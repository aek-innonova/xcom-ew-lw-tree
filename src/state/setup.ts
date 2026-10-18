// Putting the player's setup into the game (features/game-tools.md): the
// mods they want, their files, their INI settings. Everything is worked out
// first (a plan: which files change, and why) and written only when the
// player says so.
//
// Each file the page changes is first copied, as it was, to
// XComGame/lwtree-backup/; that copy is the file's original. The setup is
// always built from the originals: mods are applied to them in library
// order, settings set, mod files merged in. So taking a mod out of the setup
// takes it out of the game. If a file is neither its original nor what the
// page last wrote (the game was reinstalled, or another tool changed it), the
// file as it now is becomes the new original.

import { runScript } from '@/model/modpatch'
import { parseCommands } from '@/model/modpatch'
import { iniBytes, iniText, mergeIni, setIniValues, type IniChange } from '@/model/inifile'
import { Package } from '@/model/upk'
import { sha256, type GameFiles } from './gamefiles'

export const BACKUP = 'lwtree-backup'
export const GAME_INI = 'Config/DefaultGameCore.ini'

/** What the page knows about files it manages (kept per game folder). */
export interface Managed {
  /** SHA-256 of each file's original (its backup). */
  originals: Record<string, string>
  /** SHA-256 of what the page last wrote to each file. */
  written: Record<string, string>
  /** Files the page put there that the game did not have (mod files). */
  created: string[]
}
export const emptyManaged = (): Managed => ({ originals: {}, written: {}, created: [] })

export interface WantedScript {
  /** Shown in messages: "Lightning Reflexes (LightningReflexes.txt)". */
  label: string
  text: string
  values: Record<string, string>
}
export interface WantedFiles {
  label: string
  files: { path: string; kind: 'package' | 'config'; data: Uint8Array }[]
}
export interface Wanted {
  scripts: WantedScript[]
  files: WantedFiles[]
  settings: IniChange[]
}

export interface Change {
  path: string
  action: 'write' | 'create' | 'remove'
  why: string[]
  data?: Uint8Array
  /** The file's current bytes become its original: copy them to the backup first. */
  backup?: Uint8Array
}
export interface Plan {
  changes: Change[]
  /** Things the setup asks for that cannot be done; they are left out. */
  problems: string[]
  /** Managed as it will be once the plan is written. */
  managed: Managed
}

const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((x, i) => x === b[i])
const lower = (s: string) => s.toLowerCase()

/** The original of a file the page may change, and its current bytes. */
async function original(
  files: GameFiles,
  path: string,
  managed: Managed,
): Promise<{ current: Uint8Array | null; base: Uint8Array | null; fresh: boolean }> {
  const current = await files.read(path)
  if (!current) return { current, base: null, fresh: false }
  const known = managed.originals[path]
  if (known) {
    const sha = await sha256(current)
    if (sha === managed.written[path] || sha === known) {
      const backup = await files.read(`${BACKUP}/${path}`)
      if (backup && (await sha256(backup)) === known) return { current, base: backup, fresh: false }
    }
  }
  return { current, base: current, fresh: true }
}

