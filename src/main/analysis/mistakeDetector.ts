// Post-match mistake analysis. Runs once, over the already-finalized timeline for a
// match/round, correlating events that RecorderStateMachine already classifies (cc,
// defensive, offensive, interrupt, trinket, death-player/death-enemy) against a few
// pieces of state it also already tracks (isMistake/mistakeReason, unusedDefensives,
// isSuccessful) plus a new generic aura-window tracker (see RecorderStateMachine's
// auraWindows / isTrackedAuraWindow) for defensive/immunity/low-value-CC windows.
//
// Deliberately a pure function over already-computed data — no new combat-log parsing,
// no live state. Modeled on wowarenalogs' CombatMistakes analyzer, trimmed to what we
// can support without a richer per-unit action log than we currently keep.

import type { TimelineEvent, DetectedMistake } from '@shared/ipc.types'
import { SPELL_IDS_IMMUNITY, SPELL_IDS_DEFENSIVE, LOW_VALUE_CC_IDS } from '@shared/constants'

export type { DetectedMistake }

// A single aura's active window on a unit, keyed by player name at the call site
// (RecorderStateMachine resolves GUID → name before calling detectMistakes — this
// module only deals in names, matching TimelineEvent's casterName/targetName).
export interface AuraWindow {
  spellId: number
  spellName: string
  start: number
  end: number
}

const LATE_DEFENSIVE_HP_THRESHOLD = 30

// Some spells (Divine Shield, Ice Block, Aspect of the Turtle, Cyclone) are in both
// SPELL_IDS_DEFENSIVE and SPELL_IDS_IMMUNITY (they genuinely are both, in-game). Without
// this exclusion, a single offensive cast into one of them would double-fire both
// detectIntoImmunity AND detectBurstIntoDefensive — report it once, as the more specific
// "into immunity" mistake.
const NON_IMMUNITY_DEFENSIVE_IDS = new Set([...SPELL_IDS_DEFENSIVE].filter((id) => !SPELL_IDS_IMMUNITY.has(id)))

function isWindowOpenAt(windows: AuraWindow[] | undefined, spellIds: ReadonlySet<number>, atSecs: number): AuraWindow | undefined {
  if (windows === undefined) return undefined
  return windows.find((w) => spellIds.has(w.spellId) && atSecs >= w.start && atSecs <= w.end)
}

export function detectMistakes(
  timeline: TimelineEvent[],
  auraWindowsByName: ReadonlyMap<string, AuraWindow[]>
): DetectedMistake[] {
  const mistakes: DetectedMistake[] = [
    ...surfaceDrImmuneCC(timeline),
    ...surfaceBurstWithoutHealerCC(timeline),
    ...surfaceBadInterrupts(timeline),
    ...detectIntoImmunity(timeline, auraWindowsByName),
    ...detectBurstIntoDefensive(timeline, auraWindowsByName),
    ...detectTrinketOnLowValueCC(timeline, auraWindowsByName),
    ...detectLateDefensives(timeline)
  ]
  mistakes.sort((a, b) => a.timestamp - b.timestamp)
  return mistakes
}

// --- Surfacing mistakes RecorderStateMachine already flags inline (no new logic) ---

function surfaceDrImmuneCC(timeline: TimelineEvent[]): DetectedMistake[] {
  return timeline
    .filter((ev) => ev.type === 'cc' && ev.isMistake && ev.mistakeReason === 'DR immune')
    .map((ev) => ({
      id: 'dr_immune_cc',
      severity: 'MEDIUM',
      title: `${ev.spellName ?? 'CC'} into DR immunity`,
      tip: `${ev.targetName ?? 'The target'} was already immune to this CC category from diminishing returns — the cast was wasted.`,
      timestamp: ev.timestamp,
      spellId: ev.spellId,
      spellName: ev.spellName,
      targetName: ev.targetName
    }))
}

function surfaceBurstWithoutHealerCC(timeline: TimelineEvent[]): DetectedMistake[] {
  return timeline
    .filter((ev) => ev.type === 'offensive' && ev.isMistake && ev.mistakeReason === "No healer CC'd during burst")
    .map((ev) => ({
      id: 'burst_no_healer_cc',
      severity: 'MEDIUM',
      title: `${ev.spellName ?? 'Offensive cooldown'} without healer CC'd`,
      tip: `${ev.casterName ?? 'A teammate'} committed ${ev.spellName ?? 'an offensive cooldown'} while the enemy healer was completely free to react — CC the healer before committing burst next time.`,
      timestamp: ev.timestamp,
      spellId: ev.spellId,
      spellName: ev.spellName,
      targetName: ev.targetName
    }))
}

