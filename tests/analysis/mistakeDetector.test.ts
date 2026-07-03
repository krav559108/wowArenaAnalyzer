import { describe, it, expect } from 'vitest'
import { detectMistakes, type AuraWindow } from '../../src/main/analysis/mistakeDetector'
import type { TimelineEvent } from '../../src/shared/ipc.types'

function windows(entries: Record<string, AuraWindow[]>): Map<string, AuraWindow[]> {
  return new Map(Object.entries(entries))
}

describe('detectMistakes', () => {
  it('surfaces DR-immune CC already flagged by RecorderStateMachine', () => {
    const timeline: TimelineEvent[] = [
      {
        timestamp: 10,
        type: 'cc',
        spellId: 118,
        spellName: 'Polymorph',
        targetName: 'Enemy-EU',
        isMistake: true,
        mistakeReason: 'DR immune'
      }
    ]
    const mistakes = detectMistakes(timeline, windows({}))
    expect(mistakes).toHaveLength(1)
    expect(mistakes[0]?.id).toBe('dr_immune_cc')
  })

  it('surfaces burst without healer CC\'d already flagged by RecorderStateMachine', () => {
    const timeline: TimelineEvent[] = [
      {
        timestamp: 5,
        type: 'offensive',
        spellId: 12472,
        spellName: 'Icy Veins',
        isMistake: true,
        mistakeReason: "No healer CC'd during burst"
      }
    ]
    const mistakes = detectMistakes(timeline, windows({}))
    expect(mistakes).toHaveLength(1)
    expect(mistakes[0]?.id).toBe('burst_no_healer_cc')
  })

  it('surfaces bad interrupts (isSuccessful === false)', () => {
    const timeline: TimelineEvent[] = [
      { timestamp: 3, type: 'interrupt', spellId: 1766, spellName: 'Kick', isSuccessful: false },
      { timestamp: 4, type: 'interrupt', spellId: 1766, spellName: 'Kick', isSuccessful: true }
    ]
    const mistakes = detectMistakes(timeline, windows({}))
    expect(mistakes).toHaveLength(1)
    expect(mistakes[0]?.id).toBe('bad_interrupt')
    expect(mistakes[0]?.timestamp).toBe(3)
  })

  it('surfaces deaths with unused defensives', () => {
    const timeline: TimelineEvent[] = [
      { timestamp: 90, type: 'death-player', unit: 'Mage-EU', unusedDefensives: ['Ice Block'] },
      { timestamp: 95, type: 'death-player', unit: 'Rogue-EU', unusedDefensives: [] }
    ]
    const mistakes = detectMistakes(timeline, windows({}))
    expect(mistakes).toHaveLength(1)
    expect(mistakes[0]?.id).toBe('died_without_defensive')
    expect(mistakes[0]?.targetName).toBe('Mage-EU')
  })

  it('detects damage/CC cast into a full-immunity window', () => {
    const timeline: TimelineEvent[] = [
      { timestamp: 20, type: 'offensive', spellId: 205021, spellName: 'Ray of Frost', target: 'enemy', targetName: 'Paladin-EU' },
      // Outside the window — should not be flagged.
      { timestamp: 50, type: 'offensive', spellId: 205021, spellName: 'Ray of Frost', target: 'enemy', targetName: 'Paladin-EU' }
    ]
    const auraWindows = windows({
      'Paladin-EU': [{ spellId: 642, spellName: 'Divine Shield', start: 15, end: 25 }] // Divine Shield
    })
    const mistakes = detectMistakes(timeline, auraWindows)
    expect(mistakes).toHaveLength(1)
    expect(mistakes[0]?.id).toBe('into_immunity')
    expect(mistakes[0]?.timestamp).toBe(20)
    // Regression: title/tip must name the actual immunity that was up, not a generic
    // "into immunity" — otherwise the user can't tell what happened without rewatching.
    expect(mistakes[0]?.title).toBe('Ray of Frost into Divine Shield')
    expect(mistakes[0]?.tip).toContain('Divine Shield')
  })

  it('detects burst landing while the target has a defensive cooldown active', () => {
    const timeline: TimelineEvent[] = [
      { timestamp: 30, type: 'offensive', spellId: 12472, spellName: 'Icy Veins', target: 'enemy', targetName: 'Warrior-EU', casterName: 'Mage-EU' }
    ]
    const auraWindows = windows({
      'Warrior-EU': [{ spellId: 871, spellName: 'Shield Wall', start: 28, end: 35 }] // Shield Wall
    })
    const mistakes = detectMistakes(timeline, auraWindows)
    expect(mistakes).toHaveLength(1)
    expect(mistakes[0]?.id).toBe('burst_into_defensive')
  })

  it('does not flag burst-into-defensive for a self-buff (caster === target)', () => {
    const timeline: TimelineEvent[] = [
      { timestamp: 30, type: 'offensive', spellId: 12472, spellName: 'Icy Veins', target: 'enemy', targetName: 'Mage-EU', casterName: 'Mage-EU' }
    ]
    const auraWindows = windows({
      'Mage-EU': [{ spellId: 871, spellName: 'Shield Wall', start: 28, end: 35 }]
    })
    expect(detectMistakes(timeline, auraWindows)).toHaveLength(0)
  })

  it('detects a trinket used while a low-value CC was active on the caster', () => {
    const timeline: TimelineEvent[] = [
      { timestamp: 40, type: 'trinket', spellId: 42292, spellName: 'PvP Trinket', casterName: 'Rogue-EU' }
    ]
    const auraWindows = windows({
      'Rogue-EU': [{ spellId: 6770, spellName: 'Sap', start: 39, end: 45 }] // Sap
    })
    const mistakes = detectMistakes(timeline, auraWindows)
    expect(mistakes).toHaveLength(1)
    expect(mistakes[0]?.id).toBe('trinket_low_value_cc')
  })

  it('detects a defensive used below the late-defensive HP threshold', () => {
    const timeline: TimelineEvent[] = [
      { timestamp: 60, type: 'defensive', spellId: 48792, spellName: 'Icebound Fortitude', casterHpPct: 15 },
      { timestamp: 62, type: 'defensive', spellId: 48792, spellName: 'Icebound Fortitude', casterHpPct: 80 }
    ]
    const mistakes = detectMistakes(timeline, windows({}))
    expect(mistakes).toHaveLength(1)
    expect(mistakes[0]?.id).toBe('late_defensive')
    expect(mistakes[0]?.timestamp).toBe(60)
  })

  it('does not flag a late full-immunity defensive (effective at any HP)', () => {
    const timeline: TimelineEvent[] = [
      { timestamp: 60, type: 'defensive', spellId: 45438, spellName: 'Ice Block', casterHpPct: 5 } // Ice Block
    ]
    expect(detectMistakes(timeline, windows({}))).toHaveLength(0)
  })

  it('returns mistakes sorted by timestamp', () => {
    const timeline: TimelineEvent[] = [
      { timestamp: 50, type: 'interrupt', isSuccessful: false },
      { timestamp: 10, type: 'interrupt', isSuccessful: false },
      { timestamp: 30, type: 'interrupt', isSuccessful: false }
    ]
    const mistakes = detectMistakes(timeline, windows({}))
    expect(mistakes.map((m) => m.timestamp)).toEqual([10, 30, 50])
  })
})
