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

// WebM/Opus first, MP4/H.264+AAC as fallback — the reverse of this list's original
// order. Confirmed via [capture-renderer] diagnostics on a real machine: the captured
// MediaStream had a healthy, live "System audio" track (loopback, 48kHz, unmuted) in
// every attempt, `MediaRecorder.isTypeSupported()` reported every H.264+AAC candidate as
// `true`, video frames were recorded successfully (once a codec/level actually produced
// data) — yet the resulting .mp4 file had ZERO audio streams every single time
// (ffprobe-verified across 3 separate recordings). Chromium's MP4 muxer support for
// MediaRecorder depends on the platform offering an OS-level AAC encoder, and
// `isTypeSupported()` does not confirm that encoder is actually available/working at
// record time — same class of "silently lies" bug as the H.264 level issue below, just
// for audio instead of video. WebM's Opus muxing is Chromium's own mature,
// platform-independent software path with no equivalent OS-encoder dependency, so it's
// now tried first; MP4 (video-only in practice on affected machines, but StorageManager
// handles either extension) is kept as a fallback for builds where WebM genuinely isn't
// supported.
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
// Every candidate below explicitly pins an audio codec (mp4a.40.2 / opus) alongside the
// video codec — a bare 'video/mp4'/'video/webm' candidate (no codecs= at all) leaves
// Chromium's audio codec negotiation unconfirmed, which is worse, not better.
// VP8 before VP9: VP9 is a much heavier software encode, and at high resolution/fps
// (e.g. 2560x1440@60) it can take longer than NO_DATA_WATCHDOG_MS to produce its first
// chunk — confirmed on a real machine where vp9,opus timed out every time at 1440p60
// while vp8,opus succeeded immediately after. Leading with the candidate least likely to
// need a retry at all matters more here than VP9's better compression, especially since
// every retry now costs a full getDisplayMedia() round-trip (see attempt() below).
const MIME_CANDIDATES: Array<{ mimeType: string; ext: 'mp4' | 'webm' }> = [
  { mimeType: 'video/webm;codecs=vp8,opus', ext: 'webm' },
  { mimeType: 'video/webm;codecs=vp9,opus', ext: 'webm' },
  { mimeType: 'video/mp4;codecs=avc1.640034,mp4a.40.2', ext: 'mp4' }, // Level 5.2 — 4K@60/1440p@144
  { mimeType: 'video/mp4;codecs=avc1.4d0033,mp4a.40.2', ext: 'mp4' }, // Level 5.1 — Main profile, wider driver support
  { mimeType: 'video/mp4;codecs=avc1.64002a,mp4a.40.2', ext: 'mp4' }, // Level 4.2 — covers up to 1440p@60
  { mimeType: 'video/mp4;codecs=avc1.640028,mp4a.40.2', ext: 'mp4' } // Level 4.0 — 1080p-class, broadest support
]

// Opus/AAC default bitrate for MediaRecorder can land surprisingly low (well under
// 96kbps) if left unset, which is audible as muddy/compressed audio.
const AUDIO_BITS_PER_SECOND = 192_000