function surfaceBadInterrupts(timeline: TimelineEvent[]): DetectedMistake[] {
  return timeline
    .filter((ev) => ev.type === 'interrupt' && ev.isSuccessful === false)
    .map((ev) => ({
      id: 'bad_interrupt',
      severity: 'LOW',
      title: `${ev.spellName ?? 'Interrupt'} did not land`,
      tip: `Used on ${ev.targetName ?? 'the target'}, but did not interrupt anything — they likely weren't casting, or were immune. Check timing before kicking.`,
      timestamp: ev.timestamp,
      spellId: ev.spellId,
      spellName: ev.spellName,
      targetName: ev.targetName
    }))
}

// --- New correlations against auraWindowsByName ---

function detectIntoImmunity(
  timeline: TimelineEvent[],
  auraWindowsByName: ReadonlyMap<string, AuraWindow[]>
): DetectedMistake[] {
  const mistakes: DetectedMistake[] = []
  for (const ev of timeline) {
    if ((ev.type !== 'offensive' && ev.type !== 'cc') || ev.target !== 'enemy' || !ev.targetName) continue
    const window = isWindowOpenAt(auraWindowsByName.get(ev.targetName), SPELL_IDS_IMMUNITY, ev.timestamp)
    if (window === undefined) continue
    mistakes.push({
      id: 'into_immunity',
      severity: 'HIGH',
      title: `${ev.spellName ?? 'Cast'} into ${window.spellName}`,
      tip: `${ev.targetName} had ${window.spellName} active (full immunity) — this ${ev.type === 'cc' ? 'CC' : 'damage'} cast had no effect.`,
      timestamp: ev.timestamp,
      spellId: ev.spellId,
      spellName: ev.spellName,
      targetName: ev.targetName
    })
  }
  return mistakes
}

function detectBurstIntoDefensive(
  timeline: TimelineEvent[],
  auraWindowsByName: ReadonlyMap<string, AuraWindow[]>
): DetectedMistake[] {
  const mistakes: DetectedMistake[] = []
  for (const ev of timeline) {
    if (ev.type !== 'offensive' || ev.target !== 'enemy' || !ev.targetName) continue
    if (ev.casterName !== undefined && ev.casterName === ev.targetName) continue // self-buff, not a mistake
    const window = isWindowOpenAt(auraWindowsByName.get(ev.targetName), NON_IMMUNITY_DEFENSIVE_IDS, ev.timestamp)
    if (window === undefined) continue
    mistakes.push({
      id: 'burst_into_defensive',
      severity: 'MEDIUM',
      title: `${ev.spellName ?? 'Offensive cooldown'} into ${window.spellName}`,
      tip: `${ev.targetName} had ${window.spellName} active when this landed — the damage was significantly reduced or wasted.`,
      timestamp: ev.timestamp,
      spellId: ev.spellId,
      spellName: ev.spellName,
      targetName: ev.targetName
    })
  }
  return mistakes
}

function detectTrinketOnLowValueCC(
  timeline: TimelineEvent[],
  auraWindowsByName: ReadonlyMap<string, AuraWindow[]>
): DetectedMistake[] {
  const mistakes: DetectedMistake[] = []
  for (const ev of timeline) {
    if (ev.type !== 'trinket' || !ev.casterName) continue
    const window = isWindowOpenAt(auraWindowsByName.get(ev.casterName), LOW_VALUE_CC_IDS, ev.timestamp)
    if (window === undefined) continue
    mistakes.push({
      id: 'trinket_low_value_cc',
      severity: 'LOW',
      title: `Trinket used on ${window.spellName}`,
      tip: `${ev.casterName} trinketed out of ${window.spellName} — a short/low-impact CC. Save the trinket for a game-deciding stun or fear when possible.`,
      timestamp: ev.timestamp,
      spellId: window.spellId,
      spellName: window.spellName,
      targetName: ev.casterName
    })
  }
  return mistakes
}

// --- Late defensive (requires casterHpPct, added to defensive TimelineEvents) ---

export function detectLateDefensives(timeline: TimelineEvent[]): DetectedMistake[] {
  return timeline
    .filter(
      (ev) =>
        ev.type === 'defensive' &&
        ev.casterHpPct !== undefined &&
        ev.casterHpPct < LATE_DEFENSIVE_HP_THRESHOLD &&
        ev.spellId !== undefined &&
        !SPELL_IDS_IMMUNITY.has(ev.spellId) // full immunities are effective at any HP
    )
    .map((ev) => ({
      id: 'late_defensive',
      severity: 'MEDIUM',
      title: `${ev.spellName ?? 'Defensive'} used at ${ev.casterHpPct}% HP`,
      tip: 'Defensive cooldowns are most effective when used early. Using one at low HP risks dying before it can help.',
      timestamp: ev.timestamp,
      spellId: ev.spellId,
      spellName: ev.spellName,
      targetName: ev.casterName
    }))
}
