// Parses WoW combat log lines and emits typed arena events.
// Line format: "M/D HH:MM:SS.mmm  EVENT_TYPE,field1,field2,..."
// Two spaces separate the timestamp from the event data.
//
// IMPORTANT: Field indices for ARENA_MATCH_STATS must be verified against
// each WoW patch's combat log format. See STATS_FIELD_* constants below.

import { EventEmitter } from 'events'
import type { ArenaBracket, ArenaResult } from '@shared/ipc.types'
import {
  ARENA_ZONE_IDS,
  ARENA_ZONE_NAMES,
  BRACKET_FIELD_MAP,
  SOLO_SHUFFLE_ROUNDS_PER_SESSION,
  SPELL_IDS_CC,
  SPELL_IDS_DEFENSIVE,
  SPELL_IDS_OFFENSIVE,
  SPELL_IDS_INTERRUPT,
  SPELL_IDS_CC_BREAK,
  SPELL_IDS_TRINKET
} from '@shared/constants'

// ---------------------------------------------------------------------------
// ARENA_MATCH_STATS field indices (0-indexed, after the event type field).
// Verify these against the active patch's combat log format.
// Approximate layout: GUID, name, realm, teamIndex, teamName, score, ..., ratingBefore, ratingAfter
// ---------------------------------------------------------------------------
const STATS_FIELD_PLAYER_GUID = 0
const STATS_FIELD_PLAYER_NAME = 1
const STATS_FIELD_TEAM = 3        // 0 = local player's team, 1 = enemy — verify per patch
const STATS_FIELD_RATING_BEFORE = 13
const STATS_FIELD_RATING_AFTER = 14

// ---------------------------------------------------------------------------
// ZONE_CHANGE field indices
// ---------------------------------------------------------------------------
const ZONE_FIELD_INSTANCE_ID = 0
const ZONE_FIELD_ZONE_NAME = 1

// ---------------------------------------------------------------------------
// ARENA_MATCH_START field indices
// ---------------------------------------------------------------------------
const MATCH_START_FIELD_INSTANCE_ID = 0
const MATCH_START_FIELD_BRACKET = 2
// Field 3: which team the logging player is on (0 or 1). Used to derive WIN/LOSS from
// ARENA_MATCH_END's winningTeam, since the logging player is not always on team 0.
const MATCH_START_FIELD_LOCAL_TEAM = 3

// ---------------------------------------------------------------------------
// COMBATANT_INFO field indices (simple prefix fields — before the bracket sections)
// ---------------------------------------------------------------------------
const COMBATANT_FIELD_GUID = 0
const COMBATANT_FIELD_TEAM = 1  // 0 = enemy team, 1 = local player's team (matches localTeam)

// ---------------------------------------------------------------------------
// ARENA_MATCH_END field indices
// ---------------------------------------------------------------------------
const MATCH_END_FIELD_WINNING_TEAM = 0
const MATCH_END_FIELD_DURATION = 1

// ---------------------------------------------------------------------------
// SPELL_CAST_SUCCESS / SPELL_HEAL field indices
// Standard WoW prefix layout: srcGUID, srcName, srcFlags, srcRaidFlags,
// dstGUID, dstName, dstFlags, dstRaidFlags, spellId, spellName, spellSchool
// ---------------------------------------------------------------------------
const SPELL_FIELD_CASTER_GUID = 0
const SPELL_FIELD_CASTER_NAME = 1
const SPELL_FIELD_CASTER_FLAGS = 2
const SPELL_FIELD_TARGET_GUID = 4
const SPELL_FIELD_TARGET_NAME = 5
const SPELL_FIELD_TARGET_FLAGS = 6
const SPELL_FIELD_SPELL_ID = 8
const SPELL_FIELD_SPELL_NAME = 9
// After spell prefix (spellId, spellName, spellSchool), damage/heal suffix starts at field 11
const SPELL_SUFFIX_AMOUNT = 11
// SWING_DAMAGE has no spell prefix, amount is directly at field 8
const SWING_DAMAGE_AMOUNT = 8

// ---------------------------------------------------------------------------
// SPELL_INTERRUPT field indices
// Same prefix layout as SPELL_CAST_SUCCESS, followed by:
//   interruptSpellId, interruptSpellName, school, interruptedSpellId, interruptedSpellName, interruptedSchool
// ---------------------------------------------------------------------------
const INTERRUPT_FIELD_SPELL_ID = 8
const INTERRUPT_FIELD_SPELL_NAME = 9
const INTERRUPT_FIELD_INTERRUPTED_SPELL_ID = 11
const INTERRUPT_FIELD_INTERRUPTED_SPELL_NAME = 12