function supportedMimeCandidates(): Array<{ mimeType: string; ext: 'mp4' | 'webm' }> {
  const supported = MIME_CANDIDATES.filter((c) => MediaRecorder.isTypeSupported(c.mimeType))
  console.warn(
    `[capture] mimeType support: ${MIME_CANDIDATES.map((c) => `${c.mimeType || '(empty)'}=${MediaRecorder.isTypeSupported(c.mimeType)}`).join(', ')}`
  )
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

async function acquireStream(params: CaptureStartParams): Promise<MediaStream> {
  // audio:true here triggers session.setDisplayMediaRequestHandler on the main-process
  // side, which supplies { video: <chosen source>, audio: 'loopback' } — this is the
  // whole point of using getDisplayMedia over the older getUserMedia+chromeMediaSourceId
  // pattern: reliable cross-platform system-audio-loopback with no extra plumbing here.
  //
  // audio MUST be the plain boolean `true`, not a constraints object. Timeline of a real
  // regression: audio worked (poor quality) → constraints { echoCancellation: false,
  // noiseSuppression: false, autoGainControl: false } were added to improve quality →
  // audio vanished completely (the loopback track stayed readyState=live but delivered
  // zero samples, which also stalls MediaRecorder's muxer into producing no chunks at
  // all — video included). Requesting unprocessed audio evidently routes macOS loopback
  // capture onto a path that never produces data on some systems. Quality is instead
  // addressed via audioBitsPerSecond on the MediaRecorder, which is safe.
  return navigator.mediaDevices.getDisplayMedia({
    video: {
      frameRate: params.fps
      // width/height intentionally omitted for window sources — the real window
      // size is what we want, not a forced scale (see plan: resolution is a
      // post-processing hint, not a capture-time guarantee).
    },
    audio: true
  })
}

function logStreamDiagnostics(sourceId: string, stream: MediaStream): void {
  const videoTrack = stream.getVideoTracks()[0]
  const audioTracks = stream.getAudioTracks()
  console.warn(`[capture] getDisplayMedia resolved for "${sourceId}": ${describeTrack(videoTrack)}`)
  if (audioTracks.length === 0) {
    // System-audio loopback ('audio: loopback' in the main-process display-media
    // handler) can silently come back with zero audio tracks — most commonly on
    // macOS when the OS's audio-capture permission isn't granted (on macOS 14+ this
    // is a distinct "Screen & System Audio Recording" permission, not covered by the
    // older plain "Screen Recording" grant) or on macOS < 13, which doesn't support
    // system-audio capture via ScreenCaptureKit at all. Doesn't block the recording
    // (video-only is still useful) but is worth flagging clearly.
    console.warn(
      '[capture] No audio track in the captured stream — recording will have no audio. ' +
        'On macOS, check System Settings → Privacy & Security → Screen Recording (or ' +
        '"Screen & System Audio Recording" on macOS 14+) — this permission may need to be ' +
        'removed and re-granted the same way as after an app update. Requires macOS 13+.'
    )
  } else {
    // NOTE: a present track is not proof of actual sound — pre-ScreenCaptureKit builds
    // of Electron's macOS loopback have been known to hand back a live audio track whose
    // buffer is pure silence. main/index.ts enables the
    // MacLoopbackAudioForScreenShare/MacSckSystemAudioLoopbackOverride Chromium features
    // to force the real ScreenCaptureKit-backed path instead of that silent fallback.
    console.warn(`[capture] Audio track: ${describeTrack(audioTracks[0])}`)
  }
}

async function startCapture(params: CaptureStartParams): Promise<void> {
  sentStarted = false
  const candidates = supportedMimeCandidates()

  // Attempt plan: the top two codec candidates with audio, then every candidate
  // video-only. A loopback audio track that delivers no samples stalls MediaRecorder's
  // muxer into producing nothing AT ALL (video included) — and that audio stall, not a
  // codec problem, is the observed no-data failure mode on real machines. So after two
  // audio-included strikes, drop audio rather than burning 8s per remaining codec on a
  // stall that will never resolve: a machine with broken loopback still gets a
  // video-only recording instead of a hard "capture did not start" failure, and the
  // whole plan stays comfortably inside the main process's 30s startup timeout.
  const plan: Array<{ mimeType: string; ext: 'mp4' | 'webm'; withAudio: boolean }> = [
    ...candidates.slice(0, 2).map((c) => ({ ...c, withAudio: true })),
    ...candidates.map((c) => ({ ...c, withAudio: false }))
  ]

  // Each attempt acquires its OWN fresh getDisplayMedia() stream rather than reusing one
  // MediaStream/tracks across MediaRecorder retries — a MediaRecorder that stalled on a
  // track leaves that track's delivery state poisoned for the next recorder (observed:
  // reused-stream retries recorded video but never audio).
  const attempt = async (planIndex: number): Promise<void> => {
    const { mimeType, ext, withAudio } = plan[planIndex]!

    let stream: MediaStream
    try {
      stream = await acquireStream(params)
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
    logStreamDiagnostics(params.sourceId, stream)

    // Fires if the source disappears mid-capture (e.g. WoW window closed).
    videoTrack?.addEventListener('ended', () => {
      window.captureBridge.sendError({ message: 'Capture source ended unexpectedly (window closed?)' })
    })

    if (!withAudio) {
      console.warn(`[capture] Attempting video-only with "${mimeType}" — audio-included attempts all produced no data`)
      for (const track of stream.getAudioTracks()) {
        track.stop()
        stream.removeTrack(track)
      }
    }

    const releaseStream = (): void => {
      for (const track of stream.getTracks()) track.stop()
    }

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
        releaseStream()
        window.captureBridge.sendFinished()
      }

      recorder.start(1000) // 1s timeslice — see plan: stream chunks, don't buffer the whole match

      noDataWatchdog = setTimeout(() => {
        if (sentStarted) return
        const nextIndex = planIndex + 1
        // Snapshot BEFORE tearing down — releaseStream() flips the track to "ended",
        // which previously made these logs claim the source died when we killed it.
        const trackStateAtTimeout = describeTrack(videoTrack)
        abandonRecorder(recorder)
        releaseStream()
        if (nextIndex < plan.length) {
          console.warn(
            `[capture] No data from mimeType="${mimeType}"${withAudio ? '' : ' (video-only)'} after ${NO_DATA_WATCHDOG_MS / 1000}s ` +
              `(track: ${trackStateAtTimeout}) — retrying with a fresh stream using "${plan[nextIndex]!.mimeType}"${plan[nextIndex]!.withAudio ? '' : ' (video-only)'}`
          )
          void attempt(nextIndex)
          return
        }
        window.captureBridge.sendError({
          message:
            `No video data received from any supported encoder after trying ${plan.length} ` +
            `codec/audio combination(s) (last: "${mimeType}", video-only) for source "${params.sourceId}". ` +
            `Track: ${trackStateAtTimeout}. This usually means the captured window is ` +
            'minimized, fully hidden behind another window, or on a display that went to sleep — ' +
            'bring WoW to the foreground and try again.'
        })
      }, NO_DATA_WATCHDOG_MS)
    } catch (err) {
      const nextIndex = planIndex + 1
      releaseStream()
      if (nextIndex < plan.length) {
        console.warn(`[capture] MediaRecorder failed to start with mimeType="${mimeType}" — retrying with a fresh stream`)
        void attempt(nextIndex)
        return
      }
      window.captureBridge.sendError({
        message: `MediaRecorder failed to start (last tried "${mimeType}"): ${err instanceof Error ? err.message : String(err)}`
      })
    }
  }

  void attempt(0)
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
