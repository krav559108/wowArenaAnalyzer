// IPC handlers for system / onboarding checks.
// Channels: system:checkFfmpeg, system:checkScreenPermission, system:checkAddon,
//           system:checkWowPath, system:openSystemPreferences, system:pickFolder

import { ipcMain, shell, dialog, app, desktopCapturer, screen as electronScreen, type BrowserWindow } from 'electron'
import { execSync, execFile } from 'child_process'
import { existsSync } from 'fs'
import { cp, mkdir } from 'fs/promises'
import { join, dirname } from 'path'
import chokidar, { type FSWatcher } from 'chokidar'
import type Store from 'electron-store'
import { ScreenRecorder } from '../recorder/ScreenRecorder'
import { readAddonCharacterInfo } from '../addon/SavedVarsReader'
import { ADDON_RELATIVE_PATH, COMBAT_LOG_RELATIVE_PATH } from '@shared/constants'
import type { AppConfig, CaptureDevice, AudioDevice } from '@shared/ipc.types'

export function registerSystemIpc(configStore: Store<AppConfig>): void {
  // Return the current process platform so renderer can adapt onboarding flow.
  ipcMain.handle('system:getPlatform', (): { platform: string } => {
    return { platform: process.platform }
  })

  // Check whether Homebrew is installed and return its path.
  // On Windows, Homebrew doesn't exist — return found:true as a no-op so the
  // onboarding brew step auto-passes and the FFmpeg check runs immediately.
  ipcMain.handle('system:checkBrew', (): { found: boolean; path: string | null } => {
    if (process.platform === 'win32') return { found: true, path: null }

    try {
      const p = execSync('which brew', { stdio: ['pipe', 'pipe', 'pipe'] })
        .toString()
        .trim()
      if (p.length > 0) return { found: true, path: p }
    } catch {
      // Fall through to known Homebrew locations.
    }

    const candidates = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew']
    for (const candidate of candidates) {
      if (existsSync(candidate)) return { found: true, path: candidate }
    }

    return { found: false, path: null }
  })

  // Check whether FFmpeg is installed and return its path.
  ipcMain.handle('system:checkFfmpeg', (): { found: boolean; path: string | null } => {
    try {
      const path = ScreenRecorder.resolveFfmpegPath()
      return { found: true, path }
    } catch {
      return { found: false, path: null }
    }
  })

  // Check Screen Recording permission status. On Windows, always granted (no permission model).
  ipcMain.handle(
    'system:checkScreenPermission',
    async (): Promise<{ status: 'granted' | 'denied' | 'not-determined' }> => {
      if (process.platform === 'win32') return { status: 'granted' }
      // getMediaAccessStatus('screen') is unreliable on macOS 15 Sequoia — it can
      // return 'denied' even when the user has granted permission. Use
      // desktopCapturer.getSources as the authoritative check: if it returns at
      // least one source the app can actually capture the screen.
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen'] })
        if (sources.length > 0) return { status: 'granted' }
      } catch {
        // Falls through to getMediaAccessStatus below
      }
      const raw = ScreenRecorder.checkScreenPermission()
      const status = raw === 'restricted' ? 'denied' : raw
      return { status }
    }
  )

  // Trigger the macOS screen recording permission prompt. No-op on Windows.
  ipcMain.handle(
    'system:requestScreenPermission',
    async (): Promise<{ status: 'granted' | 'denied' | 'not-determined' }> => {
      if (process.platform === 'win32') return { status: 'granted' }
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen'] })
        if (sources.length > 0) return { status: 'granted' }
      } catch {
        // Throws when permission is denied — expected
      }
      const raw = ScreenRecorder.checkScreenPermission()
      const status = raw === 'restricted' ? 'denied' : raw
      return { status }
    }
  )

  // Check whether SimpleCombatLogger is installed in the given WoW path.
  ipcMain.handle(
    'system:checkAddon',
    (_event, { wowPath }: { wowPath: string }): { found: boolean } => {
      const addonPath = join(wowPath, ADDON_RELATIVE_PATH)
      return { found: existsSync(addonPath) }
    }
  )

  // Validate a candidate WoW installation path by checking for the Logs directory.
  ipcMain.handle(
    'system:checkWowPath',
    (_event, { path }: { path: string }): { valid: boolean } => {
      const logsDir = join(path, '_retail_', 'Logs')
      return { valid: existsSync(logsDir) }
    }
  )

  // Open the Screen Recording section of macOS System Settings. No-op on Windows.
  ipcMain.handle('system:openSystemPreferences', (): void => {
    if (process.platform !== 'win32') {
      void shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
      )
    }
  })

  // Show a native folder picker dialog and return the selected path.
  ipcMain.handle('system:pickFolder', async (): Promise<{ path: string | null }> => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    return { path: canceled || filePaths.length === 0 ? null : (filePaths[0] ?? null) }
  })

  // Show a native file picker for WoW combat log (.txt) files.
  ipcMain.handle('system:pickLogFile', async (): Promise<{ path: string | null }> => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Combat Log', extensions: ['txt'] }]
    })
    return { path: canceled || filePaths.length === 0 ? null : (filePaths[0] ?? null) }
  })

  // List video capture devices for the current platform.
  // macOS: parses AVFoundation device list from FFmpeg.
  // Windows: gdigrab always captures the full desktop — returns a single synthetic entry.
  ipcMain.handle('system:listCaptureDevices', async (): Promise<CaptureDevice[]> => {
    if (process.platform === 'win32') {
      const primary = electronScreen.getPrimaryDisplay()
      const { width, height } = primary.size
      return [{ index: 0, name: 'Desktop', isScreen: true, isPrimary: true, resolution: `${width}×${height}` }]
    }

    return new Promise((resolve) => {
      let ffmpegPath: string
      try {
        ffmpegPath = ScreenRecorder.resolveFfmpegPath()
      } catch {
        resolve([])
        return
      }

      execFile(ffmpegPath, ['-f', 'avfoundation', '-list_devices', 'true', '-i', ''], (_, __, stderr) => {
        const devices: CaptureDevice[] = []
        let inVideoSection = false
        const lineRe = /\[(\d+)\]\s+(.+)/

        for (const line of (stderr ?? '').split('\n')) {
          if (line.includes('AVFoundation video devices')) { inVideoSection = true; continue }
          if (line.includes('AVFoundation audio devices')) { inVideoSection = false; continue }
          if (!inVideoSection) continue
          const m = lineRe.exec(line)
          if (m) {
            const index = parseInt(m[1]!, 10)
            const name = m[2]!.trim()
            const isScreen = /screen|display|capture/i.test(name)
            devices.push({ index, name, isScreen })
          }
        }

        // Enrich screen devices with resolution + primary flag from Electron's display list.
        // AVFoundation screen indices (1, 2, …) map to Electron displays in the same order.
        const displays = electronScreen.getAllDisplays()
        const primaryId = electronScreen.getPrimaryDisplay().id
        let screenSlot = 0
        for (const dev of devices) {
          if (!dev.isScreen) continue
          const display = displays[screenSlot]
          if (display !== undefined) {
            const { width, height } = display.size
            dev.resolution = `${width}×${height}`
            dev.isPrimary = display.id === primaryId
          }
          screenSlot++
        }

        resolve(devices)
      })
    })
  })

  // Copy the bundled ArenaRecorderCompanion addon to the WoW AddOns directory.
  ipcMain.handle(
    'system:installAddon',
    async (_event, { wowPath }: { wowPath: string }): Promise<{ success: boolean; error?: string }> => {
      try {
        const src = join(process.resourcesPath, 'addon', 'ArenaRecorderCompanion')
        const dest = join(wowPath, '_retail_', 'Interface', 'AddOns', 'ArenaRecorderCompanion')
        await mkdir(dirname(dest), { recursive: true })
        await cp(src, dest, { recursive: true })
        return { success: true }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  // List audio capture devices. Windows: audio capture via DirectShow not yet supported.
  ipcMain.handle('system:listAudioDevices', async (): Promise<AudioDevice[]> => {
    if (process.platform === 'win32') return []

    return new Promise((resolve) => {
      let ffmpegPath: string
      try {
        ffmpegPath = ScreenRecorder.resolveFfmpegPath()
      } catch {
        resolve([])
        return
      }

      execFile(ffmpegPath, ['-f', 'avfoundation', '-list_devices', 'true', '-i', ''], (_, __, stderr) => {
        const devices: AudioDevice[] = []
        let inAudioSection = false
        const lineRe = /\[(\d+)\]\s+(.+)/

        for (const line of (stderr ?? '').split('\n')) {
          if (line.includes('AVFoundation audio devices')) { inAudioSection = true; continue }
          if (!inAudioSection) continue
          const m = lineRe.exec(line)
          if (m) {
            devices.push({ index: parseInt(m[1]!, 10), name: m[2]!.trim() })
          }
        }

        resolve(devices)
      })
    })
  })

  // Return addon connection status by reading the SavedVariables file.
  ipcMain.handle('system:getAddonStatus', () => {
    const wowPath = configStore.get('wowPath')
    const info = readAddonCharacterInfo(wowPath)
    if (info === null) return { connected: false }
    return { connected: true, name: info.name, spec: info.spec, className: info.class }
  })

  // Open a URL in the user's default browser.
  ipcMain.handle('system:openUrl', (_event, { url }: { url: string }): void => {
    void shell.openExternal(url)
  })

  // Relaunch the app — used after path settings changes that require a restart.
  ipcMain.handle('system:relaunch', (): void => {
    app.relaunch()
    app.exit(0)
  })
}

// Re-export for convenience so index.ts can import from one place.
export { COMBAT_LOG_RELATIVE_PATH }

// ---------------------------------------------------------------------------
// Addon SavedVars file watcher — pushes addon:statusChanged to the window
// whenever WoW flushes SavedVariables to disk (on character switch/reload/exit).
// ---------------------------------------------------------------------------

let addonWatcher: FSWatcher | null = null

export function wireAddonWindow(configStore: Store<AppConfig>, win: BrowserWindow): void {
  addonWatcher?.close().catch(() => {})

  const wowPath = configStore.get('wowPath')
  const pattern = join(
    wowPath,
    '_retail_',
    'WTF',
    'Account',
    '*',
    'SavedVariables',
    'ArenaRecorderCompanion.lua'
  ).replace(/\\/g, '/')

  function push(): void {
    if (win.isDestroyed()) return
    const info = readAddonCharacterInfo(wowPath)
    const payload = info === null
      ? { connected: false }
      : { connected: true, name: info.name, spec: info.spec, className: info.class }
    win.webContents.send('addon:statusChanged', payload)
  }

  addonWatcher = chokidar.watch(pattern, {
    persistent: false,
    usePolling: false,
    ignoreInitial: true,
  })
  addonWatcher.on('change', push)
  addonWatcher.on('add', push)
}
