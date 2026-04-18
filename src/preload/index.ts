import { contextBridge, ipcRenderer } from 'electron'
import type { ElectronAPI, IpcEvents } from '@shared/ipc.types'

const api: ElectronAPI = {
  invoke(channel, params) {
    return ipcRenderer.invoke(channel, params)
  },

  on(channel, listener) {
    const handler = (_event: Electron.IpcRendererEvent, payload: IpcEvents[typeof channel]) => {
      listener(payload)
    }
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.removeListener(channel, handler)
    }
  }
}

contextBridge.exposeInMainWorld('electron', api)

// Extend the window type in renderer — declared in src/renderer/src/env.d.ts
