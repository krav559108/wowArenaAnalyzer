// Defensive and offensive ability data for all WoW classes.
// Spell IDs and cooldowns must be verified against the current Midnight patch notes.
// Source: https://warcraft.wiki.gg/wiki/Spell + in-game spellbook
//
// cooldownSecs: base PvP cooldown (talents/diminishing returns excluded).
// spec: undefined = available to all specs; named = spec-exclusive ability.
// alternateIds: racial variants or talent-swap IDs that occupy the same cooldown slot.

export const WOW_CLASSES = [
  'Death Knight',
  'Demon Hunter',
  'Druid',
  'Evoker',
  'Hunter',
  'Mage',
  'Monk',
  'Paladin',
  'Priest',
  'Rogue',
  'Shaman',
  'Warlock',
  'Warrior',
] as const

export type WowClass = (typeof WOW_CLASSES)[number]

export interface ClassAbility {
  spellId: number
  // Additional IDs for the same ability slot (racial variants, talent swaps).
  // Death analysis treats any of these as "used" for the cooldown check.
  alternateIds?: readonly number[]
  name: string
  cooldownSecs: number
  spec?: string
}

export interface ClassAbilityData {
  readonly defensive: readonly ClassAbility[]
  readonly offensive: readonly ClassAbility[]
}

// ---------------------------------------------------------------------------
// Trinket is universal — every arena player has one.
// Primary ID: 42292 (generic PvP Trinket "On Use: CC break + immunity")
// Alternate IDs: racial CC break equivalents tracked as trinket events.
// ---------------------------------------------------------------------------
const TRINKET: ClassAbility = {
  spellId: 42292,
  alternateIds: [59752, 7744] as const, // Every Man for Himself, Will of the Forsaken
  name: 'Trinket',
  cooldownSecs: 120,
}

// ---------------------------------------------------------------------------
// CLASS_ABILITIES
// ---------------------------------------------------------------------------

