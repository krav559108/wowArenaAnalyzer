<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useTimeline } from '@/composables/useTimeline'
import type { MatchAnalysis } from '@shared/ipc.types'
import { TIMELINE_COLORS } from '@shared/constants'

const props = defineProps<{ match: MatchAnalysis }>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const currentTime = ref(0)
const duration = computed(() => props.match.duration)

const { tooltipText, tooltipX, draw, onMouseMove, onMouseLeave } = useTimeline(
  canvasRef,
  computed(() => props.match.events),
  currentTime,
  duration,
  () => {}
)

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  draw()
  if (canvasRef.value !== null) {
    resizeObserver = new ResizeObserver(() => draw())
    resizeObserver.observe(canvasRef.value)
  }
})

onUnmounted(() => {
  resizeObserver?.disconnect()
})

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString()
}

function checkPvpUrl(fullName: string): string {
  const parts = fullName.split('-')
  const regionCodes = new Set(['EU', 'US', 'KR', 'TW', 'CN', 'OCE'])
  const last = parts[parts.length - 1] ?? ''
  if (regionCodes.has(last.toUpperCase()) && parts.length >= 3) {
    const region = last.toLowerCase()
    const realm = parts[parts.length - 2] ?? ''
    const character = parts.slice(0, -2).join('-')
    return `https://check-pvp.fr/${region}/${realm}/${character}`
  }
  const realm = last
  const character = parts.slice(0, -1).join('-')
  return `https://check-pvp.fr/eu/${realm}/${character}`
}

function openPlayerUrl(fullName: string): void {
  void window.electron.invoke('system:openUrl', { url: checkPvpUrl(fullName) })
}

const bracketLabel: Record<string, string> = {
  '2v2': '2v2',
  '3v3': '3v3',
  'solo-shuffle': 'Solo Shuffle',
  'skirmish': 'Skirmish'
}

const CLASS_COLORS: Record<string, string> = {
  'Death Knight': '#C41E3A',
  'Demon Hunter': '#A330C9',
  'Druid': '#FF7C0A',
  'Evoker': '#33937F',
  'Hunter': '#AAD372',
  'Mage': '#3FC7EB',
  'Monk': '#00FF98',
  'Paladin': '#F48CBA',
  'Priest': '#FFFFFF',
  'Rogue': '#FFF468',
  'Shaman': '#0070DD',
  'Warlock': '#8788EE',
  'Warrior': '#C69B3A',
}

const legendItems = [
  { type: 'death-player', label: 'Player death' },
  { type: 'death-enemy', label: 'Enemy death' },
  { type: 'cc', label: 'CC' },
  { type: 'interrupt', label: 'Interrupt' },
  { type: 'defensive', label: 'Defensive' },
  { type: 'offensive', label: 'Offensive' },
  { type: 'cc-break', label: 'CC Break' },
  { type: 'trinket', label: 'Trinket' },
] as const

const visibleEvents = computed(() =>
  props.match.events.filter((e) => e.type !== 'arena-start' && e.type !== 'arena-end')
)

// Map player name → class color, built from both teams
const playerColorMap = computed(() => {
  const map = new Map<string, string>()
  for (const p of [...props.match.playerTeam, ...props.match.enemyTeam]) {
    if (p.className) {
      map.set(p.name, CLASS_COLORS[p.className] ?? '#e4e4e7')
    }
  }
  return map
})
</script>

