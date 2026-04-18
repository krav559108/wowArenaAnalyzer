import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import Store from 'electron-store'

import { registerSystemIpc, wireAddonWindow } from './ipc/system.ipc'
import { registerRecorderIpc, wireRecorderWindow } from './ipc/recorder.ipc'
import { registerStorageIpc, wireStorageWindow } from './ipc/storage.ipc'
import { registerConfigIpc } from './ipc/config.ipc'
import { registerLogAnalysisIpc } from './ipc/logAnalysis.ipc'

import { CombatLogWatcher } from './combatlog/CombatLogWatcher'
import { ScreenRecorder } from './recorder/ScreenRecorder'
import { RecorderStateMachine } from './recorder/RecorderStateMachine'
import { StorageManager } from './storage/StorageManager'
import { readAddonCharacterInfo } from './addon/SavedVarsReader'

import type { AppConfig } from '@shared/ipc.types'
import {
  COMBAT_LOG_RELATIVE_DIR,
  COMBAT_LOG_GLOB,
  DEFAULT_STORAGE_PATH,
  DEFAULT_VIDEO_BITRATE_KBPS,
  DEFAULT_VIDEO_FPS,
  DEFAULT_CAPTURE_DEVICE,
  DEFAULT_AUDIO_DEVICE,
  DEFAULT_VIDEO_RESOLUTION
} from '@shared/constants'

// ---------------------------------------------------------------------------
// App config — electron-store with typed defaults
// ---------------------------------------------------------------------------

const DEFAULT_WOW_PATH = '/Applications/World of Warcraft'

const configStore = new Store<AppConfig>({
  defaults: {
    wowPath: DEFAULT_WOW_PATH,
    storagePath: DEFAULT_STORAGE_PATH,
    videoBitrate: DEFAULT_VIDEO_BITRATE_KBPS,
    videoFps: DEFAULT_VIDEO_FPS,
    captureDevice: DEFAULT_CAPTURE_DEVICE,
    audioDevice: DEFAULT_AUDIO_DEVICE,
    videoResolution: DEFAULT_VIDEO_RESOLUTION,
    autoCleanupDays: null,
    autoCleanupMaxGb: null,
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
  recorder: ScreenRecorder
  stateMachine: RecorderStateMachine
  storageManager: StorageManager
} {
  const wowPath = configStore.get('wowPath')
  const storagePath = configStore.get('storagePath')
  const logsDir = join(wowPath, COMBAT_LOG_RELATIVE_DIR)
  const rawDir = join(storagePath, 'raw')

  const watcher = new CombatLogWatcher({ dir: logsDir, glob: COMBAT_LOG_GLOB })
  const recorder = new ScreenRecorder()
  const localPlayer = readAddonCharacterInfo(wowPath)
  const stateMachine = new RecorderStateMachine(watcher, recorder, {
    rawRecordingsDir: rawDir,
    localPlayerName: localPlayer?.fullName ?? null,
    recorder: {
      bitrateKbps: configStore.get('videoBitrate'),
      fps: configStore.get('videoFps'),
      captureDevice: configStore.get('captureDevice'),
      audioDevice: configStore.get('audioDevice'),
      resolution: configStore.get('videoResolution')
    }
  })
  const storageManager = new StorageManager(storagePath)

  // Subscribe to post-processing events from the state machine
  stateMachine.on('processingRequired', (event) => {
    let ffmpegPath: string
    try {
      ffmpegPath = ScreenRecorder.resolveFfmpegPath()
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

  const { stateMachine, storageManager } = createPipeline()

  // Register ipcMain.handle commands once — re-registration throws in Electron.
  registerRecorderIpc(stateMachine)
  registerStorageIpc(storageManager)

  createWindow(stateMachine, storageManager)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(stateMachine, storageManager)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
