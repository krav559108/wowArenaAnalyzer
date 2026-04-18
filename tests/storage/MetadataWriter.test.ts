import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { writeMetadata, readMetadata } from '../../src/main/storage/MetadataWriter'
import type { RecordingMetadata } from '../../src/shared/ipc.types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SAMPLE_METADATA: RecordingMetadata = {
  date: '2026-04-15T20:00:15.000Z',
  zone: 'Nagrand Arena',
  bracket: '2v2',
  result: 'WIN',
  duration: 187,
  playerName: '',
  playerClass: '',
  playerSpec: '',
  teamComp: [],
  enemyComp: [],
  rating: null,
  events: []
}

const SOLO_SHUFFLE_METADATA: RecordingMetadata = {
  ...SAMPLE_METADATA,
  bracket: 'solo-shuffle',
  round: 3,
  sessionId: '2026-04-15T20:00:00.000Z',
  rating: null
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(join(tmpdir(), 'wow-recorder-test-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('writeMetadata / readMetadata', () => {
  it('round-trips a 2v2 metadata object', async () => {
    await writeMetadata(tmpDir, SAMPLE_METADATA)
    const result = await readMetadata(tmpDir)

    expect(result).toEqual(SAMPLE_METADATA)
  })

  it('round-trips Solo Shuffle metadata with round and sessionId', async () => {
    await writeMetadata(tmpDir, SOLO_SHUFFLE_METADATA)
    const result = await readMetadata(tmpDir)

    expect(result).toEqual(SOLO_SHUFFLE_METADATA)
    expect(result?.round).toBe(3)
    expect(result?.sessionId).toBe('2026-04-15T20:00:00.000Z')
  })

  it('writes valid JSON to metadata.json', async () => {
    await writeMetadata(tmpDir, SAMPLE_METADATA)
    const raw = await fs.readFile(join(tmpDir, 'metadata.json'), 'utf8')
    expect(() => JSON.parse(raw)).not.toThrow()
    const parsed = JSON.parse(raw) as RecordingMetadata
    expect(parsed.zone).toBe('Nagrand Arena')
  })

  it('returns null when metadata.json does not exist', async () => {
    const result = await readMetadata(tmpDir)
    expect(result).toBeNull()
  })

  it('returns null when metadata.json contains invalid JSON', async () => {
    await fs.writeFile(join(tmpDir, 'metadata.json'), '{ invalid json }', 'utf8')
    const result = await readMetadata(tmpDir)
    expect(result).toBeNull()
  })
})
