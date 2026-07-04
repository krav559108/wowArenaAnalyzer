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

// Top 3 damage sources by spell (summed across all casts in the 10s recap window) —
// shown as a hover summary on the death row itself, so the "what killed me" headline
// doesn't require expanding anything.
function topDamageSources(ev: TimelineEvent): string {
  const bySpell = new Map<string, number>()
  for (const h of ev.deathSummary ?? []) {
    bySpell.set(h.spellName, (bySpell.get(h.spellName) ?? 0) + h.amount)
  }
  const top = [...bySpell.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  if (top.length === 0) return 'No damage recorded'
  return 'Top damage sources:\n' + top.map(([name, amt]) => `${name}: ${amt.toLocaleString()}`).join('\n')
}

// One damage/heal hit rendered as a single colored segment within its 1-second bucket
// — segment width is proportional to its share of the bucket, color is the caster's
// class color, matching how wowarenalogs' "First Blood" damage-over-time view
// visually attributes each moment to whoever dealt it.
interface Segment {
  spellName: string
  casterName?: string
  amount: number
  isCritical?: boolean
}

interface SecondBucket {
  secBefore: number
  damage: Segment[]
  healing: Segment[]
  totalDmg: number
  totalHeal: number
}

function secondBuckets(ev: TimelineEvent): SecondBucket[] {
  const buckets = new Map<number, { damage: Segment[]; healing: Segment[] }>()
  for (const h of ev.deathSummary ?? []) {
    const secBefore = Math.max(0, Math.floor(-h.relSecs))
    const b = buckets.get(secBefore) ?? { damage: [], healing: [] }
    b.damage.push({ spellName: h.spellName, casterName: h.casterName, amount: h.amount, isCritical: h.isCritical })
    buckets.set(secBefore, b)
  }
  for (const h of ev.deathHealing ?? []) {
    const secBefore = Math.max(0, Math.floor(-h.relSecs))
    const b = buckets.get(secBefore) ?? { damage: [], healing: [] }
    b.healing.push({ spellName: h.spellName, casterName: h.casterName, amount: h.amount })
    buckets.set(secBefore, b)
  }
  if (buckets.size === 0) return []
  const maxSec = Math.max(...buckets.keys())
  const result: SecondBucket[] = []
  for (let s = maxSec; s >= 0; s--) {
    const b = buckets.get(s) ?? { damage: [], healing: [] }
    result.push({
      secBefore: s,
      damage: b.damage,
      healing: b.healing,
      totalDmg: b.damage.reduce((sum, seg) => sum + seg.amount, 0),
      totalHeal: b.healing.reduce((sum, seg) => sum + seg.amount, 0)
    })
  }
  return result
}

function bucketBarPct(total: number, buckets: SecondBucket[]): number {
  const max = Math.max(1, ...buckets.map((b) => Math.max(b.totalDmg, b.totalHeal)))
  return (total / max) * 100
}

function segmentTitle(seg: Segment): string {
  const critMark = seg.isCritical ? ' *' : ''
  const caster = seg.casterName ? ` (${seg.casterName})` : ''
  return `${seg.spellName}${critMark}${caster} — ${seg.amount.toLocaleString()}`
}

function segmentColor(seg: Segment): string {
  return seg.casterName ? props.playerColor(seg.casterName) : '#71717a'
}

const rowsByDeath = computed(() =>
  props.deaths.map((ev) => ({ ev, buckets: secondBuckets(ev), topSources: topDamageSources(ev) }))
)

// Also used for the defensives-used line, kept separate from the segmented bars since
// there's no per-second amount to bucket.
function defensivesUsed(ev: TimelineEvent): { spellName: string; relSecs: number }[] {
  return (ev.deathDefensivesUsed ?? []).map((d) => ({ spellName: d.spellName, relSecs: d.relSecs }))
}
</script>

<template>
  <div class="space-y-2">
    <div
      v-for="{ ev, buckets, topSources } in rowsByDeath"
      :key="ev.timestamp"
      class="rounded hover:bg-zinc-800/40"
    >
      <div
        class="flex items-center gap-2 min-w-0 py-1 px-2"
        :title="topSources"
      >
        <button
          class="w-10 flex-shrink-0 text-zinc-500 tabular-nums hover:text-zinc-300 text-left text-xs"
          @click="emit('seek', ev.timestamp)"
        >
          {{ fmtSecs(Math.max(0, ev.timestamp - 2)) }}
        </button>
        <span
          v-if="ev.timestamp === firstBloodTimestamp"
          class="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none bg-amber-950/60 text-amber-400"
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

      <!-- Damage/healing over time, 1s buckets counting down to death. Each hit is its
           own segment, colored by the caster's class and sized by its share of the
           bucket — hover a segment for spell name, amount, and crit marker. -->
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
                class="h-full flex overflow-hidden rounded-l-sm"
                :style="{ width: `${bucketBarPct(b.totalDmg, buckets)}%` }"
              >
                <div
                  v-for="(seg, si) in b.damage"
                  :key="si"
                  :style="{ width: `${(seg.amount / b.totalDmg) * 100}%`, backgroundColor: segmentColor(seg) }"
                  :title="segmentTitle(seg)"
                />
              </div>
            </div>
            <div class="w-px h-full bg-zinc-700 flex-shrink-0" />
            <div class="flex-1 flex justify-start h-full">
              <div
                class="h-full flex overflow-hidden rounded-r-sm"
                :style="{ width: `${bucketBarPct(b.totalHeal, buckets)}%` }"
              >
                <div
                  v-for="(seg, si) in b.healing"
                  :key="si"
                  class="opacity-80"
                  :style="{ width: `${(seg.amount / b.totalHeal) * 100}%`, backgroundColor: segmentColor(seg) }"
                  :title="segmentTitle(seg)"
                />
              </div>
            </div>
          </div>
          <span
            v-if="b.totalDmg > 0 || b.totalHeal > 0"
            class="flex-shrink-0 tabular-nums"
            :class="b.totalDmg >= b.totalHeal ? 'text-red-400' : 'text-green-400'"
          >{{ b.totalDmg >= b.totalHeal ? '-' + fmtK(b.totalDmg) : '+' + fmtK(b.totalHeal) }}</span>
        </div>
      </div>

      <div
        v-if="defensivesUsed(ev).length > 0"
        class="ml-12 mr-2 mb-1.5 flex flex-wrap gap-x-3 gap-y-0.5"
      >
        <span
          v-for="(def, di) in defensivesUsed(ev)"
          :key="di"
          class="text-[10px] text-blue-300"
        >{{ def.relSecs.toFixed(1) }}s {{ def.spellName }}</span>
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