export async function planSetup(files: GameFiles, wanted: Wanted, managed: Managed): Promise<Plan> {
  const next: Managed = {
    originals: { ...managed.originals },
    written: { ...managed.written },
    created: [...managed.created],
  }
  const changes: Change[] = []
  const problems: string[] = []
  const why = new Map<string, string[]>()
  const reason = (path: string, r: string) => why.set(path, [...(why.get(path) ?? []), r])

  async function settle(
    path: string,
    base: Uint8Array,
    current: Uint8Array,
    fresh: boolean,
    data: Uint8Array,
  ) {
    if (fresh) next.originals[path] = await sha256(base)
    if (same(data, current)) return
    next.written[path] = await sha256(data)
    changes.push({
      path,
      action: 'write',
      why: why.get(path) ?? ['back to its original'],
      data,
      backup: fresh ? current : undefined,
    })
  }

  // --- Packages: originals, then every wanted script on them in order ---------
  const upks = new Set<string>()
  for (const s of wanted.scripts)
    for (const c of parseCommands(s.text))
      if (c.name === 'UPK_FILE') upks.add(lower(c.value.trim().split('\n')[0]!.trim()))
  for (const p of Object.keys(managed.originals))
    if (/^cookedpcconsole\/[^/]+\.upk$/i.test(p)) upks.add(lower(p.split('/')[1]!))

  const bases = new Map<
    string,
    { path: string; base: Uint8Array; current: Uint8Array; fresh: boolean; pkg: Package }
  >()
  for (const name of upks) {
    const path = `CookedPCConsole/${(await files.list('CookedPCConsole')).find((f) => lower(f) === name) ?? name}`
    const o = await original(files, path, managed)
    if (!o.current || !o.base) continue
    bases.set(name, {
      path,
      base: o.base,
      current: o.current,
      fresh: o.fresh,
      pkg: new Package(o.base),
    })
  }
  const results = new Map<string, Package>()
  for (const s of wanted.scripts) {
    const r = runScript(s.text, {
      open: (n) => (results.get(lower(n)) ?? bases.get(lower(n))?.pkg)?.clone(),
      values: s.values,
    })
    const err = r.steps.find((x) => x.status === 'error')
    if (err) {
      problems.push(
        `${s.label} does not fit this install (${err.where}: ${err.note}); it is left out.`,
      )
      continue
    }
    for (const [n, pkg] of r.packages) {
      results.set(n, pkg)
      if (r.steps.some((x) => x.status === 'change' && x.where.toLowerCase().startsWith(n)))
        reason(bases.get(n)!.path, s.label)
    }
  }
  for (const [n, b] of bases)
    await settle(b.path, b.base, b.current, b.fresh, results.get(n)?.bytes ?? b.base)

  // --- Config files: settings and mods' INI lines on the originals ------------
  const configEdits = new Map<string, ((text: string) => string)[]>()
  const editConfig = (path: string, edit: (t: string) => string, r: string) => {
    configEdits.set(path, [...(configEdits.get(path) ?? []), edit])
    reason(path, r)
  }
  if (wanted.settings.length)
    editConfig(
      GAME_INI,
      (t) => {
        const { text, missing } = setIniValues(t, wanted.settings)
        for (const m of missing)
          problems.push(`${m.key} is not in DefaultGameCore.ini; it is left out.`)
        return text
      },
      `${wanted.settings.length} setting${wanted.settings.length === 1 ? '' : 's'}`,
    )
  const keep = new Set<string>()
  const config = await files.list('Config')
  const cooked = await files.list('CookedPCConsole')
  for (const m of wanted.files)
    for (const f of m.files) {
      const name = f.path.split('/').pop()!
      if (f.kind === 'config') {
        const existing = config.find((c) => lower(c) === lower(name))
        const path = `Config/${existing ?? name}`
        if (existing && !managed.created.includes(path))
          editConfig(path, (t) => mergeIni(t, iniText(f.data)), m.label)
        else {
          keep.add(path)
          if (!existing || !same((await files.read(path)) ?? new Uint8Array(), f.data)) {
            changes.push({ path, action: 'create', why: [m.label], data: f.data })
            if (!next.created.includes(path)) next.created.push(path)
          }
        }
      } else {
        const existing = cooked.find((c) => lower(c) === lower(name))
        const path = `CookedPCConsole/${existing ?? name}`
        if (existing && !managed.created.includes(path)) continue // the game's own (LWR ships Sightlines.u)
        keep.add(path)
        if (!existing) {
          changes.push({ path, action: 'create', why: [m.label], data: f.data })
          if (!next.created.includes(path)) next.created.push(path)
        }
      }
    }
  for (const path of Object.keys(managed.originals))
    if (path.startsWith('Config/')) configEdits.set(path, configEdits.get(path) ?? [])
  for (const [path, edits] of configEdits) {
    const o = await original(files, path, managed)
    if (!o.current || !o.base) {
      problems.push(`${path} is not in this install.`)
      continue
    }
    let text = iniText(o.base)
    for (const e of edits) text = e(text)
    await settle(path, o.base, o.current, o.fresh, iniBytes(text))
  }
  // Files the page put there for mods no longer wanted.
  for (const path of managed.created)
    if (!keep.has(path)) {
      changes.push({ path, action: 'remove', why: ['no longer in your setup'] })
      next.created = next.created.filter((p) => p !== path)
    }
  return { changes, problems, managed: next }
}

/** Writes a plan: backups first, then each file, each checked by reading it back. */
export async function applyPlan(files: GameFiles, plan: Plan): Promise<string[]> {
  const log: string[] = []
  for (const c of plan.changes) {
    if (c.backup) {
      await files.write(`${BACKUP}/${c.path}`, c.backup)
      const back = await files.read(`${BACKUP}/${c.path}`)
      if (!back || !same(back, c.backup))
        throw new Error(`the backup of ${c.path} did not read back the same`)
      log.push(`Kept the original of ${c.path} in ${BACKUP}/`)
    }
  }
  for (const c of plan.changes) {
    if (c.action === 'remove') {
      await files.remove(c.path)
      log.push(`Removed ${c.path}`)
      continue
    }
    await files.write(c.path, c.data!)
    const back = await files.read(c.path)
    if (!back || !same(back, c.data!)) throw new Error(`${c.path} did not read back as written`)
    log.push(`${c.action === 'create' ? 'Added' : 'Wrote'} ${c.path}`)
  }
  return log
}
