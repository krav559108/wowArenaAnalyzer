import { ipcMain, app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import type Store from 'electron-store'
import type { AppConfig, MatchAnalysis } from '@shared/ipc.types'
import { LogFileAnalyzer } from '../combatlog/LogFileAnalyzer'
import { readAddonCharacterInfo } from '../addon/SavedVarsReader'

const analyzer = new LogFileAnalyzer()

const CACHE_FILE = join(app.getPath('userData'), 'log-analysis-cache.json')

interface CacheData {
  filePath: string
  matches: MatchAnalysis[]
}

async function saveCache(data: CacheData): Promise<void> {
  await fs.writeFile(CACHE_FILE, JSON.stringify(data), 'utf8')
}

async function loadCache(): Promise<CacheData | null> {
  try {
    const text = await fs.readFile(CACHE_FILE, 'utf8')
    return JSON.parse(text) as CacheData
  } catch {
    return null
  }
}

export function registerLogAnalysisIpc(configStore: Store<AppConfig>): void {
  ipcMain.handle('logAnalysis:parseFile', async (_event, { filePath }: { filePath: string }) => {
    const wowPath = configStore.get('wowPath')
    const charInfo = readAddonCharacterInfo(wowPath)
    const matches = analyzer.analyze(filePath, charInfo?.guid ?? undefined)
    await saveCache({ filePath, matches })
    return matches
  })

  ipcMain.handle('logAnalysis:getCache', async () => {
    return loadCache()
  })
}
