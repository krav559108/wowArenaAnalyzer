// Resolves which desktopCapturer source to record: auto-detects the WoW window by
// title (mirrors the old Windows gdigrab `title=World of Warcraft` behavior, now also
// used on macOS), with support for a persisted manual override by name.
//
// Source ids from desktopCapturer are not guaranteed stable across app restarts /
// window recreation — callers should persist the source NAME, not the id, and always
// re-resolve to a fresh id via a live getSources() call.

import { desktopCapturer, type DesktopCapturerSource } from 'electron'
import type { CaptureSource } from '@shared/ipc.types'

export class AmbiguousSourceError extends Error {
  constructor(public readonly matches: DesktopCapturerSource[]) {
    super(`Multiple ambiguous capture sources matched: ${matches.map((m) => m.name).join(', ')}`)
    this.name = 'AmbiguousSourceError'
  }
}

export class NoSourceFoundError extends Error {
  constructor(availableWindowNames: string[]) {
    const list = availableWindowNames.length > 0 ? availableWindowNames.join(', ') : '(none)'
    super(`No World of Warcraft window found to capture. Windows currently visible to the OS: ${list}`)
    this.name = 'NoSourceFoundError'
  }
}

const WOW_EXACT_RE = /^world of warcraft$/i
const WOW_SUBSTRING_RE = /world of warcraft/i

export function isLikelyWowWindow(name: string): boolean {
  return WOW_SUBSTRING_RE.test(name)
}

// Lists all window + screen sources for the Settings manual-override picker.
export async function listCaptureSources(): Promise<CaptureSource[]> {
  const sources = await desktopCapturer.getSources({
    types: ['window', 'screen'],
    thumbnailSize: { width: 160, height: 90 },
    fetchWindowIcons: false
  })

  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.id.startsWith('screen:') ? 'screen' : 'window',
    thumbnailDataUrl: s.thumbnail.isEmpty() ? undefined : s.thumbnail.toDataURL(),
    isLikelyWow: isLikelyWowWindow(s.name)
  }))
}

// Resolves the actual desktopCapturer source to capture.
// hintName: a persisted manual-override source name (or undefined/'auto' for auto-detect).
export async function resolveCaptureSource(
  hintName?: string
): Promise<DesktopCapturerSource> {
  const sources = await desktopCapturer.getSources({
    types: ['window', 'screen'],
    thumbnailSize: { width: 1, height: 1 },
    fetchWindowIcons: false
  })

  if (hintName !== undefined && hintName !== 'auto' && hintName.length > 0) {
    const match = sources.find((s) => s.name === hintName)
    if (match !== undefined) return match
    // Fall through to auto-detect if the persisted window/display is no longer present.
    console.warn(`[sourceResolver] Manual override "${hintName}" not found — falling back to auto-detect`)
  }

  const windowSources = sources.filter((s) => s.id.startsWith('window:'))

  const exact = windowSources.filter((s) => WOW_EXACT_RE.test(s.name))
  if (exact.length === 1) return exact[0]!
  if (exact.length > 1) throw new AmbiguousSourceError(exact)

  const substring = windowSources.filter((s) => WOW_SUBSTRING_RE.test(s.name))
  if (substring.length === 1) return substring[0]!
  if (substring.length > 1) throw new AmbiguousSourceError(substring)

  throw new NoSourceFoundError(windowSources.map((s) => s.name))
}
