import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import { RecorderStateMachine } from '../../src/main/recorder/RecorderStateMachine'
import type {
  StateMachineOptions,
  ProcessingRequiredEvent
} from '../../src/main/recorder/RecorderStateMachine'
import type { CombatLogWatcher } from '../../src/main/combatlog/CombatLogWatcher'
import type { ScreenRecorder } from '../../src/main/recorder/ScreenRecorder'
import type { ParserEventMap } from '../../src/main/combatlog/CombatLogParser'
import { UNIT_FLAG_REACTION_HOSTILE } from '../../src/main/combatlog/CombatLogParser'

// ---------------------------------------------------------------------------
// Minimal fakes
// ---------------------------------------------------------------------------

// Fake CombatLogWatcher that lets tests fire parser events directly.
class FakeWatcher extends EventEmitter {
  public readonly parser = new EventEmitter()

  onParser<K extends keyof ParserEventMap>(
    event: K,
    listener: (payload: ParserEventMap[K]) => void
  ): this {
    this.parser.on(event, listener as (...args: unknown[]) => void)
    return this
  }

  fireParser<K extends keyof ParserEventMap>(event: K, payload: ParserEventMap[K]): void {
    this.parser.emit(event, payload)
  }
}

// Fake ScreenRecorder whose start/stop behaviour is controlled per test.
class FakeRecorder extends EventEmitter {
  private recording = false

  startMock = vi.fn(async (): Promise<void> => {
    this.recording = true
  })

  stopMock = vi.fn(async (): Promise<string> => {
    this.recording = false
    return '/tmp/fake.mp4'
  })

  isRecording(): boolean {
    return this.recording
  }

  // Forward typed EventEmitter methods expected by the state machine.
  override on(event: string, listener: (...args: unknown[]) => void): this {
    return super.on(event, listener)
  }

  async start(path: string): Promise<void> {
    return this.startMock(path) as Promise<void>
  }

  stop(): Promise<string> {
    return this.stopMock()
  }
}

// ---------------------------------------------------------------------------
// Fixtures — representative combat log event payloads
// ---------------------------------------------------------------------------

const TS = new Date('2026-04-15T20:00:00Z')

const zoneEntered = {
  zoneId: 1505,
  zoneName: 'Nagrand Arena',
  timestamp: TS
}

const matchStart2v2 = {
  bracket: '2v2' as const,
  zoneName: 'Nagrand Arena',
  zoneId: 1505,
  instanceId: 1505,
  localTeam: 0,
  timestamp: new Date('2026-04-15T20:00:15Z')
}

const matchStartSS = {
  bracket: 'solo-shuffle' as const,
  zoneName: 'Nagrand Arena',
  zoneId: 1505,
  instanceId: 1505,
  localTeam: 0,
  timestamp: new Date('2026-04-15T20:00:15Z')
}

const matchEnd = {
  result: 'WIN' as const,
  durationSecs: 120,
  timestamp: new Date('2026-04-15T20:02:15Z')
}

