import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { TimelineEvent } from '@shared/ipc.types'

export const usePlayerStore = defineStore('player', () => {
  const currentTime = ref(0)
  const duration = ref(0)
  const events = ref<TimelineEvent[]>([])
  const isPlaying = ref(false)

  function setCurrentTime(time: number): void {
    currentTime.value = time
  }

  function setDuration(d: number): void {
    duration.value = d
  }

  function setEvents(list: TimelineEvent[]): void {
    events.value = list
  }

  function setPlaying(playing: boolean): void {
    isPlaying.value = playing
  }

  return {
    currentTime,
    duration,
    events,
    isPlaying,
    setCurrentTime,
    setDuration,
    setEvents,
    setPlaying
  }
})
