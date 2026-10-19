// The Tools page's state (features/game-tools.md, features/desktop-app.md):
// the player's game folder, what is installed there, their mod library and
// INI settings, and putting all of it into the game.
//
// Tools exists only in the desktop app: a web page cannot reach the game's
// files well enough (Chrome hides .ini files and Program Files from pages).
// The app finds the game the way installers do, or the player chooses the
// folder; every file goes through its bridge (state/desktop.ts). The mod
// library is the player's library folder (state/library.ts); nothing leaves
// the machine.

import { markRaw, reactive } from 'vue'
import { iniEntries, iniText, type IniChange, type IniEntry } from '@/model/inifile'
import { parseCommands, runScript, type RunResult, type Step } from '@/model/modpatch'
import { parseModScript, type ModScript } from '@/model/patchupk'
import { Package, exportsByPath, headerSizeOf, readUpk } from '@/model/upk'
import { desktop, desktopFiles } from './desktop'
import type { GameFiles } from './gamefiles'
import { stored } from './idb'
import {
  MODS,
  emptySettings,
  freeName,
  modsIn,
  orderOf,
  readSettings,
  safeName,
  writeSettings,
  type LibrarySettings,
} from './library'
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
  /** Its name in the library's Mods folder. */
  id: string
  name: string
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

/** A mod as 0.2 and earlier kept it in IndexedDB (moved to the library once). */
type StoredMod = Omit<Mod, 'files'> & { addedAt: number; files: Omit<ModFile, 'script'>[] }

export type CheckStatus = RunResult['status'] | 'checking' | 'other-values'
export interface ScriptCheck {
  status: CheckStatus
  steps: Step[]
}

