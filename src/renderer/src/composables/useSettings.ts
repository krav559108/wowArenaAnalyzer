// Settings composable.
// Loads the full AppConfig on mount and provides typed setters that persist each
// change immediately via config:set. Path changes (wowPath, storagePath) require
// an app restart to take effect in the recording pipeline.

import { ref, computed, onMounted } from 'vue'
import type { AppConfig, CaptureDevice } from '@shared/ipc.types'

export type BitratePreset = 'low' | 'medium' | 'high' | 'custom'

const BITRATE_PRESETS: Record<Exclude<BitratePreset, 'custom'>, number> = {
  low: 4000,
  medium: 8000,
  high: 16000
}

function detectPreset(bitrate: number): BitratePreset {
  for (const [key, value] of Object.entries(BITRATE_PRESETS)) {
    if (value === bitrate) return key as BitratePreset
  }
  return 'custom'
}

export function useSettings() {
  const config = ref<AppConfig | null>(null)
  const loading = ref(true)
  // True when a path that requires restart has been changed since last load/restart
  const restartRequired = ref(false)

  async function load(): Promise<void> {
    config.value = await window.electron.invoke('config:getAll')
    loading.value = false
  }

  async function set<K extends keyof AppConfig>(key: K, value: AppConfig[K]): Promise<void> {
    if (config.value === null) return
    config.value[key] = value
    await window.electron.invoke('config:set', { key, value })
  }

  // -------------------------------------------------------------------------
  // WoW path
  // -------------------------------------------------------------------------

  async function pickWowPath(): Promise<void> {
    const { path } = await window.electron.invoke('system:pickFolder')
    if (path === null) return
    const { valid } = await window.electron.invoke('system:checkWowPath', { path })
    if (!valid) return
    await set('wowPath', path)
    restartRequired.value = true
  }

  // -------------------------------------------------------------------------
  // Storage path
  // -------------------------------------------------------------------------

  async function pickStoragePath(): Promise<void> {
    const { path } = await window.electron.invoke('system:pickFolder')
    if (path === null) return
    await set('storagePath', path)
    restartRequired.value = true
  }

  // -------------------------------------------------------------------------
  // Video quality
  // -------------------------------------------------------------------------

  const bitratePreset = computed<BitratePreset>({
    get: () => (config.value !== null ? detectPreset(config.value.videoBitrate) : 'medium'),
    set: (preset) => {
      if (preset === 'custom' || config.value === null) return
      void set('videoBitrate', BITRATE_PRESETS[preset])
    }
  })

  const customBitrate = computed<number>({
    get: () => config.value?.videoBitrate ?? 8000,
    set: (kbps) => {
      if (config.value === null) return
      void set('videoBitrate', kbps)
    }
  })

  async function setFps(fps: 30 | 60): Promise<void> {
    await set('videoFps', fps)
  }

  async function setResolution(res: string): Promise<void> {
    await set('videoResolution', res)
  }

  // -------------------------------------------------------------------------
  // Capture device
  // -------------------------------------------------------------------------

  const captureDevices = ref<CaptureDevice[]>([])
  const devicesLoading = ref(false)

  async function loadCaptureDevices(): Promise<void> {
    devicesLoading.value = true
    try {
      captureDevices.value = await window.electron.invoke('system:listCaptureDevices')
    } finally {
      devicesLoading.value = false
    }
  }

  async function selectCaptureDevice(device: CaptureDevice): Promise<void> {
    await set('captureDevice', String(device.index))
  }

  // -------------------------------------------------------------------------
  // Addon
  // -------------------------------------------------------------------------

  const addonAlreadyInstalled = ref(false)

  async function checkAddonInstalled(): Promise<void> {
    if (config.value === null) return
    const { found } = await window.electron.invoke('system:checkAddon', { wowPath: config.value.wowPath })
    addonAlreadyInstalled.value = found
  }

  async function installAddon(): Promise<{ success: boolean; error?: string }> {
    if (config.value === null) return { success: false, error: 'Config not loaded' }
    const result = await window.electron.invoke('system:installAddon', { wowPath: config.value.wowPath })
    if (result.success) addonAlreadyInstalled.value = true
    return result
  }

  // -------------------------------------------------------------------------
  // Auto-cleanup
  // -------------------------------------------------------------------------

  const cleanupDaysEnabled = computed<boolean>({
    get: () => config.value?.autoCleanupDays !== null && config.value?.autoCleanupDays !== undefined,
    set: (enabled) => {
      if (config.value === null) return
      void set('autoCleanupDays', enabled ? 30 : null)
    },
  })

  const cleanupDays = computed<number>({
    get: () => config.value?.autoCleanupDays ?? 30,
    set: (days) => {
      if (config.value === null || !cleanupDaysEnabled.value) return
      void set('autoCleanupDays', days)
    },
  })

  const cleanupGbEnabled = computed<boolean>({
    get: () =>
      config.value?.autoCleanupMaxGb !== null && config.value?.autoCleanupMaxGb !== undefined,
    set: (enabled) => {
      if (config.value === null) return
      void set('autoCleanupMaxGb', enabled ? 50 : null)
    },
  })

  const cleanupGb = computed<number>({
    get: () => config.value?.autoCleanupMaxGb ?? 50,
    set: (gb) => {
      if (config.value === null || !cleanupGbEnabled.value) return
      void set('autoCleanupMaxGb', gb)
    },
  })

  // -------------------------------------------------------------------------
  // App behaviour
  // -------------------------------------------------------------------------

  const minimizeToTray = computed<boolean>({
    get: () => config.value?.minimizeToTray ?? true,
    set: (enabled) => {
      if (config.value === null) return
      void set('minimizeToTray', enabled)
    },
  })

  // -------------------------------------------------------------------------
  // Relaunch
  // -------------------------------------------------------------------------

  async function relaunch(): Promise<void> {
    await window.electron.invoke('system:relaunch')
  }

  onMounted(async () => {
    await load()
    void loadCaptureDevices()
    void checkAddonInstalled()
  })

  return {
    config,
    loading,
    restartRequired,
    bitratePreset,
    customBitrate,
    captureDevices,
    devicesLoading,
    addonAlreadyInstalled,
    cleanupDaysEnabled,
    cleanupDays,
    cleanupGbEnabled,
    cleanupGb,
    minimizeToTray,
    pickWowPath,
    pickStoragePath,
    setFps,
    setResolution,
    selectCaptureDevice,
    installAddon,
    relaunch,
  }
}
