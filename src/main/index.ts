import { app, BrowserWindow, shell, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import Store from 'electron-store'

import { registerSystemIpc, wireAddonWindow } from './ipc/system.ipc'
import { registerRecorderIpc, wireRecorderWindow } from './ipc/recorder.ipc'
import { registerStorageIpc, wireStorageWindow } from './ipc/storage.ipc'
import { registerConfigIpc } from './ipc/config.ipc'
import { registerLogAnalysisIpc } from './ipc/logAnalysis.ipc'

import { CombatLogWatcher } from './combatlog/CombatLogWatcher'
import { WindowCaptureRecorder } from './recorder/WindowCaptureRecorder'
import { RecorderStateMachine } from './recorder/RecorderStateMachine'
import { StorageManager } from './storage/StorageManager'
import { readAddonCharacterInfo } from './addon/SavedVarsReader'
import { resolveFfmpegPath } from './system/ffmpeg'

import type { AppConfig } from '@shared/ipc.types'
import {
  COMBAT_LOG_RELATIVE_DIR,
  COMBAT_LOG_GLOB,
  DEFAULT_STORAGE_PATH,
  DEFAULT_VIDEO_BITRATE_KBPS,
  DEFAULT_VIDEO_FPS,
  DEFAULT_CAPTURE_SOURCE_HINT,
  DEFAULT_VIDEO_RESOLUTION,
  DEFAULT_MINIMIZE_TO_TRAY
} from '@shared/constants'

// ---------------------------------------------------------------------------
// App config — electron-store with typed defaults
// ---------------------------------------------------------------------------

const DEFAULT_WOW_PATH = process.platform === 'win32'
  ? 'C:\\Program Files (x86)\\World of Warcraft'
  : '/Applications/World of Warcraft'

const configStore = new Store<AppConfig>({
  defaults: {
    wowPath: DEFAULT_WOW_PATH,
    storagePath: DEFAULT_STORAGE_PATH,
    videoBitrate: DEFAULT_VIDEO_BITRATE_KBPS,
    videoFps: DEFAULT_VIDEO_FPS,
    captureSourceHint: DEFAULT_CAPTURE_SOURCE_HINT,
    videoResolution: DEFAULT_VIDEO_RESOLUTION,
    autoCleanupDays: null,
    autoCleanupMaxGb: null,
    minimizeToTray: DEFAULT_MINIMIZE_TO_TRAY,
    onboardingComplete: false
  }
})

// Migrate: clamp stored FPS to 30 if the saved value is 60 (device cap)
if (configStore.get('videoFps') === 60) {
  configStore.set('videoFps', 30)
}

// ---------------------------------------------------------------------------
// Pipeline singletons — created once, shared across IPC registrations
// ---------------------------------------------------------------------------

function createPipeline(): {
  watcher: CombatLogWatcher
  recorder: WindowCaptureRecorder
  stateMachine: RecorderStateMachine
  storageManager: StorageManager
} {
  const wowPath = configStore.get('wowPath')
  const storagePath = configStore.get('storagePath')
  const logsDir = join(wowPath, COMBAT_LOG_RELATIVE_DIR)
  const rawDir = join(storagePath, 'raw')

  const watcher = new CombatLogWatcher({ dir: logsDir, glob: COMBAT_LOG_GLOB })
  const recorder = new WindowCaptureRecorder()
  const localPlayer = readAddonCharacterInfo(wowPath)
  const stateMachine = new RecorderStateMachine(watcher, recorder, {
    rawRecordingsDir: rawDir,
    localPlayerName: localPlayer?.fullName ?? null,
    localPlayerGuid: localPlayer?.guid ?? null,
    recorder: {
      bitrateKbps: configStore.get('videoBitrate'),
      fps: configStore.get('videoFps'),
      sourceHint: configStore.get('captureSourceHint'),
      resolution: configStore.get('videoResolution')
    }
  })
  const storageManager = new StorageManager(storagePath)

  // Subscribe to post-processing events from the state machine
  stateMachine.on('processingRequired', (event) => {
    let ffmpegPath: string
    try {
      ffmpegPath = resolveFfmpegPath()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[Main] Cannot post-process recording: FFmpeg not found.', message)
      return
    }

    storageManager
      .processRecording(event, ffmpegPath, event.timeline)
      .then((recording) => {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) {
            win.webContents.send('storage:recordingProcessed', { recording })
          }
        }
      })
      .catch((err: Error) => {
        console.error('[Main] Post-processing failed:', err.message)
      })
  })

  watcher.start()
  console.warn(`[Main] Combat log watcher started: ${logsDir}/${COMBAT_LOG_GLOB}`)

  return { watcher, recorder, stateMachine, storageManager }
}

