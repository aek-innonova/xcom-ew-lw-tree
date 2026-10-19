// The player's library folder in the app (features/game-bases.md):
// Documents\Long War Tech Tree. The mods are in Mods\ (a folder is one mod,
// a PatchUPK script on its own is one mod), the installers the player drops
// in are anywhere else in it, and the player's choices are in settings.json
// beside them. A folder the player can see, back up and copy mods into by
// hand; the app reads it when it starts and when it changes.

import type { IniChange } from '@/model/inifile'
import type { DesktopLibrary, LibraryFile } from './desktop'

export const MODS = 'Mods'
export const SETTINGS = 'settings.json'

/** What the player chose for one mod. */
export interface ModChoices {
  /** Option values, by script path, then option name. */
  values?: Record<string, Record<string, string>>
  /** Scripts wanted in the game, by path. */
  wanted?: Record<string, boolean>
  /** The mod's own files go into the game too. */
  wantFiles?: boolean
}

export interface LibrarySettings {
  /** Mods by their name in Mods\, in the order they are applied. */
  order: string[]
  mods: Record<string, ModChoices>
  /** The player's DefaultGameCore.ini settings. */
  ini: IniChange[]
  /** The game version under the mods: kept as installed, or put in by the app. */
  base?: BaseChoice
  /** Game settings in the player's words, by id (model/gamesettings.ts). */
  game?: Record<string, string>
}
export type BaseChoice = 'keep' | 'ew' | 'lw' | 'lwr'
export const emptySettings = (): LibrarySettings => ({ order: [], mods: {}, ini: [] })

/**
 * settings.json, or null when there is none yet. One that does not read (an
 * edit by hand gone wrong) is kept aside under another name, not lost.
 */
export async function readSettings(lib: DesktopLibrary): Promise<LibrarySettings | null> {
  const b = await lib.read(SETTINGS)
  if (!b) return null
  try {
    const s = JSON.parse(new TextDecoder().decode(b)) as Partial<LibrarySettings>
    return {
      order: Array.isArray(s.order) ? s.order.filter((x) => typeof x === 'string') : [],
      mods: s.mods && typeof s.mods === 'object' ? s.mods : {},
      ini: Array.isArray(s.ini) ? s.ini : [],
      base: (['keep', 'ew', 'lw', 'lwr'] as const).find((b) => b === s.base),
      game:
        s.game && typeof s.game === 'object'
          ? Object.fromEntries(Object.entries(s.game).filter(([, v]) => typeof v === 'string'))
          : {},
    }
  } catch {
    await lib.write(`settings (unreadable ${Date.now()}).json`, b)
    return null
  }
}

export async function writeSettings(lib: DesktopLibrary, s: LibrarySettings): Promise<void> {
  await lib.write(SETTINGS, new TextEncoder().encode(JSON.stringify(s, null, 2) + '\n'))
}

export interface LibraryMod {
  /** Its name in Mods\: the folder's, or the script file's. */
  id: string
  folder: boolean
  /** Paths inside the mod (the file's own name for a script on its own). */
  files: (LibraryFile & { rel: string })[]
}

/** The mods in a listing of the library. */
export function modsIn(files: LibraryFile[]): LibraryMod[] {
  const mods = new Map<string, LibraryMod>()
  for (const f of files) {
    if (!f.path.startsWith(`${MODS}/`)) continue
    const parts = f.path.slice(MODS.length + 1).split('/')
    const id = parts[0]!
    const folder = parts.length > 1
    if (!folder && !/\.txt$/i.test(id)) continue
    const m = mods.get(id) ?? { id, folder, files: [] }
    m.files.push({ ...f, rel: folder ? parts.slice(1).join('/') : id })
    mods.set(id, m)
  }
  return [...mods.values()]
}

/** A file or folder name Windows accepts. */
export function safeName(name: string): string {
  const s = [...name]
    .map((c) => (c.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(c) ? '_' : c))
    .join('')
    .replace(/[. ]+$/, '')
    .trim()
  return s || 'mod'
}

/** A name not yet taken in Mods\: "Name", then "Name (2)", keeping an extension. */
export function freeName(name: string, taken: Set<string>): string {
  const lower = new Set([...taken].map((t) => t.toLowerCase()))
  if (!lower.has(name.toLowerCase())) return name
  const m = /^(.*?)(\.[^.]*)?$/.exec(name)!
  for (let i = 2; ; i++) {
    const n = `${m[1]} (${i})${m[2] ?? ''}`
    if (!lower.has(n.toLowerCase())) return n
  }
}

/** The order to apply mods in: as the player had it, new ones after, by name. */
export function orderOf(ids: string[], order: string[]): string[] {
  const known = order.filter((id) => ids.includes(id))
  const fresh = ids.filter((id) => !order.includes(id)).sort((a, b) => a.localeCompare(b))
  return [...known, ...fresh]
}
