// Manages the recording library and post-processing pipeline.
//
// Post-processing flow (triggered by RecorderStateMachine.processingRequired):
//   1. Build output directory name and create it
//   2. Trim raw video to exact arena duration (FFmpeg -c copy)
//   3. Generate thumbnail from the trimmed video
//   4. Write metadata.json
//   5. Delete the raw (untrimmed) file
//
// The trim offset is the wall-clock difference between when recording started
// (on ZONE_CHANGE) and when the match began (ARENA_MATCH_START timestamp).
//
// Library operations:
//   getRecordings()          — scan storage directory, return all Recording[]
//   deleteRecording(id)      — remove a recording directory
//   findOrphanedRecordings() — directories that have recording.mp4 but no metadata.json

import { promises as fs } from 'fs'
import { join } from 'path'
import { spawn } from 'child_process'
import type { Recording, RecordingMetadata, TimelineEvent } from '@shared/ipc.types'
import type { ProcessingRequiredEvent } from '../recorder/RecorderStateMachine'
import { writeMetadata, readMetadata } from './MetadataWriter'

// ---------------------------------------------------------------------------
// FFmpeg runner — injectable for testing
// ---------------------------------------------------------------------------

export type FfmpegRunner = (ffmpegPath: string, args: string[]) => Promise<void>

// Default runner: spawns FFmpeg as a child process.
export const defaultFfmpegRunner: FfmpegRunner = (
  ffmpegPath: string,
  args: string[]
): Promise<void> => {
  return new Promise<void>((resolve, reject) => {
    const stderrLines: string[] = []
    const proc = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] })

    proc.stderr?.on('data', (chunk: Buffer) => {
      stderrLines.push(chunk.toString())
    })

    proc.on('error', (err: Error) => {
      reject(new Error(`FFmpeg spawn error: ${err.message}`))
    })

    proc.on('close', (code: number | null) => {
      if (code === 0 || code === null) {
        resolve()
      } else {
        reject(new Error(`FFmpeg exited with code ${code}.\n${stderrLines.slice(-10).join('\n')}`))
      }
    })
  })
}

// ---------------------------------------------------------------------------
// StorageManager
// ---------------------------------------------------------------------------

export class StorageManager {
  private readonly storagePath: string
  private readonly runner: FfmpegRunner
  // Tracks how many rounds still need to be processed for each raw file path.
  // The raw file is deleted only when all rounds sharing it have been processed.
  private readonly rawProcessingCounts = new Map<string, number>()

  constructor(storagePath: string, runner: FfmpegRunner = defaultFfmpegRunner) {
    this.storagePath = storagePath
    this.runner = runner
  }

  // -------------------------------------------------------------------------
  // Post-processing
  // -------------------------------------------------------------------------

  // Trims, thumbnails, and stores a completed arena recording.
  // Called by subscribing to RecorderStateMachine.processingRequired.
  // timeline is empty in Stage 5 and populated in Stage 8.
  async processRecording(
    event: ProcessingRequiredEvent,
    ffmpegPath: string,
    timeline: TimelineEvent[] = []
  ): Promise<Recording> {
    const dirName = buildDirName(event)
    const dirPath = join(this.storagePath, dirName)
    const videoPath = join(dirPath, 'recording.mp4')
    const thumbnailPath = join(dirPath, 'thumbnail.jpg')

    await fs.mkdir(dirPath, { recursive: true })

    const offsetSecs = Math.max(
      0,
      (event.matchStartedAt.getTime() - event.recordingStartedAt.getTime()) / 1000
    )

    await trimVideo(
      this.runner,
      ffmpegPath,
      event.rawPath,
      videoPath,
      offsetSecs,
      event.durationSecs
    )
    await generateThumbnail(this.runner, ffmpegPath, videoPath, thumbnailPath)

    const metadata = buildMetadata(event, timeline)
    await writeMetadata(dirPath, metadata)

    // For multi-round sessions (solo shuffle), all rounds share the same raw file.
    // Delete it only after the last round has been processed.
    const totalRounds = event.totalRoundsInSession ?? 1
    if (totalRounds > 1) {
      const remaining = (this.rawProcessingCounts.get(event.rawPath) ?? totalRounds) - 1
      if (remaining <= 0) {
        this.rawProcessingCounts.delete(event.rawPath)
        await fs.unlink(event.rawPath)
      } else {
        this.rawProcessingCounts.set(event.rawPath, remaining)
      }
    } else {
      await fs.unlink(event.rawPath)
    }

    return {
      id: dirName,
      path: dirPath,
      videoPath,
      thumbnailPath,
      metadata
    }
  }

  // -------------------------------------------------------------------------
  // Library
  // -------------------------------------------------------------------------

  // Returns all valid recordings sorted by date descending (newest first).
  // Directories without a parseable metadata.json are skipped silently
  // (they are surfaced separately via findOrphanedRecordings).
  async getRecordings(): Promise<Recording[]> {
    const entries = await safeReaddir(this.storagePath)
    const recordings: Recording[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const dirPath = join(this.storagePath, entry.name)
      const metadata = await readMetadata(dirPath)
      if (metadata === null) continue

      recordings.push({
        id: entry.name,
        path: dirPath,
        videoPath: join(dirPath, 'recording.mp4'),
        thumbnailPath: join(dirPath, 'thumbnail.jpg'),
        metadata
      })
    }

    recordings.sort((a, b) => b.metadata.date.localeCompare(a.metadata.date))
    return recordings
  }

