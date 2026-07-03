<script setup lang="ts">
import type { MeterRow } from '@/composables/useMeters'

defineProps<{
  title: string
  rows: MeterRow[]
  // Total value formatter, e.g. "58.9K"
  formatTotal: (n: number) => string
  // Per-second label suffix, e.g. "DPS" or "HPS"
  rateLabel: string
  playerColor: (name: string) => string
}>()
</script>

<template>
  <div
    v-if="rows.length > 0"
    class="bg-zinc-900 rounded-lg overflow-hidden"
  >
    <div class="px-3 py-1.5 border-b border-zinc-800/60">
      <p class="text-xs font-semibold text-zinc-300">
        {{ title }}
      </p>
    </div>
    <div class="p-1.5 space-y-1">
      <div
        v-for="(row, i) in rows"
        :key="row.name"
        class="relative rounded overflow-hidden"
      >
        <!-- Bar fill, width relative to the top row -->
        <div
          class="absolute inset-y-0 left-0 opacity-30"
          :style="{ width: `${row.barPct}%`, backgroundColor: playerColor(row.name) }"
        />
        <div class="relative flex items-center gap-2 px-2 py-1 text-xs">
          <span class="w-4 text-zinc-500 flex-shrink-0 text-right">{{ i + 1 }}.</span>
          <span
            class="flex-1 min-w-0 truncate font-medium"
            :style="{ color: playerColor(row.name) }"
          >{{ row.name }}</span>
          <span class="flex-shrink-0 text-zinc-200 font-medium">{{ formatTotal(row.total) }}</span>
          <span class="flex-shrink-0 text-zinc-500 w-16 text-right">{{ formatTotal(row.perSecond) }} {{ rateLabel }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