// Precognition buff — applied when an interrupt is used on a player who wasn't casting
// (or was immune). Used to detect bad/wasted interrupts.
const PRECOGNITION_SPELL_ID = 377362

// ---------------------------------------------------------------------------
// UNIT_DIED field indices
// srcGUID, srcName, srcFlags, srcRaidFlags, destGUID, destName, destFlags, destRaidFlags, unconscious
// ---------------------------------------------------------------------------
const UNIT_DIED_FIELD_DEST_GUID = 4
const UNIT_DIED_FIELD_DEST_NAME = 5
const UNIT_DIED_FIELD_DEST_FLAGS = 6

// ---------------------------------------------------------------------------
// UNIT_HEALTH field indices (Advanced Combat Logging only)
// srcGUID, srcName, srcFlags, srcRaidFlags, destGUID, destName, destFlags, destRaidFlags, hp, maxHp
// ---------------------------------------------------------------------------
const UNIT_HEALTH_FIELD_UNIT_GUID = 4
const UNIT_HEALTH_FIELD_UNIT_NAME = 5
const UNIT_HEALTH_FIELD_HP = 8
const UNIT_HEALTH_FIELD_MAX_HP = 9

// WoW combat log unit flag bit — set when the unit is on the hostile/enemy team.
const UNIT_FLAG_REACTION_HOSTILE = 0x40

// ---------------------------------------------------------------------------
// Event payload types
// ---------------------------------------------------------------------------

export interface ArenaZoneEnteredEvent {
  zoneId: number
  zoneName: string
  timestamp: Date
}

export interface ArenaZoneLeftEvent {
  timestamp: Date
}

export interface ArenaMatchStartEvent {
  instanceId: number
  zoneName: string
  bracket: ArenaBracket
  // Which WoW team slot the logging player is on (0 or 1).
  // Use this to determine which COMBATANT_INFO team value maps to "our team".
  localTeam: number
  timestamp: Date
}

export interface SpellAuraEvent {
  casterGuid: string
  casterName: string
  targetGuid: string
  targetName: string
  targetFlags: number
  spellId: number
  spellName: string
  timestamp: Date
}

export interface ArenaMatchEndEvent {
  result: ArenaResult
  durationSecs: number
  timestamp: Date
}

export interface SoloShuffleRoundEndEvent {
  roundNumber: number
  result: ArenaResult
  durationSecs: number
  sessionId: string
  timestamp: Date
}

export interface SoloShuffleSessionEndEvent {
  sessionId: string
  totalRounds: number
  ratingBefore: number
  ratingAfter: number
  playerGuid: string
  playerName: string
  timestamp: Date
}

export interface SpellCastEvent {
  casterGuid: string
  casterName: string
  targetGuid: string
  targetName: string
  // Raw WoW unit flags for the spell target. Use UNIT_FLAG_REACTION_HOSTILE (0x40) to
  // determine whether the target is an enemy (hostile) or a teammate (friendly).
  targetFlags: number
  spellId: number
  spellName: string
  eventCategory: 'cc' | 'defensive' | 'offensive' | 'interrupt' | 'cc-break' | 'trinket'
  timestamp: Date
}

export interface ArenaMatchStatsEntryEvent {
  playerGuid: string
  playerName: string
  team: number  // 0 = local player's team, 1 = enemy team (STATS_FIELD_TEAM — verify per patch)
  ratingBefore: number
  ratingAfter: number
  timestamp: Date
}

export interface HealerCastEvent {
  casterGuid: string
  casterName: string
  timestamp: Date
}

// Fired for SPELL_DAMAGE, SWING_DAMAGE, SPELL_PERIODIC_DAMAGE — used for death summary and team charts
export interface SpellDamageEvent {
  casterGuid: string
  casterName: string
  casterFlags: number
  targetGuid: string
  targetName: string
  spellId?: number    // undefined for SWING_DAMAGE
  spellName: string   // 'Auto Attack' for SWING_DAMAGE
  amount: number
  timestamp: Date
}

// Fired for SPELL_HEAL / SPELL_PERIODIC_HEAL — used for team healing charts
export interface SpellHealAmountEvent {
  casterGuid: string
  casterName: string
  amount: number
  timestamp: Date
}

