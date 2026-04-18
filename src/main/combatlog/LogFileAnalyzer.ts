import { readFileSync } from 'fs'
import { CombatLogParser, UNIT_FLAG_REACTION_HOSTILE } from './CombatLogParser'
import type {
  ArenaBracket,
  ArenaResult,
  ArenaPlayerStats,
  MatchAnalysis,
  TimelineEvent
} from '@shared/ipc.types'
import { SPELL_CLASS_MAP, SPELL_SPEC_MAP, HEALER_SPEC_BY_CLASS } from '@shared/constants'
import { getClassDefensives } from '@shared/classAbilities'

interface Combatant {
  guid: string
  name: string
  team: number
  personalRating: number
}

interface InProgressMatch {
  bracket: ArenaBracket
  zone: string
  date: string
  matchStartTime: Date
  isSoloShuffle: boolean
  sessionId?: string
  events: TimelineEvent[]
  playerDeaths: number
  enemyDeaths: number
  combatants: Combatant[]
  // Team slot (0 or 1) of the logging player — from ARENA_MATCH_START field 3.
  localTeam: number
}

export class LogFileAnalyzer {
  analyze(filePath: string, localPlayerGuid?: string): MatchAnalysis[] {
    const content = readFileSync(filePath, 'utf-8')
    const lines = content.split('\n')

    const matches: MatchAnalysis[] = []
    let current: InProgressMatch | null = null

    // GUIDs of units that cast at least one heal — used for healer detection
    const healerGuids = new Set<string>()
    // GUID → class name, inferred from spell IDs observed during matches
    const guidToClass = new Map<string, string>()
    // GUID → spec name, inferred from spec-unique spell IDs
    const guidToSpec = new Map<string, string>()
    // GUID → (spellId → last-used relative timestamp), for death analysis
    const lastDefensiveUse = new Map<string, Map<number, number>>()

    // CC duration tracking: `${targetGuid}-${spellId}` → { event ref, relSecs of aura application }
    type PendingCC = { event: TimelineEvent; appliedAt: number }
    const pendingCCs = new Map<string, PendingCC>()

    const parser = new CombatLogParser()

    // -----------------------------------------------------------------------
    // Match lifecycle
    // -----------------------------------------------------------------------

    parser.on('arenaMatchStart', (e) => {
      pendingCCs.clear()
      current = {
        bracket: e.bracket,
        zone: e.zoneName,
        date: e.timestamp.toISOString(),
        matchStartTime: e.timestamp,
        isSoloShuffle: e.bracket === 'solo-shuffle',
        events: [{ timestamp: 0, type: 'arena-start' }],
        playerDeaths: 0,
        enemyDeaths: 0,
        combatants: [],
        localTeam: e.localTeam
      }
    })

    // COMBATANT_INFO fires right after ARENA_MATCH_START — add to current match
    parser.on('combatantInfo', (e) => {
      if (current === null) return
      current.combatants.push({
        guid: e.playerGuid,
        name: e.playerName,
        team: e.team,
        personalRating: e.personalRating
      })
    })

    parser.on('arenaMatchEnd', (e) => {
      if (current === null) return
      current.events.push({ timestamp: e.durationSecs, type: 'arena-end' })
      matches.push(finalizeMatch(matches.length, current, e.result, e.durationSecs, healerGuids, parser.nameCache, guidToClass, guidToSpec, undefined, undefined, localPlayerGuid))
      current = null
    })

    parser.on('soloShuffleRoundEnd', (e) => {
      if (current === null) return
      current.sessionId = e.sessionId
      current.events.push({ timestamp: e.durationSecs, type: 'arena-end' })
      matches.push(finalizeMatch(matches.length, current, e.result, e.durationSecs, healerGuids, parser.nameCache, guidToClass, guidToSpec, e.roundNumber, e.sessionId, localPlayerGuid))
      current = null
    })

    parser.on('soloShuffleSessionEnd', (e) => {
      for (const m of matches) {
        if (m.sessionId === e.sessionId) {
          m.playerName = e.playerName
          m.ratingBefore = e.ratingBefore
          m.ratingAfter = e.ratingAfter
        }
      }
    })

    // -----------------------------------------------------------------------
    // Spell events
    // -----------------------------------------------------------------------

    parser.on('spellCast', (e) => {
      const cls = SPELL_CLASS_MAP[e.spellId]
      if (cls !== undefined && e.casterGuid.startsWith('Player-')) {
        guidToClass.set(e.casterGuid, cls)
      }
      const spec = SPELL_SPEC_MAP[e.spellId]
      if (spec !== undefined && e.casterGuid.startsWith('Player-')) {
        guidToSpec.set(e.casterGuid, spec)
      }
      if (current === null) return
      const relSecs = (e.timestamp.getTime() - current.matchStartTime.getTime()) / 1000

      // Track defensive + trinket spell usage for death analysis
      if (
        (e.eventCategory === 'defensive' || e.eventCategory === 'trinket') &&
        e.casterGuid.startsWith('Player-')
      ) {
        if (!lastDefensiveUse.has(e.casterGuid)) lastDefensiveUse.set(e.casterGuid, new Map())
        lastDefensiveUse.get(e.casterGuid)!.set(e.spellId, relSecs)
      }
      const isEnemy = (e.targetFlags & UNIT_FLAG_REACTION_HOSTILE) !== 0
      current.events.push({
        timestamp: relSecs,
        type: e.eventCategory,
        spellId: e.spellId,
        spellName: e.spellName,
        casterName: e.casterName,
        targetName: e.targetName,
        target: isEnemy ? 'enemy' : 'player'
      })
    })

    parser.on('unitDied', (e) => {
      if (current === null) return
      const relSecs = (e.timestamp.getTime() - current.matchStartTime.getTime()) / 1000
      const isEnemy = (e.destFlags & UNIT_FLAG_REACTION_HOSTILE) !== 0

      // Compute which defensives were available at time of death
      const unusedDefensives = computeUnusedDefensives(
        e.unitGuid,
        relSecs,
        guidToClass,
        lastDefensiveUse
      )

      current.events.push({
        timestamp: relSecs,
        type: isEnemy ? 'death-enemy' : 'death-player',
        unit: e.unitName,
        unusedDefensives: unusedDefensives.length > 0 ? unusedDefensives : undefined
      })
      if (isEnemy) current.enemyDeaths++
      else current.playerDeaths++
    })

    parser.on('spellAuraApplied', (e) => {
      if (current === null) return
      const relSecs = (e.timestamp.getTime() - current.matchStartTime.getTime()) / 1000
      // Find the most recent CC timeline event for this spell on this target and link it
      const ccEvent = [...current.events]
        .reverse()
        .find((ev) => ev.type === 'cc' && ev.spellId === e.spellId && ev.targetName === e.targetName)
      if (ccEvent !== undefined) {
        pendingCCs.set(`${e.targetGuid}-${e.spellId}`, { event: ccEvent, appliedAt: relSecs })
      }
    })

    parser.on('spellAuraRemoved', (e) => {
      if (current === null) return
      const relSecs = (e.timestamp.getTime() - current.matchStartTime.getTime()) / 1000
      const key = `${e.targetGuid}-${e.spellId}`
      const pending = pendingCCs.get(key)
      if (pending !== undefined) {
        pending.event.duration = Math.round((relSecs - pending.appliedAt) * 10) / 10
        pendingCCs.delete(key)
      }
    })

    parser.on('healerCast', (e) => {
      healerGuids.add(e.casterGuid)
    })

    // -----------------------------------------------------------------------
    // Parse all lines
    // -----------------------------------------------------------------------

    for (const line of lines) {
      parser.processLine(line)
    }

    return matches
  }
}

