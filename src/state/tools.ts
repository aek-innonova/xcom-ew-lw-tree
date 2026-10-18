// The Tools page's state (features/game-tools.md): the player's game folder,
// what is installed there, their mod library and INI settings kept in this
// browser, and putting all of it into the game.
//
// The folder is picked once (File System Access, Chromium) and its handle
// kept in IndexedDB like the save folder's. Reading needs only read access;
// writing asks the browser for more when the player applies their setup.
// Mods are kept whole in IndexedDB; nothing leaves the browser.

import { markRaw, reactive } from 'vue'
import { iniEntries, iniText, type IniChange, type IniEntry } from '@/model/inifile'
import { parseCommands, runScript, type RunResult, type Step } from '@/model/modpatch'
import { parseModScript, type ModScript } from '@/model/patchupk'
import { Package, exportsByPath, headerSizeOf, readUpk } from '@/model/upk'
import {
  WrongCode,
  folderFiles,
  helperFiles,
  helperInfo,
  helperRunning,
  type Dir,
  type GameFiles,
} from './gamefiles'
import { stored } from './idb'
import {
  GAME_INI,
  applyPlan,
  emptyManaged,
  loadManaged,
  planSetup,
  type Managed,
  type Plan,
  type Wanted,
} from './setup'
import { loadIni, setGame, state } from './store'
import type { Permission } from './watch'

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
  /** Scripts the player wants in the game, by path (unset: not decided yet). */
  wanted?: Record<string, boolean>
  /** The mod's own files (packages, INIs) go into the game too. */
  wantFiles?: boolean
}

/** What is kept in IndexedDB (scripts are parsed again on load). */
type StoredMod = Omit<Mod, 'files'> & { files: Omit<ModFile, 'script'>[] }

export type CheckStatus = RunResult['status'] | 'checking' | 'other-values'
export interface ScriptCheck {
  status: CheckStatus
  steps: Step[]
}

export const tools = reactive({
  supported: typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function',
  status: 'off' as 'off' | 'needs-permission' | 'reading' | 'ready',
  /** How the page reaches the game: the browser's folder access, or the helper program. */
  via: null as 'folder' | 'helper' | null,
  /** The helper: not tried, not running, the code was wrong. */
  helper: 'off' as 'off' | 'not-running' | 'wrong-code' | 'connected',
  folder: null as string | null,
  error: null as string | null,
  install: null as Install | null,
  /** Package tables read so far, by lower-case file name; null: not in the install. */
  packages: {} as Record<string, PackageInfo | null | 'reading'>,
  mods: [] as Mod[],
  /** Each script's state in the install, by `${mod id}:${path}`. */
  checks: {} as Record<string, ScriptCheck>,
  /** The install's DefaultGameCore.ini, as settings. */
  iniEntries: [] as IniEntry[],
  /** The player's INI settings. */
  settings: [] as IniChange[],
  /** Putting the setup into the game. */
  plan: null as Plan | null,
  busy: null as string | null,
  log: [] as string[],
})

let handle: Dir | null = null
let files: GameFiles | null = null
let managed: Managed = emptyManaged()
/** The install's packages as they are now, by lower-case name (for the checks). */
let current = new Map<string, Package | null>()
const KEY = 'gamefolder'
const lower = (s: string) => s.toLowerCase()
export const checkKey = (m: Mod, f: ModFile) => `${m.id}:${f.path}`

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

/** LWR ships LWRebalance.u; Long War 1.0 LongWar.upk; neither is plain Enemy Within. */
export function installKind(cooked: string[]): InstallKind {
  const has = (n: string) => cooked.some((c) => c.toLowerCase() === n.toLowerCase())
  if (has('LWRebalance.u')) return 'lwr'
  if (has('LongWar.upk')) return 'lw'
  return 'ew'
}

const HELPER_KEY = 'lwtree.helper.v1'
let helperPath = ''

/** Reads what is installed, switches the site to that version and loads its INI. */
async function readInstall(): Promise<void> {
  if (!handle && tools.via !== 'helper') return
  tools.status = 'reading'
  tools.error = null
  tools.packages = {}
  tools.checks = {}
  current = new Map()
  try {
    let found: { path: string }
    if (tools.via === 'helper') found = { path: helperPath }
    else {
      const dir = await findGameDir(handle!)
      if (!dir) {
        tools.install = null
        files = null
        tools.status = 'ready'
        tools.error = `No game files (XComGame with CookedPCConsole and Config) in ${handle!.name}. Pick the game's folder in your Steam library.`
        return
      }
      files = folderFiles(dir.dir)
      found = dir
    }
    if (!files) return
    const cooked = await files.list('CookedPCConsole')
    const kind = installKind(cooked)
    let ini: string | null = null
    const iniBytes = await files.read(GAME_INI)
    tools.iniEntries = markRaw(iniBytes ? iniEntries(iniText(iniBytes)) : [])
    if (kind !== 'ew') {
      setGame(kind)
      if (iniBytes) {
        loadIni('DefaultGameCore.ini', iniText(iniBytes))
        if (state.ini) ini = 'DefaultGameCore.ini'
      }
    }
    tools.install = { kind, path: found.path, ini, cooked }
    managed = await loadManaged(files)
    tools.status = 'ready'
    void checkMods()
  } catch (e) {
    // Permission withdrawn, the folder went away, or the helper was closed.
    tools.error = (e as Error).message
    tools.status = tools.via === 'helper' ? 'off' : 'needs-permission'
    if (tools.via === 'helper') tools.helper = 'not-running'
  }
}

