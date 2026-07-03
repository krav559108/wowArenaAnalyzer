// Minimal preload for the hidden capture window — deliberately exposes only the
// capture-control surface (not the full app IpcCommands/IpcEvents bridge), per the
// principle of least privilege: this window's sole job is getDisplayMedia + MediaRecorder.

import { contextBridge, ipcRenderer } from 'electron'
import {
  CAPTURE_START,
  CAPTURE_STOP,
  CAPTURE_STARTED,
  CAPTURE_CHUNK,
  CAPTURE_FINISHED,
  CAPTURE_ERROR,
  type CaptureBridge,
  type CaptureStartParams
} from '@shared/captureIpc.types'

const bridge: CaptureBridge = {
  onStart(cb) {
    ipcRenderer.on(CAPTURE_START, (_event, params: CaptureStartParams) => cb(params))
  },
  onStop(cb) {
    ipcRenderer.on(CAPTURE_STOP, () => cb())
  },
  sendStarted(payload) {
    ipcRenderer.send(CAPTURE_STARTED, payload)
  },
  sendChunk(buf) {
    // Transferred, not copied, over structured clone — avoid an extra memory copy.
    ipcRenderer.send(CAPTURE_CHUNK, buf)
  },
  sendFinished() {
    ipcRenderer.send(CAPTURE_FINISHED)
  },
  sendError(payload) {
    ipcRenderer.send(CAPTURE_ERROR, payload)
  }
}

contextBridge.exposeInMainWorld('captureBridge', bridge)