const matchEndRound = {
  result: 'WIN' as const,
  durationSecs: 90,
  roundNumber: 1,
  timestamp: new Date('2026-04-15T20:01:45Z')
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Flushes all pending microtasks and one round of macrotasks (setTimeout 0).
// Needed because the state machine uses void promise chains internally.
function flushPromises(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

function buildMachine(
  watcher: FakeWatcher,
  recorder: FakeRecorder,
  opts: Partial<StateMachineOptions> = {}
): RecorderStateMachine {
  const options: StateMachineOptions = {
    rawRecordingsDir: '/tmp/raw',
    ...opts
  }
  return new RecorderStateMachine(
    watcher as unknown as CombatLogWatcher,
    recorder as unknown as ScreenRecorder,
    options
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RecorderStateMachine — idle → waiting → recording → processing → idle (2v2)', () => {
  let watcher: FakeWatcher
  let recorder: FakeRecorder
  let machine: RecorderStateMachine

  beforeEach(() => {
    watcher = new FakeWatcher()
    recorder = new FakeRecorder()
    machine = buildMachine(watcher, recorder)
  })

  it('starts in idle state', () => {
    expect(machine.getStatus()).toBe('idle')
  })

  it('transitions to waiting on arenaZoneEntered and starts the recorder', async () => {
    const statusEvents: string[] = []
    machine.on('statusChanged', (e) => statusEvents.push(e.status))

    watcher.fireParser('arenaZoneEntered', zoneEntered)
    await flushPromises()

    expect(machine.getStatus()).toBe('waiting')
    expect(statusEvents).toContain('waiting')
    expect(recorder.startMock).toHaveBeenCalledOnce()
  })

  it('transitions to recording on arenaMatchStart', async () => {
    watcher.fireParser('arenaZoneEntered', zoneEntered)
    await flushPromises()

    watcher.fireParser('arenaMatchStart', matchStart2v2)

    expect(machine.getStatus()).toBe('recording')
  })

  it('transitions to processing on arenaMatchEnd and emits processingRequired', async () => {
    watcher.fireParser('arenaZoneEntered', zoneEntered)
    await flushPromises()
    watcher.fireParser('arenaMatchStart', matchStart2v2)

    const processingEvents: ProcessingRequiredEvent[] = []
    machine.on('processingRequired', (e) => processingEvents.push(e))

    watcher.fireParser('arenaMatchEnd', matchEnd)
    await flushPromises()

    expect(processingEvents).toHaveLength(1)
    const ev = processingEvents[0]
    expect(ev.bracket).toBe('2v2')
    expect(ev.result).toBe('WIN')
    expect(ev.zoneName).toBe('Nagrand Arena')
    expect(ev.durationSecs).toBe(120)
    expect(ev.roundNumber).toBeUndefined()
  })

  it('returns to idle after processing completes (2v2)', async () => {
    watcher.fireParser('arenaZoneEntered', zoneEntered)
    await flushPromises()
    watcher.fireParser('arenaMatchStart', matchStart2v2)
    watcher.fireParser('arenaMatchEnd', matchEnd)
    await flushPromises()

    expect(machine.getStatus()).toBe('idle')
  })
})

describe('RecorderStateMachine — zone exit aborts recording', () => {
  let watcher: FakeWatcher
  let recorder: FakeRecorder
  let machine: RecorderStateMachine

  beforeEach(() => {
    watcher = new FakeWatcher()
    recorder = new FakeRecorder()
    machine = buildMachine(watcher, recorder)
  })

  it('aborts in waiting state and returns to idle', async () => {
    watcher.fireParser('arenaZoneEntered', zoneEntered)
    await flushPromises()

    expect(machine.getStatus()).toBe('waiting')

    watcher.fireParser('arenaZoneLeft', undefined as unknown as ParserEventMap['arenaZoneLeft'])
    await flushPromises()

    expect(machine.getStatus()).toBe('idle')
    expect(recorder.stopMock).toHaveBeenCalledOnce()
  })

  it('aborts in recording state and returns to idle', async () => {
    watcher.fireParser('arenaZoneEntered', zoneEntered)
    await flushPromises()
    watcher.fireParser('arenaMatchStart', matchStart2v2)

    watcher.fireParser('arenaZoneLeft', undefined as unknown as ParserEventMap['arenaZoneLeft'])
    await flushPromises()

    expect(machine.getStatus()).toBe('idle')
  })

  it('ignores zone exit when already idle', () => {
    watcher.fireParser('arenaZoneLeft', undefined as unknown as ParserEventMap['arenaZoneLeft'])
    expect(machine.getStatus()).toBe('idle')
    expect(recorder.startMock).not.toHaveBeenCalled()
  })
})

describe('RecorderStateMachine — Solo Shuffle multi-round session', () => {
  let watcher: FakeWatcher
  let recorder: FakeRecorder
  let machine: RecorderStateMachine

  beforeEach(() => {
    watcher = new FakeWatcher()
    recorder = new FakeRecorder()
    machine = buildMachine(watcher, recorder)
  })

  it('starts a new recorder after each Solo Shuffle round', async () => {
    watcher.fireParser('arenaZoneEntered', zoneEntered)
    await flushPromises()

    // Round 1
    watcher.fireParser('arenaMatchStart', matchStartSS)
    watcher.fireParser('soloShuffleRoundEnd', matchEndRound)
    await flushPromises()

    // After round 1: should be back in waiting and started a 2nd recorder
    expect(machine.getStatus()).toBe('waiting')
    expect(recorder.startMock).toHaveBeenCalledTimes(2)
  })

  it('emits processingRequired with round number and sessionId', async () => {
    watcher.fireParser('arenaZoneEntered', zoneEntered)
    await flushPromises()

    const events: ProcessingRequiredEvent[] = []
    machine.on('processingRequired', (e) => events.push(e))

    watcher.fireParser('arenaMatchStart', matchStartSS)
    watcher.fireParser('soloShuffleRoundEnd', matchEndRound)
    await flushPromises()

    expect(events).toHaveLength(1)
    expect(events[0].bracket).toBe('solo-shuffle')
    expect(events[0].roundNumber).toBe(1)
    expect(typeof events[0].sessionId).toBe('string')
  })
})

describe('RecorderStateMachine — timeline accumulation', () => {
  let watcher: FakeWatcher
  let recorder: FakeRecorder
  let machine: RecorderStateMachine

  // Match starts at T+0 seconds
  const MATCH_START_TS = new Date('2026-04-15T20:00:15Z')

  beforeEach(() => {
    watcher = new FakeWatcher()
    recorder = new FakeRecorder()
    machine = buildMachine(watcher, recorder)
  })

  it('processingRequired includes empty timeline when no events occur', async () => {
    watcher.fireParser('arenaZoneEntered', zoneEntered)
    await flushPromises()
    watcher.fireParser('arenaMatchStart', { ...matchStart2v2, timestamp: MATCH_START_TS })

    const events: ProcessingRequiredEvent[] = []
    machine.on('processingRequired', (e) => events.push(e))

    watcher.fireParser('arenaMatchEnd', matchEnd)
    await flushPromises()

    expect(events[0].timeline).toEqual([])
  })

  it('collects spellCast events with relative timestamps and correct target side', async () => {
    watcher.fireParser('arenaZoneEntered', zoneEntered)
    await flushPromises()
    watcher.fireParser('arenaMatchStart', { ...matchStart2v2, timestamp: MATCH_START_TS })

    // 10 seconds into the match, Polymorph on an enemy
    watcher.fireParser('spellCast', {
      casterGuid: 'Player-A',
      targetGuid: 'Player-B',
      targetFlags: UNIT_FLAG_REACTION_HOSTILE, // enemy
      spellId: 118,
      spellName: 'Polymorph',
      eventCategory: 'cc',
      timestamp: new Date(MATCH_START_TS.getTime() + 10_000)
    })

    const events: ProcessingRequiredEvent[] = []
    machine.on('processingRequired', (e) => events.push(e))

    watcher.fireParser('arenaMatchEnd', matchEnd)
    await flushPromises()

    expect(events[0].timeline).toHaveLength(1)
    const ev = events[0].timeline[0]!
    expect(ev.type).toBe('cc')
    expect(ev.spellId).toBe(118)
    expect(ev.spellName).toBe('Polymorph')
    expect(ev.target).toBe('enemy')
    expect(ev.timestamp).toBeCloseTo(10, 1)
  })

  it('classifies friendly target as "player"', async () => {
    watcher.fireParser('arenaZoneEntered', zoneEntered)
    await flushPromises()
    watcher.fireParser('arenaMatchStart', { ...matchStart2v2, timestamp: MATCH_START_TS })

    watcher.fireParser('spellCast', {
      casterGuid: 'Player-B',
      targetGuid: 'Player-A',
      targetFlags: 0x511, // REACTION_FRIENDLY — friendly/own team
      spellId: 47788,
      spellName: 'Guardian Spirit',
      eventCategory: 'defensive',
      timestamp: new Date(MATCH_START_TS.getTime() + 20_000)
    })

    const events: ProcessingRequiredEvent[] = []
    machine.on('processingRequired', (e) => events.push(e))

    watcher.fireParser('arenaMatchEnd', matchEnd)
    await flushPromises()

    expect(events[0].timeline[0]!.target).toBe('player')
  })

  it('collects unitDied as death-enemy for hostile unit', async () => {
    watcher.fireParser('arenaZoneEntered', zoneEntered)
    await flushPromises()
    watcher.fireParser('arenaMatchStart', { ...matchStart2v2, timestamp: MATCH_START_TS })

    watcher.fireParser('unitDied', {
      unitGuid: 'Player-B',
      unitName: 'EnemyWarlock',
      destFlags: UNIT_FLAG_REACTION_HOSTILE,
      timestamp: new Date(MATCH_START_TS.getTime() + 60_000)
    })

    const events: ProcessingRequiredEvent[] = []
    machine.on('processingRequired', (e) => events.push(e))

    watcher.fireParser('arenaMatchEnd', matchEnd)
    await flushPromises()

    const deathEv = events[0].timeline[0]!
    expect(deathEv.type).toBe('death-enemy')
    expect(deathEv.unit).toBe('EnemyWarlock')
    expect(deathEv.timestamp).toBeCloseTo(60, 1)
  })

  it('collects unitDied as death-player for friendly unit', async () => {
    watcher.fireParser('arenaZoneEntered', zoneEntered)
    await flushPromises()
    watcher.fireParser('arenaMatchStart', { ...matchStart2v2, timestamp: MATCH_START_TS })

    watcher.fireParser('unitDied', {
      unitGuid: 'Player-A',
      unitName: 'AllyPriest',
      destFlags: 0x511, // friendly
      timestamp: new Date(MATCH_START_TS.getTime() + 45_000)
    })

    const events: ProcessingRequiredEvent[] = []
    machine.on('processingRequired', (e) => events.push(e))

    watcher.fireParser('arenaMatchEnd', matchEnd)
    await flushPromises()

    expect(events[0].timeline[0]!.type).toBe('death-player')
  })

  it('ignores events fired before ARENA_MATCH_START', async () => {
    watcher.fireParser('arenaZoneEntered', zoneEntered)
    await flushPromises()

    // Fire spell event while still in 'waiting' (before match start)
    watcher.fireParser('spellCast', {
      casterGuid: 'Player-A',
      targetGuid: 'Player-B',
      targetFlags: UNIT_FLAG_REACTION_HOSTILE,
      spellId: 118,
      spellName: 'Polymorph',
      eventCategory: 'cc',
      timestamp: new Date(MATCH_START_TS.getTime() - 5_000)
    })

    watcher.fireParser('arenaMatchStart', { ...matchStart2v2, timestamp: MATCH_START_TS })

    const events: ProcessingRequiredEvent[] = []
    machine.on('processingRequired', (e) => events.push(e))

    watcher.fireParser('arenaMatchEnd', matchEnd)
    await flushPromises()

    // The pre-match spell should not be in the timeline
    expect(events[0].timeline).toHaveLength(0)
  })

  it('resets timeline between Solo Shuffle rounds', async () => {
    watcher.fireParser('arenaZoneEntered', zoneEntered)
    await flushPromises()

    const roundStart = new Date('2026-04-15T20:00:15Z')

    // Round 1 — one event
    watcher.fireParser('arenaMatchStart', { ...matchStartSS, timestamp: roundStart })
    watcher.fireParser('spellCast', {
      casterGuid: 'Player-A',
      targetGuid: 'Player-B',
      targetFlags: UNIT_FLAG_REACTION_HOSTILE,
      spellId: 2139,
      spellName: 'Counterspell',
      eventCategory: 'interrupt',
      timestamp: new Date(roundStart.getTime() + 5_000)
    })

    const round1Events: ProcessingRequiredEvent[] = []
    machine.on('processingRequired', (e) => round1Events.push(e))

    watcher.fireParser('soloShuffleRoundEnd', { ...matchEndRound, roundNumber: 1 })
    await flushPromises()

    expect(round1Events[0].timeline).toHaveLength(1)

    // Round 2 — no events — timeline should be empty
    const round2Start = new Date('2026-04-15T20:02:00Z')
    watcher.fireParser('arenaMatchStart', { ...matchStartSS, timestamp: round2Start })

    const round2Events: ProcessingRequiredEvent[] = []
    machine.on('processingRequired', (e) => round2Events.push(e))

    watcher.fireParser('soloShuffleRoundEnd', {
      ...matchEndRound,
      roundNumber: 2,
      timestamp: new Date('2026-04-15T20:03:30Z')
    })
    await flushPromises()

    expect(round2Events[0].timeline).toHaveLength(0)
  })
})

describe('RecorderStateMachine — casterName in spell timeline events', () => {
  let watcher: FakeWatcher
  let recorder: FakeRecorder
  let machine: RecorderStateMachine

  const MATCH_START_TS = new Date('2026-04-15T20:00:15Z')

  beforeEach(() => {
    watcher = new FakeWatcher()
    recorder = new FakeRecorder()
    machine = buildMachine(watcher, recorder)
  })

  it('stores casterName and targetName in trinket timeline event', async () => {
    watcher.fireParser('arenaZoneEntered', zoneEntered)
    await flushPromises()
    watcher.fireParser('arenaMatchStart', { ...matchStart2v2, timestamp: MATCH_START_TS })

    watcher.fireParser('spellCast', {
      casterGuid: 'Player-A',
      casterName: 'Thrall-Emerald Dream',
      targetGuid: 'Player-A',
      targetName: 'Thrall-Emerald Dream',
      targetFlags: 0x511, // friendly (self)
      spellId: 42292, // PvP Trinket
      spellName: 'PvP Trinket',
      eventCategory: 'trinket',
      timestamp: new Date(MATCH_START_TS.getTime() + 30_000)
    })

    const events: ProcessingRequiredEvent[] = []
    machine.on('processingRequired', (e) => events.push(e))
    watcher.fireParser('arenaMatchEnd', matchEnd)
    await flushPromises()

    const ev = events[0].timeline[0]!
    expect(ev.type).toBe('trinket')
    expect(ev.spellId).toBe(42292)
    expect(ev.casterName).toBe('Thrall-Emerald Dream')
    expect(ev.targetName).toBe('Thrall-Emerald Dream')
  })

  it('stores casterName in defensive timeline event', async () => {
    watcher.fireParser('arenaZoneEntered', zoneEntered)
    await flushPromises()
    watcher.fireParser('arenaMatchStart', { ...matchStart2v2, timestamp: MATCH_START_TS })

    watcher.fireParser('spellCast', {
      casterGuid: 'Player-A',
      casterName: 'Frostmage-Stormrage',
      targetGuid: 'Player-A',
      targetName: 'Frostmage-Stormrage',
      targetFlags: 0x511,
      spellId: 45438, // Ice Block
      spellName: 'Ice Block',
      eventCategory: 'defensive',
      timestamp: new Date(MATCH_START_TS.getTime() + 20_000)
    })

    const events: ProcessingRequiredEvent[] = []
    machine.on('processingRequired', (e) => events.push(e))
    watcher.fireParser('arenaMatchEnd', matchEnd)
    await flushPromises()

    expect(events[0].timeline[0]!.casterName).toBe('Frostmage-Stormrage')
  })
})

describe('RecorderStateMachine — death analysis: unusedDefensives', () => {
  let watcher: FakeWatcher
  let recorder: FakeRecorder
  let machine: RecorderStateMachine

  const MATCH_START_TS = new Date('2026-04-15T20:00:15Z')

  beforeEach(() => {
    watcher = new FakeWatcher()
    recorder = new FakeRecorder()
    machine = buildMachine(watcher, recorder)
  })

  // Helper: start session and match
  async function startMatch(bracket = matchStart2v2): Promise<void> {
    watcher.fireParser('arenaZoneEntered', zoneEntered)
    await flushPromises()
    watcher.fireParser('arenaMatchStart', { ...bracket, timestamp: MATCH_START_TS })
  }

  it('unusedDefensives is undefined when player class is unknown', async () => {
    await startMatch()

    watcher.fireParser('unitDied', {
      unitGuid: 'Player-X',
      unitName: 'UnknownPlayer-Realm',
      destFlags: 0x511, // friendly
      timestamp: new Date(MATCH_START_TS.getTime() + 60_000)
    })

    const events: ProcessingRequiredEvent[] = []
    machine.on('processingRequired', (e) => events.push(e))
    watcher.fireParser('arenaMatchEnd', matchEnd)
    await flushPromises()

    expect(events[0].timeline[0]!.unusedDefensives).toBeUndefined()
  })

  it('all class defensives shown as unused when none were cast', async () => {
    await startMatch()

    // Establish class: Mage cast Counterspell (class inference)
    watcher.fireParser('spellCast', {
      casterGuid: 'Player-A',
      casterName: 'Frostmage-Stormrage',
      targetGuid: 'Player-B',
      targetName: 'Enemy-Realm',
      targetFlags: UNIT_FLAG_REACTION_HOSTILE,
      spellId: 2139, // Counterspell → Mage
      spellName: 'Counterspell',
      eventCategory: 'interrupt',
      timestamp: new Date(MATCH_START_TS.getTime() + 10_000)
    })

    // Mage dies without pressing anything
    watcher.fireParser('unitDied', {
      unitGuid: 'Player-A',
      unitName: 'Frostmage-Stormrage',
      destFlags: 0x511, // friendly (own team)
      timestamp: new Date(MATCH_START_TS.getTime() + 60_000)
    })

    const events: ProcessingRequiredEvent[] = []
    machine.on('processingRequired', (e) => events.push(e))
    watcher.fireParser('arenaMatchEnd', matchEnd)
    await flushPromises()

    const deathEv = events[0].timeline.find((e) => e.type === 'death-player')!
    expect(deathEv.unusedDefensives).toBeDefined()
    expect(deathEv.unusedDefensives).toContain('Ice Block')
    expect(deathEv.unusedDefensives).toContain('Trinket')
  })

  it('defensive used within cooldown window is NOT listed as unused', async () => {
    await startMatch()

    // Mage cast Barkskin... no wait, Mage: Ice Block was used at T+10s (cooldown 240s)
    watcher.fireParser('spellCast', {
      casterGuid: 'Player-A',
      casterName: 'Frostmage-Stormrage',
      targetGuid: 'Player-A',
      targetName: 'Frostmage-Stormrage',
      targetFlags: 0x511,
      spellId: 45438, // Ice Block — also sets class to Mage
      spellName: 'Ice Block',
      eventCategory: 'defensive',
      timestamp: new Date(MATCH_START_TS.getTime() + 10_000)
    })

    // Mage dies at T+15s — Ice Block was used 5s ago, still on 240s cooldown
    watcher.fireParser('unitDied', {
      unitGuid: 'Player-A',
      unitName: 'Frostmage-Stormrage',
      destFlags: 0x511,
      timestamp: new Date(MATCH_START_TS.getTime() + 15_000)
    })

    const events: ProcessingRequiredEvent[] = []
    machine.on('processingRequired', (e) => events.push(e))
    watcher.fireParser('arenaMatchEnd', matchEnd)
    await flushPromises()

    const deathEv = events[0].timeline.find((e) => e.type === 'death-player')!
    expect(deathEv.unusedDefensives).not.toContain('Ice Block')
    // Trinket was NOT used — should still be listed
    expect(deathEv.unusedDefensives).toContain('Trinket')
  })

  it('defensive used with expired cooldown IS listed as unused again', async () => {
    await startMatch()

    // Rogue used Evasion (120s CD) at T+5s
    watcher.fireParser('spellCast', {
      casterGuid: 'Player-A',
      casterName: 'SubRogue-Realm',
      targetGuid: 'Player-A',
      targetName: 'SubRogue-Realm',
      targetFlags: 0x511,
      spellId: 5277, // Evasion — also sets class to Rogue
      spellName: 'Evasion',
      eventCategory: 'defensive',
      timestamp: new Date(MATCH_START_TS.getTime() + 5_000)
    })

    // Rogue dies at T+130s — Evasion was used 125s ago, 120s CD expired → available again
    watcher.fireParser('unitDied', {
      unitGuid: 'Player-A',
      unitName: 'SubRogue-Realm',
      destFlags: 0x511,
      timestamp: new Date(MATCH_START_TS.getTime() + 130_000)
    })

    const events: ProcessingRequiredEvent[] = []
    machine.on('processingRequired', (e) => events.push(e))
    watcher.fireParser('arenaMatchEnd', matchEnd)
    await flushPromises()

    const deathEv = events[0].timeline.find((e) => e.type === 'death-player')!
    expect(deathEv.unusedDefensives).toContain('Evasion')
  })

  it('computes unusedDefensives for enemy death as well', async () => {
    await startMatch()

    // Enemy Paladin is identified by casting Avenging Wrath
    watcher.fireParser('spellCast', {
      casterGuid: 'Player-Enemy',
      casterName: 'HolyPal-Realm',
      targetGuid: 'Player-Enemy',
      targetName: 'HolyPal-Realm',
      targetFlags: UNIT_FLAG_REACTION_HOSTILE,
      spellId: 31884, // Avenging Wrath → Paladin
      spellName: 'Avenging Wrath',
      eventCategory: 'offensive',
      timestamp: new Date(MATCH_START_TS.getTime() + 30_000)
    })

    // Enemy Paladin dies — did not use Divine Shield
    watcher.fireParser('unitDied', {
      unitGuid: 'Player-Enemy',
      unitName: 'HolyPal-Realm',
      destFlags: UNIT_FLAG_REACTION_HOSTILE,
      timestamp: new Date(MATCH_START_TS.getTime() + 90_000)
    })

    const events: ProcessingRequiredEvent[] = []
    machine.on('processingRequired', (e) => events.push(e))
    watcher.fireParser('arenaMatchEnd', matchEnd)
    await flushPromises()

    const deathEv = events[0].timeline.find((e) => e.type === 'death-enemy')!
    expect(deathEv.unusedDefensives).toContain('Divine Shield')
    expect(deathEv.unusedDefensives).toContain('Trinket')
  })

  it('cooldowns reset between Solo Shuffle rounds', async () => {
    watcher.fireParser('arenaZoneEntered', zoneEntered)
    await flushPromises()

    const round1Start = new Date('2026-04-15T20:00:15Z')

    // Round 1: Mage uses Ice Block at T+10s
    watcher.fireParser('arenaMatchStart', { ...matchStartSS, timestamp: round1Start })
    watcher.fireParser('spellCast', {
      casterGuid: 'Player-A',
      casterName: 'Frostmage-Stormrage',
      targetGuid: 'Player-A',
      targetName: 'Frostmage-Stormrage',
      targetFlags: 0x511,
      spellId: 45438,
      spellName: 'Ice Block',
      eventCategory: 'defensive',
      timestamp: new Date(round1Start.getTime() + 10_000)
    })
    watcher.fireParser('soloShuffleRoundEnd', { ...matchEndRound, roundNumber: 1 })
    await flushPromises()

    // Round 2: same Mage dies at T+5s — cooldown tracker was reset, Ice Block should appear
    const round2Start = new Date('2026-04-15T20:02:00Z')
    watcher.fireParser('arenaMatchStart', { ...matchStartSS, timestamp: round2Start })

    watcher.fireParser('unitDied', {
      unitGuid: 'Player-A',
      unitName: 'Frostmage-Stormrage',
      destFlags: 0x511,
      timestamp: new Date(round2Start.getTime() + 5_000)
    })

    const round2Events: ProcessingRequiredEvent[] = []
    machine.on('processingRequired', (e) => round2Events.push(e))
    watcher.fireParser('soloShuffleRoundEnd', {
      ...matchEndRound,
      roundNumber: 2,
      timestamp: new Date('2026-04-15T20:03:30Z')
    })
    await flushPromises()

    const deathEv = round2Events[0].timeline.find((e) => e.type === 'death-player')!
    expect(deathEv.unusedDefensives).toContain('Ice Block')
  })
})

describe('RecorderStateMachine — error handling', () => {
  let watcher: FakeWatcher
  let recorder: FakeRecorder
  let machine: RecorderStateMachine

  beforeEach(() => {
    watcher = new FakeWatcher()
    recorder = new FakeRecorder()
    machine = buildMachine(watcher, recorder)
  })

  it('transitions to error when recorder.start() rejects', async () => {
    recorder.startMock.mockRejectedValueOnce(new Error('Screen Recording permission denied'))

    const errors: { message: string }[] = []
    machine.on('error', (e) => errors.push(e))

    watcher.fireParser('arenaZoneEntered', zoneEntered)
    await flushPromises()

    expect(machine.getStatus()).toBe('error')
    expect(errors[0].message).toMatch(/Screen Recording permission denied/)
  })

  it('transitions to error on unexpected FFmpeg stop', async () => {
    watcher.fireParser('arenaZoneEntered', zoneEntered)
    await Promise.resolve()
    watcher.fireParser('arenaMatchStart', matchStart2v2)

    const errors: { message: string }[] = []
    machine.on('error', (e) => errors.push(e))

    recorder.emit('unexpectedStop', { code: 1, outputPath: '/tmp/raw.mp4', stderrTail: [] })

    expect(machine.getStatus()).toBe('error')
    expect(errors).toHaveLength(1)
  })

  it('ignores arenaZoneEntered when not idle', async () => {
    watcher.fireParser('arenaZoneEntered', zoneEntered)
    await flushPromises()

    expect(machine.getStatus()).toBe('waiting')
    const startCallCount = recorder.startMock.mock.calls.length

    // Second zone entry while already in waiting — should be ignored
    watcher.fireParser('arenaZoneEntered', zoneEntered)
    await flushPromises()

    expect(recorder.startMock).toHaveBeenCalledTimes(startCallCount)
  })
})
