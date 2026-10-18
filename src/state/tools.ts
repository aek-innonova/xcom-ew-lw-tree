// The Tools page's state (features/game-tools.md): the player's game folder,
// what is installed there, and their mod library kept in this browser.
//
// The folder is picked once (File System Access, Chromium) and its handle
// kept in IndexedDB like the save folder's. Phase 1 only reads: the version
// (Long War 1.0, LWR or plain Enemy Within), the INI, and the packages the
// mods patch. Mods are kept whole in IndexedDB; nothing leaves the browser.

import { markRaw, reactive } from 'vue'
import { parseModScript, type ModScript } from '@/model/patchupk'
import { exportsByPath, headerSizeOf, readUpk } from '@/model/upk'
import { stored } from './idb'
import { loadIni, setGame, state } from './store'
import type { DirectoryHandle, Permission } from './watch'

interface FileHandle {
  kind: 'file'
  getFile(): Promise<File>
}
interface Dir extends DirectoryHandle {
  getDirectoryHandle(name: string): Promise<Dir>
  getFileHandle(name: string): Promise<FileHandle>
}

export type InstallKind = 'lw' | 'lwr' | 'ew'

export interface PackageInfo {
  size: number
  compressed: boolean
  /** Full names of its exports ("XGUnit.RecordKill"). */
  exports: ReadonlySet<string>
}

export interface Install {
  kind: InstallKind
  /** Where the game's files are, under the folder picked ("XEW/XComGame"). */
  path: string
  /** The INI was found and loaded into the site. */
  ini: string | null
  /** File names in CookedPCConsole. */
  cooked: string[]
}

export type ModFileKind = 'script' | 'package' | 'config' | 'doc' | 'other'

export interface ModFile {
  /** Path inside the mod ("Sightlines.u", or the file's name for a single script). */
  path: string
  size: number
  kind: ModFileKind
  data: Blob
  /** For scripts: what it patches and its options. */
  script?: ModScript
}

export interface Mod {
  id: string
  name: string
  addedAt: number
  files: ModFile[]
  /** Option values the player set, by script path, then option name. */
  values: Record<string, Record<string, string>>
  /** From a README, for mods whose scripts say nothing. */
  readme?: string
}

/** What is kept in IndexedDB (scripts are parsed again on load). */
type StoredMod = Omit<Mod, 'files'> & { files: Omit<ModFile, 'script'>[] }

export const tools = reactive({
  supported: typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function',
  status: 'off' as 'off' | 'needs-permission' | 'reading' | 'ready',
  folder: null as string | null,
  error: null as string | null,
  install: null as Install | null,
  /** Package tables read so far, by lower-case file name; null: not in the install. */
  packages: {} as Record<string, PackageInfo | null | 'reading'>,
  mods: [] as Mod[],
})

let handle: Dir | null = null
let gameDir: Dir | null = null
const KEY = 'gamefolder'

// --- The game folder -----------------------------------------------------------

async function child(dir: Dir, name: string): Promise<Dir | null> {
  try {
    return await dir.getDirectoryHandle(name)
  } catch {
    return null
  }
}

/**
 * The XComGame folder (CookedPCConsole and Config) under whatever was picked:
 * the Steam game folder, XEW, or XComGame itself.
 */
async function findGameDir(root: Dir): Promise<{ dir: Dir; path: string } | null> {
  const tries: string[][] = [[], ['XComGame'], ['XEW', 'XComGame']]
  for (const steps of tries) {
    let d: Dir | null = root
    for (const s of steps) d = d && (await child(d, s))
    if (d && (await child(d, 'CookedPCConsole')) && (await child(d, 'Config')))
      return { dir: d, path: [root.name, ...steps].join('/') }
  }
  return null
}

async function names(dir: Dir): Promise<string[]> {
  const out: string[] = []
  for await (const e of dir.values()) if (e.kind === 'file') out.push(e.name)
  return out
}

async function fileIn(dir: Dir, ...path: string[]): Promise<File | null> {
  try {
    let d = dir
    for (const p of path.slice(0, -1)) d = await d.getDirectoryHandle(p)
    return await (await d.getFileHandle(path[path.length - 1]!)).getFile()
  } catch {
    return null
  }
}