function finalizeMatch(
  index: number,
  m: InProgressMatch,
  result: ArenaResult,
  duration: number,
  healerGuids: Set<string>,
  guidToName: ReadonlyMap<string, string>,
  guidToClass: ReadonlyMap<string, string>,
  guidToSpec: ReadonlyMap<string, string>,
  round?: number,
  sessionId?: string,
  localPlayerGuid?: string
): MatchAnalysis {
  // Backfill combatant names that were empty at COMBATANT_INFO time (enemy team names
  // arrive only via spell events that fire during combat, after COMBATANT_INFO)
  for (const c of m.combatants) {
    if (!c.name) {
      c.name = guidToName.get(c.guid) ?? ''
    }
  }

  // Classes that have a healing specialization.
  const HEALER_CAPABLE_CLASSES = new Set([
    'Druid', 'Paladin', 'Priest', 'Shaman', 'Monk', 'Evoker'
  ])
  // Specs that are definitively DPS — override healer detection even if the player
  // cast heals on others (e.g. Shadow Priest Vampiric Embrace, Balance Druid procs).
  const DPS_SPECS = new Set([
    'Shadow', 'Balance', 'Feral',
    'Retribution', 'Arms', 'Fury',
    'Fire', 'Frost', 'Arcane',
    'Outlaw', 'Assassination', 'Subtlety',
    'Devastation', 'Augmentation',
    'Havoc', 'Vengeance',
    'Unholy',
    'Elemental', 'Enhancement',
    'Affliction', 'Demonology', 'Destruction',
    'Windwalker', 'Brewmaster',
  ])

  // Determine healer names: must cast heals on others, class must be healer-capable,
  // and spec must not be a known DPS spec.
  const healerNames = new Set<string>(
    m.combatants
      .filter((c) => {
        if (!healerGuids.has(c.guid) || !c.name) return false
        const cls = guidToClass.get(c.guid)
        if (cls && !HEALER_CAPABLE_CLASSES.has(cls)) return false
        const spec = guidToSpec.get(c.guid)
        if (spec && DPS_SPECS.has(spec)) return false
        return true
      })
      .map((c) => c.name)
  )

  // Build team arrays — team 0 = enemy, team 1 = local player's team
  const toStats = (c: Combatant): ArenaPlayerStats => {
    const className = guidToClass.get(c.guid) ?? ''
    const isHealer = healerNames.has(c.name)
    // Spec: use observed spec-unique spell, or derive from healer class
    let specName = guidToSpec.get(c.guid) ?? ''
    if (!specName && isHealer && className) {
      specName = HEALER_SPEC_BY_CLASS[className] ?? ''
    }
    return {
      guid: c.guid,
      name: c.name,
      team: c.team,
      ratingBefore: c.personalRating,
      ratingAfter: c.personalRating,
      isHealer,
      className,
      specName
    }
  }

  // Determine which team slot is "ours": prefer GUID lookup (accurate), fall back to
  // m.localTeam from ARENA_MATCH_START field 3 (unreliable for skirmish, always 0).
  const localTeam = localPlayerGuid !== undefined
    ? (m.combatants.find((c) => c.guid === localPlayerGuid)?.team ?? m.localTeam)
    : m.localTeam
  const playerTeam: ArenaPlayerStats[] = m.combatants.filter((c) => c.team === localTeam).map(toStats)
  const enemyTeam: ArenaPlayerStats[] = m.combatants.filter((c) => c.team !== localTeam).map(toStats)

  // Post-process: flag CC events targeting known healers
  for (const ev of m.events) {
    if (ev.type === 'cc' && ev.targetName !== undefined) {
      ev.isHealerCC = healerNames.has(ev.targetName)
    }
  }

  // Local player rating from their own combatant entry (any team-1 player)
  // For 2v2/3v3 we expose the whole team's ratings; for SS it gets backfilled later
  const localPlayer = playerTeam[0]

  return {
    id: String(index),
    bracket: m.bracket,
    zone: m.zone,
    result,
    duration,
    date: m.date,
    playerName: localPlayer?.name ?? '',
    ratingBefore: localPlayer?.personalRating,
    ratingAfter: undefined,  // not available without ARENA_MATCH_END delta
    round,
    sessionId: sessionId ?? m.sessionId,
    events: m.events,
    playerTeam,
    enemyTeam,
    summary: {
      playerDeaths: m.playerDeaths,
      enemyDeaths: m.enemyDeaths,
      ccCount: m.events.filter((e) => e.type === 'cc').length,
      interruptCount: m.events.filter((e) => e.type === 'interrupt').length,
      defensiveCount: m.events.filter((e) => e.type === 'defensive').length,
      offensiveCount: m.events.filter((e) => e.type === 'offensive').length,
      ccBreakCount: m.events.filter((e) => e.type === 'cc-break').length
    }
  }
}

function computeUnusedDefensives(
  guid: string,
  deathTime: number,
  guidToClass: ReadonlyMap<string, string>,
  lastDefensiveUse: Map<string, Map<number, number>>
): string[] {
  const className = guidToClass.get(guid)
  if (!className) return []

  const defensives = getClassDefensives(className)
  const usageMap = lastDefensiveUse.get(guid)
  const unused: string[] = []

  for (const ability of defensives) {
    const allIds = [ability.spellId, ...(ability.alternateIds ?? [])]
    let lastUsed: number | undefined
    for (const id of allIds) {
      const used = usageMap?.get(id)
      if (used !== undefined && (lastUsed === undefined || used > lastUsed)) {
        lastUsed = used
      }
    }
    const isOnCooldown = lastUsed !== undefined && deathTime - lastUsed < ability.cooldownSecs
    if (!isOnCooldown) {
      unused.push(ability.name)
    }
  }

  return unused
}
