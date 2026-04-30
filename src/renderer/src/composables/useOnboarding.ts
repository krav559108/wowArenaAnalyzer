// Onboarding wizard logic.
// Encapsulates all step state and IPC calls so OnboardingView stays thin.
//
// Steps (0-indexed, macOS):
//   0 — WoW folder detection and validation
//   1 — Screen Recording permission
//   2 — Addon
//   3 — Homebrew + FFmpeg
//   4 — Ready (summary + finish)
//
// Steps (Windows): same as above but step 4 = monitor selection, step 5 = Ready

import { ref, computed } from 'vue'
import type { CaptureDevice } from '@shared/ipc.types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PermissionStatus = 'granted' | 'denied' | 'not-determined'
export type CheckState = 'idle' | 'checking' | 'ok' | 'fail'

// ---------------------------------------------------------------------------
// useOnboarding
// ---------------------------------------------------------------------------

export function useOnboarding() {
  // Current wizard step
  const step = ref(0)

  // Platform — loaded once via IPC; defaults to 'darwin' until resolved
  const platform = ref('darwin')

  // Step 0 — WoW folder
  const wowPath = ref('')
  const wowPathState = ref<CheckState>('idle')

  // Step 1 — Screen Recording
  const permissionStatus = ref<PermissionStatus>('not-determined')
  const permissionChecking = ref(false)

  // Step 2 — Addon
  const addonState = ref<CheckState>('idle')
  const addonInstalling = ref(false)
  const addonInstallError = ref<string | null>(null)

  // Step 3 — Brew + FFmpeg
  const brewState = ref<CheckState>('idle')
  const ffmpegState = ref<CheckState>('idle')
  const ffmpegPath = ref<string | null>(null)

  // Step 3 sub-steps: on Windows skip brew (not applicable), show FFmpeg section immediately
  const showFfmpegSection = computed(() => platform.value === 'win32' || brewState.value === 'ok')

  // Step 4 (Windows only) — monitor selection
  const captureDevices = ref<CaptureDevice[]>([])
  const selectedCaptureDevice = ref<CaptureDevice | null>(null)

  const totalSteps = 7
  const readyStep = 6

  // Whether the current step allows advancing
  const canAdvance = computed(() => {
    switch (step.value) {
      case 0:
        return wowPathState.value === 'ok'
      case 1:
        // ACL step — informational only, always advanceable
        return true
      case 2:
        return permissionStatus.value === 'granted'
      case 3:
        // Addon is recommended but not required
        return true
      case 4:
        return ffmpegState.value === 'ok'
      case 5:
        return selectedCaptureDevice.value !== null
      case 6:
        return true
      default:
        return false
    }
  })

  // -------------------------------------------------------------------------
  // Step 0 — WoW folder
  // -------------------------------------------------------------------------

  async function detectWowPath(): Promise<void> {
    const defaultPath = platform.value === 'win32'
      ? 'C:\\Program Files (x86)\\World of Warcraft'
      : '/Applications/World of Warcraft'
    wowPathState.value = 'checking'
    const result = await window.electron.invoke('system:checkWowPath', { path: defaultPath })
    if (result.valid) {
      wowPath.value = defaultPath
      wowPathState.value = 'ok'
    } else {
      wowPath.value = ''
      wowPathState.value = 'idle'
    }
  }

  async function pickWowFolder(): Promise<void> {
    const result = await window.electron.invoke('system:pickFolder')
    if (result.path === null) return

    wowPathState.value = 'checking'
    const check = await window.electron.invoke('system:checkWowPath', {
      path: result.path
    })
    if (check.valid) {
      wowPath.value = result.path
      wowPathState.value = 'ok'
    } else {
      wowPath.value = result.path
      wowPathState.value = 'fail'
    }
  }

  // -------------------------------------------------------------------------
  // Step 1 — Screen Recording
  // -------------------------------------------------------------------------

  async function checkScreenPermission(): Promise<void> {
    permissionChecking.value = true
    try {
      const result = await window.electron.invoke('system:checkScreenPermission')
      permissionStatus.value = result.status
    } finally {
      permissionChecking.value = false
    }
  }

  async function openSystemPreferences(): Promise<void> {
    await window.electron.invoke('system:openSystemPreferences')
  }

  // -------------------------------------------------------------------------
  // Step 2 — Addon
  // -------------------------------------------------------------------------

  async function checkAddon(): Promise<void> {
    addonState.value = 'checking'
    const result = await window.electron.invoke('system:checkAddon', {
      wowPath: wowPath.value
    })
    addonState.value = result.found ? 'ok' : 'fail'
  }

  async function installAddon(): Promise<void> {
    addonInstalling.value = true
    addonInstallError.value = null
    try {
      const result = await window.electron.invoke('system:installAddon', {
        wowPath: wowPath.value
      })
      if (result.success) {
        await checkAddon()
      } else {
        addonInstallError.value = result.error ?? 'Unknown error'
      }
    } finally {
      addonInstalling.value = false
    }
  }

  // -------------------------------------------------------------------------
  // Step 3 — Homebrew + FFmpeg
  // -------------------------------------------------------------------------

  async function checkBrew(): Promise<void> {
    brewState.value = 'checking'
    const result = await window.electron.invoke('system:checkBrew')
    brewState.value = result.found ? 'ok' : 'fail'
  }

  async function checkFfmpeg(): Promise<void> {
    ffmpegState.value = 'checking'
    const result = await window.electron.invoke('system:checkFfmpeg')
    if (result.found) {
      ffmpegState.value = 'ok'
      ffmpegPath.value = result.path
    } else {
      ffmpegState.value = 'fail'
      ffmpegPath.value = null
    }
  }

  // -------------------------------------------------------------------------
  // Navigation
  // -------------------------------------------------------------------------

  async function next(): Promise<void> {
    if (!canAdvance.value) return
    step.value++
    await runStepChecks()
  }

  function back(): void {
    if (step.value > 0) step.value--
  }

  // Run automatic checks when entering a step
  async function runStepChecks(): Promise<void> {
    switch (step.value) {
      case 1:
        // ACL step — informational only, nothing to check automatically.
        break
      case 2:
        if (platform.value === 'win32') {
          // No screen recording permission model on Windows — auto-pass this step.
          permissionStatus.value = 'granted'
          break
        }
        // macOS: trigger the permission prompt (registers the app in System Settings).
        permissionChecking.value = true
        try {
          const result = await window.electron.invoke('system:requestScreenPermission')
          permissionStatus.value = result.status
        } finally {
          permissionChecking.value = false
        }
        break
      case 3:
        if (addonState.value === 'idle') await checkAddon()
        break
      case 4:
        if (platform.value === 'win32') {
          brewState.value = 'ok'
          await checkFfmpeg()
        } else {
          await checkBrew()
          if (brewState.value === 'ok') await checkFfmpeg()
        }
        break
      case 5: {
        // Load monitors and pre-select the primary display.
        const devices = await window.electron.invoke('system:listCaptureDevices')
        captureDevices.value = devices
        selectedCaptureDevice.value = devices.find((d) => d.isPrimary) ?? devices[0] ?? null
        break
      }
      default:
        break
    }
  }

  // -------------------------------------------------------------------------
  // Init — must be called once on mount to resolve platform before any checks
  // -------------------------------------------------------------------------

  async function init(): Promise<void> {
    const result = await window.electron.invoke('system:getPlatform')
    platform.value = result.platform
  }

  // -------------------------------------------------------------------------
  // Completion
  // -------------------------------------------------------------------------

  async function complete(): Promise<void> {
    await window.electron.invoke('config:set', { key: 'wowPath', value: wowPath.value })
    if (selectedCaptureDevice.value !== null) {
      const d = selectedCaptureDevice.value
      // Windows: encode bounds for per-monitor gdigrab capture.
      // macOS: store the AVFoundation device index string.
      const deviceStr = platform.value === 'win32' && d.bounds
        ? `${d.bounds.width}x${d.bounds.height}@${d.bounds.x},${d.bounds.y}`
        : String(d.index)
      await window.electron.invoke('config:set', { key: 'captureDevice', value: deviceStr })
    }
    await window.electron.invoke('config:set', { key: 'onboardingComplete', value: true })
  }

  return {
    // State
    step,
    platform,
    totalSteps,
    readyStep,
    wowPath,
    wowPathState,
    permissionStatus,
    permissionChecking,
    addonState,
    addonInstalling,
    addonInstallError,
    brewState,
    ffmpegState,
    ffmpegPath,
    showFfmpegSection,
    captureDevices,
    selectedCaptureDevice,
    canAdvance,
    // Actions
    init,
    detectWowPath,
    pickWowFolder,
    checkScreenPermission,
    openSystemPreferences,
    checkAddon,
    installAddon,
    checkBrew,
    checkFfmpeg,
    next,
    back,
    complete
  }
}
