import { describe, it, expect } from 'vitest'
import { computeMeter } from '../../src/renderer/src/composables/useMeters'

describe('computeMeter', () => {
  it('sorts descending and computes bar % relative to the top row', () => {
    const rows = computeMeter({ Gorkadin: 58971000, Wordup: 54785000, Squisheli: 50568000 }, 180)
    expect(rows.map((r) => r.name)).toEqual(['Gorkadin', 'Wordup', 'Squisheli'])
    expect(rows[0]?.barPct).toBe(100)
    expect(rows[1]?.barPct).toBeCloseTo((54785000 / 58971000) * 100)
  })

  it('computes per-second rate from match duration', () => {
    const rows = computeMeter({ Mage: 60000 }, 60)
    expect(rows[0]?.perSecond).toBe(1000)
  })

  it('drops zero/negative entries', () => {
    const rows = computeMeter({ A: 100, B: 0 }, 60)
    expect(rows.map((r) => r.name)).toEqual(['A'])
  })

  it('returns an empty array for undefined totals', () => {
    expect(computeMeter(undefined, 60)).toEqual([])
  })
})
