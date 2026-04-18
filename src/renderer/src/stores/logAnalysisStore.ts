import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { MatchAnalysis } from '@shared/ipc.types'

export const useLogAnalysisStore = defineStore('logAnalysis', () => {
  const matches = ref<MatchAnalysis[]>([])
  const selectedMatch = ref<MatchAnalysis | null>(null)
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const filePath = ref<string | null>(null)

  function setMatches(path: string, results: MatchAnalysis[]): void {
    filePath.value = path
    matches.value = results
    selectedMatch.value = results[0] ?? null
    error.value = null
  }

  function setError(message: string): void {
    error.value = message
    matches.value = []
    selectedMatch.value = null
  }

  function selectMatch(match: MatchAnalysis): void {
    selectedMatch.value = match
  }

  function reset(): void {
    matches.value = []
    selectedMatch.value = null
    error.value = null
    filePath.value = null
  }

  return { matches, selectedMatch, isLoading, error, filePath, setMatches, setError, selectMatch, reset }
})