export const tools = reactive({
  /** Tools runs in the desktop app only. */
  supported: !!desktop,
  status: 'off' as 'off' | 'reading' | 'ready',
  /** Where the app looked for the game when it could not find it. */
  looked: [] as string[],
  error: null as string | null,
  install: null as Install | null,
  /** Package tables read so far, by lower-case file name; null: not in the install. */
  packages: {} as Record<string, PackageInfo | null | 'reading'>,
  /** The player's library folder (Documents\Long War Tech Tree). */
  library: null as string | null,
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

let files: GameFiles | null = null
let managed: Managed = emptyManaged()
/** The install's packages as they are now, by lower-case name (for the checks). */
let current = new Map<string, Package | null>()
const lower = (s: string) => s.toLowerCase()
export const checkKey = (m: Mod, f: ModFile) => `${m.id}:${f.path}`

// --- The game folder -----------------------------------------------------------

/** LWR ships LWRebalance.u; Long War 1.0 LongWar.upk; neither is plain Enemy Within. */
export function installKind(cooked: string[]): InstallKind {
  const has = (n: string) => cooked.some((c) => c.toLowerCase() === n.toLowerCase())
  if (has('LWRebalance.u')) return 'lwr'
  if (has('LongWar.upk')) return 'lw'
  return 'ew'
}

/** Reads what is installed, switches the site to that version and loads its INI. */
async function readInstall(): Promise<void> {
  if (!desktop) return
  tools.packages = {}
  tools.checks = {}
  current = new Map()
  const game = await desktop.game.current()
  if (!game) {
    Object.assign(tools, { status: 'off', install: null, iniEntries: [] })
    files = null
    return
  }
  tools.status = 'reading'
  tools.error = null
  try {
    files = desktopFiles(desktop)
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
    tools.install = { kind, path: game.root, ini, cooked }
    managed = await loadManaged(files)
    tools.status = 'ready'
    void checkMods()
  } catch (e) {
    tools.error = (e as Error).message
    tools.status = 'off'
  }
}

/** A package's tables, read once per install (only the header part of the file). */
export async function readPackage(name: string): Promise<void> {
  const key = lower(name)
  if (!desktop || !tools.install || key in tools.packages) return
  const real = tools.install.cooked.find((c) => lower(c) === key)
  if (!real) {
    tools.packages[key] = null
    return
  }
  tools.packages[key] = 'reading'
  try {
    const path = `CookedPCConsole/${real}`
    const head = (await desktop.game.read(path, 0, 64))!
    const size = headerSizeOf(head)
    const pk = readUpk((await desktop.game.read(path, 0, size))!)
    tools.packages[key] = {
      size: 0,
      compressed: pk.compressed,
      exports: markRaw(new Set(exportsByPath(pk).keys())),
    }
  } catch {
    tools.packages[key] = null
  }
}

/** Finds the game the way installers do (Steam's registration with Windows). */
export async function findGameFolder(): Promise<void> {
  if (!desktop) return
  tools.status = 'reading'
  const r = await desktop.game.find()
  tools.looked = r.game ? [] : r.looked
  await readInstall()
}

/** The player chooses the folder. */
export async function chooseGameFolder(): Promise<void> {
  if (!desktop) return
  const r = await desktop.game.choose()
  tools.error = r.error
  if (r.game) {
    tools.looked = []
    await readInstall()
  }
}

export async function rereadInstall(): Promise<void> {
  await readInstall()
}

export async function forgetGameFolder(): Promise<void> {
  if (!desktop) return
  await desktop.game.forget()
  files = null
  current = new Map()
  Object.assign(tools, {
    status: 'off',
    error: null,
    install: null,
    packages: {},
    checks: {},
    iniEntries: [],
    plan: null,
    looked: [],
  })
}

/** On start-up in the app: the library, the settings, and the game (found the first time). */
export async function restoreTools(): Promise<void> {
  if (!desktop) return
  const lib = desktop.library
  if (lib) {
    try {
      tools.library = (await lib.info()).dir
      choices = (await readSettings(lib)) ?? emptySettings()
      await moveOldLibrary()
    } catch (e) {
      tools.error = `Could not read your library folder: ${(e as Error).message}`
    }
    tools.settings = choices.ini
    await loadMods()
    // A mod copied into the folder by hand turns up when the app is back in front.
    window.addEventListener('focus', () => void rereadLibrary())
  }
  if (await desktop.game.current()) await readInstall()
  else await findGameFolder()
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
        ...m.wanted,
        [f.path]: status === 'installed' || status === 'other-values',
      }
      await save(m)
    }
    await new Promise((res) => setTimeout(res, 0))
  }
}

// --- The mod library: the player's library folder (state/library.ts) -------------

export function fileKind(path: string, text?: string): ModFileKind {
  const name = path.toLowerCase()
  if (/\.(u|upk)$/.test(name)) return 'package'
  if (name.endsWith('.ini')) return 'config'
  if (name.endsWith('.txt') && text !== undefined && /^\s*UPK_FILE\s*=/m.test(text)) return 'script'
  if (/\.(txt|md|pdf|html?)$/.test(name)) return 'doc'
  return 'other'
}

/** The player's choices: settings.json in the library. */
let choices: LibrarySettings = emptySettings()
/** The library's Mods listing as last read, to see whether it changed. */
let listing = ''
let writing = Promise.resolve()

/** Writes settings.json, one write at a time. */
function saveChoices(): Promise<void> {
  const lib = desktop?.library
  if (!lib) return Promise.resolve()
  const snapshot = JSON.parse(JSON.stringify(choices)) as LibrarySettings
  writing = writing
    .then(() => writeSettings(lib, snapshot))
    .catch((e) => {
      tools.error = `Could not write settings.json in your library: ${(e as Error).message}`
    })
  return writing
}

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

