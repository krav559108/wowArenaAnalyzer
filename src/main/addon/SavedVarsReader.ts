// Reads the ArenaRecorderCompanion SavedVariables file and extracts player info.
//
// File location:
//   {wowPath}/_retail_/WTF/Account/*/SavedVariables/ArenaRecorderCompanion.lua
//
// The account directory name is not predictable (it's a Battle.net account ID),
// so we glob for all accounts and return the most recently modified match.

import { readFileSync, statSync } from 'fs'
import { join } from 'path'
import glob from 'glob'

export interface AddonCharacterInfo {
  guid: string       // e.g. "Player-1329-0A8F36D7"
  name: string
  realm: string
  fullName: string   // "Name-Realm"
  class: string
  spec: string
}

export function readAddonCharacterInfo(wowPath: string): AddonCharacterInfo | null {
  const pattern = join(
    wowPath,
    '_retail_',
    'WTF',
    'Account',
    '*',
    'SavedVariables',
    'ArenaRecorderCompanion.lua'
  ).replace(/\\/g, '/')

  const files = glob.sync(pattern)
  if (files.length === 0) return null

  // Pick the most recently modified file if there are multiple accounts
  const file = files.sort((a, b) => {
    try {
      return statSync(b).mtimeMs - statSync(a).mtimeMs
    } catch {
      return 0
    }
  })[0]!

  let content: string
  try {
    content = readFileSync(file, 'utf-8')
  } catch {
    return null
  }

  return parseSavedVars(content)
}

// Parses the Lua SavedVariables table with simple string extraction.
// Handles the format written by WoW's SavedVariables serialiser:
//   ArenaRecorderDB = {
//     ["character"] = {
//       ["guid"] = "Player-1329-XXXXXXXX",
//       ...
//     },
//   }
function parseSavedVars(content: string): AddonCharacterInfo | null {
  const extract = (key: string): string => {
    const re = new RegExp(`\\["${key}"\\]\\s*=\\s*"([^"]*)"`)
    return re.exec(content)?.[1] ?? ''
  }

  const guid = extract('guid')
  if (!guid.startsWith('Player-')) return null

  return {
    guid,
    name: extract('name'),
    realm: extract('realm'),
    fullName: extract('fullName'),
    class: extract('class'),
    spec: extract('spec'),
  }
}
