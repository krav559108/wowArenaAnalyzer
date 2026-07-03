import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { RecorderStatus } from '@shared/ipc.types'

export const useAppStore = defineStore('app', () => {
  const status = ref<RecorderStatus>('idle')
  const currentZone = ref<string | null>(null)
  const lastError = ref<string | null>(null)
  // Wall-clock time (ms) the status last transitioned to 'recording' — drives the
  // live elapsed-time indicator in the header. null when not recording.
  const recordingStartedAt = ref<number | null>(null)

  function setStatus(newStatus: RecorderStatus, zone?: string): void {
    const wasRecording = status.value === 'recording'
    status.value = newStatus
    if (zone !== undefined) {
      currentZone.value = zone
    }
    if (newStatus !== 'error') {
      lastError.value = null
    }
    if (newStatus === 'recording' && !wasRecording) {
      recordingStartedAt.value = Date.now()
    } else if (newStatus !== 'recording') {
      recordingStartedAt.value = null
    }
  }

  function setError(message: string): void {
    status.value = 'error'
    lastError.value = message
  }

  // Dismisses the current error banner without changing recorder status — the next
  // real status transition (or error) will set lastError again as usual.
  function clearError(): void {
    lastError.value = null
  }

  return { status, currentZone, lastError, recordingStartedAt, setStatus, setError, clearError }
})