<template>
  <div class="flex flex-col gap-5 p-5 h-full overflow-y-auto">
    <!-- Header -->
    <div class="flex items-start gap-3">
      <span class="flex-shrink-0 px-2 py-0.5 rounded text-xs font-semibold bg-zinc-800 text-zinc-300">
        {{ bracketLabel[match.bracket] ?? match.bracket }}
      </span>
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium text-zinc-200 truncate">
          {{ match.zone }}
          <span
            v-if="match.round !== undefined"
            class="text-zinc-500 font-normal"
          >
            · Round {{ match.round }}
          </span>
        </p>
        <p class="text-xs text-zinc-500 mt-0.5">
          {{ formatDate(match.date) }} · {{ formatDuration(match.duration) }}
        </p>
      </div>
      <span :class="['flex-shrink-0 text-sm font-bold', match.result === 'WIN' ? 'text-green-400' : 'text-red-400']">
        {{ match.result }}
      </span>
    </div>

    <!-- Teams -->
    <div
      v-if="match.playerTeam.length > 0 || match.enemyTeam.length > 0"
      class="grid grid-cols-2 gap-3"
    >
      <!-- Team Gold (team 0) -->
      <div class="bg-zinc-900 rounded-lg p-3">
        <p class="text-xs font-semibold uppercase tracking-wider mb-2" style="color: #f0b429;">
          Team Gold
        </p>
        <div
          v-for="p in match.playerTeam"
          :key="p.guid"
          class="flex items-center justify-between py-1 gap-2"
        >
          <div class="flex items-center gap-1.5 min-w-0">
            <button
              class="text-xs truncate font-medium hover:underline transition-colors text-left"
              :style="{ color: p.className ? (CLASS_COLORS[p.className] ?? '#e4e4e7') : '#e4e4e7' }"
              :title="'Open ' + p.name + ' on check-pvp.fr'"
              @click="openPlayerUrl(p.name)"
            >
              {{ p.name }}
            </button>
          </div>
          <div class="flex items-center gap-2 flex-shrink-0">
            <span
              v-if="p.className"
              class="text-xs text-zinc-500"
            >
              {{ p.specName ? p.specName + ' ' + p.className : p.className }}
            </span>
            <span class="text-xs text-zinc-500">{{ p.ratingBefore }}</span>
          </div>
        </div>
      </div>

      <!-- Team Purple (team 1) -->
      <div class="bg-zinc-900 rounded-lg p-3">
        <p class="text-xs font-semibold uppercase tracking-wider mb-2" style="color: #a855f7;">
          Team Purple
        </p>
        <div
          v-for="p in match.enemyTeam"
          :key="p.guid"
          class="flex items-center justify-between py-1 gap-2"
        >
          <div class="flex items-center gap-1.5 min-w-0">
            <button
              class="text-xs truncate font-medium hover:underline transition-colors text-left"
              :style="{ color: p.className ? (CLASS_COLORS[p.className] ?? '#e4e4e7') : '#e4e4e7' }"
              :title="'Open ' + p.name + ' on check-pvp.fr'"
              @click="openPlayerUrl(p.name)"
            >
              {{ p.name }}
            </button>
          </div>
          <div class="flex items-center gap-2 flex-shrink-0">
            <span
              v-if="p.className"
              class="text-xs text-zinc-500"
            >
              {{ p.specName ? p.specName + ' ' + p.className : p.className }}
            </span>
            <span class="text-xs text-zinc-500">{{ p.ratingBefore }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Timeline -->
    <div>
      <p class="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
        Timeline
      </p>
      <div class="relative w-full select-none">
        <canvas
          ref="canvasRef"
          class="w-full h-10 rounded block"
          @mousemove="onMouseMove"
          @mouseleave="onMouseLeave"
        />
        <div
          v-if="tooltipText !== null"
          class="absolute bottom-12 pointer-events-none z-10 bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs px-2 py-1 rounded shadow-lg whitespace-nowrap -translate-x-1/2"
          :style="{ left: tooltipX + 'px' }"
        >
          {{ tooltipText }}
        </div>
      </div>
      <div class="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        <div
          v-for="item in legendItems"
          :key="item.type"
          class="flex items-center gap-1.5"
        >
          <span
            class="w-2 h-2 rounded-sm flex-shrink-0"
            :style="{ backgroundColor: TIMELINE_COLORS[item.type] ?? '#888' }"
          />
          <span class="text-xs text-zinc-500">{{ item.label }}</span>
        </div>
      </div>
    </div>

    <!-- Summary stats -->
    <div>
      <p class="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
        Summary
      </p>
      <div class="grid grid-cols-2 gap-2">
        <div class="bg-zinc-900 rounded-lg px-3 py-2.5 flex items-center justify-between">
          <span class="text-xs text-zinc-400">Player deaths</span>
          <span class="text-sm font-semibold text-red-400">{{ match.summary.playerDeaths }}</span>
        </div>
        <div class="bg-zinc-900 rounded-lg px-3 py-2.5 flex items-center justify-between">
          <span class="text-xs text-zinc-400">Enemy deaths</span>
          <span class="text-sm font-semibold text-green-400">{{ match.summary.enemyDeaths }}</span>
        </div>
        <div class="bg-zinc-900 rounded-lg px-3 py-2.5 flex items-center justify-between">
          <span class="text-xs text-zinc-400">CCs</span>
          <span class="text-sm font-semibold text-zinc-200">{{ match.summary.ccCount }}</span>
        </div>
        <div class="bg-zinc-900 rounded-lg px-3 py-2.5 flex items-center justify-between">
          <span class="text-xs text-zinc-400">Interrupts</span>
          <span class="text-sm font-semibold text-zinc-200">{{ match.summary.interruptCount }}</span>
        </div>
        <div class="bg-zinc-900 rounded-lg px-3 py-2.5 flex items-center justify-between">
          <span class="text-xs text-zinc-400">Defensives</span>
          <span class="text-sm font-semibold text-zinc-200">{{ match.summary.defensiveCount }}</span>
        </div>
        <div class="bg-zinc-900 rounded-lg px-3 py-2.5 flex items-center justify-between">
          <span class="text-xs text-zinc-400">Offensives</span>
          <span class="text-sm font-semibold text-zinc-200">{{ match.summary.offensiveCount }}</span>
        </div>
        <div class="bg-zinc-900 rounded-lg px-3 py-2.5 flex items-center justify-between col-span-2">
          <span class="text-xs text-zinc-400">CC Breaks</span>
          <span class="text-sm font-semibold text-zinc-200">{{ match.summary.ccBreakCount }}</span>
        </div>
      </div>
    </div>

    <!-- Event log -->
    <div>
      <p class="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
        Events
        <span class="text-zinc-700 font-normal normal-case tracking-normal ml-1">
          — ✦ healer CC highlighted in orange
        </span>
      </p>
      <div class="space-y-0.5 max-h-80 overflow-y-auto pr-1">
        <div
          v-for="(ev, i) in visibleEvents"
          :key="i"
          :class="[
            'flex flex-col text-xs py-1 px-2 rounded',
            ev.isHealerCC ? 'bg-orange-950/60 border border-orange-700/40' : 'hover:bg-zinc-800/60'
          ]"
        >
          <!-- Main event row -->
          <div class="flex items-center gap-2 min-w-0">
            <!-- Time -->
            <span class="w-10 flex-shrink-0 text-zinc-500 tabular-nums">
              {{ ev.timestamp.toFixed(1) }}s
            </span>

            <!-- Color dot -->
            <span
              class="w-1.5 h-1.5 rounded-sm flex-shrink-0"
              :style="{ backgroundColor: TIMELINE_COLORS[ev.type] ?? '#888' }"
            />

            <!-- Type -->
            <span :class="['flex-shrink-0 capitalize', ev.isHealerCC ? 'text-orange-300 font-semibold' : 'text-zinc-400']">
              {{ ev.type }}
            </span>

            <!-- Spell name + optional CC duration -->
            <span
              v-if="ev.spellName"
              class="text-zinc-300 truncate"
            >{{ ev.spellName }}<span
              v-if="ev.duration !== undefined"
              class="text-zinc-500 ml-1"
            >{{ ev.duration.toFixed(1) }}s</span></span>

            <!-- Death unit -->
            <span
              v-else-if="ev.unit"
              :style="{ color: playerColorMap.get(ev.unit) ?? '#e4e4e7' }"
              class="font-medium"
            >{{ ev.unit }}</span>

            <!-- Caster → Target -->
            <template v-if="ev.casterName">
              <span class="text-zinc-600 flex-shrink-0">by</span>
              <span
                :style="{ color: playerColorMap.get(ev.casterName) ?? '#a1a1aa' }"
                class="font-medium truncate"
              >{{ ev.casterName }}</span>
            </template>
            <template v-if="ev.targetName">
              <span class="text-zinc-600 flex-shrink-0">→</span>
              <span
                :style="{ color: ev.isHealerCC ? undefined : (playerColorMap.get(ev.targetName) ?? '#a1a1aa') }"
                :class="['font-medium truncate', ev.isHealerCC ? 'text-orange-300' : '']"
              >
                {{ ev.targetName }}
                <span
                  v-if="ev.isHealerCC"
                  class="text-orange-400 ml-0.5"
                >✦</span>
              </span>
            </template>
          </div>

          <!-- Death analysis: unused defensives -->
          <div
            v-if="ev.unusedDefensives && ev.unusedDefensives.length > 0"
            class="flex flex-wrap gap-1 mt-0.5 ml-12 pb-1"
          >
            <span class="text-zinc-600 mr-0.5">could use:</span>
            <span
              v-for="def in ev.unusedDefensives"
              :key="def"
              class="bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded"
            >{{ def }}</span>
          </div>
        </div>

        <p
          v-if="visibleEvents.length === 0"
          class="text-xs text-zinc-600 py-2 text-center"
        >
          No tracked events in this match
        </p>
      </div>
    </div>
  </div>
</template>
