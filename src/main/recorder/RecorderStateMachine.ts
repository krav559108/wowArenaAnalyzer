// Recording pipeline state machine: idle → waiting → recording → processing → idle.
//
// State transitions:
//   idle      → waiting    : arenaZoneEntered — recorder.start() is called here
//   waiting   → recording  : arenaMatchStart — match has begun
//   recording → processing : arenaMatchEnd / soloShuffleRoundEnd — recorder.stop()
//   processing → idle      : 2v2/3v3 — processing complete, await zone exit
//   processing → waiting   : Solo Shuffle — next round, recorder.start() again
//   any       → idle       : arenaZoneLeft — abort recording if active
//   any       → error      : recorder crashes or start/stop fails

import { EventEmitter } from 'events'
import { join } from 'path'
import type { ArenaBracket, ArenaResult, RecorderStatus, TimelineEvent } from '@shared/ipc.types'
import { SPELL_CLASS_MAP, DR_CATEGORY, WOW_SPEC_ID_MAP } from '@shared/constants'
import { getClassDefensives, type WowClass } from '@shared/classAbilities'
import type { CombatLogWatcher } from '../combatlog/CombatLogWatcher'
import type { RecorderOptions, ScreenRecorder } from './ScreenRecorder'
import type {
  ArenaZoneEnteredEvent,
  ArenaMatchStartEvent,
  SpellCastEvent,
  SpellAuraEvent,
  UnitDiedEvent,
  HealerCastEvent,
  CombatantInfoEvent
} from '../combatlog/CombatLogParser'
import { UNIT_FLAG_REACTION_HOSTILE } from '../combatlog/CombatLogParser'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StateMachineOptions {
  // Directory for raw (untrimmed) recordings before post-processing
  rawRecordingsDir: string
  // Local player's fullName (Name-Realm) from addon SavedVars — used for "could use" filter.
  // null = unknown (show "could use" for no deaths, to avoid false positives).
  localPlayerName: string | null
  // Options forwarded to ScreenRecorder.start()
  recorder?: RecorderOptions
}

// Emitted when a match recording is complete and ready for post-processing.
// Stage 5 subscribes to this event and performs trim / thumbnail / metadata.
export interface ProcessingRequiredEvent {
  rawPath: string
  zoneName: string
  bracket: ArenaBracket
  result: ArenaResult
  durationSecs: number
  // Exact time the ARENA_MATCH_START event was received
  matchStartedAt: Date
  // Time recorder.start() was called — used to calculate the trim offset
  recordingStartedAt: Date
  // Timeline events collected during this match (relative timestamps in seconds)
  timeline: TimelineEvent[]
  // name → spec string from COMBATANT_INFO
  knownSpecs: Record<string, string>
  // confirmed healer names
  healerNames: string[]
  // Solo Shuffle only
  roundNumber?: number
  sessionId?: string
}

export interface StateMachineEventMap {
  statusChanged: { status: RecorderStatus; zone?: string }
  error: { message: string }
  // Stage 5 hooks here to perform post-processing
  processingRequired: ProcessingRequiredEvent
}

// ---------------------------------------------------------------------------
// Internal session context
// ---------------------------------------------------------------------------

interface DrCounter {
  count: number       // number of applications since window opened
  windowExpiresAt: number  // relSecs when the 18s DR window expires (set on aura removal)
}

interface ActiveCC {
  spellId: number
  spellName: string
  startRelSecs: number
  // Index in pendingTimeline so we can back-fill the duration
  timelineIndex: number
}