/** LWR ships LWRebalance.u; Long War 1.0 LongWar.upk; neither is plain Enemy Within. */
export function installKind(cooked: string[]): InstallKind {
  const has = (n: string) => cooked.some((c) => c.toLowerCase() === n.toLowerCase())
  if (has('LWRebalance.u')) return 'lwr'
  if (has('LongWar.upk')) return 'lw'
  return 'ew'
}

/** Reads what is installed, switches the site to that version and loads its INI. */
async function readInstall(): Promise<void> {
  if (!handle) return
  tools.status = 'reading'
  tools.error = null
  tools.packages = {}
  try {
    const found = await findGameDir(handle)
    if (!found) {
      tools.install = null
      tools.status = 'ready'
      tools.error = `No game files (XComGame with CookedPCConsole and Config) in ${handle.name}. Pick the game's folder in your Steam library.`
      return
    }
    gameDir = found.dir
    const cooked = await names(await found.dir.getDirectoryHandle('CookedPCConsole'))
    const kind = installKind(cooked)
    let ini: string | null = null
    if (kind !== 'ew') {
      setGame(kind)
      const file = await fileIn(found.dir, 'Config', 'DefaultGameCore.ini')
      if (file) {
        loadIni(file.name, await file.text())
        if (state.ini) ini = file.name
      }
    }
    tools.install = { kind, path: found.path, ini, cooked }
    tools.status = 'ready'
  } catch (e) {
    // Permission withdrawn, or the folder went away.
    tools.error = (e as Error).message
    tools.status = 'needs-permission'
  }
}

/** A package's tables, read once per install (only the header part of the file). */
export async function readPackage(name: string): Promise<void> {
  const key = name.toLowerCase()
  if (!gameDir || !tools.install || key in tools.packages) return
  const real = tools.install.cooked.find((c) => c.toLowerCase() === key)
  if (!real) {
    tools.packages[key] = null
    return
  }
  tools.packages[key] = 'reading'
  try {
    const file = (await fileIn(gameDir, 'CookedPCConsole', real))!
    const head = new Uint8Array(await file.slice(0, 64).arrayBuffer())
    const size = headerSizeOf(head)
    const pk = readUpk(new Uint8Array(await file.slice(0, size).arrayBuffer()))
    tools.packages[key] = {
      size: file.size,
      compressed: pk.compressed,
      exports: markRaw(new Set(exportsByPath(pk).keys())),
    }
  } catch {
    tools.packages[key] = null
  }
}

export async function chooseGameFolder(): Promise<void> {
  if (!window.showDirectoryPicker) return
  let dir: Dir
  try {
    dir = (await window.showDirectoryPicker({ id: 'xcom-game', mode: 'read' })) as Dir
  } catch {
    return // cancelled
  }
  handle = dir
  tools.folder = dir.name
  await stored('handles', 'readwrite', (s) => s.put(dir, KEY)).catch(() => undefined)
  await readInstall()
}

export async function reconnectGameFolder(): Promise<void> {
  if (!handle) return
  const p = await handle.requestPermission({ mode: 'read' }).catch(() => 'denied' as Permission)
  if (p === 'granted') await readInstall()
}

export async function forgetGameFolder(): Promise<void> {
  handle = null
  gameDir = null
  Object.assign(tools, { status: 'off', folder: null, error: null, install: null, packages: {} })
  await stored('handles', 'readwrite', (s) => s.delete(KEY)).catch(() => undefined)
}

/** On start-up: the folder picked before, if the browser still lets the page read it. */
export async function restoreTools(): Promise<void> {
  await loadMods()
  if (!tools.supported) return
  const dir = await stored<Dir | undefined>('handles', 'readonly', (s) => s.get(KEY)).catch(
    () => undefined,
  )
  if (!dir) return
  handle = dir
  tools.folder = dir.name
  const p = await dir.queryPermission({ mode: 'read' }).catch(() => 'denied' as Permission)
  if (p === 'granted') await readInstall()
  else tools.status = 'needs-permission'
}

