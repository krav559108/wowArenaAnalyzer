import { describe, it, expect } from 'vitest'
import { computeCooldownRows } from '../../src/renderer/src/composables/useCooldownRows'
import type { TimelineEvent } from '../../src/shared/ipc.types'

describe('computeCooldownRows', () => {
  it('groups defensive/trinket/offensive casts by caster, sorted by timestamp', () => {
    const events: TimelineEvent[] = [
      { timestamp: 30, type: 'defensive', casterName: 'Mage-EU', spellName: 'Ice Block' },
      { timestamp: 10, type: 'trinket', casterName: 'Mage-EU', spellName: 'Trinket' },
      { timestamp: 20, type: 'offensive', casterName: 'Warrior-EU', spellName: 'Avatar' },
      // Non-CD event types must be ignored
      { timestamp: 5, type: 'cc', casterName: 'Mage-EU', spellName: 'Polymorph' }
    ]

    const rows = computeCooldownRows(events, ['Mage-EU'], ['Warrior-EU'])
    const mage = rows.find((r) => r.name === 'Mage-EU')!
    expect(mage.casts.map((c) => c.spellName)).toEqual(['Trinket', 'Ice Block'])
    expect(mage.casts[0]!.castType).toBe('trinket')

    const warrior = rows.find((r) => r.name === 'Warrior-EU')!
    expect(warrior.casts).toHaveLength(1)
    expect(warrior.casts[0]!.castType).toBe('offensive')
  })

  it('orders rows by team roster, dropping players with no CD casts', () => {
    const events: TimelineEvent[] = [
      { timestamp: 1, type: 'trinket', casterName: 'B-EU', spellName: 'Trinket' },
      { timestamp: 1, type: 'defensive', casterName: 'A-EU', spellName: 'Barkskin' }
    ]
    const rows = computeCooldownRows(events, ['A-EU', 'NoCasts-EU'], ['B-EU'])
    expect(rows.map((r) => r.name)).toEqual(['A-EU', 'B-EU'])
  })

  it('returns an empty array when no CD events are present', () => {
    const events: TimelineEvent[] = [{ timestamp: 1, type: 'interrupt', casterName: 'A-EU' }]
    expect(computeCooldownRows(events, [], [])).toEqual([])
  })
})
