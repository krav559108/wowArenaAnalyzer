<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useLogAnalysisStore } from '@/stores/logAnalysisStore'
import LogMatchDetail from '@/components/LogMatchDetail.vue'

const store = useLogAnalysisStore()
const { matches, selectedMatch, isLoading, error, filePath } = storeToRefs(store)

async function pickAndParse(): Promise<void> {
  const { path } = await window.electron.invoke('system:pickLogFile')
  if (path === null) return

  store.isLoading = true
  store.error = null
  try {
    const results = await window.electron.invoke('logAnalysis:parseFile', { filePath: path })
    store.setMatches(path, results)
  } catch (e) {
    store.setError(e instanceof Error ? e.message : String(e))
  } finally {
    store.isLoading = false
  }
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

const bracketLabel: Record<string, string> = {
  '2v2': '2v2',
  '3v3': '3v3',
  'solo-shuffle': 'SS'
}
</script>

<template>
  <div class="flex flex-1 min-h-0">
    <!-- Sidebar: match list -->
    <aside class="flex-shrink-0 w-72 border-r border-zinc-800/60 flex flex-col overflow-hidden">
      <!-- Import area -->
      <div class="flex-shrink-0 px-3 py-3 border-b border-zinc-800/60 space-y-2">
        <h2 class="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
          Log Analysis
        </h2>
        <button
          class="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-colors"
          :disabled="isLoading"
          @click="pickAndParse"
        >
          <svg
            class="w-3.5 h-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
            />
          </svg>
          {{ isLoading ? 'Parsing…' : 'Import Combat Log' }}
        </button>
        <p
          v-if="filePath !== null"
          class="text-xs text-zinc-600 truncate"
          :title="filePath"
        >
          {{ filePath.split('/').pop() }}
        </p>
      </div>

      <!-- Error state -->
      <div
        v-if="error !== null"
        class="px-3 py-3 text-xs text-red-400"
      >
        {{ error }}
      </div>

      <!-- Empty state -->
      <div
        v-else-if="matches.length === 0 && !isLoading"
        class="flex-1 flex flex-col items-center justify-center px-4 text-center"
      >
        <p class="text-xs text-zinc-600">
          Import a WoWCombatLog.txt to see your arena matches.
        </p>
      </div>

      <!-- Match list -->
      <div
        v-else
        class="flex-1 min-h-0 overflow-y-auto"
      >
        <button
          v-for="match in matches"
          :key="match.id"
          class="w-full text-left px-3 py-2.5 border-b border-zinc-800/40 transition-colors hover:bg-zinc-800/60"
          :class="selectedMatch?.id === match.id ? 'bg-zinc-800' : ''"
          @click="store.selectMatch(match)"
        >
          <div class="flex items-center gap-2">
            <span class="text-xs font-semibold bg-zinc-700 text-zinc-300 px-1.5 py-0.5 rounded flex-shrink-0">
              {{ bracketLabel[match.bracket] ?? match.bracket }}
            </span>
            <span
              :class="[
                'text-xs font-bold flex-shrink-0',
                match.result === 'WIN' ? 'text-green-400' : 'text-red-400'
              ]"
            >
              {{ match.result }}
            </span>
            <span class="text-xs text-zinc-400 truncate flex-1">{{ match.zone }}</span>
            <span class="text-xs text-zinc-600 flex-shrink-0">{{ formatDuration(match.duration) }}</span>
          </div>
          <div
            v-if="match.round !== undefined"
            class="text-xs text-zinc-600 mt-0.5 pl-0.5"
          >
            Round {{ match.round }}
          </div>
        </button>
      </div>
    </aside>

    <!-- Main panel: match detail -->
    <main class="flex-1 min-w-0 overflow-hidden">
      <LogMatchDetail
        v-if="selectedMatch !== null"
        :match="selectedMatch"
        class="h-full"
      />
      <div
        v-else
        class="h-full flex flex-col items-center justify-center text-center px-8"
      >
        <div class="w-16 h-16 rounded-full bg-zinc-800/60 flex items-center justify-center mb-4">
          <svg
            class="w-7 h-7 text-zinc-600"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
            />
          </svg>
        </div>
        <p class="text-zinc-300 text-sm font-medium">
          Import a combat log
        </p>
        <p class="text-zinc-600 text-xs mt-1 max-w-[260px]">
          Click "Import Combat Log" and select your WoWCombatLog.txt to analyse your arena matches.
        </p>
      </div>
    </main>
  </div>
</template>