// Fired for SPELL_INTERRUPT — a successful interrupt landed on a casting target.
export interface SpellInterruptSuccessEvent {
  casterGuid: string
  casterName: string
  casterFlags: number
  targetGuid: string
  targetName: string
  targetFlags: number
  spellId: number
  spellName: string
  interruptedSpellId: number
  interruptedSpellName: string
  timestamp: Date
}

// Fired when Precognition (377362) is applied to a player — indicates someone wasted
// an interrupt on them while they weren't casting an interruptible spell.
export interface PrecognitionGainedEvent {
  playerGuid: string
  playerName: string
  timestamp: Date
}

export interface CombatantInfoEvent {
  playerGuid: string
  playerName: string
  team: number        // 0 = enemy, 1 = local player's team
  personalRating: number
  specId: number | null  // WoW spec ID from trailing field (may be 0 if not available)
  timestamp: Date
}

export interface UnitDiedEvent {
  unitGuid: string
  unitName: string
  // Raw WoW unit flags for the unit that died. Use UNIT_FLAG_REACTION_HOSTILE (0x40)
  // to determine whether the death was a player-team death or an enemy death.
  destFlags: number
  // true = feign death / battle-res / ankh; unit did not actually die. Ignore for round result tracking.
  unconscious?: boolean
  timestamp: Date
}

// Fired for UNIT_HEALTH events (requires Advanced Combat Logging in WoW).
// Provides current HP snapshot per unit — used to attach HP% to death summary hits.
export interface UnitHealthEvent {
  unitGuid: string
  unitName: string
  hp: number
  maxHp: number
  timestamp: Date
}

// Re-exported so callers can test hostility without coupling to the bit value.
export { UNIT_FLAG_REACTION_HOSTILE }

// ---------------------------------------------------------------------------
// Typed event map for the EventEmitter
// ---------------------------------------------------------------------------

export interface ParserEventMap {
  arenaZoneEntered: ArenaZoneEnteredEvent
  arenaZoneLeft: ArenaZoneLeftEvent
  arenaMatchStart: ArenaMatchStartEvent
  arenaMatchEnd: ArenaMatchEndEvent
  soloShuffleRoundEnd: SoloShuffleRoundEndEvent
  soloShuffleSessionEnd: SoloShuffleSessionEndEvent
  spellCast: SpellCastEvent
  spellAuraApplied: SpellAuraEvent
  spellAuraRemoved: SpellAuraEvent
  unitDied: UnitDiedEvent
  unitHealth: UnitHealthEvent
  arenaMatchStatsEntry: ArenaMatchStatsEntryEvent
  healerCast: HealerCastEvent
  combatantInfo: CombatantInfoEvent
  spellDamage: SpellDamageEvent
  spellHealAmount: SpellHealAmountEvent
  spellInterruptSuccess: SpellInterruptSuccessEvent
  precognitionGained: PrecognitionGainedEvent
}

// ---------------------------------------------------------------------------
// Internal parser state for the current arena session
// ---------------------------------------------------------------------------

interface SessionState {
  sessionId: string
  zoneId: number
  zoneName: string
  bracket: ArenaBracket | null
  isSoloShuffle: boolean
  localTeam: number   // 0 or 1 — which team the logging player is on (from ARENA_MATCH_START)
  // Solo Shuffle only
  roundCount: number
  roundResults: ArenaResult[]
}

// ---------------------------------------------------------------------------
// CombatLogParser
// ---------------------------------------------------------------------------

export class CombatLogParser extends EventEmitter {
  private session: SessionState | null = null
  // GUID → player name, built from standard-prefix spell/aura events
  private readonly guidNames = new Map<string, string>()

  // Typed overrides for EventEmitter methods
  override emit<K extends keyof ParserEventMap>(event: K, payload: ParserEventMap[K]): boolean {
    return super.emit(event, payload)
  }

  override on<K extends keyof ParserEventMap>(
    event: K,
    listener: (payload: ParserEventMap[K]) => void
  ): this {
    return super.on(event, listener)
  }

  override once<K extends keyof ParserEventMap>(
    event: K,
    listener: (payload: ParserEventMap[K]) => void
  ): this {
    return super.once(event, listener)
  }

  override off<K extends keyof ParserEventMap>(
    event: K,
    listener: (payload: ParserEventMap[K]) => void
  ): this {
    return super.off(event, listener)
  }

  // Exposes the accumulated GUID→name cache so callers can backfill names that were
  // missing at event-emit time (e.g. COMBATANT_INFO fires before combat spell events).
  get nameCache(): ReadonlyMap<string, string> {
    return this.guidNames
  }