interface SessionContext {
  zoneId: number
  zoneName: string
  bracket: ArenaBracket | null
  isSoloShuffle: boolean
  roundNumber: number
  sessionId: string
  recordingStartedAt: Date
  matchStartedAt: Date | null
  rawOutputPath: string | null
  // Timeline events accumulated during the current round (cleared on each ARENA_MATCH_START)
  pendingTimeline: TimelineEvent[]
  // Per-player defensive + trinket cooldown usage: playerName → (spellId → relSecs used).
  playerCooldowns: Map<string, Map<number, number>>
  // Active CC auras: `${targetGuid}:${spellId}` → ActiveCC (to compute actual duration)
  activeCCs: Map<string, ActiveCC>
  // DR state per target per category: `${targetGuid}:${drCategory}` → DrCounter
  drCounters: Map<string, DrCounter>
  // Confirmed healers (by casterGuid) — detected via SPELL_HEAL cross-heal events
  healerGuids: Set<string>
  // casterGuid → casterName for healer lookups
  healerNames: Map<string, string>
  // playerName → spec string from COMBATANT_INFO specId
  knownSpecs: Map<string, string>
}

// ---------------------------------------------------------------------------
// RecorderStateMachine
// ---------------------------------------------------------------------------

export class RecorderStateMachine extends EventEmitter {
  private status: RecorderStatus = 'idle'
  private session: SessionContext | null = null

  // Inferred class per player name — persists for the duration of the arena session.
  private readonly playerClassInferred = new Map<string, WowClass>()

  // Local player's fullName from addon SavedVars (Name-Realm format).
  private readonly localPlayerName: string | null

  private readonly watcher: CombatLogWatcher
  private readonly recorder: ScreenRecorder
  private readonly options: StateMachineOptions

  constructor(watcher: CombatLogWatcher, recorder: ScreenRecorder, options: StateMachineOptions) {
    super()
    this.watcher = watcher
    this.recorder = recorder
    this.options = options
    this.localPlayerName = options.localPlayerName

    this.bindParserEvents()
    this.bindRecorderEvents()
  }

  // ---------------------------------------------------------------------------
  // Public
  // ---------------------------------------------------------------------------

  getStatus(): RecorderStatus {
    return this.status
  }

  // ---------------------------------------------------------------------------
  // Typed EventEmitter overrides
  // ---------------------------------------------------------------------------

  override emit<K extends keyof StateMachineEventMap>(
    event: K,
    payload: StateMachineEventMap[K]
  ): boolean {
    return super.emit(event, payload)
  }

  override on<K extends keyof StateMachineEventMap>(
    event: K,
    listener: (payload: StateMachineEventMap[K]) => void
  ): this {
    return super.on(event, listener)
  }

  override once<K extends keyof StateMachineEventMap>(
    event: K,
    listener: (payload: StateMachineEventMap[K]) => void
  ): this {
    return super.once(event, listener)
  }

  // ---------------------------------------------------------------------------
  // Parser event binding
  // ---------------------------------------------------------------------------

  private bindParserEvents(): void {
    this.watcher.onParser('arenaZoneEntered', (e) => this.onZoneEntered(e))
    this.watcher.onParser('arenaZoneLeft', () => this.onZoneLeft())
    this.watcher.onParser('arenaMatchStart', (e) => this.onMatchStart(e))
    this.watcher.onParser('arenaMatchEnd', (e) =>
      this.onMatchEnd(e.result, e.durationSecs, e.timestamp)
    )
    this.watcher.onParser('soloShuffleRoundEnd', (e) =>
      this.onMatchEnd(e.result, e.durationSecs, e.timestamp)
    )
    this.watcher.onParser('spellCast', (e) => this.onSpellCast(e))
    this.watcher.onParser('unitDied', (e) => this.onUnitDied(e))
    this.watcher.onParser('spellAuraApplied', (e) => this.onAuraApplied(e))
    this.watcher.onParser('spellAuraRemoved', (e) => this.onAuraRemoved(e))
    this.watcher.onParser('healerCast', (e) => this.onHealerCast(e))
    this.watcher.onParser('combatantInfo', (e) => this.onCombatantInfo(e))
  }