// ---------------------------------------------------------------------------
// System tray
// ---------------------------------------------------------------------------

let tray: Tray | null = null
// Set to true when the app is actually quitting so the window close event
// doesn't intercept and hide the window instead of letting it close.
let isQuitting = false

async function createTray(mainWindow: BrowserWindow): Promise<void> {
  if (tray !== null) return
  let icon = nativeImage.createEmpty()
  try {
    icon = await app.getFileIcon(process.execPath, { size: 'small' })
  } catch { /* use empty icon */ }
  tray = new Tray(icon)
  tray.setToolTip('WoW Arena Recorder')
  tray.on('double-click', () => mainWindow.show())
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show', click: () => mainWindow.show() },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit() } },
  ]))
}

function destroyTray(): void {
  tray?.destroy()
  tray = null
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createWindow(
  stateMachine: RecorderStateMachine,
  storageManager: StorageManager
): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 900,
    minHeight: 720,
    show: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f0f0f',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('close', (event) => {
    if (!isQuitting && configStore.get('minimizeToTray')) {
      event.preventDefault()
      mainWindow.hide()
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Wire per-window push events (ipcMain.handle is registered once at startup)
  wireRecorderWindow(stateMachine, mainWindow)
  wireStorageWindow(storageManager, mainWindow)
  wireAddonWindow(configStore, mainWindow)

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  registerSystemIpc(configStore)
  registerConfigIpc(configStore)
  registerLogAnalysisIpc(configStore)

  const { recorder, stateMachine, storageManager } = createPipeline()

  // Keep recorder options in sync with config changes (e.g. window selection in Settings).
  const recorderConfigKeys = ['videoBitrate', 'videoFps', 'captureSourceHint', 'videoResolution'] as const
  for (const key of recorderConfigKeys) {
    configStore.onDidChange(key, () => {
      stateMachine.updateRecorderOptions({
        bitrateKbps: configStore.get('videoBitrate'),
        fps: configStore.get('videoFps'),
        sourceHint: configStore.get('captureSourceHint'),
        resolution: configStore.get('videoResolution')
      })
    })
  }

  // Register ipcMain.handle commands once — re-registration throws in Electron.
  registerRecorderIpc(stateMachine)
  registerStorageIpc(storageManager)

  const mainWindow = createWindow(stateMachine, storageManager)

  // Create tray on startup if the setting is enabled, and react to changes.
  if (configStore.get('minimizeToTray')) {
    void createTray(mainWindow)
  }
  configStore.onDidChange('minimizeToTray', (enabled) => {
    if (enabled) {
      void createTray(mainWindow)
    } else {
      destroyTray()
    }
  })

  app.on('activate', () => {
    // On macOS: clicking the dock icon shows the window even if it was hidden to tray.
    const wins = BrowserWindow.getAllWindows()
    if (wins.length === 0) {
      createWindow(stateMachine, storageManager)
    } else {
      wins[0]?.show()
    }
  })

  // Stop any active capture before quitting so macOS releases the screen recording
  // indicator immediately and the hidden capture window/write stream are torn down
  // cleanly (mainWindow stays open throughout, so window-all-closed doesn't fire
  // prematurely while the hidden window is being destroyed).
  app.on('before-quit', (event) => {
    isQuitting = true
    if (!recorder.isRecording()) return
    event.preventDefault()
    recorder
      .stop()
      .catch((err: Error) => console.error('[Main] Failed to stop recorder on quit:', err.message))
      .finally(() => app.quit())
  })
})

// Quit on window close on all platforms — this is a utility app, not a menu-bar app.
app.on('window-all-closed', () => {
  app.quit()
})