  // Reset all session state — call on app start or after crash recovery
  reset(): void {
    this.session = null
    this.guidNames.clear()
  }

  // Main entry point. Call once per log line.
  processLine(line: string): void {
    const parsed = parseLine(line)
    if (parsed === null) return

    const { timestamp, eventType, fields } = parsed

    // Cache GUID→name from standard unit-prefix events (srcGUID/srcName, dstGUID/dstName).
    // Player names always follow "CharacterName-RealmName" format — guard with includes('-')
    // to avoid overwriting the cache with numeric fields (e.g. COMBATANT_INFO team index).
    if (fields[0]?.startsWith('Player-') && fields[1]?.includes('-')) {
      this.guidNames.set(fields[0], fields[1])
    }
    if (fields[4]?.startsWith('Player-') && fields[5]?.includes('-')) {
      this.guidNames.set(fields[4], fields[5])
    }

    switch (eventType) {
      case 'COMBATANT_INFO':
        this.handleCombatantInfo(fields, line, timestamp)
        break
      case 'ZONE_CHANGE':
        this.handleZoneChange(fields, timestamp)
        break
      case 'ARENA_MATCH_START':
        this.handleArenaMatchStart(fields, timestamp)
        break
      case 'ARENA_MATCH_END':
        this.handleArenaMatchEnd(fields, timestamp)
        break
      case 'ARENA_MATCH_STATS':
        this.handleArenaMatchStats(fields, timestamp)
        break
      case 'SPELL_CAST_SUCCESS':
        this.handleSpellCastSuccess(fields, timestamp)
        break
      case 'SPELL_INTERRUPT':
        this.handleSpellInterrupt(fields, timestamp)
        break
      case 'SPELL_AURA_APPLIED':
        this.handleSpellAura(fields, timestamp, 'spellAuraApplied')
        break
      case 'SPELL_AURA_REMOVED':
        this.handleSpellAura(fields, timestamp, 'spellAuraRemoved')
        break
      case 'SPELL_HEAL':
      case 'SPELL_PERIODIC_HEAL':
        this.handleSpellHeal(fields, timestamp)
        break
      case 'SPELL_DAMAGE':
      case 'SPELL_PERIODIC_DAMAGE':
        this.handleSpellDamage(fields, timestamp)
        break
      case 'SWING_DAMAGE':
        this.handleSwingDamage(fields, timestamp)
        break
      case 'UNIT_DIED':
        this.handleUnitDied(fields, timestamp)
        break
      case 'UNIT_HEALTH':
        this.handleUnitHealth(fields, timestamp)
        break
      default:
        break
    }
  }

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  private handleZoneChange(fields: string[], timestamp: Date): void {
    const rawId = fields[ZONE_FIELD_INSTANCE_ID]
    const zoneName = fields[ZONE_FIELD_ZONE_NAME] ?? ''
    const instanceId = parseInt(rawId ?? '', 10)

    if (isNaN(instanceId)) return

    const isArena = ARENA_ZONE_IDS.has(instanceId)

    if (isArena) {
      const resolvedName = ARENA_ZONE_NAMES[instanceId] ?? zoneName

      this.session = {
        sessionId: timestamp.toISOString(),
        zoneId: instanceId,
        zoneName: resolvedName,
        bracket: null,
        isSoloShuffle: false,
        localTeam: 0,
        roundCount: 0,
        roundResults: []
      }

      this.emit('arenaZoneEntered', {
        zoneId: instanceId,
        zoneName: resolvedName,
        timestamp
      })
    } else if (this.session !== null) {
      // Left an arena zone
      this.session = null
      this.emit('arenaZoneLeft', { timestamp })
    }
  }

  private handleArenaMatchStart(fields: string[], timestamp: Date): void {
    if (this.session === null) return

    const rawInstanceId = fields[MATCH_START_FIELD_INSTANCE_ID]
    const rawBracket = fields[MATCH_START_FIELD_BRACKET]

    if (rawBracket === undefined) return

    const bracketLower = rawBracket.toLowerCase()
    const bracket = BRACKET_FIELD_MAP[bracketLower]
    if (bracket === undefined) return

    const instanceId = parseInt(rawInstanceId ?? '', 10)
    if (isNaN(instanceId)) return

    this.session.bracket = bracket
    this.session.isSoloShuffle = bracket === 'solo-shuffle'
    this.session.localTeam = parseInt(fields[MATCH_START_FIELD_LOCAL_TEAM] ?? '0', 10) || 0

    // Diagnostic: log raw fields to verify indices per Midnight patch
    console.warn('[Parser] ARENA_MATCH_START fields:', JSON.stringify(fields.slice(0, 6)))
    console.warn(`[Parser] MATCH_START → bracket="${bracket}", localTeam=${this.session.localTeam}`)

    this.emit('arenaMatchStart', {
      instanceId,
      zoneName: this.session.zoneName,
      bracket,
      localTeam: this.session.localTeam,
      timestamp
    })
  }

