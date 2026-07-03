import { describe, it, expect } from 'vitest'
import { buildCharacterStatsUrl } from '../../src/renderer/src/utils/characterLinks'

describe('buildCharacterStatsUrl', () => {
  const fullName = 'Crítícäl-Ravencrest-EU'

  it('builds arenacoach.gg URLs (lowercase realm and name)', () => {
    expect(buildCharacterStatsUrl('arenacoach', fullName, 'eu')).toBe(
      'https://arenacoach.gg/character/eu/ravencrest/crítícäl'
    )
  })

  it('builds seramate.com URLs (realm/name case preserved)', () => {
    expect(buildCharacterStatsUrl('seramate', fullName, 'eu')).toBe(
      'https://seramate.com/eu/Ravencrest/Crítícäl'
    )
  })

  it('builds check-pvp.fr URLs (realm/name case preserved)', () => {
    expect(buildCharacterStatsUrl('checkpvp', fullName, 'eu')).toBe(
      'https://check-pvp.fr/eu/Ravencrest/Crítícäl'
    )
  })

  it('builds drustvar.com URLs (lowercase realm and name)', () => {
    expect(buildCharacterStatsUrl('drustvar', fullName, 'eu')).toBe(
      'https://drustvar.com/character/eu/ravencrest/crítícäl'
    )
  })

  it('builds worldofwarcraft.blizzard.com armory URLs (lowercase realm and name)', () => {
    expect(buildCharacterStatsUrl('armory', fullName, 'eu')).toBe(
      'https://worldofwarcraft.blizzard.com/en-gb/character/eu/ravencrest/crítícäl'
    )
  })

  it('falls back to the default region when the combat log name has no region suffix', () => {
    expect(buildCharacterStatsUrl('checkpvp', 'Crítícäl-Ravencrest', 'us')).toBe(
      'https://check-pvp.fr/us/Ravencrest/Crítícäl'
    )
  })
})