  // Deletes a recording directory by id.
  // Rejects if the id looks like a path traversal attempt.
  async deleteRecording(id: string): Promise<void> {
    if (id.includes('/') || id.includes('\\') || id === '..' || id === '.') {
      throw new Error(`Invalid recording id: ${id}`)
    }
    const dirPath = join(this.storagePath, id)
    await fs.rm(dirPath, { recursive: true, force: true })
  }

  // Returns paths of directories that contain recording.mp4 but no metadata.json.
  // These are incomplete recordings left by a crash during post-processing.
  async findOrphanedRecordings(): Promise<string[]> {
    const entries = await safeReaddir(this.storagePath)
    const orphaned: string[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const dirPath = join(this.storagePath, entry.name)
      const [hasVideo, hasMetadata] = await Promise.all([
        fileExists(join(dirPath, 'recording.mp4')),
        fileExists(join(dirPath, 'metadata.json'))
      ])

      if (hasVideo && !hasMetadata) {
        orphaned.push(dirPath)
      }
    }

    return orphaned
  }
}

// ---------------------------------------------------------------------------
// FFmpeg wrappers
// ---------------------------------------------------------------------------

// Trims the raw recording to the exact match duration using stream copy.
// -ss before -i enables fast input seek; ≤1 second inaccuracy is acceptable
// because the source was recorded with -g fps (keyframe every second).
function trimVideo(
  runner: FfmpegRunner,
  ffmpegPath: string,
  inputPath: string,
  outputPath: string,
  offsetSecs: number,
  durationSecs: number
): Promise<void> {
  return runner(ffmpegPath, [
    '-ss',
    offsetSecs.toFixed(3),
    '-i',
    inputPath,
    '-t',
    String(durationSecs),
    '-c',
    'copy',
    '-y',
    outputPath
  ])
}

// Extracts a single frame at 5 seconds as the recording thumbnail.
function generateThumbnail(
  runner: FfmpegRunner,
  ffmpegPath: string,
  videoPath: string,
  thumbnailPath: string
): Promise<void> {
  return runner(ffmpegPath, ['-ss', '5', '-i', videoPath, '-vframes', '1', '-y', thumbnailPath])
}

// ---------------------------------------------------------------------------
// Metadata builder
// ---------------------------------------------------------------------------

// Builds RecordingMetadata from a processing event.
// playerName/playerClass/playerSpec/teamComp/enemyComp are not yet available
// from the combat log in Stage 5 — they will be populated in a later stage.
// rating is not yet tracked here; it will be added when ARENA_MATCH_STATS
// parsing is extended to feed data into processRecording.
export function buildDirName(event: ProcessingRequiredEvent): string {
  const date = formatDate(event.matchStartedAt)
  const zone = event.zoneName.replace(/[^a-zA-Z0-9]/g, '')

  let bracketPart: string
  if (event.bracket === 'solo-shuffle') {
    bracketPart = `SoloShuffle_R${event.roundNumber ?? 1}`
  } else {
    bracketPart = event.bracket
  }

  return `${date}_${zone}_${bracketPart}_${event.result}`
}

export function buildMetadata(
  event: ProcessingRequiredEvent,
  timeline: TimelineEvent[]
): RecordingMetadata {
  const metadata: RecordingMetadata = {
    date: event.matchStartedAt.toISOString(),
    zone: event.zoneName,
    bracket: event.bracket,
    result: event.result,
    duration: event.durationSecs,
    playerName: '',
    playerClass: '',
    playerSpec: '',
    teamComp: [],
    enemyComp: [],
    knownSpecs: event.knownSpecs,
    healerNames: event.healerNames,
    rating:
      event.ratingBefore !== undefined && event.ratingAfter !== undefined
        ? { before: event.ratingBefore, after: event.ratingAfter }
        : null,
    events: timeline,
    playerRatings: Object.keys(event.playerRatings).length > 0 ? event.playerRatings : undefined,
    teamDmgBySecond: event.teamDmgBySecond.length > 0 ? event.teamDmgBySecond : undefined,
    enemyDmgBySecond: event.enemyDmgBySecond.length > 0 ? event.enemyDmgBySecond : undefined,
    teamHealBySecond: event.teamHealBySecond.length > 0 ? event.teamHealBySecond : undefined,
    enemyHealBySecond: event.enemyHealBySecond.length > 0 ? event.enemyHealBySecond : undefined
  }

  if (event.bracket === 'solo-shuffle') {
    metadata.round = event.roundNumber
    metadata.sessionId = event.sessionId
  }

  return metadata
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

// Reads a directory, returning an empty array if the directory does not exist.
async function safeReaddir(dirPath: string): Promise<import('fs').Dirent[]> {
  try {
    return await fs.readdir(dirPath, { withFileTypes: true })
  } catch {
    return []
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

function formatDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