/**
 * Connects through the helper program with its pairing code (kept for next
 * time, so the page reconnects by itself while the helper runs).
 */
export async function connectHelper(code: string): Promise<void> {
  const c = code.trim().toUpperCase()
  if (!(await helperRunning())) {
    tools.helper = 'not-running'
    return
  }
  try {
    const info = await helperInfo(c)
    helperPath = info.root.replace(/\\/g, '/')
    files = helperFiles(c)
    handle = null
    tools.via = 'helper'
    tools.helper = 'connected'
    tools.folder = info.name
    localStorage.setItem(HELPER_KEY, c)
    await readInstall()
  } catch (e) {
    tools.helper = e instanceof WrongCode ? 'wrong-code' : 'not-running'
  }
}

/** A package's tables, read once per install (only the header part of the file). */
export async function readPackage(name: string): Promise<void> {
  const key = lower(name)
  if (!files || !tools.install || key in tools.packages) return
  const real = tools.install.cooked.find((c) => lower(c) === key)
  if (!real) {
    tools.packages[key] = null
    return
  }
  tools.packages[key] = 'reading'
  try {
    const file = (await files.file(`CookedPCConsole/${real}`))!
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
    dir = (await window.showDirectoryPicker({ id: 'xcom-game', mode: 'read' })) as unknown as Dir
  } catch {
    return // cancelled
  }
  handle = dir
  tools.via = 'folder'
  tools.folder = dir.name
  await stored('handles', 'readwrite', (s) => s.put(dir, KEY)).catch(() => undefined)
  await readInstall()
}

export async function reconnectGameFolder(): Promise<void> {
  if (!handle) return
  const p = await handle.requestPermission({ mode: 'read' }).catch(() => 'denied' as Permission)
  if (p === 'granted') await readInstall()
}

export async function rereadInstall(): Promise<void> {
  await readInstall()
}

export async function forgetGameFolder(): Promise<void> {
  handle = null
  files = null
  current = new Map()
  localStorage.removeItem(HELPER_KEY)
  Object.assign(tools, {
    via: null,
    helper: 'off',
    status: 'off',
    folder: null,
    error: null,
    install: null,
    packages: {},
    checks: {},
    iniEntries: [],
    plan: null,
  })
  await stored('handles', 'readwrite', (s) => s.delete(KEY)).catch(() => undefined)
}

/** On start-up: the library, the settings, and the folder picked before if the browser still lets the page read it. */
export async function restoreTools(): Promise<void> {
  await loadMods()
  tools.settings =
    (await stored<IniChange[] | undefined>('state', 'readonly', (s) => s.get('settings')).catch(
      () => undefined,
    )) ?? []
  // The helper first: if its code is known and it runs, it is the way in.
  const code = localStorage.getItem(HELPER_KEY)
  if (code && (await helperRunning())) {
    await connectHelper(code)
    if (tools.helper === 'connected') return
  }
  if (!tools.supported) return
  const dir = await stored<Dir | undefined>('handles', 'readonly', (s) => s.get(KEY)).catch(
    () => undefined,
  )
  if (!dir) return
  handle = dir
  tools.via = 'folder'
  tools.folder = dir.name
  const p = await dir.queryPermission({ mode: 'read' }).catch(() => 'denied' as Permission)
  if (p === 'granted') await readInstall()
  else tools.status = 'needs-permission'
}

// --- Is it installed? ------------------------------------------------------------

async function currentPackage(name: string): Promise<Package | null> {
  const key = lower(name)
  if (current.has(key)) return current.get(key)!
  let pkg: Package | null = null
  const real = tools.install?.cooked.find((c) => lower(c) === key)
  if (files && real) {
    const bytes = await files.read(`CookedPCConsole/${real}`)
    try {
      pkg = bytes ? markRaw(new Package(bytes)) : null
    } catch {
      pkg = null
    }
  }
  current.set(key, pkg)
  return pkg
}

const upkNames = (text: string) => [
  ...new Set(
    parseCommands(text)
      .filter((c) => c.name === 'UPK_FILE')
      .map((c) => c.value.trim().split('\n')[0]!.trim()),
  ),
]