/** Reads the mods in the library's Mods folder, in the player's order. */
async function loadMods(): Promise<void> {
  const lib = desktop?.library
  if (!lib) {
    tools.mods = []
    return
  }
  const files = await lib.files()
  listing = JSON.stringify(files.filter((f) => f.path.startsWith(`${MODS}/`)))
  const mods: Mod[] = []
  for (const g of modsIn(files)) {
    const modFiles: ModFile[] = []
    let readme: string | undefined
    for (const f of g.files) {
      const name = f.rel.split('/').pop()!
      const textual = /\.(txt|md|ini)$/i.test(name)
      // Docs and other files are listed, not read.
      const bytes = textual || /\.(u|upk)$/i.test(name) ? await lib.read(f.path) : null
      const text = textual && bytes ? new TextDecoder().decode(bytes) : undefined
      const kind = fileKind(f.rel, text)
      if (/^readme/i.test(name) && text) readme = readmeIntro(text)
      modFiles.push({
        path: f.rel,
        size: f.size,
        kind,
        data: new Blob(bytes ? [bytes as BlobPart] : []),
        script: kind === 'script' ? parseModScript(text!, f.rel) : undefined,
      })
    }
    // A file on its own in Mods that is not a mod script is not a mod.
    if (!g.folder && modFiles[0]!.kind !== 'script') continue
    const c = choices.mods[g.id] ?? {}
    mods.push({
      id: g.id,
      name: g.folder ? g.id : modFiles[0]!.script!.name,
      files: modFiles,
      values: c.values ?? {},
      wanted: c.wanted,
      wantFiles: c.wantFiles,
      readme,
    })
  }
  const order = orderOf(
    mods.map((m) => m.id),
    choices.order,
  )
  tools.mods = order.map((id) => mods.find((m) => m.id === id)!)
  if (JSON.stringify(order) !== JSON.stringify(choices.order)) {
    choices.order = order
    void saveChoices()
  }
}

/** Reads the library again if its Mods folder changed (a mod copied in by hand). */
export async function rereadLibrary(): Promise<void> {
  const lib = desktop?.library
  if (!lib) return
  const files = await lib.files()
  if (JSON.stringify(files.filter((f) => f.path.startsWith(`${MODS}/`))) === listing) return
  await loadMods()
  void checkMods()
}

export function openLibrary(): void {
  void desktop?.library?.open()
}

async function save(m: Mod): Promise<void> {
  choices.mods[m.id] = { values: m.values, wanted: m.wanted, wantFiles: m.wantFiles }
  await saveChoices()
}

/**
 * Adds mods to the library: a script file on its own goes into Mods as it
 * is; files picked as a folder (they carry a relative path) become a folder
 * there, named after theirs.
 */
export async function addModFiles(picked: File[]): Promise<number> {
  const lib = desktop?.library
  if (!lib) return 0
  const groups = new Map<string, File[]>()
  for (const f of picked) {
    const folder = f.webkitRelativePath.split('/')[0]
    const key = folder && f.webkitRelativePath.includes('/') ? `dir:${folder}` : `file:${f.name}`
    groups.set(key, [...(groups.get(key) ?? []), f])
  }
  const taken = new Set(
    (await lib.files())
      .filter((f) => f.path.startsWith(`${MODS}/`))
      .map((f) => f.path.split('/')[1]!),
  )
  let added = 0
  for (const [key, group] of groups) {
    if (key.startsWith('file:')) {
      const f = group[0]!
      // A lone file that is not a mod script is not a mod.
      if (fileKind(f.name, await f.text()) !== 'script') continue
      const id = freeName(safeName(f.name), taken)
      await lib.write(`${MODS}/${id}`, new Uint8Array(await f.arrayBuffer()))
      taken.add(id)
    } else {
      const id = freeName(safeName(key.slice(4)), taken)
      for (const f of group) {
        const rel = f.webkitRelativePath.split('/').slice(1).join('/')
        await lib.write(`${MODS}/${id}/${rel}`, new Uint8Array(await f.arrayBuffer()))
      }
      taken.add(id)
    }
    added++
  }
  if (added) {
    await loadMods()
    void checkMods()
  }
  return added
}

