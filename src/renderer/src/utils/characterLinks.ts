// Builds "view my stats" links to external PvP sites from a combat-log character
// fullName ("Name-Realm" or "Name-Realm-EU"). No new data — reuses names already
// captured in RecordingMetadata (playerName / teamComp / enemyComp).

import type { StatsSite, WowRegion } from '@shared/ipc.types'

const REGION_CODES = new Set(['EU', 'US', 'KR', 'TW', 'CN', 'OCE'])

interface ParsedCharacter {
  name: string
  realm: string
  region: string
}

// Combat log names omit the region suffix when the character is in the same region
// as the account — falls back to the configured default region in that case.
export function parseCharacterFullName(fullName: string, defaultRegion: WowRegion): ParsedCharacter {
  const parts = fullName.split('-')
  const last = parts[parts.length - 1] ?? ''
  if (REGION_CODES.has(last.toUpperCase()) && parts.length >= 3) {
    return {
      name: parts.slice(0, -2).join('-'),
      realm: parts[parts.length - 2] ?? '',
      region: last.toUpperCase()
    }
  }
  return {
    name: parts.slice(0, -1).join('-'),
    realm: last,
    region: defaultRegion.toUpperCase()
  }
}

export const STATS_SITE_LABELS: Readonly<Record<StatsSite, string>> = {
  arenacoach: 'ArenaCoach',
  seramate: 'Seramate',
  checkpvp: 'Check-PvP',
  drustvar: 'Drustvar',
  armory: 'Armory'
}

export const STATS_SITES: readonly StatsSite[] = ['arenacoach', 'seramate', 'checkpvp', 'drustvar', 'armory']

export function buildCharacterStatsUrl(site: StatsSite, fullName: string, defaultRegion: WowRegion): string {
  const { name, realm, region } = parseCharacterFullName(fullName, defaultRegion)
  const r = region.toLowerCase()
  switch (site) {
    case 'arenacoach':
      return `https://arenacoach.gg/character/${r}/${realm.toLowerCase()}/${name.toLowerCase()}`
    case 'drustvar':
      return `https://drustvar.com/character/${r}/${realm.toLowerCase()}/${name.toLowerCase()}`
    case 'armory':
      return `https://worldofwarcraft.blizzard.com/en-gb/character/${r}/${realm.toLowerCase()}/${name.toLowerCase()}`
    case 'seramate':
      return `https://seramate.com/${r}/${realm}/${name}`
    case 'checkpvp':
    default:
      return `https://check-pvp.fr/${r}/${realm}/${name}`
  }
}
