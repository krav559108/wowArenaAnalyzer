<script setup lang="ts">
import type { TimelineEvent } from '@shared/ipc.types'

defineProps<{
  deaths: TimelineEvent[]
  playerColor: (name: string) => string
}>()

const emit = defineEmits<{ seek: [time: number] }>()

function fmtSecs(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
</script>

<template>
  <div class="space-y-1">
    <div
      v-for="(ev, i) in deaths"
      :key="i"
      class="flex flex-col text-xs py-1.5 px-2 rounded hover:bg-zinc-800/60"
    >
      <div class="flex items-center gap-2 min-w-0">
        <button
          class="w-10 flex-shrink-0 text-zinc-500 tabular-nums hover:text-zinc-300 text-left"
          @click="emit('seek', ev.timestamp)"
        >
          {{ fmtSecs(Math.max(0, ev.timestamp - 2)) }}
        </button>
        <span
          class="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none"
          :class="ev.type === 'death-player' ? 'bg-red-950/60 text-red-400' : 'bg-green-950/60 text-green-400'"
        >{{ ev.type === 'death-player' ? 'Death' : 'Kill' }}</span>
        <span
          v-if="ev.unit"
          class="font-medium truncate"
          :style="{ color: playerColor(ev.unit) }"
        >{{ ev.unit }}</span>
      </div>

      <div
        v-if="(ev.deathSummary && ev.deathSummary.length > 0) || (ev.deathHealing && ev.deathHealing.length > 0) || (ev.deathCCTaken && ev.deathCCTaken.length > 0) || (ev.deathDefensivesUsed && ev.deathDefensivesUsed.length > 0)"
        class="mt-1 ml-12 border-l border-zinc-700 pl-2 pb-0.5 space-y-1"
      >
        <div v-if="ev.deathSummary && ev.deathSummary.length > 0">
          <p class="text-[10px] text-zinc-500 mb-0.5">
            Last 10s incoming damage:
          </p>
          <div
            v-for="(hit, hi) in ev.deathSummary"
            :key="`dmg-${hi}`"
            class="flex items-center gap-1.5 text-[10px] text-zinc-400"
          >
            <span class="tabular-nums text-zinc-600 w-8 flex-shrink-0">{{ hit.relSecs.toFixed(1) }}s</span>
            <span
              v-if="hit.hpPct !== undefined"
              class="tabular-nums text-zinc-500 flex-shrink-0"
            >({{ hit.hpPct }}%)</span>
            <span class="truncate">{{ hit.spellName }}</span>
            <span class="ml-auto text-red-400 tabular-nums flex-shrink-0">{{ hit.amount.toLocaleString() }}</span>
          </div>
        </div>

        <div v-if="ev.deathHealing && ev.deathHealing.length > 0">
          <p class="text-[10px] text-zinc-500 mb-0.5">
            Last 10s healing received:
          </p>
          <div
            v-for="(hit, hi) in ev.deathHealing"
            :key="`heal-${hi}`"
            class="flex items-center gap-1.5 text-[10px] text-zinc-400"
          >
            <span class="tabular-nums text-zinc-600 w-8 flex-shrink-0">{{ hit.relSecs.toFixed(1) }}s</span>
            <span class="truncate">{{ hit.spellName }}</span>
            <span class="ml-auto text-green-400 tabular-nums flex-shrink-0">{{ hit.amount.toLocaleString() }}</span>
          </div>
        </div>

        <div v-if="ev.deathCCTaken && ev.deathCCTaken.length > 0">
          <p class="text-[10px] text-zinc-500 mb-0.5">
            CC taken:
          </p>
          <div
            v-for="(cc, ci) in ev.deathCCTaken"
            :key="`cc-${ci}`"
            class="flex items-center gap-1.5 text-[10px] text-zinc-400"
          >
            <span class="tabular-nums text-zinc-600 w-8 flex-shrink-0">{{ cc.relSecs.toFixed(1) }}s</span>
            <span class="truncate">{{ cc.spellName }}</span>
            <span
              v-if="cc.casterName"
              class="ml-auto truncate flex-shrink-0"
              :style="{ color: playerColor(cc.casterName) }"
            >{{ cc.casterName }}</span>
          </div>
        </div>

        <div v-if="ev.deathDefensivesUsed && ev.deathDefensivesUsed.length > 0">
          <p class="text-[10px] text-zinc-500 mb-0.5">
            Defensives used:
          </p>
          <div
            v-for="(def, di) in ev.deathDefensivesUsed"
            :key="`def-${di}`"
            class="flex items-center gap-1.5 text-[10px] text-zinc-400"
          >
            <span class="tabular-nums text-zinc-600 w-8 flex-shrink-0">{{ def.relSecs.toFixed(1) }}s</span>
            <span class="truncate">{{ def.spellName }}</span>
          </div>
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
