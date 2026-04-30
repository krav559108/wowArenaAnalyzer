// All IPC channel names and payload types for the application.
// Main process: ipcMain.handle / webContents.send
// Renderer: ipcRenderer.invoke / ipcRenderer.on (via contextBridge)

// ---------------------------------------------------------------------------
// Bracket and result types
// ---------------------------------------------------------------------------

export type ArenaBracket = '2v2' | '3v3' | 'solo-shuffle' | 'skirmish'
export type ArenaResult = 'WIN' | 'LOSS'

export type RecorderStatus = 'idle' | 'waiting' | 'recording' | 'processing' | 'error'

// ---------------------------------------------------------------------------
// Timeline event types (stored in metadata.json and used in renderer)
// ---------------------------------------------------------------------------

export type TimelineEventType =
  | 'arena-start'
  | 'arena-end'
  | 'death-player'
  | 'death-enemy'
  | 'cc'
  | 'defensive'
  | 'offensive'
  | 'interrupt'
  | 'cc-break'
  | 'trinket'

export interface DeathHit {
  spellId?: number
  spellName: string
  amount: number
  relSecs: number  // seconds before death (0 = at death moment, negative = before)
  // HP% of the target just before this hit landed (requires Advanced Combat Logging)
  hpPct?: number
}

export interface TimelineEvent {
  timestamp: number // seconds from recording start
  type: TimelineEventType
  spellId?: number
  spellName?: string
  duration?: number     // actual CC duration in seconds (AURA_APPLIED → AURA_REMOVED)
  unit?: string         // unit name for death events
  casterName?: string   // who cast the spell
  targetName?: string   // who was targeted
  target?: 'player' | 'enemy'
  isHealerCC?: boolean  // CC whose target is a confirmed healer
  unusedDefensives?: string[]  // defensives that were off cooldown at time of death (local player only)
  isMistake?: boolean   // flagged as a mistake (e.g. DR-immune CC, bad interrupt)
  mistakeReason?: string // human-readable reason, e.g. "DR immune", "Bad interrupt"
  deathSummary?: DeathHit[]  // last 3 seconds of incoming damage (death events only)
  // Interrupt-specific: undefined = unknown, true = interrupted a spell, false = hit on immune (Precognition)
  isSuccessful?: boolean
  // Name of the spell that was interrupted (successful interrupts only)
  interruptedSpell?: string
}

// ---------------------------------------------------------------------------
// Recording metadata (written to metadata.json, read back by storage layer)
// ---------------------------------------------------------------------------

export interface RecordingMetadata {
  date: string // ISO 8601
  zone: string
  bracket: ArenaBracket
  result: ArenaResult
  duration: number // seconds
  playerName: string    // local player fullName (Name-Realm), empty if addon not connected
  playerClass: string
  playerSpec: string
  teamComp: string[]
  enemyComp: string[]
  // name → spec string derived from COMBATANT_INFO specId (populated at match start)
  knownSpecs: Record<string, string>
  // names of confirmed healers (from SPELL_HEAL cross-heals + specId)
  healerNames: string[]
  rating: { before: number; after: number } | null
  // name → personal rating from COMBATANT_INFO (populated at match start)
  playerRatings?: Record<string, number>
  // Per-second cumulative damage for line charts (index = second from match start)
  teamDmgBySecond?: number[]
  enemyDmgBySecond?: number[]
  teamHealBySecond?: number[]
  enemyHealBySecond?: number[]
  // Solo Shuffle only
  round?: number
  sessionId?: string
  events: TimelineEvent[]
}

export interface Recording {
  id: string // directory name
  path: string // absolute path to directory
  videoPath: string
  thumbnailPath: string
  metadata: RecordingMetadata
}

// ---------------------------------------------------------------------------
// Log analysis types
// ---------------------------------------------------------------------------

export interface ArenaPlayerStats {
  guid: string
  name: string
  team: number        // 0 = local player's team, 1 = enemy team
  ratingBefore: number
  ratingAfter: number
  isHealer: boolean
  className: string   // inferred from spell events, empty if no tracked spells observed
  specName: string    // inferred from spec-unique spell events, empty if undetermined
}

export interface MatchAnalysisSummary {
  playerDeaths: number
  enemyDeaths: number
  ccCount: number
  interruptCount: number
  defensiveCount: number
  offensiveCount: number
  ccBreakCount: number
}

export interface MatchAnalysis {
  id: string
  bracket: ArenaBracket
  zone: string
  result: ArenaResult
  duration: number
  date: string
  playerName: string
  ratingBefore?: number
  ratingAfter?: number
  round?: number
  sessionId?: string
  events: TimelineEvent[]
  summary: MatchAnalysisSummary
  playerTeam: ArenaPlayerStats[]
  enemyTeam: ArenaPlayerStats[]
}