let checkRun = 0
/** Runs every script against the install as it is (on copies) and records what it finds. */
export async function checkMods(): Promise<void> {
  if (!files || !tools.install) return
  const run = ++checkRun
  const scripts = tools.mods.flatMap((m) =>
    m.files.filter((f) => f.kind === 'script').map((f) => ({ m, f })),
  )
  for (const { m, f } of scripts)
    tools.checks[checkKey(m, f)] = {
      status: 'checking',
      steps: tools.checks[checkKey(m, f)]?.steps ?? [],
    }
  for (const { m, f } of scripts) {
    const text = await f.data.text()
    for (const n of upkNames(text)) await currentPackage(n)
    if (run !== checkRun) return
    const open = (n: string) => current.get(lower(n))?.clone()
    const values = m.values[f.path] ?? {}
    const r = runScript(text, { open, values })
    let status: CheckStatus = r.status
    if (status !== 'installed' && Object.keys(values).length) {
      if (runScript(text, { open }).status === 'installed') status = 'other-values'
    }
    tools.checks[checkKey(m, f)] = { status, steps: markRaw(r.steps) }
    // A mod first seen in the game counts as wanted there.
    if (m.wanted?.[f.path] === undefined) {
      m.wanted = {
        ...(m.wanted ?? {}),
        [f.path]: status === 'installed' || status === 'other-values',
      }
      await save(m)
    }
    await new Promise((res) => setTimeout(res, 0))
  }
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
  const out: ModFile[] = []
  for (const f of m.files) {
    if (f.kind === 'script') {
      const text = await f.data.text()
      out.push({ ...f, script: parseModScript(text, f.path) })
    } else out.push({ ...f })
  }
  return { ...m, files: out }
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
export async function addModFiles(picked: File[]): Promise<number> {
  const groups = new Map<string, File[]>()
  for (const f of picked) {
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
  if (added) void checkMods()
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
  void checkMods()
}

export async function setWanted(id: string, script: string, want: boolean) {
  const m = tools.mods.find((x) => x.id === id)
  if (!m) return
  m.wanted = { ...(m.wanted ?? {}), [script]: want }
  await save(m)
}

export async function setWantFiles(id: string, want: boolean) {
  const m = tools.mods.find((x) => x.id === id)
  if (!m) return
  m.wantFiles = want
  await save(m)
}

// --- INI settings ----------------------------------------------------------------

const sameSetting = (a: IniChange, b: IniChange) =>
  a.section === b.section && a.key === b.key && a.occurrence === b.occurrence

/** Sets (or, with value null, drops) one of the player's INI settings. */
export async function setSetting(entry: IniChange, value: string | null) {
  const rest = tools.settings.filter((s) => !sameSetting(s, entry))
  tools.settings = value === null ? rest : [...rest, { ...entry, value }]
  await stored('state', 'readwrite', (s) =>
    s.put(JSON.parse(JSON.stringify(tools.settings)), 'settings'),
  )
}

// --- Putting the setup into the game ---------------------------------------------

async function wantedSetup(everything: boolean): Promise<Wanted> {
  const wanted: Wanted = { scripts: [], files: [], settings: everything ? [...tools.settings] : [] }
  if (!everything) return wanted
  for (const m of tools.mods) {
    for (const f of m.files)
      if (f.kind === 'script' && m.wanted?.[f.path])
        wanted.scripts.push({
          label: `${m.name}${scriptsOf(m) > 1 ? ` (${f.path})` : ''}`,
          text: await f.data.text(),
          values: { ...(m.values[f.path] ?? {}) },
        })
    if (m.wantFiles) {
      const own = m.files.filter((f) => f.kind === 'package' || f.kind === 'config')
      wanted.files.push({
        label: m.name,
        files: await Promise.all(
          own.map(async (f) => ({
            path: f.path,
            kind: f.kind as 'package' | 'config',
            data: new Uint8Array(await f.data.arrayBuffer()),
          })),
        ),
      })
    }
  }
  return wanted
}
const scriptsOf = (m: Mod) => m.files.filter((f) => f.kind === 'script').length

/**
 * Works out what putting the setup into the game would change (or, with
 * `everything` false, putting every file back as it was). Asks for write
 * access first, while the click that asked for it still counts.
 */
export async function makePlan(everything = true): Promise<void> {
  if (!files) return
  tools.log = []
  if (!(await files.canWrite(true))) {
    tools.error = 'The browser did not allow changes to the game folder.'
    return
  }
  tools.error = null
  tools.busy = 'Working out what changes…'
  try {
    tools.plan = markRaw(await planSetup(files, await wantedSetup(everything), managed))
  } catch (e) {
    tools.error = (e as Error).message
  } finally {
    tools.busy = null
  }
}

export function cancelPlan() {
  tools.plan = null
}

/** Writes the plan, keeps the bookkeeping, and reads the install again. */
export async function applyPlanNow(): Promise<void> {
  if (!files || !tools.plan || !tools.install) return
  const plan = tools.plan
  tools.busy = 'Writing…'
  try {
    tools.log = await applyPlan(files, plan)
    managed = plan.managed
    tools.plan = null
  } catch (e) {
    tools.error = `Stopped: ${(e as Error).message}. Your originals are in lwtree-backup/.`
  } finally {
    tools.busy = null
  }
  const log = tools.log
  await readInstall()
  tools.log = log
}
