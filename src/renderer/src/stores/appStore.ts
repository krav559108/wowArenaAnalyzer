import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { RecorderStatus } from '@shared/ipc.types'

export const useAppStore = defineStore('app', () => {
  const status = ref<RecorderStatus>('idle')
  const currentZone = ref<string | null>(null)
  const lastError = ref<string | null>(null)

  function setStatus(newStatus: RecorderStatus, zone?: string): void {
    status.value = newStatus
    if (zone !== undefined) {
      currentZone.value = zone
    }
    if (newStatus !== 'error') {
      lastError.value = null
    }
  }

  function setError(message: string): void {
    status.value = 'error'
    lastError.value = message
  }

  return { status, currentZone, lastError, setStatus, setError }
})
