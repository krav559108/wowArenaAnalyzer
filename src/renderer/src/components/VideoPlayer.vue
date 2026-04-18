<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import type { Recording, TimelineEventType } from '@shared/ipc.types'
import { usePlayerStore } from '@/stores/playerStore'
import { usePlayer } from '@/composables/usePlayer'
import TimelineCanvas from './TimelineCanvas.vue'
import { TIMELINE_COLORS, SPELL_CLASS_MAP, SPELL_SPEC_MAP, HEALER_SPEC_BY_CLASS } from '@shared/constants'

const props = defineProps<{ recording: Recording }>()

const playerStore = usePlayerStore()
const { currentTime, duration } = storeToRefs(playerStore)

function fmtSecs(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const videoRef = ref<HTMLVideoElement | null>(null)
const { onTimeUpdate, onLoadedMetadata, onPlay, onPause, onEnded, seekTo, skip, setPlaybackRate } = usePlayer(
  () => videoRef.value
)

const playbackRate = ref(1)
const SPEED_OPTIONS = [0.5, 0.75, 1, 1.5, 2]

function selectSpeed(rate: number): void {
  playbackRate.value = rate
  setPlaybackRate(rate)
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

function openPlayer(name: string): void {
  void window.electron.invoke('system:openUrl', { url: checkPvpUrl(name) })
}

const videoSrc = computed(() => encodeURI('file://' + props.recording.videoPath))

const hiddenTypes = ref(new Set<TimelineEventType>())

watch(
  () => props.recording.id,
  () => {
    playerStore.setCurrentTime(0)
    playerStore.setDuration(0)
    playerStore.setPlaying(false)
    hiddenTypes.value = new Set()
    playerStore.setEvents(props.recording.metadata.events)
  },
  { immediate: true }
)

const result = computed(() => props.recording.metadata.result)
const bracket = computed(() => props.recording.metadata.bracket)
const zone = computed(() => props.recording.metadata.zone)
const formattedDuration = computed(() => fmtSecs(props.recording.metadata.duration))
const formattedDate = computed(() => formatDate(props.recording.metadata.date))
const rating = computed(() => props.recording.metadata.rating)
const currentTimeLabel = computed(() => fmtSecs(currentTime.value))
const totalTimeLabel = computed(() => fmtSecs(duration.value || props.recording.metadata.duration))

const events = computed(() => props.recording.metadata.events)

// Player names in WoW combat log follow "Name-Realm" or "Name-Realm-EU" format:
// contain a hyphen, no spaces, and are long enough to distinguish from pet names (Chi-Ji = 6 chars).
function isPlayerName(name: string): boolean {
  return name.includes('-') && !name.includes(' ') && name.length >= 7
}

// Derive team lists from event data when teamComp/enemyComp aren't populated yet.
// Rules:
//   - targetName team is always reliable (target field = target's faction)
//   - casterName team is reliable ONLY for aggressive actions (cc/interrupt/offensive):
//     if target='enemy' caster is player-side; if target='player' caster is enemy-side
//   - defensive casters are skipped: enemy healers cast on enemies (target='enemy') too
//   - death events: unit team follows death type
const derivedTeams = computed(() => {
  const stored = props.recording.metadata
  if (stored.teamComp.length > 0 || stored.enemyComp.length > 0) {
    return { playerTeam: stored.teamComp, enemyTeam: stored.enemyComp }
  }
  const playerSet = new Set<string>()
  const enemySet = new Set<string>()
  const aggressive = new Set(['cc', 'interrupt', 'offensive'])

  for (const ev of stored.events) {
    if ('targetName' in ev && ev.targetName && ev.targetName !== 'nil' && isPlayerName(ev.targetName)) {
      if (ev.target === 'enemy') enemySet.add(ev.targetName)
      else playerSet.add(ev.targetName)
    }
    if ('casterName' in ev && ev.casterName && isPlayerName(ev.casterName) && aggressive.has(ev.type)) {
      if (ev.target === 'enemy') playerSet.add(ev.casterName)
      else if (ev.target === 'player') enemySet.add(ev.casterName)
    }
    if ('unit' in ev && ev.unit && isPlayerName(ev.unit)) {
      if (ev.type === 'death-player') playerSet.add(ev.unit)
      else if (ev.type === 'death-enemy') enemySet.add(ev.unit)
    }
  }
  // Remove anyone who ended up in both sets (edge cases) — trust death events more
  for (const name of playerSet) if (enemySet.has(name)) enemySet.delete(name)
  return {
    playerTeam: [...playerSet].sort(),
    enemyTeam: [...enemySet].sort(),
  }
})

function handleSeek(time: number): void {
  seekTo(Math.max(0, time - 2))
}

const EVENT_TYPE_LABEL: Record<string, string> = {
  'cc': 'CC',
  'interrupt': 'Interrupt',
  'defensive': 'Defensive',
  'offensive': 'Offensive',
  'trinket': 'Trinket',
  'cc-break': 'CC Break',
  'death-player': 'Death',
  'death-enemy': 'Kill',
}

const legendItems = [
  { type: 'death-player', label: 'Death' },
  { type: 'death-enemy', label: 'Kill' },
  { type: 'cc', label: 'CC' },
  { type: 'interrupt', label: 'Interrupt' },
  { type: 'defensive', label: 'Defensive' },
  { type: 'offensive', label: 'Offensive' },
  { type: 'trinket', label: 'Trinket' },
] as const

const bracketLabel: Record<string, string> = {
  '2v2': '2v2',
  '3v3': '3v3',
  'solo-shuffle': 'Solo Shuffle',
  'skirmish': 'Skirmish',
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

// Infer player → class and spec from spell events
const derivedClassMap = computed((): Map<string, string> => {
  const map = new Map<string, string>()
  for (const ev of props.recording.metadata.events) {
    if ('spellId' in ev && ev.spellId !== undefined && 'casterName' in ev && ev.casterName) {
      const cls = (SPELL_CLASS_MAP as Record<number, string>)[ev.spellId]
      if (cls !== undefined) map.set(ev.casterName, cls)
    }
  }
  return map
})

// Fallback spec map inferred from spell casts (used for old recordings without knownSpecs)
const derivedSpecMap = computed((): Map<string, string> => {
  const map = new Map<string, string>()
  for (const ev of props.recording.metadata.events) {
    if ('spellId' in ev && ev.spellId !== undefined && 'casterName' in ev && ev.casterName) {
      const spec = (SPELL_SPEC_MAP as Record<number, string>)[ev.spellId]
      if (spec !== undefined) map.set(ev.casterName, spec)
    }
  }
  return map
})

// Confirmed healer names: prefer metadata.healerNames (set by StateMachine),
// fall back to isHealerCC flags for old recordings.
const confirmedHealerSet = computed((): Set<string> => {
  const saved = props.recording.metadata.healerNames
  if (saved !== undefined && saved.length > 0) return new Set(saved)
  const s = new Set<string>()
  for (const ev of props.recording.metadata.events) {
    if (ev.isHealerCC && ev.targetName) s.add(ev.targetName)
  }
  return s
})

function playerColor(name: string): string {
  const cls = derivedClassMap.value.get(name)
  return cls !== undefined ? (CLASS_COLORS[cls] ?? '#d4d4d8') : '#d4d4d8'
}

function playerSpec(name: string): string {
  // Primary: reliable spec from COMBATANT_INFO (saved to metadata.knownSpecs)
  const saved = props.recording.metadata.knownSpecs
  if (saved !== undefined) {
    const spec = saved[name]
    if (spec !== undefined) return spec
  }
  // Fallback: inferred from distinctive spell IDs
  const inferred = derivedSpecMap.value.get(name)
  if (inferred !== undefined) return inferred
  // Last resort: healer spec by class if confirmed healer
  if (confirmedHealerSet.value.has(name)) {
    const cls = derivedClassMap.value.get(name)
    if (cls !== undefined) return (HEALER_SPEC_BY_CLASS as Record<string, string>)[cls] ?? ''
  }
  return ''
}

const HEALER_SPECS = new Set(['Holy', 'Discipline', 'Restoration', 'Mistweaver', 'Preservation', 'Augmentation'])

function isHealer(name: string): boolean {
  if (confirmedHealerSet.value.has(name)) return true
  return HEALER_SPECS.has(playerSpec(name))
}

// -------------------------------------------------------------------------
// Event type filter (click legend to toggle)
// -------------------------------------------------------------------------

function toggleType(type: TimelineEventType): void {
  const next = new Set(hiddenTypes.value)
  if (next.has(type)) next.delete(type)
  else next.add(type)
  hiddenTypes.value = next
}

const visibleEvents = computed(() =>
  events.value.filter((ev) => !hiddenTypes.value.has(ev.type))
)

watch(visibleEvents, () => {
  playerStore.setEvents(visibleEvents.value)
})

// -------------------------------------------------------------------------
// Custom fullscreen
// -------------------------------------------------------------------------
const isFullscreen = ref(false)

function toggleFullscreen(): void {
  isFullscreen.value = !isFullscreen.value
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && isFullscreen.value) isFullscreen.value = false
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div
    class="flex flex-col"
    :class="isFullscreen ? 'fixed inset-0 z-50 bg-[#0f0f0f]' : 'h-full'"
  >
    <!-- Video -->
    <div
      class="relative bg-black flex-shrink-0"
      :style="isFullscreen ? 'flex: 1 1 0; min-height: 0' : 'aspect-ratio: 16/9; max-height: 42%'"
    >
      <video
        ref="videoRef"
        class="w-full h-full object-contain"
        controls
        :src="videoSrc"
        @timeupdate="onTimeUpdate"
        @loadedmetadata="onLoadedMetadata"
        @play="onPlay"
        @pause="onPause"
        @ended="onEnded"
      />
    </div>

    <!-- Playback controls -->
    <div class="flex-shrink-0 px-4 py-2 flex items-center gap-3">
      <!-- Skip buttons -->
      <button
        class="text-xs text-zinc-400 hover:text-white px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700"
        @click="skip(-10)"
      >
        ←10s
      </button>
      <button
        class="text-xs text-zinc-400 hover:text-white px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700"
        @click="skip(10)"
      >
        +10s→
      </button>

      <!-- Speed selector -->
      <div class="flex items-center gap-1">
        <button
          v-for="rate in SPEED_OPTIONS"
          :key="rate"
          class="text-xs px-2 py-1 rounded"
          :class="playbackRate === rate ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'"
          @click="selectSpeed(rate)"
        >
          {{ rate }}x
        </button>
      </div>

      <!-- Fullscreen toggle -->
      <button
        class="ml-auto text-xs text-zinc-400 hover:text-white px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700"
        :title="isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'"
        @click="toggleFullscreen"
      >
        {{ isFullscreen ? '✕ Exit' : '⛶' }}
      </button>
    </div>

    <!-- Match header -->
    <div class="flex-shrink-0 px-4 pt-1 pb-2 flex items-center gap-3">
      <div class="flex-1 min-w-0">
        <h3 class="text-sm font-semibold text-white truncate">
          {{ zone }}
          <span
            v-if="recording.metadata.round !== undefined"
            class="text-zinc-500 font-normal"
          > · R{{ recording.metadata.round }}</span>
        </h3>
        <p class="text-xs text-zinc-500 mt-0.5">
          {{ formattedDate }} · {{ formattedDuration }}
        </p>
      </div>
      <span
        class="text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0"
        :class="{
          'bg-blue-900 text-blue-300': bracket === '2v2',
          'bg-purple-900 text-purple-300': bracket === '3v3',
          'bg-amber-900 text-amber-300': bracket === 'solo-shuffle',
          'bg-zinc-800 text-zinc-400': bracket === 'skirmish',
        }"
      >
        {{ bracketLabel[bracket] ?? bracket }}
      </span>
      <span
        class="text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0"
        :class="result === 'WIN' ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-400'"
      >
        {{ result }}
      </span>
      <template v-if="rating !== null">
        <span class="text-xs text-zinc-400 flex-shrink-0">
          {{ rating.before }}
          <span class="text-zinc-600">→</span>
          <span :class="rating.after >= rating.before ? 'text-green-400' : 'text-red-400'">{{ rating.after }}</span>
        </span>
      </template>
    </div>

    <!-- Scrollable detail -->
    <div class="flex-1 min-h-0 overflow-y-auto px-4 pb-4 space-y-4">
      <!-- Teams -->
      <div class="grid grid-cols-2 gap-3">
        <div class="bg-zinc-900 rounded-lg p-3">
          <p
            class="text-xs font-semibold uppercase tracking-wider mb-2"
            style="color: #f0b429;"
          >
            Your Team
          </p>
          <div
            v-for="name in derivedTeams.playerTeam"
            :key="name"
            class="flex items-center gap-1 py-0.5"
          >
            <span
              v-if="isHealer(name)"
              class="text-green-400 text-[10px] leading-none flex-shrink-0"
              title="Healer"
            >✚</span>
            <button
              class="min-w-0 flex-1 text-xs truncate text-left hover:underline"
              :style="{ color: playerColor(name) }"
              @click="openPlayer(name)"
            >
              {{ name }}<span v-if="playerSpec(name)" class="text-zinc-500"> ({{ playerSpec(name) }})</span>
            </button>
          </div>
          <p
            v-if="derivedTeams.playerTeam.length === 0"
            class="text-xs text-zinc-600"
          >
            —
          </p>
        </div>
        <div class="bg-zinc-900 rounded-lg p-3">
          <p
            class="text-xs font-semibold uppercase tracking-wider mb-2"
            style="color: #a855f7;"
          >
            Enemy Team
          </p>
          <div
            v-for="name in derivedTeams.enemyTeam"
            :key="name"
            class="flex items-center gap-1 py-0.5"
          >
            <span
              v-if="isHealer(name)"
              class="text-green-400 text-[10px] leading-none flex-shrink-0"
              title="Healer"
            >✚</span>
            <button
              class="min-w-0 flex-1 text-xs truncate text-left hover:underline"
              :style="{ color: playerColor(name) }"
              @click="openPlayer(name)"
            >
              {{ name }}<span v-if="playerSpec(name)" class="text-zinc-500"> ({{ playerSpec(name) }})</span>
            </button>
          </div>
          <p
            v-if="derivedTeams.enemyTeam.length === 0"
            class="text-xs text-zinc-600"
          >
            —
          </p>
        </div>
      </div>

      <!-- Timeline -->
      <div>
        <p class="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
          Timeline
        </p>
        <div class="flex items-center justify-between text-xs text-zinc-600 mb-1">
          <span>{{ currentTimeLabel }}</span>
          <span>{{ totalTimeLabel }}</span>
        </div>
        <div class="relative w-full select-none">
          <TimelineCanvas @seek="handleSeek" />
        </div>
        <div class="flex flex-wrap gap-x-3 gap-y-1 mt-2">
          <button
            v-for="item in legendItems"
            :key="item.type"
            class="flex items-center gap-1.5 rounded px-1 py-0.5 transition-opacity"
            :class="hiddenTypes.has(item.type) ? 'opacity-30' : 'opacity-100 hover:opacity-80'"
            :title="hiddenTypes.has(item.type) ? 'Show ' + item.label : 'Hide ' + item.label"
            @click="toggleType(item.type)"
          >
            <span
              class="w-2 h-2 rounded-sm flex-shrink-0"
              :style="{ backgroundColor: TIMELINE_COLORS[item.type] ?? '#888' }"
            />
            <span
              class="text-xs text-zinc-500"
              :class="hiddenTypes.has(item.type) ? 'line-through' : ''"
            >{{ item.label }}</span>
          </button>
        </div>
      </div>

      <!-- Events -->
      <div>
        <p class="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
          Events
        </p>
        <div class="space-y-0.5">
          <div
            v-for="(ev, i) in visibleEvents"
            :key="i"
            class="flex flex-col text-xs py-1 px-2 rounded"
            :class="ev.isHealerCC ? 'bg-purple-950/40 hover:bg-purple-950/60' : 'hover:bg-zinc-800/60'"
          >
            <div class="flex items-center gap-2 min-w-0">
              <!-- Timestamp — click to seek -->
              <button
                class="w-10 flex-shrink-0 text-zinc-500 tabular-nums hover:text-zinc-300 text-left"
                @click="handleSeek(ev.timestamp)"
              >
                {{ fmtSecs(ev.timestamp) }}
              </button>

              <!-- Color dot -->
              <span
                class="w-1.5 h-1.5 rounded-sm flex-shrink-0"
                :style="{ backgroundColor: TIMELINE_COLORS[ev.type] ?? '#888' }"
              />

              <!-- Type label -->
              <span class="flex-shrink-0 text-zinc-400">
                {{ EVENT_TYPE_LABEL[ev.type] ?? ev.type }}
              </span>

              <!-- Mistake marker -->
              <span
                v-if="ev.isMistake"
                class="flex-shrink-0 text-red-400 font-bold text-[10px] bg-red-950/60 px-1 rounded"
                :title="ev.mistakeReason"
              >!</span>

              <!-- Spell name + CC duration -->
              <span
                v-if="ev.spellName"
                class="text-zinc-300 truncate"
              >
                {{ ev.spellName }}<span
                  v-if="ev.duration !== undefined"
                  class="text-zinc-500 ml-1"
                >{{ ev.duration }}s</span>
              </span>

              <!-- Death unit -->
              <span
                v-else-if="ev.unit"
                class="font-medium truncate"
                :style="{ color: playerColor(ev.unit) }"
              >{{ ev.unit }}</span>

              <!-- Caster → Target -->
              <template v-if="ev.casterName">
                <span class="text-zinc-600 flex-shrink-0">by</span>
                <span
                  class="truncate"
                  :style="{ color: playerColor(ev.casterName) }"
                >{{ ev.casterName }}</span>
              </template>
              <template v-if="ev.targetName && ev.targetName !== 'nil'">
                <span class="text-zinc-600 flex-shrink-0">→</span>
                <span
                  class="truncate"
                  :style="{ color: playerColor(ev.targetName) }"
                >{{ ev.targetName }}</span>
              </template>
            </div>

            <!-- Unused defensives -->
            <div
              v-if="ev.unusedDefensives && ev.unusedDefensives.length > 0"
              class="flex flex-wrap gap-1 mt-0.5 ml-12 pb-0.5"
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
  </div>
</template>
