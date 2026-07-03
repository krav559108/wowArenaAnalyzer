<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import type { Recording } from '@shared/ipc.types'
import { CLASS_COLORS } from '@shared/constants'
import { computePvpStats, type MatchupRow, type ClassSpecRow } from '@/composables/usePvpStats'
import { useStatsLinkStore } from '@/stores/statsLinkStore'
import { buildCharacterStatsUrl, STATS_SITE_LABELS } from '@/utils/characterLinks'

const props = defineProps<{ recordings: Recording[] }>()

const stats = computed(() => computePvpStats(props.recordings))

const statsLinkStore = useStatsLinkStore()
const { statsSite, wowRegion } = storeToRefs(statsLinkStore)

function openCharacter(name: string): void {
  const url = buildCharacterStatsUrl(statsSite.value, name, wowRegion.value)
  void window.electron.invoke('system:openUrl', { url })
}

function classColor(className: string): string {
  return CLASS_COLORS[className] ?? '#d4d4d8'
}

function winRateClass(pct: number): string {
  if (pct >= 55) return 'text-green-400'
  if (pct < 45) return 'text-red-400'
  return 'text-zinc-300'
}

function fmtPct(pct: number): string {
  return `${pct.toFixed(0)}%`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function sortedBySpec(rows: ClassSpecRow[]): ClassSpecRow[] {
  return [...rows].sort((a, b) => b.games - a.games)
}

// -------------------------------------------------------------------------
// Rating trend chart (simple SVG polyline, normalized to the min/max seen)
// -------------------------------------------------------------------------

const CHART_W = 640
const CHART_H = 120

const ratingChart = computed(() => {
  const points = stats.value.ratingTrend
  if (points.length < 2) return { path: '', min: 0, max: 0 }
  const values = points.map((p) => p.rating)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const path = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * CHART_W
      const y = CHART_H - ((p.rating - min) / range) * CHART_H
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return { path, min, max }
})

function matchupBarPct(row: MatchupRow): number {
  return Math.max(2, row.winRatePct)
}
</script>

<template>
  <div class="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-6">
    <div
      v-if="stats.totalGames === 0"
      class="flex flex-col items-center justify-center text-center py-24"
    >
      <p class="text-zinc-300 text-sm font-medium">
        No recordings yet
      </p>
      <p class="text-zinc-600 text-xs mt-1 max-w-[280px]">
        Stats will build up here automatically as you record more arena matches.
      </p>
    </div>

    <template v-else>
      <!-- Overview -->
      <div class="grid grid-cols-3 gap-3">
        <div class="bg-zinc-900 rounded-lg p-4">
          <p class="text-[11px] text-zinc-500 uppercase tracking-wider mb-1">
            Total Games
          </p>
          <p class="text-2xl font-semibold text-zinc-100">
            {{ stats.totalGames }}
          </p>
        </div>
        <div class="bg-zinc-900 rounded-lg p-4">
          <p class="text-[11px] text-zinc-500 uppercase tracking-wider mb-1">
            Overall Win Rate
          </p>
          <p
            class="text-2xl font-semibold"
            :class="winRateClass(stats.overall.winRatePct)"
          >
            {{ fmtPct(stats.overall.winRatePct) }}
          </p>
          <p class="text-[11px] text-zinc-600 mt-0.5">
            {{ stats.overall.wins }}W – {{ stats.overall.games - stats.overall.wins }}L
          </p>
        </div>
        <div class="bg-zinc-900 rounded-lg p-4">
          <p class="text-[11px] text-zinc-500 uppercase tracking-wider mb-1">
            Current Rating
          </p>
          <p class="text-2xl font-semibold text-zinc-100">
            {{ stats.ratingTrend.length > 0 ? stats.ratingTrend[stats.ratingTrend.length - 1]!.rating : '—' }}
          </p>
        </div>
      </div>

      <!-- Your characters -->
      <div v-if="stats.characters.length > 0">
        <p class="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
          Your Characters
        </p>
        <div class="bg-zinc-900 rounded-lg p-2 space-y-1">
          <div
            v-for="char in stats.characters"
            :key="char.name"
            class="flex items-center gap-2 px-2 py-1.5 text-xs"
          >
            <span
              class="w-2 h-2 rounded-full flex-shrink-0"
              :style="{ backgroundColor: classColor(char.className) }"
            />
            <span
              class="flex-1 min-w-0 truncate font-medium"
              :style="{ color: classColor(char.className) }"
            >{{ char.name }}</span>
            <span
              v-if="char.specName"
              class="text-zinc-500 flex-shrink-0"
            >{{ char.specName }} {{ char.className }}</span>
            <span class="text-zinc-500 flex-shrink-0">{{ char.games }} games</span>
            <button
              class="flex-shrink-0 text-[10px] px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
              :title="`Open on ${STATS_SITE_LABELS[statsSite]}`"
              @click="openCharacter(char.name)"
            >
              {{ STATS_SITE_LABELS[statsSite] }}
            </button>
          </div>
        </div>
      </div>

      <!-- Win rate by bracket -->
      <div>
        <p class="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
          By Bracket
        </p>
        <div class="grid grid-cols-4 gap-2">
          <div
            v-for="row in stats.byBracket"
            :key="row.bracket"
            class="bg-zinc-900 rounded-lg p-3"
          >
            <p class="text-[11px] text-zinc-500 mb-1">
              {{ row.bracket }}
            </p>
            <p
              class="text-sm font-medium"
              :class="winRateClass(row.winRatePct)"
            >
              {{ fmtPct(row.winRatePct) }}
            </p>
            <p class="text-[10px] text-zinc-600">
              {{ row.games }} games
            </p>
          </div>
        </div>
      </div>

      <!-- Solo Shuffle sessions -->
      <div v-if="stats.shuffleSessions.totalSessions > 0">
        <p class="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
          Shuffle Sessions
        </p>
        <div class="grid grid-cols-3 gap-2 mb-2">
          <div class="bg-zinc-900 rounded-lg p-3">
            <p class="text-[11px] text-zinc-500 mb-1">
              Sessions
            </p>
            <p class="text-sm font-medium text-zinc-100">
              {{ stats.shuffleSessions.totalSessions }}
            </p>
          </div>
          <div class="bg-zinc-900 rounded-lg p-3">
            <p class="text-[11px] text-zinc-500 mb-1">
              Positive Sessions
            </p>
            <p
              class="text-sm font-medium"
              :class="winRateClass(stats.shuffleSessions.positiveRatePct)"
            >
              {{ fmtPct(stats.shuffleSessions.positiveRatePct) }}
              <span class="text-zinc-600 font-normal">({{ stats.shuffleSessions.positiveSessions }}/{{ stats.shuffleSessions.totalSessions }})</span>
            </p>
          </div>
          <div class="bg-zinc-900 rounded-lg p-3">
            <p class="text-[11px] text-zinc-500 mb-1">
              Avg. Rounds Won
            </p>
            <p class="text-sm font-medium text-zinc-100">
              {{ stats.shuffleSessions.avgRoundsWon.toFixed(1) }} / {{ stats.shuffleSessions.sessions[0]?.rounds ?? 6 }}
            </p>
          </div>
        </div>
        <div class="bg-zinc-900 rounded-lg p-2 space-y-1 max-h-56 overflow-y-auto">
          <div
            v-for="session in stats.shuffleSessions.sessions"
            :key="session.sessionId"
            class="flex items-center gap-2 px-2 py-1.5 text-xs"
          >
            <span
              class="text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none border flex-shrink-0"
              :class="session.isPositive
                ? 'border-green-700 bg-green-950/40 text-green-400'
                : 'border-red-700 bg-red-950/40 text-red-400'"
            >{{ session.isPositive ? 'POS' : 'NEG' }}</span>
            <span class="text-zinc-300 flex-shrink-0">{{ session.wins }}W – {{ session.losses }}L</span>
            <span class="text-zinc-600 flex-1 text-right">{{ formatDate(session.date) }}</span>
          </div>
        </div>
      </div>

      <!-- Rating trend -->
      <div v-if="stats.ratingTrend.length >= 2">
        <p class="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
          Rating Trend
        </p>
        <div class="bg-zinc-900 rounded-lg p-3">
          <svg
            :viewBox="`0 0 ${CHART_W} ${CHART_H}`"
            class="w-full h-28"
            preserveAspectRatio="none"
          >
            <path
              :d="ratingChart.path"
              fill="none"
              stroke="#60a5fa"
              stroke-width="2"
              vector-effect="non-scaling-stroke"
            />
          </svg>
          <div class="flex justify-between text-[10px] text-zinc-600 mt-1">
            <span>{{ ratingChart.min }}</span>
            <span>{{ ratingChart.max }}</span>
          </div>
        </div>
      </div>

      <!-- Games by class/spec -->
      <div>
        <p class="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
          Games By Class / Spec
        </p>
        <div class="bg-zinc-900 rounded-lg p-2 space-y-1">
          <div
            v-for="row in sortedBySpec(stats.byClassSpec)"
            :key="`${row.className}-${row.specName}`"
            class="flex items-center gap-2 px-2 py-1.5 text-xs"
          >
            <span
              class="w-2 h-2 rounded-full flex-shrink-0"
              :style="{ backgroundColor: classColor(row.className) }"
            />
            <span
              class="flex-1 min-w-0 truncate"
              :style="{ color: classColor(row.className) }"
            >{{ row.specName ? `${row.specName} ${row.className}` : row.className }}</span>
            <span class="text-zinc-500 flex-shrink-0">{{ row.games }} games</span>
            <span
              class="w-12 text-right flex-shrink-0 font-medium"
              :class="winRateClass(row.winRatePct)"
            >
              {{ fmtPct(row.winRatePct) }}
            </span>
          </div>
        </div>
      </div>

      <!-- Best / worst matchups -->
      <div class="grid grid-cols-2 gap-4">
        <div>
          <p class="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
            Best Matchups
          </p>
          <div
            v-if="stats.bestMatchups.length === 0"
            class="text-xs text-zinc-600 bg-zinc-900 rounded-lg p-3"
          >
            Not enough games yet (need 3+ vs. the same spec).
          </div>
          <div
            v-else
            class="bg-zinc-900 rounded-lg p-2 space-y-1.5"
          >
            <div
              v-for="row in stats.bestMatchups"
              :key="row.enemySpec"
              class="relative rounded overflow-hidden"
            >
              <div
                class="absolute inset-y-0 left-0 bg-green-500/20"
                :style="{ width: `${matchupBarPct(row)}%` }"
              />
              <div class="relative flex items-center justify-between px-2 py-1 text-xs">
                <span class="text-zinc-200">{{ row.enemySpec }}</span>
                <span class="text-zinc-500">{{ row.games }} games · <span class="text-green-400 font-medium">{{ fmtPct(row.winRatePct) }}</span></span>
              </div>
            </div>
          </div>
        </div>
        <div>
          <p class="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
            Worst Matchups
          </p>
          <div
            v-if="stats.worstMatchups.length === 0"
            class="text-xs text-zinc-600 bg-zinc-900 rounded-lg p-3"
          >
            Not enough games yet (need 3+ vs. the same spec).
          </div>
          <div
            v-else
            class="bg-zinc-900 rounded-lg p-2 space-y-1.5"
          >
            <div
              v-for="row in stats.worstMatchups"
              :key="row.enemySpec"
              class="relative rounded overflow-hidden"
            >
              <div
                class="absolute inset-y-0 left-0 bg-red-500/20"
                :style="{ width: `${matchupBarPct(row)}%` }"
              />
              <div class="relative flex items-center justify-between px-2 py-1 text-xs">
                <span class="text-zinc-200">{{ row.enemySpec }}</span>
                <span class="text-zinc-500">{{ row.games }} games · <span class="text-red-400 font-medium">{{ fmtPct(row.winRatePct) }}</span></span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
