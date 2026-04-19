// PvP-relevant abilities per class.
// cooldown is in seconds. spellId is used to track cast events in the combat log.

export interface AbilityInfo {
  spellId: number
  name: string
  cooldown: number
}

export interface ClassAbilities {
  defensive: AbilityInfo[]
  offensive: AbilityInfo[]
}

export const CLASS_ABILITIES: Readonly<Record<string, ClassAbilities>> = {
  'Mage': {
    defensive: [
      { spellId: 45438,  name: 'Ice Block',            cooldown: 240 },
      { spellId: 110959, name: 'Greater Invisibility',  cooldown: 120 },
      { spellId: 108978, name: 'Alter Time',            cooldown: 60  },
      { spellId: 414664, name: 'Mass Invisibility',     cooldown: 120 },
      // Barrier (spec-specific): Prismatic (Arcane), Ice (Frost), Blazing (Fire)
      { spellId: 235450, name: 'Prismatic Barrier',     cooldown: 25  },
      { spellId: 11426,  name: 'Ice Barrier',           cooldown: 25  },
      { spellId: 235313, name: 'Blazing Barrier',       cooldown: 25  },
      // Mirror Image and Cold Snap removed — passive/no PvP impact in Midnight
    ],
    offensive: [
      { spellId: 190319, name: 'Combustion',   cooldown: 120 },
      { spellId: 205021, name: 'Ray of Frost',  cooldown: 60  },
      { spellId: 365350, name: 'Arcane Surge',  cooldown: 90  },
      { spellId: 12472,  name: 'Icy Veins',     cooldown: 90  },
    ],
  },

  'Rogue': {
    defensive: [
      { spellId: 6229,   name: 'Evasion',           cooldown: 120 },
      { spellId: 31224,  name: 'Cloak of Shadows',  cooldown: 60  },
      { spellId: 1856,   name: 'Vanish',            cooldown: 90  },
      { spellId: 185311, name: 'Crimson Vial',      cooldown: 30  },
    ],
    offensive: [
      { spellId: 13750,  name: 'Adrenaline Rush',  cooldown: 180 },
      { spellId: 185313, name: 'Shadow Dance',      cooldown: 60  },
      { spellId: 212283, name: 'Symbols of Death',  cooldown: 30  },
      { spellId: 121471, name: 'Shadow Blades',     cooldown: 180 },
    ],
  },

  'Druid': {
    defensive: [
      { spellId: 22812,  name: 'Barkskin',           cooldown: 60  },
      { spellId: 61336,  name: 'Survival Instincts', cooldown: 120 },
      { spellId: 22842,  name: 'Frenzied Regeneration', cooldown: 36 },
      { spellId: 102342, name: 'Ironbark',           cooldown: 90  },
    ],
    offensive: [
      { spellId: 102543, name: 'Incarnation',           cooldown: 180 },
      { spellId: 106951, name: 'Berserk',               cooldown: 180 },
      { spellId: 194223, name: 'Celestial Alignment',   cooldown: 180 },
      { spellId: 323764, name: 'Convoke the Spirits',   cooldown: 120 },
    ],
  },

  'Paladin': {
    defensive: [
      { spellId: 642,    name: 'Divine Shield',          cooldown: 300 },
      { spellId: 498,    name: 'Divine Protection',      cooldown: 60  },
      { spellId: 633,    name: 'Lay on Hands',           cooldown: 600 },
      { spellId: 1022,   name: 'Blessing of Protection', cooldown: 300 },
      { spellId: 6940,   name: 'Blessing of Sacrifice',  cooldown: 120 },
    ],
    offensive: [
      { spellId: 31884,  name: 'Avenging Wrath',  cooldown: 120 },
      { spellId: 105809, name: 'Holy Avenger',    cooldown: 180 },
      { spellId: 383185, name: 'Execution Sentence', cooldown: 60 },
    ],
  },

  'Priest': {
    defensive: [
      { spellId: 47585,  name: 'Dispersion',      cooldown: 120 },
      { spellId: 586,    name: 'Fade',            cooldown: 30  },
      { spellId: 33206,  name: 'Pain Suppression', cooldown: 180 },
      { spellId: 47788,  name: 'Guardian Spirit', cooldown: 180 },
      { spellId: 19236,  name: 'Desperate Prayer', cooldown: 90 },
    ],
    offensive: [
      { spellId: 450395, name: 'Dark Ascension',   cooldown: 90  },
      { spellId: 10060,  name: 'Power Infusion',   cooldown: 120 },
      { spellId: 228260, name: 'Void Eruption',    cooldown: 90  },
    ],
  },

  'Shaman': {
    defensive: [
      { spellId: 108271, name: 'Astral Shift',      cooldown: 90  },
      { spellId: 98008,  name: 'Spirit Link Totem', cooldown: 180 },
      { spellId: 204336, name: 'Grounding Totem',   cooldown: 30  },
    ],
    offensive: [
      { spellId: 2825,   name: 'Bloodlust',          cooldown: 300 },
      { spellId: 32182,  name: 'Heroism',            cooldown: 300 },
      { spellId: 51533,  name: 'Feral Spirit',       cooldown: 120 },
      { spellId: 198067, name: 'Fire Elemental',     cooldown: 150 },
      { spellId: 192249, name: 'Storm Elemental',    cooldown: 150 },
    ],
  },

  'Warlock': {
    defensive: [
      { spellId: 104773, name: 'Unending Resolve', cooldown: 180 },
      { spellId: 108416, name: 'Dark Pact',        cooldown: 60  },
      { spellId: 6789,   name: 'Mortal Coil',      cooldown: 45  },
    ],
    offensive: [
      { spellId: 205180, name: 'Summon Darkglare',    cooldown: 180 },
      { spellId: 113858, name: 'Dark Soul: Misery',   cooldown: 120 },
      { spellId: 1122,   name: 'Summon Infernal',     cooldown: 180 },
      { spellId: 265187, name: 'Summon Demonic Tyrant', cooldown: 90 },
    ],
  },

  'Warrior': {
    defensive: [
      { spellId: 871,    name: 'Shield Wall',          cooldown: 240 },
      { spellId: 118038, name: 'Die by the Sword',     cooldown: 120 },
      { spellId: 97462,  name: 'Rallying Cry',         cooldown: 180 },
      { spellId: 184364, name: 'Enraged Regeneration', cooldown: 120 },
      { spellId: 23920,  name: 'Spell Reflection',     cooldown: 25  },
    ],
    offensive: [
      { spellId: 107574, name: 'Avatar',      cooldown: 90  },
      { spellId: 46924,  name: 'Bladestorm',  cooldown: 90  },
      { spellId: 1719,   name: 'Recklessness', cooldown: 90 },
    ],
  },

  'Monk': {
    defensive: [
      { spellId: 122278, name: 'Dampen Harm',     cooldown: 120 },
      { spellId: 122783, name: 'Diffuse Magic',   cooldown: 90  },
      { spellId: 115176, name: 'Zen Meditation',  cooldown: 300 },
      { spellId: 115203, name: 'Fortifying Brew', cooldown: 420 },
    ],
    offensive: [
      { spellId: 137639, name: 'Storm, Earth, and Fire', cooldown: 90  },
      { spellId: 152173, name: 'Serenity',               cooldown: 90  },
      { spellId: 123904, name: 'Invoke Xuen',            cooldown: 120 },
    ],
  },

  'Hunter': {
    defensive: [
      { spellId: 186265, name: 'Aspect of the Turtle', cooldown: 180 },
      { spellId: 109304, name: 'Exhilaration',         cooldown: 120 },
      { spellId: 5384,   name: 'Feign Death',          cooldown: 30  },
    ],
    offensive: [
      { spellId: 19574,  name: 'Bestial Wrath',       cooldown: 90  },
      { spellId: 288613, name: 'Trueshot',            cooldown: 120 },
      { spellId: 360952, name: 'Coordinated Assault', cooldown: 120 },
      { spellId: 193530, name: 'Aspect of the Wild',  cooldown: 120 },
    ],
  },

  'Death Knight': {
    defensive: [
      { spellId: 48792,  name: 'Icebound Fortitude', cooldown: 180 },
      { spellId: 48707,  name: 'Anti-Magic Shell',   cooldown: 60  },
      { spellId: 51052,  name: 'Anti-Magic Zone',    cooldown: 120 },
      { spellId: 55233,  name: 'Vampiric Blood',     cooldown: 180 },
    ],
    offensive: [
      { spellId: 51271,  name: 'Pillar of Frost',       cooldown: 60  },
      { spellId: 319454, name: 'Apocalypse',            cooldown: 90  },
      { spellId: 47568,  name: 'Empower Rune Weapon',   cooldown: 120 },
      { spellId: 42650,  name: 'Army of the Dead',      cooldown: 480 },
    ],
  },

  'Demon Hunter': {
    defensive: [
      { spellId: 212800, name: 'Blur',        cooldown: 60  },
      { spellId: 196555, name: 'Netherwalk',  cooldown: 180 },
      { spellId: 196718, name: 'Darkness',    cooldown: 300 },
    ],
    offensive: [
      { spellId: 198013, name: 'Eye Beam',      cooldown: 40  },
      { spellId: 187827, name: 'Metamorphosis', cooldown: 180 },
      { spellId: 183752, name: 'Consume Magic', cooldown: 10  },
    ],
  },

  'Evoker': {
    defensive: [
      { spellId: 363916, name: 'Obsidian Scales', cooldown: 90  },
      { spellId: 374348, name: 'Renewing Blaze',  cooldown: 90  },
      { spellId: 370960, name: 'Zephyr',          cooldown: 120 },
    ],
    offensive: [
      { spellId: 375087, name: 'Dragonrage',           cooldown: 120 },
      { spellId: 390386, name: 'Fury of the Aspects',  cooldown: 300 },
      { spellId: 382266, name: 'Breath of Eons',       cooldown: 120 },
    ],
  },
}