  private handleArenaMatchEnd(fields: string[], timestamp: Date): void {
    if (this.session === null || this.session.bracket === null) return

    const rawWinningTeam = fields[MATCH_END_FIELD_WINNING_TEAM]
    const rawDuration = fields[MATCH_END_FIELD_DURATION]

    if (rawWinningTeam === undefined || rawDuration === undefined) return

    const winningTeam = parseInt(rawWinningTeam, 10)
    const durationSecs = parseInt(rawDuration, 10)

    if (isNaN(winningTeam) || isNaN(durationSecs)) return

    // Diagnostic: log raw fields to verify indices per Midnight patch
    console.warn('[Parser] ARENA_MATCH_END fields:', JSON.stringify(fields.slice(0, 4)))
    console.warn(`[Parser] MATCH_END → winningTeam=${winningTeam}, durationSecs=${durationSecs}, localTeam=${this.session.localTeam}`)

    // localTeam is read from ARENA_MATCH_START field 3. The logging player wins when
    // the winning team matches their own team number.
    const result: ArenaResult = winningTeam === this.session.localTeam ? 'WIN' : 'LOSS'

    // Midnight (12.x): ARENA_MATCH_END fires once at the end of the entire session for
    // all brackets including Solo Shuffle — emit arenaMatchEnd unconditionally.
    this.emit('arenaMatchEnd', {
      result,
      durationSecs,
      timestamp
    })
  }

  private handleArenaMatchStats(fields: string[], timestamp: Date): void {
    const playerGuid = fields[STATS_FIELD_PLAYER_GUID]
    const playerName = fields[STATS_FIELD_PLAYER_NAME]
    const rawTeam = fields[STATS_FIELD_TEAM]
    const rawRatingBefore = fields[STATS_FIELD_RATING_BEFORE]
    const rawRatingAfter = fields[STATS_FIELD_RATING_AFTER]

    if (playerGuid === undefined || playerName === undefined) return

    const team = parseInt(rawTeam ?? '0', 10)
    const ratingBefore = parseInt(rawRatingBefore ?? '0', 10)
    const ratingAfter = parseInt(rawRatingAfter ?? '0', 10)

    // Emit per-player stats entry for all bracket types so the log analyser can
    // build team compositions and per-player rating changes.
    this.emit('arenaMatchStatsEntry', {
      playerGuid,
      playerName,
      team: isNaN(team) ? 0 : team,
      ratingBefore: isNaN(ratingBefore) ? 0 : ratingBefore,
      ratingAfter: isNaN(ratingAfter) ? 0 : ratingAfter,
      timestamp
    })

    // Solo Shuffle session-end logic — fires once after all 6 rounds are done.
    if (
      this.session !== null &&
      this.session.isSoloShuffle &&
      this.session.roundCount >= SOLO_SHUFFLE_ROUNDS_PER_SESSION &&
      !isNaN(ratingBefore) &&
      !isNaN(ratingAfter)
    ) {
      const { sessionId, roundCount } = this.session
      this.session = null

      this.emit('soloShuffleSessionEnd', {
        sessionId,
        totalRounds: roundCount,
        ratingBefore,
        ratingAfter,
        playerGuid,
        playerName,
        timestamp
      })
    }
  }

  private handleSpellCastSuccess(fields: string[], timestamp: Date): void {
    const rawSpellId = fields[SPELL_FIELD_SPELL_ID]
    if (rawSpellId === undefined) return

    const spellId = parseInt(rawSpellId, 10)
    if (isNaN(spellId)) return

    const category = resolveSpellCategory(spellId)
    if (category === null) return

    const casterGuid = fields[SPELL_FIELD_CASTER_GUID]
    const casterName = fields[SPELL_FIELD_CASTER_NAME] ?? ''
    const targetGuid = fields[SPELL_FIELD_TARGET_GUID]
    const targetName = fields[SPELL_FIELD_TARGET_NAME] ?? ''
    const spellName = fields[SPELL_FIELD_SPELL_NAME] ?? ''

    if (casterGuid === undefined || targetGuid === undefined) return

    const targetFlags = parseHexFlags(fields[SPELL_FIELD_TARGET_FLAGS] ?? '0')

    this.emit('spellCast', {
      casterGuid,
      casterName,
      targetGuid,
      targetName,
      targetFlags,
      spellId,
      spellName,
      eventCategory: category,
      timestamp
    })
  }

