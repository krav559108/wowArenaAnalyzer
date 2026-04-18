// Video player composable.
// Bridges the native <video> element and playerStore so the timeline
// can read currentTime without knowing about the DOM.

import { usePlayerStore } from '@/stores/playerStore'

export function usePlayer(videoEl: () => HTMLVideoElement | null) {
  const store = usePlayerStore()

  function onTimeUpdate(e: Event): void {
    store.setCurrentTime((e.target as HTMLVideoElement).currentTime)
  }

  function onLoadedMetadata(e: Event): void {
    const el = e.target as HTMLVideoElement
    store.setDuration(el.duration)
    store.setCurrentTime(0)
  }

  function onPlay(): void {
    store.setPlaying(true)
  }

  function onPause(): void {
    store.setPlaying(false)
  }

  function onEnded(): void {
    store.setPlaying(false)
  }

  function seekTo(time: number): void {
    const el = videoEl()
    if (el !== null) {
      el.currentTime = time
    }
  }

  function skip(deltaSecs: number): void {
    const el = videoEl()
    if (el !== null) {
      el.currentTime = Math.max(0, Math.min(el.duration || 0, el.currentTime + deltaSecs))
    }
  }

  function setPlaybackRate(rate: number): void {
    const el = videoEl()
    if (el !== null) {
      el.playbackRate = rate
    }
  }

  return { onTimeUpdate, onLoadedMetadata, onPlay, onPause, onEnded, seekTo, skip, setPlaybackRate }
}
