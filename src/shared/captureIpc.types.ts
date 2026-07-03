// Private IPC protocol between WindowCaptureRecorder (main) and its hidden capture
// window (renderer). Deliberately separate from IpcCommands/IpcEvents in ipc.types.ts —
// the hidden window gets a minimal preload (src/preload/capture.ts) exposing only this
// surface, not the full app-wide typed bridge.

export interface CaptureStartParams {
  sourceId: string
  bitrateKbps: number
  fps: number
  resolution?: string // "1920x1080" — hint only, capture backend may not honor exactly
}

export interface CaptureStartedPayload {
  mimeType: string
  containerExt: 'mp4' | 'webm'
}

export interface CaptureErrorPayload {
  message: string
}

// main -> hidden window
export const CAPTURE_START = 'capture:start'
export const CAPTURE_STOP = 'capture:stop'

// hidden window -> main
export const CAPTURE_STARTED = 'capture:started'
export const CAPTURE_CHUNK = 'capture:chunk'
export const CAPTURE_FINISHED = 'capture:finished'
export const CAPTURE_ERROR = 'capture:error'

export interface CaptureBridge {
  onStart(cb: (params: CaptureStartParams) => void): void
  onStop(cb: () => void): void
  sendStarted(payload: CaptureStartedPayload): void
  sendChunk(buf: ArrayBuffer): void
  sendFinished(): void
  sendError(payload: CaptureErrorPayload): void
}
