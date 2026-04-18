// Onboarding wizard logic.
// Encapsulates all step state and IPC calls so OnboardingView stays thin.
//
// Steps (0-indexed):
//   0 — WoW folder detection and validation
//   1 — macOS Screen Recording permission
//   2 — SimpleCombatLogger addon
//   3 — Homebrew + FFmpeg
//   4 — Ready (summary + finish)

import { ref, computed } from 'vue'

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

  // Step 0 — WoW folder
  const wowPath = ref('')
  const wowPathState = ref<CheckState>('idle')

  // Step 1 — Screen Recording
  const permissionStatus = ref<PermissionStatus>('not-determined')
  const permissionChecking = ref(false)

  // Step 2 — Addon
  const addonState = ref<CheckState>('idle')

  // Step 3 — Brew + FFmpeg
  const brewState = ref<CheckState>('idle')
  const ffmpegState = ref<CheckState>('idle')
  const ffmpegPath = ref<string | null>(null)

  // Step 3 sub-steps: only show ffmpeg section after brew is confirmed
  const showFfmpegSection = computed(() => brewState.value === 'ok')

  // Whether the current step allows advancing
  const canAdvance = computed(() => {
    switch (step.value) {
      case 0:
        return wowPathState.value === 'ok'
      case 1:
        return permissionStatus.value === 'granted'
      case 2:
        // Addon is recommended but not required — allow advancing regardless
        return true
      case 3:
        return ffmpegState.value === 'ok'
      case 4:
        return true
      default:
        return false
    }
  })

  // -------------------------------------------------------------------------
  // Step 0 — WoW folder
  // -------------------------------------------------------------------------

  async function detectWowPath(): Promise<void> {
    const DEFAULT_PATH = '/Applications/World of Warcraft'
    wowPathState.value = 'checking'
    const result = await window.electron.invoke('system:checkWowPath', {
      path: DEFAULT_PATH
    })
    if (result.valid) {
      wowPath.value = DEFAULT_PATH
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
        // Request permission first — this triggers the macOS prompt and registers
        // the app in System Settings → Screen Recording (if not-determined).
        // Then fall through to a plain status check on subsequent visits.
        permissionChecking.value = true
        try {
          const result = await window.electron.invoke('system:requestScreenPermission')
          permissionStatus.value = result.status
        } finally {
          permissionChecking.value = false
        }
        break
      case 2:
        if (addonState.value === 'idle') await checkAddon()
        break
      case 3:
        await checkBrew()
        if (brewState.value === 'ok') await checkFfmpeg()
        break
      default:
        break
    }
  }

  // -------------------------------------------------------------------------
  // Completion
  // -------------------------------------------------------------------------

  async function complete(): Promise<void> {
    await window.electron.invoke('config:set', { key: 'wowPath', value: wowPath.value })
    await window.electron.invoke('config:set', { key: 'onboardingComplete', value: true })
  }

  return {
    // State
    step,
    wowPath,
    wowPathState,
    permissionStatus,
    permissionChecking,
    addonState,
    brewState,
    ffmpegState,
    ffmpegPath,
    showFfmpegSection,
    canAdvance,
    // Actions
    detectWowPath,
    pickWowFolder,
    checkScreenPermission,
    openSystemPreferences,
    checkAddon,
    checkBrew,
    checkFfmpeg,
    next,
    back,
    complete
  }
}
