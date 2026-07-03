// Per-player cooldown-usage rows for the CD timeline strip (Details!/WeakAuras-style:
// one lane per player, colored ticks for each defensive/trinket/offensive cast). Pure
// function over already-persisted TimelineEvent[] — no new backend data required.

import type { TimelineEvent } from '@shared/ipc.types'

export type CooldownCastType = 'defensive' | 'trinket' | 'offensive'

export interface CooldownCast {
  spellId?: number
  spellName: string
  timestamp: number
  castType: CooldownCastType
}

export interface CooldownRow {
  name: string
  casts: CooldownCast[]
}

const COOLDOWN_TYPES: ReadonlySet<CooldownCastType> = new Set(['defensive', 'trinket', 'offensive'])

// Orders rows by team (playerTeam first, then enemyTeam), preserving roster order within
// each team; players with no CD casts are dropped.
export function computeCooldownRows(
  events: TimelineEvent[],
  playerTeam: string[],
  enemyTeam: string[]
): CooldownRow[] {
  const castsByName = new Map<string, CooldownCast[]>()

  for (const ev of events) {
    if (!COOLDOWN_TYPES.has(ev.type as CooldownCastType) || !ev.casterName) continue
    const list = castsByName.get(ev.casterName) ?? []
    list.push({
      spellId: ev.spellId,
      spellName: ev.spellName ?? '',
      timestamp: ev.timestamp,
      castType: ev.type as CooldownCastType
    })
    castsByName.set(ev.casterName, list)
  }

  const orderedNames = [...playerTeam, ...enemyTeam].filter((name) => castsByName.has(name))
  // Include any caster not present in either roster (e.g. teamComp/enemyComp unresolved).
  for (const name of castsByName.keys()) {
    if (!orderedNames.includes(name)) orderedNames.push(name)
  }

  return orderedNames.map((name) => ({
    name,
    casts: (castsByName.get(name) ?? []).sort((a, b) => a.timestamp - b.timestamp)
  }))
}
