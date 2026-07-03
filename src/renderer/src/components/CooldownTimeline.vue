<script setup lang="ts">
import type { CooldownRow } from '@/composables/useCooldownRows'

const props = defineProps<{
  rows: CooldownRow[]
  duration: number
  playerColor: (name: string) => string
}>()

const emit = defineEmits<{ seek: [time: number] }>()

const CAST_TYPE_COLOR: Record<string, string> = {
  trinket: '#f0b429', // amber — matches TIMELINE_COLORS['trinket']
  defensive: '#38bdf8', // sky blue
  offensive: '#f87171' // red
}

function pct(timestamp: number): string {
  if (props.duration <= 0) return '0%'
  return `${Math.min(100, Math.max(0, (timestamp / props.duration) * 100))}%`
}

function fmtSecs(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
</script>

<template>
  <div class="space-y-1">
    <div
      v-for="row in rows"
      :key="row.name"
      class="flex items-center gap-2"
    >
      <span
        class="text-[10px] w-24 flex-shrink-0 truncate"
        :style="{ color: playerColor(row.name) }"
      >{{ row.name }}</span>
      <div class="relative flex-1 h-3 bg-zinc-800/60 rounded-sm">
        <button
          v-for="(cast, ci) in row.casts"
          :key="ci"
          class="absolute top-0 bottom-0 w-1 rounded-sm -translate-x-1/2 hover:scale-125 transition-transform"
          :style="{ left: pct(cast.timestamp), backgroundColor: CAST_TYPE_COLOR[cast.castType] }"
          :title="`${cast.spellName} (${fmtSecs(cast.timestamp)})`"
          @click="emit('seek', cast.timestamp)"
        />
      </div>
    </div>
    <div class="flex items-center gap-3 text-[10px] text-zinc-500 pt-1">
      <span class="flex items-center gap-1"><span
        class="w-2 h-2 rounded-sm inline-block"
        :style="{ backgroundColor: CAST_TYPE_COLOR.trinket }"
      />Trinket</span>
      <span class="flex items-center gap-1"><span
        class="w-2 h-2 rounded-sm inline-block"
        :style="{ backgroundColor: CAST_TYPE_COLOR.defensive }"
      />Defensive</span>
      <span class="flex items-center gap-1"><span
        class="w-2 h-2 rounded-sm inline-block"
        :style="{ backgroundColor: CAST_TYPE_COLOR.offensive }"
      />Offensive CD</span>
    </div>
  </div>
</template>
