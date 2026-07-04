import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { CombatLogParser, UNIT_FLAG_REACTION_HOSTILE } from '../../src/main/combatlog/CombatLogParser'
import type {
  ArenaZoneEnteredEvent,
  ArenaMatchStartEvent,
  ArenaMatchEndEvent,
  SpellCastEvent,
  UnitDiedEvent,
  CombatantInfoEvent
} from '../../src/main/combatlog/CombatLogParser'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readFixture(name: string): string[] {
  const filePath = resolve(__dirname, '../fixtures', name)
  return readFileSync(filePath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
}

function feedLines(parser: CombatLogParser, lines: string[]): void {
  for (const line of lines) {
    parser.processLine(line)
  }
}

// ---------------------------------------------------------------------------
// 2v2 arena tests
// ---------------------------------------------------------------------------

describe('CombatLogParser — 2v2 arena', () => {
  let parser: CombatLogParser
  const lines = readFixture('sample_2v2.log')

  beforeEach(() => {
    parser = new CombatLogParser()
  })

  it('emits arenaZoneEntered when entering an arena zone', () => {
    const events: ArenaZoneEnteredEvent[] = []
    parser.on('arenaZoneEntered', (e) => events.push(e))

    feedLines(parser, lines)

    expect(events).toHaveLength(1)
    expect(events[0]!.zoneId).toBe(1505)
    expect(events[0]!.zoneName).toBe('Nagrand Arena')
  })

  it('emits arenaMatchStart with correct zone, bracket, and timestamp', () => {
    const events: ArenaMatchStartEvent[] = []
    parser.on('arenaMatchStart', (e) => events.push(e))

    feedLines(parser, lines)

    expect(events).toHaveLength(1)
    const event = events[0]!
    expect(event.bracket).toBe('2v2')
    expect(event.instanceId).toBe(1505)
    expect(event.zoneName).toBe('Nagrand Arena')
    expect(event.timestamp).toBeInstanceOf(Date)
    expect(event.timestamp.getHours()).toBe(20)
    expect(event.timestamp.getMinutes()).toBe(0)
    expect(event.timestamp.getSeconds()).toBe(15)
  })

  it('emits arenaMatchEnd with the raw winningTeam and correct duration', () => {
    const events: ArenaMatchEndEvent[] = []
    parser.on('arenaMatchEnd', (e) => events.push(e))

    feedLines(parser, lines)

    expect(events).toHaveLength(1)
    const event = events[0]!
    expect(event.winningTeam).toBe(0)
    expect(event.durationSecs).toBe(180)
    expect(event.timestamp).toBeInstanceOf(Date)
  })

  it('emits arenaZoneLeft when leaving the arena', () => {
    const leftEvents: unknown[] = []
    parser.on('arenaZoneLeft', (e) => leftEvents.push(e))

    feedLines(parser, lines)

    expect(leftEvents).toHaveLength(1)
  })

  it('does NOT emit soloShuffleRoundEnd for a 2v2 match', () => {
    const events: unknown[] = []
    parser.on('soloShuffleRoundEnd', (e) => events.push(e))

    feedLines(parser, lines)

    expect(events).toHaveLength(0)
  })

  it('emits spellCast for tracked CC spells (Polymorph)', () => {
    const events: SpellCastEvent[] = []
    parser.on('spellCast', (e) => events.push(e))

    feedLines(parser, lines)

    const polymorph = events.find((e) => e.spellId === 118)
    expect(polymorph).toBeDefined()
    expect(polymorph!.spellName).toBe('Polymorph')
    expect(polymorph!.eventCategory).toBe('cc')
  })

  it('emits spellCast for tracked interrupt spells (Counterspell)', () => {
    const events: SpellCastEvent[] = []
    parser.on('spellCast', (e) => events.push(e))

    feedLines(parser, lines)

    const cs = events.find((e) => e.spellId === 2139)
    expect(cs).toBeDefined()
    expect(cs!.spellName).toBe('Counterspell')
    expect(cs!.eventCategory).toBe('interrupt')
  })

  it('emits unitDied for the dead player', () => {
    const events: UnitDiedEvent[] = []
    parser.on('unitDied', (e) => events.push(e))

    feedLines(parser, lines)

    expect(events).toHaveLength(1)
    expect(events[0]!.unitName).toBe('Priest')
    expect(events[0]!.unitGuid).toBe('Player-123-BBBBBB')
  })

  it('spellCast includes targetFlags parsed from hex', () => {
    const events: SpellCastEvent[] = []
    parser.on('spellCast', (e) => events.push(e))

    feedLines(parser, lines)

    const polymorph = events.find((e) => e.spellId === 118)
    expect(polymorph).toBeDefined()
    // Priest target has flags 0x548 — REACTION_HOSTILE bit set
    expect((polymorph!.targetFlags & UNIT_FLAG_REACTION_HOSTILE) !== 0).toBe(true)
  })

  it('unitDied includes destFlags parsed from hex', () => {
    const events: UnitDiedEvent[] = []
    parser.on('unitDied', (e) => events.push(e))

    feedLines(parser, lines)

    // Priest has flags 0x548 — REACTION_HOSTILE bit set
    expect((events[0]!.destFlags & UNIT_FLAG_REACTION_HOSTILE) !== 0).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// LOSS result test
// ---------------------------------------------------------------------------

describe('CombatLogParser — raw winningTeam passthrough', () => {
  it('emits arenaMatchEnd with winningTeam=1 as-is (WIN/LOSS derivation is the caller\'s job)', () => {
    const parser = new CombatLogParser()
    const events: ArenaMatchEndEvent[] = []
    parser.on('arenaMatchEnd', (e) => events.push(e))

    const lines = [
      '4/15/2026 20:00:00.0000  ZONE_CHANGE,1505,"Nagrand Arena",0',
      '4/15/2026 20:00:15.0000  ARENA_MATCH_START,1505,41,"2v2",0',
      '4/15/2026 20:03:15.0000  ARENA_MATCH_END,1,180'
    ]

    feedLines(parser, lines)

    expect(events).toHaveLength(1)
    expect(events[0]!.winningTeam).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Unknown zone does not trigger arena events
// ---------------------------------------------------------------------------

describe('CombatLogParser — non-arena zone', () => {
  it('does not emit arenaZoneEntered for non-arena zones', () => {
    const parser = new CombatLogParser()
    const events: unknown[] = []
    parser.on('arenaZoneEntered', (e) => events.push(e))

    parser.processLine('4/15/2026 20:00:00.0000  ZONE_CHANGE,0,"Stormwind City",0')

    expect(events).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Solo Shuffle tests
// ---------------------------------------------------------------------------

describe('CombatLogParser — Solo Shuffle', () => {
  let parser: CombatLogParser
  const lines = readFixture('sample_solo_shuffle.log')

  beforeEach(() => {
    parser = new CombatLogParser()
  })

  it('emits arenaMatchStart with bracket=solo-shuffle', () => {
    const events: ArenaMatchStartEvent[] = []
    parser.on('arenaMatchStart', (e) => events.push(e))

    feedLines(parser, lines)

    // 6 rounds = 6 ARENA_MATCH_START events
    expect(events).toHaveLength(6)
    for (const event of events) {
      expect(event.bracket).toBe('solo-shuffle')
      expect(event.zoneName).toBe('Enigma Crucible')
    }
  })

  it('emits exactly one arenaMatchEnd event for the whole session (Midnight format)', () => {
    const events: ArenaMatchEndEvent[] = []
    parser.on('arenaMatchEnd', (e) => events.push(e))

    feedLines(parser, lines)

    expect(events).toHaveLength(1)
  })

  it('arenaMatchEnd carries the raw session-level winningTeam', () => {
    const events: ArenaMatchEndEvent[] = []
    parser.on('arenaMatchEnd', (e) => events.push(e))

    feedLines(parser, lines)

    expect(events[0]!.winningTeam).toBe(0)
    expect(events[0]!.durationSecs).toBe(720)
  })

  it('does NOT emit soloShuffleRoundEnd (Midnight: per-round end events removed)', () => {
    const events: unknown[] = []
    parser.on('soloShuffleRoundEnd', (e) => events.push(e))

    feedLines(parser, lines)

    expect(events).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Malformed / unknown line handling
// ---------------------------------------------------------------------------

describe('CombatLogParser — robustness', () => {
  it('silently ignores empty lines', () => {
    const parser = new CombatLogParser()
    expect(() => parser.processLine('')).not.toThrow()
  })

  it('silently ignores lines without double-space separator', () => {
    const parser = new CombatLogParser()
    expect(() => parser.processLine('not a valid log line')).not.toThrow()
  })

  it('silently ignores unknown event types', () => {
    const parser = new CombatLogParser()
    expect(() => parser.processLine('4/15 20:00:00.000  UNKNOWN_EVENT,some,data')).not.toThrow()
  })

  it('does not emit arenaMatchStart if no zone entry preceded it', () => {
    const parser = new CombatLogParser()
    const events: unknown[] = []
    parser.on('arenaMatchStart', (e) => events.push(e))

    parser.processLine('4/15/2026 20:00:15.0000  ARENA_MATCH_START,3698,41,"2v2",0')

    expect(events).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// File rotation simulation (offset tracking is in CombatLogWatcher, but
// parser reset() allows clean state for back-to-back sessions)
// ---------------------------------------------------------------------------

describe('CombatLogParser — sequential sessions', () => {
  it('handles two consecutive arena sessions correctly', () => {
    const parser = new CombatLogParser()
    const matchStartEvents: ArenaMatchStartEvent[] = []
    const matchEndEvents: ArenaMatchEndEvent[] = []

    parser.on('arenaMatchStart', (e) => matchStartEvents.push(e))
    parser.on('arenaMatchEnd', (e) => matchEndEvents.push(e))

    const session1 = [
      '4/15/2026 20:00:00.0000  ZONE_CHANGE,1505,"Nagrand Arena",0',
      '4/15/2026 20:00:15.0000  ARENA_MATCH_START,1505,41,"2v2",0',
      '4/15/2026 20:03:15.0000  ARENA_MATCH_END,0,180',
      '4/15/2026 20:03:30.0000  ZONE_CHANGE,0,"Stormwind City",0'
    ]

    const session2 = [
      '4/15/2026 20:10:00.0000  ZONE_CHANGE,1672,"Blade\'s Edge Arena",0',
      '4/15/2026 20:10:15.0000  ARENA_MATCH_START,1672,41,"2v2",0',
      '4/15/2026 20:12:00.0000  ARENA_MATCH_END,1,105',
      '4/15/2026 20:12:30.0000  ZONE_CHANGE,0,"Stormwind City",0'
    ]

    feedLines(parser, [...session1, ...session2])

    expect(matchStartEvents).toHaveLength(2)
    expect(matchStartEvents[0]!.zoneName).toBe('Nagrand Arena')
    expect(matchStartEvents[1]!.zoneName).toBe("Blade's Edge Arena")

    expect(matchEndEvents).toHaveLength(2)
    expect(matchEndEvents[0]!.winningTeam).toBe(0)
    expect(matchEndEvents[1]!.winningTeam).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// COMBATANT_INFO — spec ID field position
// ---------------------------------------------------------------------------
// specID is the LAST plain stat field before the FIRST '[' (talents bracket) —
// verified against real Midnight combat logs. A prior version of the parser read it
// from the trailing section after the LAST ']' instead, which is a different field
// entirely and silently produced wrong/garbage spec IDs for every recording.

describe('CombatLogParser — COMBATANT_INFO spec ID', () => {
  it('reads specId from the stat block before the talents bracket, not the trailing fields', () => {
    const parser = new CombatLogParser()
    const events: CombatantInfoEvent[] = []
    parser.on('combatantInfo', (e) => events.push(e))

    // Structurally real (redacted GUID/name): stat block ending in specId=64 (Frost
    // Mage), then talents/pvp-talents/covenant/gear/aura brackets, then trailing
    // [garbage, unk, personalRating, honorLevel] after the last ']'.
    parser.processLine(
      '4/15/2026 20:00:00.0000  COMBATANT_INFO,Player-000-00000001,1,306,470,22231,2744,0,0,0,0,0,0,0,98,0,' +
        '1006,1006,1006,0,157,1229,1229,1229,702,64,' +
        '[(62084,80140,1)],(0,410248,1220739,415945),[(250060,289,(7991,0,0),(13448),(213748,610))],' +
        '[Player-000-00000001,1459,1],78,41,2407,0'
    )

    expect(events).toHaveLength(1)
    expect(events[0]!.specId).toBe(64)
    expect(events[0]!.personalRating).toBe(2407)
  })

  it('returns specId null when the stat block is empty or malformed', () => {
    const parser = new CombatLogParser()
    const events: CombatantInfoEvent[] = []
    parser.on('combatantInfo', (e) => events.push(e))

    parser.processLine(
      '4/15/2026 20:00:00.0000  COMBATANT_INFO,Player-000-00000002,0,[(1,2,3)],78,41,1600,0'
    )

    expect(events).toHaveLength(1)
    expect(events[0]!.specId).toBeNull()
  })
})