  private handleSpellAura(
    fields: string[],
    timestamp: Date,
    event: 'spellAuraApplied' | 'spellAuraRemoved'
  ): void {
    const rawSpellId = fields[SPELL_FIELD_SPELL_ID]
    if (rawSpellId === undefined) return
    const spellId = parseInt(rawSpellId, 10)
    if (isNaN(spellId)) return

    // Precognition: fired when an interrupt is wasted on a player who wasn't casting.
    // Self-applied buff — src and dst are the same player.
    if (event === 'spellAuraApplied' && spellId === PRECOGNITION_SPELL_ID) {
      const playerGuid = fields[SPELL_FIELD_TARGET_GUID]
      const playerName = fields[SPELL_FIELD_TARGET_NAME] ?? ''
      if (playerGuid !== undefined) {
        this.emit('precognitionGained', { playerGuid, playerName, timestamp })
      }
      return
    }

    if (!SPELL_IDS_CC.has(spellId)) return

    const casterGuid = fields[SPELL_FIELD_CASTER_GUID]
    const casterName = fields[SPELL_FIELD_CASTER_NAME] ?? ''
    const targetGuid = fields[SPELL_FIELD_TARGET_GUID]
    const targetName = fields[SPELL_FIELD_TARGET_NAME] ?? ''
    const spellName = fields[SPELL_FIELD_SPELL_NAME] ?? ''

    if (casterGuid === undefined || targetGuid === undefined) return

    const targetFlags = parseHexFlags(fields[SPELL_FIELD_TARGET_FLAGS] ?? '0')

    this.emit(event, { casterGuid, casterName, targetGuid, targetName, targetFlags, spellId, spellName, timestamp })
  }

  private handleSpellInterrupt(fields: string[], timestamp: Date): void {
    const casterGuid = fields[SPELL_FIELD_CASTER_GUID]
    const casterName = fields[SPELL_FIELD_CASTER_NAME] ?? ''
    const targetGuid = fields[SPELL_FIELD_TARGET_GUID]
    const targetName = fields[SPELL_FIELD_TARGET_NAME] ?? ''

    if (casterGuid === undefined || targetGuid === undefined) return

    const rawSpellId = fields[INTERRUPT_FIELD_SPELL_ID]
    const rawInterruptedSpellId = fields[INTERRUPT_FIELD_INTERRUPTED_SPELL_ID]
    if (rawSpellId === undefined || rawInterruptedSpellId === undefined) return

    const spellId = parseInt(rawSpellId, 10)
    const interruptedSpellId = parseInt(rawInterruptedSpellId, 10)
    if (isNaN(spellId) || isNaN(interruptedSpellId)) return

    const spellName = fields[INTERRUPT_FIELD_SPELL_NAME] ?? ''
    const interruptedSpellName = fields[INTERRUPT_FIELD_INTERRUPTED_SPELL_NAME] ?? ''
    const casterFlags = parseHexFlags(fields[SPELL_FIELD_CASTER_FLAGS] ?? '0')
    const targetFlags = parseHexFlags(fields[SPELL_FIELD_TARGET_FLAGS] ?? '0')

    this.emit('spellInterruptSuccess', {
      casterGuid,
      casterName,
      casterFlags,
      targetGuid,
      targetName,
      targetFlags,
      spellId,
      spellName,
      interruptedSpellId,
      interruptedSpellName,
      timestamp
    })
  }