export const CLASS_ABILITIES: Readonly<Record<WowClass, ClassAbilityData>> = {
  'Death Knight': {
    defensive: [
      { spellId: 48707, name: 'Anti-Magic Shell', cooldownSecs: 60 },
      { spellId: 48792, name: 'Icebound Fortitude', cooldownSecs: 180 },
      { spellId: 48743, name: 'Death Pact', cooldownSecs: 120 },
      // Lichborne removed from defensives in Midnight — no longer reduces damage, only fear/charm/sleep immunity
      TRINKET,
    ],
    offensive: [
      { spellId: 51271, name: 'Pillar of Frost', cooldownSecs: 60, spec: 'Frost' },
      { spellId: 279302, name: "Frostwyrm's Fury", cooldownSecs: 180, spec: 'Frost' },
      { spellId: 47568, name: 'Empower Rune Weapon', cooldownSecs: 120 },
      { spellId: 316916, name: 'Apocalypse', cooldownSecs: 90, spec: 'Unholy' },
      { spellId: 42650, name: 'Army of the Dead', cooldownSecs: 600 },
    ],
  },

  'Demon Hunter': {
    defensive: [
      { spellId: 198589, name: 'Blur', cooldownSecs: 60 },
      // Netherwalk removed in Midnight
      { spellId: 196718, name: 'Darkness', cooldownSecs: 300 },
      TRINKET,
    ],
    offensive: [
      { spellId: 187827, name: 'Metamorphosis', cooldownSecs: 240, spec: 'Havoc' },
      { spellId: 198013, name: 'Eye Beam', cooldownSecs: 30, spec: 'Havoc' },
      { spellId: 179057, name: 'Chaos Nova', cooldownSecs: 60 },
    ],
  },

  Druid: {
    defensive: [
      { spellId: 22812, name: 'Barkskin', cooldownSecs: 60 },
      { spellId: 61336, alternateIds: [33891] as const, name: 'Survival Instincts', cooldownSecs: 180 },
      { spellId: 22842, name: 'Frenzied Regeneration', cooldownSecs: 36, spec: 'Guardian' },
      { spellId: 102342, name: 'Ironbark', cooldownSecs: 90 },
      TRINKET,
    ],
    offensive: [
      { spellId: 5217, name: "Tiger's Fury", cooldownSecs: 30, spec: 'Feral' },
      { spellId: 102543, name: 'Incarnation: King of the Jungle', cooldownSecs: 180, spec: 'Feral' },
      { spellId: 50334, name: 'Berserk', cooldownSecs: 180, spec: 'Feral' },
      { spellId: 194223, name: 'Celestial Alignment', cooldownSecs: 180, spec: 'Balance' },
      { spellId: 102560, name: 'Incarnation: Chosen of Elune', cooldownSecs: 180, spec: 'Balance' },
    ],
  },

  Evoker: {
    defensive: [
      { spellId: 363916, name: 'Obsidian Scales', cooldownSecs: 90, spec: 'Devastation' },
      { spellId: 374348, name: 'Renewing Blaze', cooldownSecs: 90 },
      { spellId: 374875, name: 'Time Spiral', cooldownSecs: 120 },
      { spellId: 370784, name: 'Rescue', cooldownSecs: 60 },
      { spellId: 370960, name: 'Zephyr', cooldownSecs: 120 },
      TRINKET,
    ],
    offensive: [
      { spellId: 375087, name: 'Dragonrage', cooldownSecs: 120, spec: 'Devastation' },
      { spellId: 370553, name: 'Tip the Scales', cooldownSecs: 120 },
      { spellId: 390386, name: 'Fury of the Aspects', cooldownSecs: 300 },
    ],
  },

  Hunter: {
    defensive: [
      { spellId: 186265, name: 'Aspect of the Turtle', cooldownSecs: 180 },
      { spellId: 109304, name: 'Exhilaration', cooldownSecs: 120 },
      { spellId: 5384, name: 'Feign Death', cooldownSecs: 30 },
      TRINKET,
    ],
    offensive: [
      { spellId: 288613, name: 'Trueshot', cooldownSecs: 120, spec: 'Marksmanship' },
      { spellId: 19574, name: 'Bestial Wrath', cooldownSecs: 90, spec: 'Beast Mastery' },
      { spellId: 360952, name: 'Coordinated Assault', cooldownSecs: 120, spec: 'Survival' },
      { spellId: 193530, name: 'Aspect of the Wild', cooldownSecs: 120, spec: 'Beast Mastery' },
    ],
  },

  Mage: {
    defensive: [
      { spellId: 45438,  name: 'Ice Block',            cooldownSecs: 240 },
      { spellId: 108978, name: 'Alter Time',            cooldownSecs: 60  },
      { spellId: 110959, name: 'Greater Invisibility',  cooldownSecs: 120 },
      { spellId: 414664, name: 'Mass Invisibility',     cooldownSecs: 120 },
      { spellId: 235450, name: 'Prismatic Barrier',     cooldownSecs: 25, spec: 'Arcane' },
      { spellId: 11426,  name: 'Ice Barrier',           cooldownSecs: 25, spec: 'Frost'  },
      { spellId: 235313, name: 'Blazing Barrier',       cooldownSecs: 25, spec: 'Fire'   },
      // Mirror Image and Cold Snap removed — no PvP impact in Midnight
      TRINKET,
    ],
    offensive: [
      { spellId: 190319, name: 'Combustion',  cooldownSecs: 120, spec: 'Fire'   },
      { spellId: 205021, name: 'Ray of Frost', cooldownSecs: 60,  spec: 'Frost'  },
      { spellId: 365350, name: 'Arcane Surge', cooldownSecs: 90,  spec: 'Arcane' },
      { spellId: 12472,  name: 'Icy Veins',    cooldownSecs: 90,  spec: 'Frost'  },
    ],
  },

  Monk: {
    defensive: [
      { spellId: 122278, name: 'Dampen Harm', cooldownSecs: 120 },
      { spellId: 122783, name: 'Diffuse Magic', cooldownSecs: 90 },
      { spellId: 115176, name: 'Zen Meditation', cooldownSecs: 300 },
      { spellId: 115203, name: 'Fortifying Brew', cooldownSecs: 360, spec: 'Windwalker' },
      { spellId: 243435, name: 'Fortifying Brew', cooldownSecs: 360, spec: 'Mistweaver' },
      TRINKET,
    ],
    offensive: [
      { spellId: 137639, name: 'Storm, Earth, and Fire', cooldownSecs: 90, spec: 'Windwalker' },
      { spellId: 152173, name: 'Serenity', cooldownSecs: 90, spec: 'Windwalker' },
      { spellId: 123904, name: 'Invoke Xuen, the White Tiger', cooldownSecs: 180, spec: 'Windwalker' },
      { spellId: 325197, name: 'Invoke Chi-Ji, the Red Crane', cooldownSecs: 180, spec: 'Mistweaver' },
    ],
  },

  Paladin: {
    defensive: [
      { spellId: 642, name: 'Divine Shield', cooldownSecs: 300 },
      { spellId: 498, name: 'Divine Protection', cooldownSecs: 60 },
      { spellId: 31850, name: 'Ardent Defender', cooldownSecs: 120 },
      { spellId: 1022, name: 'Blessing of Protection', cooldownSecs: 300 },
      { spellId: 633, name: 'Lay on Hands', cooldownSecs: 600 },
      TRINKET,
    ],
    offensive: [
      { spellId: 31884, name: 'Avenging Wrath', cooldownSecs: 120 },
      { spellId: 105809, name: 'Holy Avenger', cooldownSecs: 180 },
      { spellId: 231895, name: 'Crusade', cooldownSecs: 120 },
    ],
  },

  Priest: {
    defensive: [
      { spellId: 33206, name: 'Pain Suppression', cooldownSecs: 180, spec: 'Discipline' },
      { spellId: 47788, name: 'Guardian Spirit', cooldownSecs: 180, spec: 'Holy' },
      { spellId: 47585, name: 'Dispersion', cooldownSecs: 120, spec: 'Shadow' },
      { spellId: 62618, name: 'Power Word: Barrier', cooldownSecs: 180, spec: 'Discipline' },
      { spellId: 19236, name: 'Desperate Prayer', cooldownSecs: 90 },
      TRINKET,
    ],
    offensive: [
      { spellId: 228260, name: 'Void Eruption', cooldownSecs: 90, spec: 'Shadow' },
      { spellId: 391109, name: 'Dark Ascension', cooldownSecs: 60, spec: 'Shadow' },
      { spellId: 10060, name: 'Power Infusion', cooldownSecs: 120 },
      { spellId: 34433, name: 'Shadowfiend', cooldownSecs: 180 },
    ],
  },

  Rogue: {
    defensive: [
      { spellId: 5277, alternateIds: [6229] as const, name: 'Evasion', cooldownSecs: 120 },
      { spellId: 31224, name: 'Cloak of Shadows', cooldownSecs: 60 },
      { spellId: 1856, name: 'Vanish', cooldownSecs: 120 },
      { spellId: 1966, name: 'Feint', cooldownSecs: 15 },
      TRINKET,
    ],
    offensive: [
      { spellId: 13750, name: 'Adrenaline Rush', cooldownSecs: 180, spec: 'Outlaw' },
      { spellId: 185313, name: 'Shadow Dance', cooldownSecs: 60, spec: 'Subtlety' },
      { spellId: 121471, name: 'Shadow Blades', cooldownSecs: 180, spec: 'Subtlety' },
      { spellId: 360194, name: 'Deathmark', cooldownSecs: 120, spec: 'Assassination' },
    ],
  },

  Shaman: {
    defensive: [
      { spellId: 108271, name: 'Astral Shift', cooldownSecs: 90 },
      { spellId: 198103, name: 'Earth Elemental', cooldownSecs: 300 },
      { spellId: 98008, name: 'Spirit Link Totem', cooldownSecs: 180, spec: 'Restoration' },
      TRINKET,
    ],
    offensive: [
      { spellId: 2825, alternateIds: [32182] as const, name: 'Bloodlust / Heroism', cooldownSecs: 300 },
      { spellId: 51533, name: 'Feral Spirit', cooldownSecs: 150, spec: 'Enhancement' },
      { spellId: 191634, name: 'Stormkeeper', cooldownSecs: 60, spec: 'Elemental' },
      { spellId: 114050, name: 'Ascendance', cooldownSecs: 180 },
    ],
  },

  Warlock: {
    defensive: [
      { spellId: 104773, name: 'Unending Resolve', cooldownSecs: 180 },
      { spellId: 108416, name: 'Dark Pact', cooldownSecs: 60 },
      { spellId: 212295, name: 'Netherward', cooldownSecs: 45 },
      TRINKET,
    ],
    offensive: [
      { spellId: 1122, name: 'Summon Infernal', cooldownSecs: 180, spec: 'Destruction' },
      { spellId: 205180, name: 'Summon Darkglare', cooldownSecs: 180, spec: 'Affliction' },
      { spellId: 267217, name: 'Nether Portal', cooldownSecs: 180, spec: 'Demonology' },
      { spellId: 113860, name: 'Dark Soul: Misery', cooldownSecs: 120, spec: 'Affliction' },
    ],
  },

  Warrior: {
    defensive: [
      { spellId: 871, name: 'Shield Wall', cooldownSecs: 240, spec: 'Protection' },
      { spellId: 118038, name: 'Die by the Sword', cooldownSecs: 60, spec: 'Arms' },
      { spellId: 184364, name: 'Enraged Regeneration', cooldownSecs: 120, spec: 'Fury' },
      { spellId: 97462, name: 'Rallying Cry', cooldownSecs: 180 },
      { spellId: 23920, name: 'Spell Reflection', cooldownSecs: 25 },
      TRINKET,
    ],
    offensive: [
      { spellId: 107574, name: 'Avatar', cooldownSecs: 90, spec: 'Arms' },
      { spellId: 227847, name: 'Bladestorm', cooldownSecs: 90, spec: 'Arms' },
      { spellId: 1719, name: 'Recklessness', cooldownSecs: 90, spec: 'Fury' },
      { spellId: 228920, name: 'Ravager', cooldownSecs: 45 },
    ],
  },
}

// Returns all defensive abilities for a class, including universal trinket slot.
// Returns only the trinket entry when the class is not recognised.
export function getClassDefensives(className: string): readonly ClassAbility[] {
  const data = CLASS_ABILITIES[className as WowClass]
  return data?.defensive ?? [TRINKET]
}