  private bindRecorderEvents(): void {
    this.recorder.on('unexpectedStop', ({ outputPath, stderrTail }) => {
      console.error(
        '[StateMachine] FFmpeg stopped unexpectedly.\n' + stderrTail.slice(-5).join('\n')
      )
      this.session = null
      this.transitionTo('error')
      this.emit('error', {
        message: `Recording stopped unexpectedly. Raw file: ${outputPath}`
      })
    })
  }

  // ---------------------------------------------------------------------------
  // Zone entry / exit
  // ---------------------------------------------------------------------------

  private onZoneEntered(e: ArenaZoneEnteredEvent): void {
    if (this.status !== 'idle' && this.status !== 'error') {
      console.warn(`[StateMachine] arenaZoneEntered in state "${this.status}" — ignoring`)
      return
    }
    if (this.status === 'error') {
      // Auto-recover: a new arena zone clears the error state
      this.transitionTo('idle')
    }

    this.session = {
      zoneId: e.zoneId,
      zoneName: e.zoneName,
      bracket: null,
      isSoloShuffle: false,
      roundNumber: 0,
      sessionId: e.timestamp.toISOString(),
      recordingStartedAt: new Date(),
      matchStartedAt: null,
      rawOutputPath: null,
      pendingTimeline: [],
      playerCooldowns: new Map(),
      activeCCs: new Map(),
      drCounters: new Map(),
      healerGuids: new Set(),
      healerNames: new Map(),
      knownSpecs: new Map()
    }

    this.transitionTo('waiting', e.zoneName)
    void this.startRecorder()
  }

  private onZoneLeft(): void {
    if (this.status === 'idle' || this.status === 'error') return

    if (this.status === 'waiting' || this.status === 'recording') {
      console.warn(`[StateMachine] Zone left during "${this.status}" — aborting recording`)
      void this.abortRecorder()
    }

    this.session = null
    this.playerClassInferred.clear()
    this.transitionTo('idle')
  }

  // ---------------------------------------------------------------------------
  // Match start / end
  // ---------------------------------------------------------------------------

  private onMatchStart(e: ArenaMatchStartEvent): void {
    // Fallback: if ZONE_CHANGE was missed (file created after watcher started),
    // treat ARENA_MATCH_START itself as the zone-entry trigger.
    if ((this.status === 'idle' || this.status === 'error') && this.session === null) {
      console.warn(`[StateMachine] ARENA_MATCH_START in idle — recovering via match-start trigger`)
      this.session = {
        zoneId: e.instanceId,
        zoneName: e.zoneName,
        bracket: null,
        isSoloShuffle: false,
        roundNumber: 0,
        sessionId: e.timestamp.toISOString(),
        recordingStartedAt: new Date(),
        matchStartedAt: null,
        rawOutputPath: null,
        pendingTimeline: [],
        playerCooldowns: new Map(),
        activeCCs: new Map(),
        drCounters: new Map(),
        healerGuids: new Set(),
        healerNames: new Map(),
        knownSpecs: new Map()
      }
      this.transitionTo('waiting', e.zoneName)
      void this.startRecorder()
    }

    if (this.status !== 'waiting' || this.session === null) return

    this.session.bracket = e.bracket
    this.session.isSoloShuffle = e.bracket === 'solo-shuffle'
    this.session.roundNumber++
    this.session.matchStartedAt = e.timestamp
    // Clear per-round state: all timestamps are relative to this match start.
    this.session.pendingTimeline = []
    this.session.playerCooldowns = new Map()
    this.session.activeCCs = new Map()
    this.session.drCounters = new Map()

    this.transitionTo('recording', this.session.zoneName)
    console.warn(
      `[StateMachine] Match started: ${e.bracket} in ${e.zoneName} ` +
        `(round ${this.session.roundNumber})`
    )
  }

