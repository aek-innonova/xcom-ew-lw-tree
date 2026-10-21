// The player's library folder in the app (features/game-bases.md):
// Documents\Long War Tech Tree. The mods are in Mods\ (a folder is one mod,
// a PatchUPK script on its own is one mod), the installers the player drops
// in are anywhere else in it, and the player's choices are in settings.json
// beside them. A folder the player can see, back up and copy mods into by
// hand; the app reads it when it starts and when it changes.

import { splitOldValues } from '@/model/gamesettings'
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

/**
 * One game version's setup (features/version-setups.md): every version keeps
 * its own, since a mod ticked or a value set for Long War means nothing for
 * LWR or plain Enemy Within. Choosing a version is choosing its setup.
 */
export interface VersionSetup {
  /** Mods by their name in Mods\, in the order they are applied. */
  order: string[]
  mods: Record<string, ModChoices>
  /** The player's lines of DefaultGameCore.ini. */
  ini: IniChange[]
  /** Game settings in the player's words (model/gamesettings.ts), by id. */
  game: Record<string, string>
  /** Setups the player saved by name, to go back to (features/game-setups.md). */
  setups: Record<string, SavedSetup>
  /** The setup last used or saved: the current choices came from it. */
  setupFrom?: string
}

export interface LibrarySettings {
  /** The version chosen, whose setup is shown and put into the game; unset: the one installed. */
  base?: GameKind
  versions: Partial<Record<GameKind, VersionSetup>>
}

/** A version's setup as it was when saved. */
export interface SavedSetup {
  saved: string
  mods: Record<string, ModChoices>
  ini: IniChange[]
  game: Record<string, string>
}
export type GameKind = 'ew' | 'lw' | 'lwr'
const KINDS: GameKind[] = ['ew', 'lw', 'lwr']

const stringsOf = (o: unknown): Record<string, string> =>
  o && typeof o === 'object'
    ? Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === 'string'))
    : {}
const objectOf = <T>(o: unknown): Record<string, T> =>
  o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, T>) : {}
const kindOf = (v: unknown): GameKind | undefined => KINDS.find((k) => k === v)

export const emptyVersion = (): VersionSetup => ({
  order: [],
  mods: {},
  ini: [],
  game: {},
  setups: {},
})
export const emptySettings = (): LibrarySettings => ({ versions: {} })

/**
 * settings.json, or null when there is none yet. One that does not read (an
 * edit by hand gone wrong) is kept aside under another name, not lost. A file
 * from before each version had its own setup is moved over (`fromShared`),
 * which needs the version installed when it said "as installed".
 */
export async function readSettings(
  lib: DesktopLibrary,
  installed: () => Promise<GameKind>,
): Promise<LibrarySettings | null> {
  const b = await lib.read(SETTINGS)
  if (!b) return null
  let s: Record<string, unknown>
  try {
    s = objectOf(JSON.parse(new TextDecoder().decode(b)))
  } catch {
    await lib.write(`settings (unreadable ${Date.now()}).json`, b)
    return null
  }
  if (!('versions' in s)) {
    const base = kindOf(s.base)
    return fromShared(s, base ?? (await installed()))
  }
  const versions = objectOf<unknown>(s.versions)
  return {
    base: kindOf(s.base),
    versions: Object.fromEntries(
      KINDS.filter((k) => k in versions).map((k) => [k, versionOf(versions[k])]),
    ),
  }
}

function versionOf(v: unknown): VersionSetup {
  const o = objectOf<unknown>(v)
  return {
    order: Array.isArray(o.order) ? o.order.filter((x) => typeof x === 'string') : [],
    mods: objectOf<ModChoices>(o.mods),
    ini: Array.isArray(o.ini) ? o.ini : [],
    game: splitOldValues(stringsOf(o.game)),
    setups: Object.fromEntries(
      Object.entries(objectOf<Record<string, unknown>>(o.setups)).map(([name, x]) => [
        name,
        {
          saved: typeof x?.saved === 'string' ? x.saved : '',
          mods: objectOf<ModChoices>(x?.mods),
          ini: Array.isArray(x?.ini) ? (x.ini as IniChange[]) : [],
          game: splitOldValues(stringsOf(x?.game)),
        },
      ]),
    ),
    setupFrom: typeof o.setupFrom === 'string' ? o.setupFrom : undefined,
  }
}

/**
 * A settings.json from when the versions shared one setup (0.3): its mods,
 * their order and the INI lines go to `kind`, the version it had chosen (or
 * the one installed, for "as installed"); each saved setup to the version it
 * was saved with, with that version's game settings; each version keeps its
 * game settings. Nothing else carries over to another version.
 */
export function fromShared(s: Record<string, unknown>, kind: GameKind): LibrarySettings {
  const game = gameOf(s.game)
  const versions: LibrarySettings['versions'] = {}
  const of = (k: GameKind) => (versions[k] ??= { ...emptyVersion(), game: game[k] ?? {} })
  for (const k of KINDS) if (game[k]) of(k)
  Object.assign(of(kind), {
    order: Array.isArray(s.order) ? s.order.filter((x) => typeof x === 'string') : [],
    mods: objectOf<ModChoices>(s.mods),
    ini: Array.isArray(s.ini) ? s.ini : [],
  })
  for (const [name, x] of Object.entries(objectOf<Record<string, unknown>>(s.setups))) {
    const k = kindOf(x?.base) ?? kind
    of(k).setups[name] = {
      saved: typeof x?.saved === 'string' ? x.saved : '',
      mods: objectOf<ModChoices>(x?.mods),
      ini: Array.isArray(x?.ini) ? (x.ini as IniChange[]) : [],
      game: gameOf(x?.game)[k] ?? {},
    }
    // The current choices came from it: they are the chosen version's.
    if (s.setupFrom === name && k === kind) of(k).setupFrom = name
  }
  return { base: kindOf(s.base), versions }
}

/**
 * The game settings by version. 0.3.1 kept one set for every version; it was
 * only ever made on Long War (the bench), so it becomes Long War's. Settings
 * since split in two come back as their parts.
 */
export function gameOf(g: unknown): Partial<Record<GameKind, Record<string, string>>> {
  if (!g || typeof g !== 'object') return {}
  const o = g as Record<string, unknown>
  if (Object.values(o).some((v) => typeof v === 'string'))
    return { lw: splitOldValues(stringsOf(o)) }
  return Object.fromEntries(
    KINDS.filter((k) => k in o).map((k) => [k, splitOldValues(stringsOf(o[k]))]),
  )
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
