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
//
// The H.264 level in "avc1.<profile><constraints><level>" is NOT just a hint — it's a hard
// cap on max frame size (macroblocks) and macroblocks/sec that MediaRecorder.isTypeSupported()
// does not validate against the actual capture resolution/fps (it only checks the codec
// string is understood in the abstract, with no stream context). Level 4.0 (0x28) caps out
// at 8192 MBs/frame (~1920x1088) — a 2560x1440 capture is already 14,400 MBs/frame, over that
// limit before frame rate is even considered. The encoder then silently never produces a
// single frame instead of throwing, which read as "track is live but zero data ever arrives"
// (see the capture-diagnostics watchdog below). Level 5.2 (0x34) covers up to ~4096x2304 and
// comfortably fits 4K@60fps / 1440p@144fps — high enough for any realistic capture target here.
const MIME_CANDIDATES: Array<{ mimeType: string; ext: 'mp4' | 'webm' }> = [
  { mimeType: 'video/mp4;codecs=avc1.640034,mp4a.40.2', ext: 'mp4' },
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

function supportedMimeCandidates(): Array<{ mimeType: string; ext: 'mp4' | 'webm' }> {
  const supported = MIME_CANDIDATES.filter((c) => MediaRecorder.isTypeSupported(c.mimeType))
  // Should be unreachable — every Chromium build supports at least plain webm.
  return supported.length > 0 ? supported : [{ mimeType: '', ext: 'webm' }]
}

let activeStream: MediaStream | null = null
let activeRecorder: MediaRecorder | null = null
let sentStarted = false
let noDataWatchdog: ReturnType<typeof setTimeout> | null = null

// If getDisplayMedia resolves and MediaRecorder.start() succeeds but the video track
// never actually produces a frame, nothing ever throws — the encoder can silently fail
// to initialize for a codec/resolution/fps combination that MediaRecorder.isTypeSupported()
// reported as fine (that check has no knowledge of the actual stream's resolution/fps).
// This watchdog gives up early per candidate and tries the next MIME candidate before
// giving up entirely, instead of sitting on a single doomed codec for the full ~30s
// blanket startup timeout with no context.
const NO_DATA_WATCHDOG_MS = 8_000

function describeTrack(track: MediaStreamTrack | undefined): string {
  if (track === undefined) return 'no video track'
  const settings = track.getSettings()
  return (
    `readyState=${track.readyState} muted=${track.muted} enabled=${track.enabled} ` +
    `label="${track.label}" settings=${JSON.stringify(settings)}`
  )
}

// Detaches a doomed-candidate MediaRecorder's handlers before abandoning it, so its
// stop() (needed to release internal encoder resources) doesn't send a spurious
// 'finished'/chunk event for a recording that never actually started.
function abandonRecorder(recorder: MediaRecorder): void {
  recorder.ondataavailable = null
  recorder.onerror = null
  recorder.onstop = null
  if (recorder.state !== 'inactive') recorder.stop()
}

async function startCapture(params: CaptureStartParams): Promise<void> {
  sentStarted = false
  let stream: MediaStream
  try {
    // audio:true here triggers session.setDisplayMediaRequestHandler on the main-process
    // side, which supplies { video: <chosen source>, audio: 'loopback' } — this is the
    // whole point of using getDisplayMedia over the older getUserMedia+chromeMediaSourceId
    // pattern: reliable cross-platform system-audio-loopback with no extra plumbing here.
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: params.fps
        // width/height intentionally omitted for window sources — the real window
        // size is what we want, not a forced scale (see plan: resolution is a
        // post-processing hint, not a capture-time guarantee).
      },
      audio: AUDIO_CONSTRAINTS
    } as MediaStreamConstraints)
  } catch (err) {
    window.captureBridge.sendError({
      message:
        `getDisplayMedia failed for source "${params.sourceId}": ` +
        `${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`
    })
    return
  }

  activeStream = stream
  const videoTrack = stream.getVideoTracks()[0]
  console.warn(`[capture] getDisplayMedia resolved for "${params.sourceId}": ${describeTrack(videoTrack)}`)

  const candidates = supportedMimeCandidates()

  const attempt = (candidateIndex: number): void => {
    const { mimeType, ext } = candidates[candidateIndex]!

    try {
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
          if (noDataWatchdog !== null) {
            clearTimeout(noDataWatchdog)
            noDataWatchdog = null
          }
          window.captureBridge.sendStarted({ mimeType: recorder.mimeType || mimeType, containerExt: ext })
        }
        void e.data.arrayBuffer().then((buf) => window.captureBridge.sendChunk(buf))
      }

      recorder.onerror = (e: Event) => {
        const err = (e as unknown as { error?: DOMException }).error
        window.captureBridge.sendError({ message: `MediaRecorder error: ${err?.message ?? 'unknown'}` })
      }

      recorder.onstop = () => {
        for (const track of stream.getTracks()) track.stop()
        window.captureBridge.sendFinished()
      }

      recorder.start(1000) // 1s timeslice — see plan: stream chunks, don't buffer the whole match

      noDataWatchdog = setTimeout(() => {
        if (sentStarted) return
        const nextIndex = candidateIndex + 1
        if (nextIndex < candidates.length) {
          console.warn(
            `[capture] No data from mimeType="${mimeType}" after ${NO_DATA_WATCHDOG_MS / 1000}s ` +
              `(track: ${describeTrack(videoTrack)}) — retrying with "${candidates[nextIndex]!.mimeType}"`
          )
          abandonRecorder(recorder)
          attempt(nextIndex)
          return
        }
        window.captureBridge.sendError({
          message:
            `No video data received from any supported encoder after trying ${candidates.length} ` +
            `codec candidate(s) (last: "${mimeType}") for source "${params.sourceId}". ` +
            `Track: ${describeTrack(videoTrack)}. This usually means the captured window is ` +
            'minimized, fully hidden behind another window, or on a display that went to sleep — ' +
            'bring WoW to the foreground and try again.'
        })
      }, NO_DATA_WATCHDOG_MS)
    } catch (err) {
      const nextIndex = candidateIndex + 1
      if (nextIndex < candidates.length) {
        console.warn(`[capture] MediaRecorder failed to start with mimeType="${mimeType}" — retrying next candidate`)
        attempt(nextIndex)
        return
      }
      window.captureBridge.sendError({
        message: `MediaRecorder failed to start (last tried "${mimeType}"): ${err instanceof Error ? err.message : String(err)}`
      })
    }
  }

  // Fires if the source disappears mid-capture (e.g. WoW window closed) — applies across
  // candidate retries since the underlying stream/track is reused, not recreated.
  videoTrack?.addEventListener('ended', () => {
    window.captureBridge.sendError({ message: 'Capture source ended unexpectedly (window closed?)' })
  })

  attempt(0)
}

function stopCapture(): void {
  if (noDataWatchdog !== null) {
    clearTimeout(noDataWatchdog)
    noDataWatchdog = null
  }
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