  private handleCombatantInfo(fields: string[], rawLine: string, timestamp: Date): void {
    const playerGuid = fields[COMBATANT_FIELD_GUID]
    const rawTeam = fields[COMBATANT_FIELD_TEAM]
    if (playerGuid === undefined || rawTeam === undefined) return

    const team = parseInt(rawTeam, 10)
    if (isNaN(team)) return

    // Name is not present in COMBATANT_INFO itself — resolve from the GUID→name cache
    // populated by standard-prefix events (SPELL_AURA_REMOVED etc.) that fire nearby.
    const playerName = this.guidNames.get(playerGuid) ?? ''

    // Trailing fields after the last ']' bracket section:
    // [specOrLoadoutID, bracketID, personalRating, honorLevel]
    const trailing = parseCombatantInfoTrailing(rawLine)

    // Diagnostic: log trailing to verify format per Midnight patch
    console.warn('[Parser] COMBATANT_INFO trailing:', JSON.stringify(trailing), '| playerName:', playerName || '(unknown)', '| team:', team)

    if (trailing.length < 4) return

    // personalRating is the third-to-last field (index -2)
    const personalRating = parseInt(trailing[trailing.length - 2] ?? '', 10)
    if (isNaN(personalRating)) return

    // specId is the first trailing field after the last ']'
    const rawSpecId = parseInt(trailing[0] ?? '', 10)
    const specId = !isNaN(rawSpecId) && rawSpecId > 0 ? rawSpecId : null

    this.emit('combatantInfo', { playerGuid, playerName, team, personalRating, specId, timestamp })
  }

  private handleSpellHeal(fields: string[], timestamp: Date): void {
    const casterGuid = fields[SPELL_FIELD_CASTER_GUID]
    const casterName = fields[SPELL_FIELD_CASTER_NAME]
    const targetGuid = fields[SPELL_FIELD_TARGET_GUID]
    if (casterGuid === undefined || casterName === undefined) return

    // Emit heal amount event for ALL heals (including self) — used for team heal charts
    const rawAmount = fields[SPELL_SUFFIX_AMOUNT]
    const amount = parseInt(rawAmount ?? '0', 10)
    if (!isNaN(amount) && amount > 0) {
      this.emit('spellHealAmount', { casterGuid, casterName, amount, timestamp })
    }

    // Only count heals cast on OTHER players for healer detection — self-heals from
    // DPS specs (leech, Healthstone) must not trigger healer detection.
    if (targetGuid === casterGuid) return
    this.emit('healerCast', { casterGuid, casterName, timestamp })
  }

  private handleSpellDamage(fields: string[], timestamp: Date): void {
    const casterGuid = fields[SPELL_FIELD_CASTER_GUID]
    const casterName = fields[SPELL_FIELD_CASTER_NAME]
    const targetGuid = fields[SPELL_FIELD_TARGET_GUID]
    const targetName = fields[SPELL_FIELD_TARGET_NAME] ?? ''
    if (casterGuid === undefined || targetGuid === undefined) return

    // Only track damage between players (Pet/NPC hits are excluded by GUID prefix)
    if (!targetGuid.startsWith('Player-')) return

    const rawSpellId = fields[SPELL_FIELD_SPELL_ID]
    const spellId = rawSpellId !== undefined ? parseInt(rawSpellId, 10) : NaN
    const spellName = fields[SPELL_FIELD_SPELL_NAME] ?? 'Unknown'
    const rawAmount = fields[SPELL_SUFFIX_AMOUNT]
    const amount = parseInt(rawAmount ?? '0', 10)
    if (isNaN(amount) || amount <= 0) return

    const casterFlags = parseHexFlags(fields[SPELL_FIELD_CASTER_FLAGS] ?? '0')

    this.emit('spellDamage', {
      casterGuid,
      casterName: casterName ?? '',
      casterFlags,
      targetGuid,
      targetName,
      spellId: !isNaN(spellId) ? spellId : undefined,
      spellName,
      amount,
      timestamp
    })
  }

  private handleSwingDamage(fields: string[], timestamp: Date): void {
    const casterGuid = fields[SPELL_FIELD_CASTER_GUID]
    const casterName = fields[SPELL_FIELD_CASTER_NAME]
    const targetGuid = fields[SPELL_FIELD_TARGET_GUID]
    const targetName = fields[SPELL_FIELD_TARGET_NAME] ?? ''
    if (casterGuid === undefined || targetGuid === undefined) return

    if (!targetGuid.startsWith('Player-')) return

    const rawAmount = fields[SWING_DAMAGE_AMOUNT]
    const amount = parseInt(rawAmount ?? '0', 10)
    if (isNaN(amount) || amount <= 0) return

    const casterFlags = parseHexFlags(fields[SPELL_FIELD_CASTER_FLAGS] ?? '0')

    this.emit('spellDamage', {
      casterGuid,
      casterName: casterName ?? '',
      casterFlags,
      targetGuid,
      targetName,
      spellId: undefined,
      spellName: 'Auto Attack',
      amount,
      timestamp
    })
  }