/** Takes a mod out of the library: its files go to the recycle bin. */
export async function removeMod(id: string): Promise<void> {
  const lib = desktop?.library
  if (!lib) return
  try {
    await lib.trash(`${MODS}/${id}`)
  } catch (e) {
    tools.error = `Could not remove ${id}: ${(e as Error).message}`
    return
  }
  tools.mods = tools.mods.filter((m) => m.id !== id)
  delete choices.mods[id]
  choices.order = choices.order.filter((x) => x !== id)
  await saveChoices()
}

/** Sets one option of one script; an empty value goes back to the script's own. */
export async function setOption(id: string, script: string, option: string, value: string) {
  const m = tools.mods.find((x) => x.id === id)
  if (!m) return
  const v = { ...m.values[script] }
  if (value === '') delete v[option]
  else v[option] = value
  m.values = { ...m.values, [script]: v }
  await save(m)
  void checkMods()
}

export async function setWanted(id: string, script: string, want: boolean) {
  const m = tools.mods.find((x) => x.id === id)
  if (!m) return
  m.wanted = { ...m.wanted, [script]: want }
  await save(m)
}

export async function setWantFiles(id: string, want: boolean) {
  const m = tools.mods.find((x) => x.id === id)
  if (!m) return
  m.wantFiles = want
  await save(m)
}

/**
 * Mods and settings kept in the app's IndexedDB before the library folder
 * (0.2 and earlier): written out to the library once, then dropped there.
 */
async function moveOldLibrary(): Promise<void> {
  const lib = desktop?.library
  if (!lib) return
  const old = await stored<StoredMod[]>('mods', 'readonly', (s) => s.getAll()).catch(
    () => [] as StoredMod[],
  )
  const oldIni = await stored<IniChange[] | undefined>('state', 'readonly', (s) =>
    s.get('settings'),
  ).catch(() => undefined)
  if (!old.length && !oldIni?.length) return
  const taken = new Set(
    (await lib.files())
      .filter((f) => f.path.startsWith(`${MODS}/`))
      .map((f) => f.path.split('/')[1]!),
  )
  for (const m of old.sort((a, b) => a.addedAt - b.addedAt)) {
    const only = m.files.length === 1 ? m.files[0]! : null
    const loose = !!only && only.kind === 'script' && !only.path.includes('/')
    const id = freeName(safeName(loose ? only!.path : m.name), taken)
    taken.add(id)
    for (const f of m.files) {
      const data = new Uint8Array(await f.data.arrayBuffer())
      await lib.write(loose ? `${MODS}/${id}` : `${MODS}/${id}/${f.path}`, data)
    }
    choices.mods[id] = { values: m.values, wanted: m.wanted, wantFiles: m.wantFiles }
    choices.order.push(id)
  }
  if (oldIni?.length && !choices.ini.length) choices.ini = oldIni
  await saveChoices()
  await stored('mods', 'readwrite', (s) => s.clear()).catch(() => undefined)
  await stored('state', 'readwrite', (s) => s.delete('settings')).catch(() => undefined)
}

// --- INI settings ----------------------------------------------------------------

const sameSetting = (a: IniChange, b: IniChange) =>
  a.section === b.section && a.key === b.key && a.occurrence === b.occurrence

/** Sets (or, with value null, drops) one of the player's INI settings. */
export async function setSetting(entry: IniChange, value: string | null) {
  const rest = tools.settings.filter((s) => !sameSetting(s, entry))
  tools.settings = value === null ? rest : [...rest, { ...entry, value }]
  choices.ini = JSON.parse(JSON.stringify(tools.settings))
  await saveChoices()
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
          values: { ...m.values[f.path] },
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
    tools.log = await applyPlan(files, plan, (done, total, path) => {
      tools.busy = `Writing ${done + 1} of ${total}: ${path}`
    })
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
