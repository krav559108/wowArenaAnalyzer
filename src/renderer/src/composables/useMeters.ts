// Per-player "meter" rows (Details!/Skada-style: sorted descending, bar width relative
// to the top player, class-colored). Pure function over already-persisted metadata
// fields (playerDamageDone/playerDamageTaken/playerHealingDone) — no new backend calls.

export interface MeterRow {
  name: string
  total: number
  perSecond: number
  barPct: number // 0-100, relative to the top row
}

export function computeMeter(
  totals: Record<string, number> | undefined,
  durationSecs: number
): MeterRow[] {
  if (totals === undefined) return []
  const entries = Object.entries(totals).filter(([, total]) => total > 0)
  if (entries.length === 0) return []

  entries.sort((a, b) => b[1] - a[1])
  const max = entries[0]![1]

  return entries.map(([name, total]) => ({
    name,
    total,
    perSecond: durationSecs > 0 ? total / durationSecs : 0,
    barPct: max > 0 ? (total / max) * 100 : 0
  }))
}
