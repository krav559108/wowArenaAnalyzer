import { describe, it, expect } from 'vitest'
import { computePvpStats } from '../../src/renderer/src/composables/usePvpStats'
import type { Recording, RecordingMetadata } from '../../src/shared/ipc.types'

let seq = 0

function makeRecording(overrides: Partial<RecordingMetadata>): Recording {
  seq++
  const metadata: RecordingMetadata = {
    date: '2026-01-01T00:00:00.000Z',
    zone: 'Nagrand Arena',
    bracket: '2v2',
    result: 'WIN',
    duration: 120,
    playerName: 'Me-Realm',
    playerClass: 'Mage',
    playerSpec: 'Frost',
    teamComp: ['Me-Realm'],
    enemyComp: [],
    knownSpecs: {},
    healerNames: [],
    rating: null,
    events: [],
    ...overrides
  }
  return {
    id: `rec-${seq}`,
    path: `/tmp/rec-${seq}`,
    videoPath: `/tmp/rec-${seq}/video.mp4`,
    thumbnailPath: `/tmp/rec-${seq}/thumb.jpg`,
    metadata
  }
}

describe('computePvpStats', () => {
  it('computes overall and per-bracket win rate', () => {
    const recordings = [
      makeRecording({ bracket: '2v2', result: 'WIN' }),
      makeRecording({ bracket: '2v2', result: 'LOSS' }),
      makeRecording({ bracket: '3v3', result: 'WIN' })
    ]
    const stats = computePvpStats(recordings)
    expect(stats.totalGames).toBe(3)
    expect(stats.overall).toEqual({ games: 3, wins: 2, winRatePct: (2 / 3) * 100 })

    const byBracket = Object.fromEntries(stats.byBracket.map((r) => [r.bracket, r]))
    expect(byBracket['2v2']).toEqual({ bracket: '2v2', games: 2, wins: 1, winRatePct: 50 })
    expect(byBracket['3v3']).toEqual({ bracket: '3v3', games: 1, wins: 1, winRatePct: 100 })
  })

  it('groups games by class/spec played', () => {
    const recordings = [
      makeRecording({ playerClass: 'Mage', playerSpec: 'Frost', result: 'WIN' }),
      makeRecording({ playerClass: 'Mage', playerSpec: 'Frost', result: 'LOSS' }),
      makeRecording({ playerClass: 'Rogue', playerSpec: 'Subtlety', result: 'WIN' })
    ]
    const stats = computePvpStats(recordings)
    const mage = stats.byClassSpec.find((r) => r.className === 'Mage')!
    expect(mage.games).toBe(2)
    expect(mage.winRatePct).toBe(50)
    const rogue = stats.byClassSpec.find((r) => r.className === 'Rogue')!
    expect(rogue.games).toBe(1)
  })

  it('builds a chronological rating trend from matches with a rating', () => {
    const recordings = [
      makeRecording({ date: '2026-01-03T00:00:00.000Z', rating: { before: 1500, after: 1516 } }),
      makeRecording({ date: '2026-01-01T00:00:00.000Z', rating: { before: 1480, after: 1500 } }),
      makeRecording({ date: '2026-01-02T00:00:00.000Z', rating: null })
    ]
    const stats = computePvpStats(recordings)
    expect(stats.ratingTrend.map((p) => p.rating)).toEqual([1500, 1516])
  })

  it('credits one matchup result per distinct enemy spec faced, not per enemy player', () => {
    const recordings = [
      makeRecording({
        result: 'WIN',
        enemyComp: ['E1-Realm', 'E2-Realm'],
        knownSpecs: { 'E1-Realm': 'Holy', 'E2-Realm': 'Holy' }
      }),
      makeRecording({
        result: 'LOSS',
        enemyComp: ['E1-Realm', 'E2-Realm'],
        knownSpecs: { 'E1-Realm': 'Holy', 'E2-Realm': 'Discipline' }
      }),
      makeRecording({
        result: 'WIN',
        enemyComp: ['E1-Realm'],
        knownSpecs: { 'E1-Realm': 'Holy' }
      })
    ]
    const stats = computePvpStats(recordings)
    // 'Holy' appears in all 3 matches (deduped within match 1) — 2 wins, 1 loss
    const allMatchups = [...stats.bestMatchups, ...stats.worstMatchups]
    const holy = allMatchups.find((r) => r.enemySpec === 'Holy')
    expect(holy?.games).toBe(3)
    expect(holy?.wins).toBe(2)
  })

  it('excludes matchups below the minimum sample size from best/worst lists', () => {
    const recordings = [
      makeRecording({ result: 'WIN', enemyComp: ['E-Realm'], knownSpecs: { 'E-Realm': 'Arcane' } }),
      makeRecording({ result: 'WIN', enemyComp: ['E-Realm'], knownSpecs: { 'E-Realm': 'Arcane' } })
    ]
    const stats = computePvpStats(recordings)
    expect(stats.bestMatchups).toHaveLength(0)
    expect(stats.worstMatchups).toHaveLength(0)
  })

  it('groups Solo Shuffle rounds into sessions and marks positive/negative by round record', () => {
    const recordings = [
      // Session A: 4 wins, 2 losses — positive
      ...['WIN', 'WIN', 'WIN', 'WIN', 'LOSS', 'LOSS'].map((result, i) =>
        makeRecording({
          bracket: 'solo-shuffle',
          sessionId: 'session-a',
          round: i + 1,
          date: `2026-01-01T00:0${i}:00.000Z`,
          result: result as 'WIN' | 'LOSS'
        })
      ),
      // Session B: 2 wins, 4 losses — negative
      ...['WIN', 'WIN', 'LOSS', 'LOSS', 'LOSS', 'LOSS'].map((result, i) =>
        makeRecording({
          bracket: 'solo-shuffle',
          sessionId: 'session-b',
          round: i + 1,
          date: `2026-01-02T00:0${i}:00.000Z`,
          result: result as 'WIN' | 'LOSS'
        })
      ),
      // Non-shuffle recording — must not be counted as a session
      makeRecording({ bracket: '2v2', result: 'WIN' })
    ]

    const stats = computePvpStats(recordings)
    expect(stats.shuffleSessions.totalSessions).toBe(2)
    expect(stats.shuffleSessions.positiveSessions).toBe(1)
    expect(stats.shuffleSessions.positiveRatePct).toBe(50)
    expect(stats.shuffleSessions.avgRoundsWon).toBe(3) // (4 + 2) / 2

    const sessionA = stats.shuffleSessions.sessions.find((s) => s.sessionId === 'session-a')!
    expect(sessionA).toEqual({
      sessionId: 'session-a',
      date: '2026-01-01T00:00:00.000Z',
      wins: 4,
      losses: 2,
      rounds: 6,
      isPositive: true
    })

    const sessionB = stats.shuffleSessions.sessions.find((s) => s.sessionId === 'session-b')!
    expect(sessionB.isPositive).toBe(false)
  })

  it('ignores Solo Shuffle recordings with no sessionId', () => {
    const recordings = [makeRecording({ bracket: 'solo-shuffle', result: 'WIN' })]
    const stats = computePvpStats(recordings)
    expect(stats.shuffleSessions.totalSessions).toBe(0)
  })
})
