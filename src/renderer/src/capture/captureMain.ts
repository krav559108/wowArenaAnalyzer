// Hidden capture window's renderer script. Loaded only by the offscreen BrowserWindow
// created by WindowCaptureRecorder (main process) — never shown to the user.
//
// Flow: main sends 'capture:start' with a desktopCapturer sourceId (chosen via
// session.setDisplayMediaRequestHandler, wired in WindowCaptureRecorder) -> this script
// calls getDisplayMedia (resolved with zero OS/Chromium picker UI, see main-side handler)
// -> starts a MediaRecorder -> streams chunks back to main for disk write -> on
// 'capture:stop', finalizes and sends the last chunk + 'capture:finished'.

import type { CaptureBridge, CaptureStartParams } from '@shared/captureIpc.types'

declare global {
  interface Window {
    captureBridge: CaptureBridge
  }
}

// Preferred first: keeps StorageManager's existing MP4 "-c copy" trim path unchanged.
// Falls back to WebM/VP9+Opus if the Chromium build doesn't support MP4 MediaRecorder output.
const MIME_CANDIDATES: Array<{ mimeType: string; ext: 'mp4' | 'webm' }> = [
  { mimeType: 'video/mp4;codecs=avc1.640028,mp4a.40.2', ext: 'mp4' },
  { mimeType: 'video/mp4', ext: 'mp4' },
  { mimeType: 'video/webm;codecs=vp9,opus', ext: 'webm' },
  { mimeType: 'video/webm;codecs=vp8,opus', ext: 'webm' },
  { mimeType: 'video/webm', ext: 'webm' }
]

// Chromium applies voice-call-style processing to captured audio by default
// (echo cancellation, noise suppression, auto gain control) — these are tuned for a
// mic picking up speech, not system-loopback game/music audio, and visibly degrade it
// (pumping, muffling, artifacts). Must be explicitly disabled for loopback capture.
const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false
}

// Opus/AAC default bitrate for MediaRecorder can land surprisingly low (well under
// 96kbps) if left unset, which is audible as muddy/compressed audio.
const AUDIO_BITS_PER_SECOND = 192_000

function pickMimeType(): { mimeType: string; ext: 'mp4' | 'webm' } {
  for (const candidate of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate.mimeType)) return candidate
  }
  // Should be unreachable — every Chromium build supports at least plain webm.
  return { mimeType: '', ext: 'webm' }
}

let activeStream: MediaStream | null = null
let activeRecorder: MediaRecorder | null = null
let sentStarted = false

async function startCapture(params: CaptureStartParams): Promise<void> {
  sentStarted = false
  try {
    // audio:true here triggers session.setDisplayMediaRequestHandler on the main-process
    // side, which supplies { video: <chosen source>, audio: 'loopback' } — this is the
    // whole point of using getDisplayMedia over the older getUserMedia+chromeMediaSourceId
    // pattern: reliable cross-platform system-audio-loopback with no extra plumbing here.
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: params.fps
        // width/height intentionally omitted for window sources — the real window
        // size is what we want, not a forced scale (see plan: resolution is a
        // post-processing hint, not a capture-time guarantee).
      },
      audio: AUDIO_CONSTRAINTS
    } as MediaStreamConstraints)

    activeStream = stream

    const { mimeType, ext } = pickMimeType()
    const recorder = new MediaRecorder(stream, {
      mimeType: mimeType || undefined,
      videoBitsPerSecond: params.bitrateKbps * 1000,
      audioBitsPerSecond: AUDIO_BITS_PER_SECOND
    })
    activeRecorder = recorder

    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data.size === 0) return
      if (!sentStarted) {
        sentStarted = true
        window.captureBridge.sendStarted({ mimeType: recorder.mimeType || mimeType, containerExt: ext })
      }
      void e.data.arrayBuffer().then((buf) => window.captureBridge.sendChunk(buf))
    }

    recorder.onerror = (e: Event) => {
      const err = (e as unknown as { error?: DOMException }).error
      window.captureBridge.sendError({ message: `MediaRecorder error: ${err?.message ?? 'unknown'}` })
    }

    // Fires if the source disappears mid-capture (e.g. WoW window closed).
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      window.captureBridge.sendError({ message: 'Capture source ended unexpectedly (window closed?)' })
    })

    recorder.onstop = () => {
      for (const track of stream.getTracks()) track.stop()
      window.captureBridge.sendFinished()
    }

    recorder.start(1000) // 1s timeslice — see plan: stream chunks, don't buffer the whole match
  } catch (err) {
    window.captureBridge.sendError({
      message: `getDisplayMedia/MediaRecorder failed to start: ${err instanceof Error ? err.message : String(err)}`
    })
  }
}

function stopCapture(): void {
  if (activeRecorder !== null && activeRecorder.state !== 'inactive') {
    activeRecorder.stop() // onstop -> stops tracks, sends 'finished'
  } else if (activeStream !== null) {
    // Recorder never started successfully — still release the OS capture indicator.
    for (const track of activeStream.getTracks()) track.stop()
    window.captureBridge.sendFinished()
  }
  activeRecorder = null
  activeStream = null
}

window.captureBridge.onStart((params) => void startCapture(params))
window.captureBridge.onStop(() => stopCapture())
