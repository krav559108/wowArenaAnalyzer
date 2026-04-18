// IPC handlers for app configuration (electron-store).
//
// Commands (ipcMain.handle):
//   config:get    — returns the value for a single config key
//   config:set    — sets a single config key
//   config:getAll — returns the full AppConfig object

import { ipcMain } from 'electron'
import type Store from 'electron-store'
import type { AppConfig } from '@shared/ipc.types'

export function registerConfigIpc(configStore: Store<AppConfig>): void {
  ipcMain.handle('config:get', (_event, { key }: { key: string }) => {
    return configStore.get(key as keyof AppConfig)
  })

  ipcMain.handle('config:set', (_event, { key, value }: { key: string; value: unknown }) => {
    configStore.set(key as keyof AppConfig, value as AppConfig[keyof AppConfig])
  })

  ipcMain.handle('config:getAll', () => {
    return configStore.store
  })
}