// --- The mod library -----------------------------------------------------------

export function fileKind(path: string, text?: string): ModFileKind {
  const name = path.toLowerCase()
  if (/\.(u|upk)$/.test(name)) return 'package'
  if (/\.ini$/.test(name)) return 'config'
  if (/\.txt$/.test(name) && text !== undefined && /^\s*UPK_FILE\s*=/m.test(text)) return 'script'
  if (/\.(txt|md|pdf|html?)$/.test(name)) return 'doc'
  return 'other'
}

async function withScripts(m: StoredMod): Promise<Mod> {
  const files: ModFile[] = []
  for (const f of m.files) {
    if (f.kind === 'script') {
      const text = await f.data.text()
      files.push({ ...f, script: parseModScript(text, f.path) })
    } else files.push({ ...f })
  }
  return { ...m, files }
}

async function loadMods(): Promise<void> {
  const all = await stored<StoredMod[]>('mods', 'readonly', (s) => s.getAll()).catch(
    () => [] as StoredMod[],
  )
  const mods: Mod[] = []
  for (const m of all.sort((a, b) => a.addedAt - b.addedAt)) mods.push(await withScripts(m))
  tools.mods = mods
}

async function save(m: Mod): Promise<void> {
  const plain: StoredMod = JSON.parse(
    JSON.stringify({ ...m, files: m.files.map((f) => ({ ...f, data: null, script: undefined })) }),
  )
  plain.files.forEach((f, i) => (f.data = m.files[i]!.data))
  await stored('mods', 'readwrite', (s) => s.put(plain, m.id))
}

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/** The first paragraph of a README, for a mod whose scripts carry no description. */
function readmeIntro(text: string): string {
  return (
    text
      .replace(/\r/g, '')
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .find((p) => p && !p.startsWith('#')) ?? ''
  )
}

/**
 * Adds mods: a script file on its own is one mod; files picked as a folder
 * (they carry a relative path) are one mod named after the folder.
 */
export async function addModFiles(files: File[]): Promise<number> {
  const groups = new Map<string, File[]>()
  for (const f of files) {
    const folder = f.webkitRelativePath.split('/')[0]
    const key = folder && f.webkitRelativePath.includes('/') ? `dir:${folder}` : `file:${f.name}`
    groups.set(key, [...(groups.get(key) ?? []), f])
  }
  let added = 0
  for (const [key, group] of groups) {
    const modFiles: ModFile[] = []
    let readme: string | undefined
    for (const f of group) {
      const path = key.startsWith('dir:')
        ? f.webkitRelativePath.split('/').slice(1).join('/')
        : f.name
      const text = /\.(txt|md|ini)$/i.test(f.name) ? await f.text() : undefined
      const kind = fileKind(path, text)
      if (/^readme/i.test(f.name) && text) readme = readmeIntro(text)
      modFiles.push({
        path,
        size: f.size,
        kind,
        data: new Blob([await f.arrayBuffer()]),
        script: kind === 'script' ? parseModScript(text!, path) : undefined,
      })
    }
    // A lone file that is not a mod script is not a mod.
    if (key.startsWith('file:') && modFiles[0]!.kind !== 'script') continue
    const name = key.startsWith('dir:') ? key.slice(4) : modFiles[0]!.script!.name
    const m: Mod = { id: newId(), name, addedAt: Date.now(), files: modFiles, values: {}, readme }
    await save(m)
    tools.mods.push(m)
    added++
  }
  return added
}

export async function removeMod(id: string): Promise<void> {
  tools.mods = tools.mods.filter((m) => m.id !== id)
  await stored('mods', 'readwrite', (s) => s.delete(id)).catch(() => undefined)
}

/** Sets one option of one script; an empty value goes back to the script's own. */
export async function setOption(id: string, script: string, option: string, value: string) {
  const m = tools.mods.find((x) => x.id === id)
  if (!m) return
  const v = { ...(m.values[script] ?? {}) }
  if (value === '') delete v[option]
  else v[option] = value
  m.values = { ...m.values, [script]: v }
  await save(m)
}
