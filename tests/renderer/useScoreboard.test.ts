import { describe, it, expect } from 'vitest'
import { computeScoreboard } from '../../src/renderer/src/composables/useScoreboard'
import type { TimelineEvent } from '../../src/shared/ipc.types'

describe('computeScoreboard', () => {
  it('counts kicks done/taken and CC output/uptime per player', () => {
    const events: TimelineEvent[] = [
      { timestamp: 1, type: 'interrupt', casterName: 'Rogue-EU', targetName: 'Mage-EU', isSuccessful: true },
      { timestamp: 2, type: 'interrupt', casterName: 'Mage-EU', targetName: 'Rogue-EU', isSuccessful: false },
      { timestamp: 3, type: 'cc', casterName: 'Rogue-EU', targetName: 'Mage-EU', duration: 4 },
      { timestamp: 4, type: 'cc', casterName: 'Warrior-EU', targetName: 'Rogue-EU', duration: 2 }
    ]

    const rows = computeScoreboard(events, 60)
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]))

    expect(byName['Rogue-EU'].kicksDone).toBe(1)
    // Mage's interrupt on Rogue was unsuccessful (isSuccessful: false) — must not count
    // as a landed kick against Rogue.
    expect(byName['Rogue-EU'].kicksTaken).toBe(0)
    expect(byName['Mage-EU'].kicksTaken).toBe(1)
    expect(byName['Rogue-EU'].ccOutputSecs).toBe(4)
    expect(byName['Mage-EU'].ccUptimeSecs).toBe(4)
    expect(byName['Rogue-EU'].ccUptimeSecs).toBe(2)
    expect(byName['Mage-EU'].ccUptimePct).toBeCloseTo((4 / 60) * 100)
  })

  it('computes per-minute rates from match duration', () => {
    const events: TimelineEvent[] = [
      { timestamp: 1, type: 'interrupt', casterName: 'Rogue-EU', targetName: 'Mage-EU', isSuccessful: true },
      { timestamp: 30, type: 'interrupt', casterName: 'Rogue-EU', targetName: 'Mage-EU', isSuccessful: true }
    ]
    const rows = computeScoreboard(events, 120) // 2 minutes
    expect(rows.find((r) => r.name === 'Rogue-EU')?.kicksDonePerMin).toBeCloseTo(1)
  })

  it('returns an empty list for events with no cc/interrupt entries', () => {
    const events: TimelineEvent[] = [
      { timestamp: 1, type: 'defensive', casterName: 'Rogue-EU', target: 'player' }
    ]
    expect(computeScoreboard(events, 60)).toEqual([])
  })
})
