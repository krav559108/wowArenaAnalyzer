// Per-player scoreboard/CC stats computed purely from already-persisted timeline events.
// No backend changes needed — works retroactively on every existing recording, since
// `type: 'interrupt'` (with casterName/targetName/isSuccessful) and `type: 'cc'` (with
// casterName/targetName/duration) have always been part of TimelineEvent.

import type { TimelineEvent } from '@shared/ipc.types'

export interface PlayerScoreboardStats {
  name: string
  kicksTaken: number
  kicksTakenPerMin: number
  kicksDone: number
  kicksDonePerMin: number
  // Total seconds of CC this player landed on enemies (from event.duration, when known).
  ccOutputSecs: number
  // Total seconds this player spent CC'd, and that as a % of match duration.
  ccUptimeSecs: number
  ccUptimePct: number
}

// Builds one row per player name that appears as a caster or target of a
// cc/interrupt event. durationSecs should be the match/round duration (metadata.duration).
export function computeScoreboard(
  events: TimelineEvent[],
  durationSecs: number
): PlayerScoreboardStats[] {
  const stats = new Map<string, PlayerScoreboardStats>()

  function entry(name: string): PlayerScoreboardStats {
    let s = stats.get(name)
    if (s === undefined) {
      s = {
        name,
        kicksTaken: 0,
        kicksTakenPerMin: 0,
        kicksDone: 0,
        kicksDonePerMin: 0,
        ccOutputSecs: 0,
        ccUptimeSecs: 0,
        ccUptimePct: 0
      }
      stats.set(name, s)
    }
    return s
  }

  for (const ev of events) {
    if (ev.type === 'interrupt') {
      // A successful interrupt has isSuccessful === true. Whiffed/bad interrupts
      // (isSuccessful === false) still count as an attempt for "kicks done" — mirrors
      // how a scoreboard would count kick usage, not just successful ones.
      if (ev.casterName) entry(ev.casterName).kicksDone++
      if (ev.targetName && ev.isSuccessful !== false) entry(ev.targetName).kicksTaken++
    } else if (ev.type === 'cc' && ev.duration !== undefined) {
      if (ev.casterName) entry(ev.casterName).ccOutputSecs += ev.duration
      if (ev.targetName) entry(ev.targetName).ccUptimeSecs += ev.duration
    }
  }

  const minutes = durationSecs > 0 ? durationSecs / 60 : 0
  for (const s of stats.values()) {
    s.kicksDonePerMin = minutes > 0 ? s.kicksDone / minutes : 0
    s.kicksTakenPerMin = minutes > 0 ? s.kicksTaken / minutes : 0
    s.ccUptimePct = durationSecs > 0 ? (s.ccUptimeSecs / durationSecs) * 100 : 0
  }

  return [...stats.values()].sort((a, b) => a.name.localeCompare(b.name))
}