  private onMatchEnd(result: ArenaResult, durationSecs: number): void {
    if (this.status !== 'recording' || this.session === null) return

    const {
      zoneName,
      bracket,
      isSoloShuffle,
      roundNumber,
      sessionId,
      recordingStartedAt,
      matchStartedAt,
      rawOutputPath
    } = this.session

    if (bracket === null || matchStartedAt === null || rawOutputPath === null) {
      console.error('[StateMachine] onMatchEnd: incomplete session context — aborting')
      this.session = null
      this.transitionTo('error')
      this.emit('error', { message: 'Internal state error: match ended with missing context' })
      return
    }

    this.transitionTo('processing', zoneName)

    const timeline = [...this.session.pendingTimeline]
    const knownSpecs = Object.fromEntries(this.session.knownSpecs)
    const healerNames = [...this.session.healerNames.keys()]

    void this.recorder
      .stop()
      .then((finalPath) => {
        this.emit('processingRequired', {
          rawPath: finalPath,
          zoneName,
          bracket,
          result,
          durationSecs,
          matchStartedAt,
          recordingStartedAt,
          timeline,
          knownSpecs,
          healerNames,
          roundNumber: isSoloShuffle ? roundNumber : undefined,
          sessionId: isSoloShuffle ? sessionId : undefined
        })

        if (isSoloShuffle && this.session !== null) {
          // Reset per-round fields and start recording for the next round
          this.session.matchStartedAt = null
          this.session.rawOutputPath = null
          this.session.pendingTimeline = []
          this.transitionTo('waiting', zoneName)
          void this.startRecorder()
        } else {
          // 2v2 / 3v3 — done. Zone exit will drive us back to idle.
          this.session = null
          this.transitionTo('idle')
        }
      })
      .catch((err: Error) => {
        console.error('[StateMachine] recorder.stop() failed:', err.message)
        this.session = null
        this.transitionTo('error')
        this.emit('error', { message: `Failed to stop recording: ${err.message}` })
      })
  }

  // ---------------------------------------------------------------------------
  // Recorder helpers
  // ---------------------------------------------------------------------------