// ---------------------------------------------------------------------------
// Command channels: ipcMain.handle / ipcRenderer.invoke (request/response)
// ---------------------------------------------------------------------------

export interface IpcCommands {
  // Recorder control
  'recorder:start': { params: void; result: void }
  'recorder:stop': { params: void; result: void }
  'recorder:getStatus': { params: void; result: RecorderStatus }

  // Storage
  'storage:getRecordings': { params: void; result: Recording[] }
  'storage:deleteRecording': { params: { id: string }; result: void }
  'storage:openFolder': { params: { id: string }; result: void }

  // Config
  'config:get': { params: { key: string }; result: unknown }
  'config:set': { params: { key: string; value: unknown }; result: void }
  'config:getAll': { params: void; result: AppConfig }

  // Log file analysis
  'logAnalysis:parseFile': { params: { filePath: string }; result: MatchAnalysis[] }
  'logAnalysis:getCache': { params: void; result: { filePath: string; matches: MatchAnalysis[] } | null }

  // Addon connection status
  'system:getAddonStatus': {
    params: void
    result: { connected: boolean; name?: string; spec?: string; className?: string }
  }

  // System / onboarding checks
  'system:checkBrew': { params: void; result: { found: boolean; path: string | null } }
  'system:checkFfmpeg': { params: void; result: { found: boolean; path: string | null } }
  'system:checkScreenPermission': {
    params: void
    result: { status: 'granted' | 'denied' | 'not-determined' }
  }
  'system:requestScreenPermission': {
    params: void
    result: { status: 'granted' | 'denied' | 'not-determined' }
  }
  'system:checkAddon': { params: { wowPath: string }; result: { found: boolean } }
  'system:installAddon': { params: { wowPath: string }; result: { success: boolean; error?: string } }
  'system:openAddonSource': { params: void; result: void }
  'system:openAddonsDir': { params: { wowPath: string }; result: void }
  'system:listCaptureDevices': { params: void; result: CaptureDevice[] }
  'system:checkWowPath': { params: { path: string }; result: { valid: boolean } }
  'system:openSystemPreferences': { params: void; result: void }
  'system:pickFolder': { params: void; result: { path: string | null } }
  'system:pickLogFile': { params: void; result: { path: string | null } }
  'system:openUrl': { params: { url: string }; result: void }
  'system:relaunch': { params: void; result: void }
  'system:getPlatform': { params: void; result: { platform: string } }
}

// ---------------------------------------------------------------------------
// Push event channels: webContents.send / ipcRenderer.on (main → renderer)
// ---------------------------------------------------------------------------

export interface IpcEvents {
  'recorder:statusChanged': { status: RecorderStatus; zone?: string }
  'recorder:error': { message: string }
  'combatlog:arenaDetected': { zone: string; bracket: ArenaBracket }
  // Fired after a recording is successfully post-processed
  'storage:recordingProcessed': { recording: Recording }
  // Fired on startup when orphaned recording directories are found
  'storage:orphanedRecordings': { paths: string[] }
  // Fired when the SavedVariables file changes — addon character switched
  'addon:statusChanged': { connected: boolean; name?: string; spec?: string; className?: string }
}

// ---------------------------------------------------------------------------
// App configuration stored in electron-store
// ---------------------------------------------------------------------------

export interface AppConfig {
  wowPath: string
  storagePath: string
  videoBitrate: number // kbps
  videoFps: 30 | 60
  captureDevice: string  // AVFoundation video device index, e.g. "1"
  videoResolution: string // "native" | "2560x1440" | "1920x1080" | "1280x720"
  autoCleanupDays: number | null // null = disabled
  autoCleanupMaxGb: number | null // null = disabled
  minimizeToTray: boolean
  onboardingComplete: boolean
}

export interface CaptureDevice {
  index: number
  name: string
  isScreen: boolean
  // Populated for screen devices: pixel dimensions and whether it's the primary display
  resolution?: string
  isPrimary?: boolean
  // Windows only: monitor bounds for per-monitor gdigrab capture
  bounds?: { x: number; y: number; width: number; height: number }
}

// ---------------------------------------------------------------------------
// Preload API exposed to renderer via contextBridge
// ---------------------------------------------------------------------------

export interface ElectronAPI {
  invoke<K extends keyof IpcCommands>(
    channel: K,
    params?: IpcCommands[K]['params']
  ): Promise<IpcCommands[K]['result']>

  on<K extends keyof IpcEvents>(channel: K, listener: (payload: IpcEvents[K]) => void): () => void // returns unsubscribe function
}
