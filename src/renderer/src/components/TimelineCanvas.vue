<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { usePlayerStore } from '@/stores/playerStore'
import { useTimeline } from '@/composables/useTimeline'

const emit = defineEmits<{ seek: [time: number] }>()

const playerStore = usePlayerStore()
const { currentTime, duration, events } = storeToRefs(playerStore)

const canvasRef = ref<HTMLCanvasElement | null>(null)

const { tooltipText, tooltipX, draw, onClick, onMouseMove, onMouseLeave } = useTimeline(
  canvasRef,
  events,
  currentTime,
  duration,
  (time) => emit('seek', time)
)

// Redraw when the container resizes
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
</script>

<template>
  <div class="relative w-full select-none">
    <canvas
      ref="canvasRef"
      class="w-full h-14 rounded cursor-pointer block"
      @click="onClick"
      @mousemove="onMouseMove"
      @mouseleave="onMouseLeave"
    />

    <!-- Tooltip -->
    <div
      v-if="tooltipText !== null"
      class="absolute bottom-12 pointer-events-none z-10 bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs px-2 py-1 rounded shadow-lg whitespace-nowrap -translate-x-1/2"
      :style="{ left: tooltipX + 'px' }"
    >
      {{ tooltipText }}
    </div>
  </div>
</template>