  private async startRecorder(): Promise<void> {
    if (this.session === null) return

    const rawPath = buildRawPath(
      this.options.rawRecordingsDir,
      this.session.zoneName,
      this.session.sessionId,
      this.session.roundNumber + 1
    )

    this.session.rawOutputPath = rawPath

    try {
      await this.recorder.start(rawPath, this.options.recorder)
      // Set AFTER FFmpeg confirms it's capturing — this timestamp is used to compute
      // the trim offset, so it must reflect when actual frames started being written.
      this.session.recordingStartedAt = new Date()
      console.warn(`[StateMachine] Recorder started: ${rawPath}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[StateMachine] recorder.start() failed:', message)
      this.session = null
      this.transitionTo('error')
      this.emit('error', { message: `Failed to start recording: ${message}` })
    }
  }

  private async abortRecorder(): Promise<void> {
    if (!this.recorder.isRecording()) return
    try {
      await this.recorder.stop()
    } catch (err) {
      // Best-effort — log but don't escalate; we're abandoning the recording anyway
      console.warn('[StateMachine] abortRecorder error (ignored):', err instanceof Error ? err.message : String(err))
    }
  }

  // ---------------------------------------------------------------------------
  // Timeline event collectors
  // ---------------------------------------------------------------------------

  private onSpellCast(e: SpellCastEvent): void {
    if (this.status !== 'recording' || this.session === null || this.session.matchStartedAt === null)
      return

    const relSecs = (e.timestamp.getTime() - this.session.matchStartedAt.getTime()) / 1000
    const isEnemy = (e.targetFlags & UNIT_FLAG_REACTION_HOSTILE) !== 0

    // Infer caster class from the spell ID.
    const inferredClass = SPELL_CLASS_MAP[e.spellId] as WowClass | undefined
    if (inferredClass !== undefined && e.casterName) {
      this.playerClassInferred.set(e.casterName, inferredClass)
    }

    // Track defensive and trinket cooldown usage per player.
    if (e.eventCategory === 'defensive' || e.eventCategory === 'trinket') {
      let cooldowns = this.session.playerCooldowns.get(e.casterName)
      if (cooldowns === undefined) {
        cooldowns = new Map()
        this.session.playerCooldowns.set(e.casterName, cooldowns)
      }
      cooldowns.set(e.spellId, relSecs)
    }

    // Check if this CC targets a confirmed enemy healer.
    const isHealerCC =
      e.eventCategory === 'cc' &&
      isEnemy &&
      e.targetName !== '' &&
      this.session.healerNames.has(e.targetName)
        ? true
        : undefined

    // DR check: is the target immune to this CC?
    let isMistake: boolean | undefined
    let mistakeReason: string | undefined
    if (e.eventCategory === 'cc' && e.targetGuid) {
      const drCategory = DR_CATEGORY[e.spellId]
      if (drCategory !== undefined) {
        const key = `${e.targetGuid}:${drCategory}`
        const counter = this.session.drCounters.get(key)
        if (counter !== undefined && relSecs < counter.windowExpiresAt && counter.count >= 3) {
          isMistake = true
          mistakeReason = 'DR immune'
        }
      }
    }

    this.session.pendingTimeline.push({
      timestamp: relSecs,
      type: e.eventCategory,
      spellId: e.spellId,
      spellName: e.spellName,
      casterName: e.casterName || undefined,
      targetName: e.targetName || undefined,
      target: isEnemy ? 'enemy' : 'player',
      isHealerCC,
      isMistake,
      mistakeReason
    })
  }

  private onHealerCast(e: HealerCastEvent): void {
    if (this.session === null) return
    this.session.healerGuids.add(e.casterGuid)
    // Store name→guid so isHealerCC check in onSpellCast can look up by targetName
    this.session.healerNames.set(e.casterName, e.casterGuid)
  }

  private onCombatantInfo(e: CombatantInfoEvent): void {
    if (this.session === null || e.playerName === '' || e.specId === null) return
    const entry = (WOW_SPEC_ID_MAP as Record<number, { spec: string; class: string; isHealer: boolean }>)[e.specId]
    if (entry === undefined) return
    this.session.knownSpecs.set(e.playerName, entry.spec)
    if (entry.isHealer) {
      this.session.healerNames.set(e.playerName, e.playerGuid)
    }
  }

  private onAuraApplied(e: SpellAuraEvent): void {
    if (this.status !== 'recording' || this.session === null || this.session.matchStartedAt === null)
      return

    const relSecs = (e.timestamp.getTime() - this.session.matchStartedAt.getTime()) / 1000
    const key = `${e.targetGuid}:${e.spellId}`

    // Find the most recent matching CC cast in pendingTimeline to back-fill duration later.
    let timelineIndex = -1
    for (let i = this.session.pendingTimeline.length - 1; i >= 0; i--) {
      const ev = this.session.pendingTimeline[i]!
      if (ev.type === 'cc' && ev.spellId === e.spellId && ev.targetName === e.targetName) {
        timelineIndex = i
        break
      }
    }

    this.session.activeCCs.set(key, {
      spellId: e.spellId,
      spellName: e.spellName,
      startRelSecs: relSecs,
      timelineIndex
    })

    // Update DR counter: increment count, keep existing window expiry if still active.
    const drCategory = DR_CATEGORY[e.spellId]
    if (drCategory !== undefined) {
      const drKey = `${e.targetGuid}:${drCategory}`
      const existing = this.session.drCounters.get(drKey)
      if (existing !== undefined && relSecs < existing.windowExpiresAt) {
        existing.count++
      } else {
        // Fresh window — first application in this cycle.
        this.session.drCounters.set(drKey, { count: 1, windowExpiresAt: Infinity })
      }
    }
  }

  private onAuraRemoved(e: SpellAuraEvent): void {
    if (this.status !== 'recording' || this.session === null || this.session.matchStartedAt === null)
      return

    const relSecs = (e.timestamp.getTime() - this.session.matchStartedAt.getTime()) / 1000
    const key = `${e.targetGuid}:${e.spellId}`
    const active = this.session.activeCCs.get(key)

    if (active !== undefined) {
      const duration = Math.max(0, relSecs - active.startRelSecs)
      // Back-fill duration on the corresponding timeline event.
      if (active.timelineIndex >= 0) {
        const ev = this.session.pendingTimeline[active.timelineIndex]
        if (ev !== undefined) ev.duration = parseFloat(duration.toFixed(1))
      }
      this.session.activeCCs.delete(key)
    }

    // Update DR window: 18s from when the aura expired.
    const drCategory = DR_CATEGORY[e.spellId]
    if (drCategory !== undefined) {
      const drKey = `${e.targetGuid}:${drCategory}`
      const counter = this.session.drCounters.get(drKey)
      if (counter !== undefined) {
        counter.windowExpiresAt = relSecs + 18
      }
    }
  }

  private onUnitDied(e: UnitDiedEvent): void {
    if (this.status !== 'recording' || this.session === null || this.session.matchStartedAt === null)
      return

    const relSecs = (e.timestamp.getTime() - this.session.matchStartedAt.getTime()) / 1000
    const isEnemy = (e.destFlags & UNIT_FLAG_REACTION_HOSTILE) !== 0

    // "Could use" only for the local player (identified by addon fullName).
    const isLocalPlayer =
      this.localPlayerName !== null &&
      e.unitName.toLowerCase() === this.localPlayerName.toLowerCase()

    const unusedDefensives = isLocalPlayer
      ? computeUnusedDefensives(e.unitName, relSecs, this.playerClassInferred, this.session.playerCooldowns, false)
      : []

    this.session.pendingTimeline.push({
      timestamp: relSecs,
      type: isEnemy ? 'death-enemy' : 'death-player',
      unit: e.unitName,
      unusedDefensives: unusedDefensives.length > 0 ? unusedDefensives : undefined
    })
  }

  // ---------------------------------------------------------------------------
  // Transitions
  // ---------------------------------------------------------------------------

  private transitionTo(status: RecorderStatus, zone?: string): void {
    const prev = this.status
    this.status = status
    console.warn(`[StateMachine] ${prev} → ${status}` + (zone !== undefined ? ` (${zone})` : ''))
    this.emit('statusChanged', { status, zone })
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

// Returns the names of defensive abilities that were available (off cooldown) at the
// moment of death. Used to populate TimelineEvent.unusedDefensives for death events.
function computeUnusedDefensives(
  unitName: string,
  deathRelSecs: number,
  classMap: ReadonlyMap<string, WowClass>,
  cooldownMap: Map<string, Map<number, number>>,
  isEnemy: boolean
): string[] {
  const className = classMap.get(unitName)
  if (className === undefined) return []

  const defensives = getClassDefensives(className)
  const playerCDs = cooldownMap.get(unitName)
  const available: string[] = []

  for (const ability of defensives) {
    // Trinket only flagged as unused when a friendly (user-controlled) player dies.
    if (ability.name === 'Trinket' && isEnemy) continue

    const allIds = [ability.spellId, ...(ability.alternateIds ?? [])]

    // Find the most recent use of this ability (any of its spell IDs).
    let lastUsed: number | undefined
    for (const id of allIds) {
      const used = playerCDs?.get(id)
      if (used !== undefined && (lastUsed === undefined || used > lastUsed)) {
        lastUsed = used
      }
    }

    const isOnCooldown =
      lastUsed !== undefined && deathRelSecs - lastUsed < ability.cooldownSecs

    if (!isOnCooldown) {
      available.push(ability.name)
    }
  }

  return available
}

function buildRawPath(dir: string, zone: string, sessionId: string, round: number): string {
  const safeZone = zone.replace(/[^a-z0-9]/gi, '-').toLowerCase()
  const safeTs = sessionId.replace(/[^0-9T]/g, '').slice(0, 15) // "20260415T200000"
  return join(dir, `raw_${safeZone}_${safeTs}_r${round}.mp4`)
}
