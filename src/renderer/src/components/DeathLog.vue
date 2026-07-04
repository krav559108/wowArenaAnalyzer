<script setup lang="ts">
import { computed } from 'vue'
import type { TimelineEvent } from '@shared/ipc.types'

const props = defineProps<{
  deaths: TimelineEvent[]
  playerColor: (name: string) => string
}>()

const emit = defineEmits<{ seek: [time: number] }>()

function fmtSecs(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function fmtK(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K'
  return String(n)
}

// The match's very first death (either side) — mirrors wowarenalogs' "First Blood"
// highlight, which calls out the opening death of the match specifically.
const firstBloodTimestamp = computed(() =>
  props.deaths.length > 0 ? Math.min(...props.deaths.map((d) => d.timestamp)) : null
)

// One unified, chronological recap row per death — mirrors the classic Details!
// "Death Recap" addon layout: time, spell (caster), amount. Damage/healing/CC/
// defensives are merged into a single list instead of separate sub-sections so it
// reads as one timeline of "what happened in the runup to this death."
interface RecapRow {
  relSecs: number
  spellName: string
  casterName?: string
  amount?: number
  kind: 'damage' | 'heal' | 'cc' | 'defensive'
}

function recapRows(ev: TimelineEvent): RecapRow[] {
  const rows: RecapRow[] = []
  for (const h of ev.deathSummary ?? []) {
    rows.push({ relSecs: h.relSecs, spellName: h.spellName, casterName: h.casterName, amount: -h.amount, kind: 'damage' })
  }
  for (const h of ev.deathHealing ?? []) {
    rows.push({ relSecs: h.relSecs, spellName: h.spellName, casterName: h.casterName, amount: h.amount, kind: 'heal' })
  }
  for (const cc of ev.deathCCTaken ?? []) {
    rows.push({ relSecs: cc.relSecs, spellName: cc.spellName, casterName: cc.casterName, kind: 'cc' })
  }
  for (const def of ev.deathDefensivesUsed ?? []) {
    rows.push({ relSecs: def.relSecs, spellName: def.spellName, kind: 'defensive' })
  }
  return rows.sort((a, b) => a.relSecs - b.relSecs)
}

// Damage/healing bucketed into 1-second slices counting down to the death (0 = the
// second death happened in) — same idea as wowarenalogs' "First Blood" damage-over-
// time view, built entirely from the relSecs already on each recap hit (no new
// backend data needed).
interface SecondBucket {
  secBefore: number
  dmg: number
  heal: number
}

function secondBuckets(ev: TimelineEvent): SecondBucket[] {
  const buckets = new Map<number, { dmg: number; heal: number }>()
  for (const h of ev.deathSummary ?? []) {
    const secBefore = Math.max(0, Math.floor(-h.relSecs))
    const b = buckets.get(secBefore) ?? { dmg: 0, heal: 0 }
    b.dmg += h.amount
    buckets.set(secBefore, b)
  }
  for (const h of ev.deathHealing ?? []) {
    const secBefore = Math.max(0, Math.floor(-h.relSecs))
    const b = buckets.get(secBefore) ?? { dmg: 0, heal: 0 }
    b.heal += h.amount
    buckets.set(secBefore, b)
  }
  if (buckets.size === 0) return []
  const maxSec = Math.max(...buckets.keys())
  const result: SecondBucket[] = []
  for (let s = maxSec; s >= 0; s--) {
    const b = buckets.get(s) ?? { dmg: 0, heal: 0 }
    result.push({ secBefore: s, dmg: b.dmg, heal: b.heal })
  }
  return result
}

function bucketPct(amount: number, buckets: SecondBucket[]): number {
  const max = Math.max(1, ...buckets.map((b) => Math.max(b.dmg, b.heal)))
  return (amount / max) * 100
}

const rowsByDeath = computed(() =>
  props.deaths.map((ev) => ({ ev, rows: recapRows(ev), buckets: secondBuckets(ev) }))
)

function fmtAmount(n: number): string {
  return n >= 0 ? `+${n.toLocaleString()}` : n.toLocaleString()
}
</script>

<template>
  <div class="space-y-2">
    <div
      v-for="{ ev, rows, buckets } in rowsByDeath"
      :key="ev.timestamp"
      class="rounded hover:bg-zinc-800/40"
    >
      <div class="flex items-center gap-2 min-w-0 py-1 px-2">
        <button
          class="w-10 flex-shrink-0 text-zinc-500 tabular-nums hover:text-zinc-300 text-left text-xs"
          @click="emit('seek', ev.timestamp)"
        >
          {{ fmtSecs(Math.max(0, ev.timestamp - 2)) }}
        </button>
        <span
          v-if="ev.timestamp === firstBloodTimestamp"
          class="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none bg-amber-950/60 text-amber-400"
          title="The first death of the match"
        >First Blood</span>
        <span
          class="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none"
          :class="ev.type === 'death-player' ? 'bg-red-950/60 text-red-400' : 'bg-green-950/60 text-green-400'"
        >{{ ev.type === 'death-player' ? 'Death' : 'Kill' }}</span>
        <span
          v-if="ev.unit"
          class="text-xs font-medium truncate"
          :style="{ color: playerColor(ev.unit) }"
        >{{ ev.unit }}</span>
      </div>

      <!-- Damage/healing over time, 1s buckets counting down to death -->
      <div
        v-if="buckets.length > 0"
        class="ml-12 mr-2 mb-1 space-y-0.5"
      >
        <div
          v-for="b in buckets"
          :key="b.secBefore"
          class="flex items-center gap-1 h-3.5 text-[9px]"
        >
          <span class="w-6 text-zinc-600 flex-shrink-0 text-right">-{{ b.secBefore }}s</span>
          <div class="flex-1 flex items-center h-3">
            <div class="flex-1 flex justify-end h-full">
              <div
                class="h-full bg-red-500/70 rounded-l-sm"
                :style="{ width: `${bucketPct(b.dmg, buckets)}%` }"
              />
            </div>
            <div class="w-px h-full bg-zinc-700 flex-shrink-0" />
            <div class="flex-1 flex justify-start h-full">
              <div
                class="h-full bg-green-500/70 rounded-r-sm"
                :style="{ width: `${bucketPct(b.heal, buckets)}%` }"
              />
            </div>
          </div>
          <span class="w-20 flex-shrink-0 flex justify-between tabular-nums">
            <span class="text-red-400">{{ b.dmg > 0 ? '-' + fmtK(b.dmg) : '' }}</span>
            <span class="text-green-400">{{ b.heal > 0 ? '+' + fmtK(b.heal) : '' }}</span>
          </span>
        </div>
      </div>

      <div
        v-if="rows.length > 0"
        class="ml-12 mr-2 mb-1.5 rounded bg-black/20 overflow-hidden"
      >
        <div
          v-for="(row, ri) in rows"
          :key="ri"
          class="flex items-center gap-1.5 text-[11px] px-2 py-1 odd:bg-white/[0.02]"
        >
          <span class="tabular-nums text-zinc-500 w-9 flex-shrink-0">{{ row.relSecs.toFixed(1) }}s</span>
          <span
            class="truncate"
            :class="row.kind === 'defensive' ? 'text-blue-300' : row.kind === 'cc' ? 'text-purple-300' : 'text-amber-200'"
          >{{ row.spellName }}</span>
          <span
            v-if="row.casterName"
            class="truncate flex-shrink-0"
            :style="{ color: playerColor(row.casterName) }"
          >({{ row.casterName }})</span>
          <span
            v-if="row.amount !== undefined"
            class="ml-auto tabular-nums font-medium flex-shrink-0"
            :class="row.kind === 'heal' ? 'text-green-400' : 'text-red-400'"
          >{{ fmtAmount(row.amount) }}</span>
        </div>
      </div>
    </div>

    <p
      v-if="deaths.length === 0"
      class="text-xs text-zinc-600 py-2 text-center"
    >
      No deaths tracked in this match
    </p>
  </div>
</template>