  private handleUnitDied(fields: string[], timestamp: Date): void {
    const unitGuid = fields[UNIT_DIED_FIELD_DEST_GUID]
    const unitName = fields[UNIT_DIED_FIELD_DEST_NAME]

    if (unitGuid === undefined || unitName === undefined) return

    const destFlags = parseHexFlags(fields[UNIT_DIED_FIELD_DEST_FLAGS] ?? '0')
    const unconscious = fields[8] === '1'

    this.emit('unitDied', {
      unitGuid,
      unitName,
      destFlags,
      unconscious,
      timestamp
    })
  }

  private handleUnitHealth(fields: string[], timestamp: Date): void {
    const unitGuid = fields[UNIT_HEALTH_FIELD_UNIT_GUID]
    const unitName = fields[UNIT_HEALTH_FIELD_UNIT_NAME]
    if (unitGuid === undefined || unitName === undefined) return
    // Only track player units
    if (!unitGuid.startsWith('Player-')) return

    const hp = parseInt(fields[UNIT_HEALTH_FIELD_HP] ?? '', 10)
    const maxHp = parseInt(fields[UNIT_HEALTH_FIELD_MAX_HP] ?? '', 10)
    if (isNaN(hp) || isNaN(maxHp) || maxHp <= 0) return

    this.emit('unitHealth', { unitGuid, unitName, hp, maxHp, timestamp })
  }
}

// ---------------------------------------------------------------------------
// Utility functions (module-private)
// ---------------------------------------------------------------------------

function resolveSpellCategory(spellId: number): SpellCastEvent['eventCategory'] | null {
  if (SPELL_IDS_TRINKET.has(spellId)) return 'trinket'
  if (SPELL_IDS_CC.has(spellId)) return 'cc'
  if (SPELL_IDS_DEFENSIVE.has(spellId)) return 'defensive'
  if (SPELL_IDS_OFFENSIVE.has(spellId)) return 'offensive'
  if (SPELL_IDS_INTERRUPT.has(spellId)) return 'interrupt'
  if (SPELL_IDS_CC_BREAK.has(spellId)) return 'cc-break'
  return null
}

interface ParsedLine {
  timestamp: Date
  eventType: string
  fields: string[]
}

function parseLine(line: string): ParsedLine | null {
  // Split on the first occurrence of two consecutive spaces
  const separatorIdx = line.indexOf('  ')
  if (separatorIdx === -1) return null

  const rawTimestamp = line.substring(0, separatorIdx)
  const rest = line.substring(separatorIdx + 2)

  const timestamp = parseWowTimestamp(rawTimestamp)
  if (timestamp === null) return null

  const fields = parseCsvFields(rest)
  if (fields.length === 0) return null

  return {
    timestamp,
    eventType: fields[0] ?? '',
    fields: fields.slice(1)
  }
}

// Parses a WoW hex flag string such as "0x548" or "0x514" into a number.
// Returns 0 for any unparseable input.
function parseHexFlags(raw: string): number {
  const n = parseInt(raw, 16)
  return isNaN(n) ? 0 : n
}

// WoW combat log timestamp format: "M/D/YYYY HH:MM:SS.mmmm" (4-digit ms, with year)
const TIMESTAMP_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})\.(\d{1,4})$/

function parseWowTimestamp(raw: string): Date | null {
  const match = TIMESTAMP_RE.exec(raw)
  if (match === null) return null

  const [, month, day, year, hours, minutes, seconds, ms] = match

  return new Date(
    parseInt(year!, 10),
    parseInt(month!, 10) - 1,
    parseInt(day!, 10),
    parseInt(hours!, 10),
    parseInt(minutes!, 10),
    parseInt(seconds!, 10),
    parseInt(ms!, 10)
  )
}

// Extracts trailing numeric fields from a COMBATANT_INFO line by finding the last ']'
// and splitting everything after it on commas.
// Returns e.g. ['76', '41', '1546', '11'] for a 3v3 entry.
function parseCombatantInfoTrailing(line: string): string[] {
  const lastBracket = line.lastIndexOf(']')
  if (lastBracket === -1) return []
  return line
    .substring(lastBracket + 1)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

// Minimal CSV parser — handles double-quoted fields.
// WoW does not embed escaped quotes inside quoted fields.
function parseCsvFields(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (ch === '"') {
      inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += ch
    }
  }

  result.push(current)
  return result
}
