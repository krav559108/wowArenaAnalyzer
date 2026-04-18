import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Recording } from '@shared/ipc.types'

export const useRecordingsStore = defineStore('recordings', () => {
  const recordings = ref<Recording[]>([])
  const selectedId = ref<string | null>(null)

  const selected = ref<Recording | null>(null)

  function setRecordings(list: Recording[]): void {
    recordings.value = list
  }

  function select(id: string): void {
    selectedId.value = id
    selected.value = recordings.value.find((r) => r.id === id) ?? null
  }

  function deselect(): void {
    selectedId.value = null
    selected.value = null
  }

  function remove(id: string): void {
    recordings.value = recordings.value.filter((r) => r.id !== id)
    if (selectedId.value === id) {
      deselect()
    }
  }

  return { recordings, selectedId, selected, setRecordings, select, deselect, remove }
})
