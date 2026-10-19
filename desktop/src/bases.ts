// The game versions the app can put into the game (features/game-bases.md):
// Long War from its installer and LWR from its zip or folder, found in the
// player's library and unpacked once into the app's cache. Each becomes a
// base: its files (paths under XEW\XComGame), the files its installer
// deletes, and the byte patches it makes to XComEW.exe.

import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { listTree } from './game'
import { readInnoSetup } from './inno'
import { readZip } from './zip'

export type BaseKind = 'lw' | 'lwr'

export interface BaseFile {
  /** Under XEW\XComGame, with "/". */
  path: string
  size: number
  sha256: string
}
export interface ExePatch {
  description: string
  /** Hex bytes. */
  find: string
  replace: string
}
export interface BaseManifest {
  /** The SHA-256 of what it came from (the installer, the zip, or the folder's listing). */
  id: string
  kind: BaseKind
  name: string
  version: string
  /** Where it is in the library. */
  source: string
  files: BaseFile[]
  /** Files the installer deletes after copying (under XComGame). */
  deletes: string[]
  /** Byte patches to Binaries\Win32\XComEW.exe. */
  exePatches: ExePatch[]
  /** Its own notes (text files beside the game folder), kept in docs/. */
  docs?: string[]
}
/** A base found in the library, unpacked or not. */
export type BaseFound = Omit<BaseManifest, 'files' | 'deletes' | 'exePatches'> & {
  unpacked: boolean
}

/** Where LWR's installer copies from: these folders, into XEW\XComGame. */
const LWR_FOLDERS = ['Config', 'CookedPCConsole', 'Localization', 'Movies']
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

/** "v2.06.00" out of a name like "LW Rebalance v2.06.00". */
const versionIn = (s: string) => /v?(\d+(?:\.\d+)+)/i.exec(s)?.[1] ?? ''

/** The installer's own scripts: the files run_init.bat deletes, relative to "Long War Files". */
export function deletesIn(bat: string): string[] {
  const out: string[] = []
  for (const m of bat.matchAll(/^\s*del\s+"?([^"\r\n]+?)"?\s*$/gim)) {
    const p = path.posix.normalize(path.posix.join('Long War Files', m[1]!.replace(/\\/g, '/')))
    if (p.startsWith('XComGame/')) out.push(p.slice('XComGame/'.length))
  }
  return out
}

/** XCOMModHelper's configuration: byte patches to XComEW.exe (the only target it has). */
export function exePatchesIn(xml: string): ExePatch[] {
  const out: ExePatch[] = []
  for (const t of xml.matchAll(/<PatchTarget>([\s\S]*?)<\/PatchTarget>/g)) {
    const target = /<TargetPath>([^<]+)<\/TargetPath>/.exec(t[1]!)?.[1]?.trim() ?? ''
    if (!/^XEW\\Binaries\\Win32\\XComEW\.exe$/i.test(target))
      throw new Error(`the Long War installer patches ${target}, which the app does not know`)
    for (const e of t[1]!.matchAll(/<PatchEntry>([\s\S]*?)<\/PatchEntry>/g)) {
      const get = (tag: string) =>
        (new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(e[1]!)?.[1] ?? '').trim()
      const hex = (s: string) => s.replace(/\s+/g, '').toLowerCase()
      const find = hex(get('FindValue'))
      const replace = hex(get('ReplaceValue'))
      if (!find || find.length !== replace.length || !/^[0-9a-f]+$/.test(find + replace))
        throw new Error('the Long War installer has an exe patch the app does not read')
      out.push({ description: get('Description'), find, replace })
    }
  }
  return out
}

interface IndexEntry {
  source: string
  size: number
  modified: number
  found: Omit<BaseFound, 'unpacked'> | null
}

export class BaseStore {
  private index = new Map<string, IndexEntry>()
  private indexRead = false

  constructor(
    /** The player's library. */
    private library: string,
    /** The cache: one folder per unpacked base. */
    private cache: string,
  ) {}

  private indexFile = () => path.join(this.cache, 'index.json')

  private async loadIndex() {
    if (this.indexRead) return
    this.indexRead = true
    try {
      for (const e of JSON.parse(await fs.readFile(this.indexFile(), 'utf8')) as IndexEntry[])
        this.index.set(e.source, e)
    } catch {
      // none yet
    }
  }
  private async saveIndex() {
    await fs.mkdir(this.cache, { recursive: true })
    await fs.writeFile(this.indexFile(), JSON.stringify([...this.index.values()], null, 1))
  }

  /** What the library holds: Long War installers, and LWR as zips or folders. */
  async list(): Promise<BaseFound[]> {
    await this.loadIndex()
    const files = (await listTree(this.library)).filter((f) => !f.path.startsWith('Mods/'))
    const out: BaseFound[] = []
    const seen = new Set<string>()
    for (const f of files) {
      const lower = f.path.toLowerCase()
      let source: string | null = null
      if (lower.endsWith('.exe') || lower.endsWith('.zip')) source = f.path
      else if (lower.endsWith('/cookedpcconsole/lwrebalance.u'))
        source = f.path.slice(0, -'/CookedPCConsole/LWRebalance.u'.length)
      if (!source || seen.has(source)) continue
      seen.add(source)
      const known = this.index.get(source)
      let found: IndexEntry['found']
      if (known && known.size === f.size && known.modified === f.modified) found = known.found
      else {
        found = await this.identify(source, f.path).catch(() => null)
        this.index.set(source, { source, size: f.size, modified: f.modified, found })
        await this.saveIndex()
      }
      if (found) out.push({ ...found, unpacked: existsSync(this.manifestFile(found.id)) })
    }
    return out
  }

  private manifestFile = (id: string) => path.join(this.cache, id, 'manifest.json')
  private abs = (rel: string) => path.join(this.library, ...rel.split('/'))

  /** What a candidate is, without unpacking it. */
  private async identify(source: string, file: string): Promise<IndexEntry['found']> {
    const lower = file.toLowerCase()
    if (lower.endsWith('.exe')) {
      const b = await fs.readFile(this.abs(source))
      const setup = readInnoSetup(b)
      if (!/long war/i.test(setup.appName)) return null
      if (!setup.files.some((f) => /\\LongWar\.upk$/i.test(f.destination))) return null
      return {
        id: sha(b),
        kind: 'lw',
        name: `Long War ${setup.appVersion}`,
        version: setup.appVersion,
        source,
      }
    }
    if (lower.endsWith('.zip')) {
      const b = await fs.readFile(this.abs(source))
      const zip = readZip(b)
      const marker = zip.entries.find((e) => /(^|\/)CookedPCConsole\/LWRebalance\.u$/i.test(e.path))
      if (!marker) return null
      const root = marker.path.slice(0, -'CookedPCConsole/LWRebalance.u'.length)
      const version = versionIn(root) || versionIn(path.basename(source))
      return {
        id: sha(b),
        kind: 'lwr',
        name: `Long War Rebalanced ${version}`.trim(),
        version,
        source,
      }
    }
    // A folder: identified by its listing (paths, sizes).
    const listing = (await listTree(this.abs(source))).map((f) => `${f.path}:${f.size}`).join('\n')
    const version = versionIn(path.basename(source))
    return {
      id: sha(new TextEncoder().encode(`${source}\n${listing}`)),
      kind: 'lwr',
      name: `Long War Rebalanced ${version}`.trim(),
      version,
      source,
    }
  }

  async manifest(id: string): Promise<BaseManifest | null> {
    try {
      return JSON.parse(await fs.readFile(this.manifestFile(id), 'utf8'))
    } catch {
      return null
    }
  }

  /** Unpacks a base into the cache (once), and returns what it holds. */
  async unpack(
    id: string,
    progress?: (done: number, total: number) => void,
  ): Promise<BaseManifest> {
    const have = await this.manifest(id)
    // Long War unpacked by 0.3.0 kept no notes: unpacked again, once.
    if (have && (have.kind !== 'lw' || have.docs)) return have
    const found = (await this.list()).find((b) => b.id === id)
    if (!found) throw new Error('that base is no longer in the library')
    const dir = path.join(this.cache, id)
    const tmp = `${dir}.unpacking-${process.pid}`
    await fs.rm(tmp, { recursive: true, force: true })
    const files: BaseFile[] = []
    const put = async (rel: string, data: Uint8Array) => {
      const p = path.join(tmp, 'files', ...rel.split('/'))
      await fs.mkdir(path.dirname(p), { recursive: true })
      await fs.writeFile(p, data)
      files.push({ path: rel, size: data.length, sha256: sha(data) })
    }
    let deletes: string[] = []
    const docs: string[] = []
    let exePatches: ExePatch[] = []
    try {
      if (found.kind === 'lw') {
        const setup = readInnoSetup(await fs.readFile(this.abs(found.source)))
        const wanted = setup.files.filter((f) => /^\{app\}\\XComGame\\/i.test(f.destination))
        const own = (name: string) => {
          const f = setup.files.find(
            (x) => x.destination.toLowerCase() === `{app}\\long war files\\${name}`,
          )
          return f ? new TextDecoder('windows-1252').decode(setup.read(f)) : ''
        }
        // Long War's own notes beside the game folder: the Armor Kit codes name
        // the class colors and headgear numbers (features/game-settings.md).
        for (const f of setup.files.filter((x) => /^\{app\}\\[^\\]+\.txt$/i.test(x.destination))) {
          const name = f.destination.slice('{app}\\'.length)
          const p = path.join(tmp, 'docs', name)
          await fs.mkdir(path.dirname(p), { recursive: true })
          await fs.writeFile(p, setup.read(f))
          docs.push(name)
        }
        deletes = deletesIn(own('run_init.bat'))
        exePatches = exePatchesIn(own('long_war_ew_config_exe.xml') || '<x/>')
        for (const [i, f] of wanted.entries()) {
          progress?.(i, wanted.length)
          await put(
            f.destination.slice('{app}\\XComGame\\'.length).replace(/\\/g, '/'),
            setup.read(f),
          )
        }
      } else if (found.source.toLowerCase().endsWith('.zip')) {
        const zip = readZip(await fs.readFile(this.abs(found.source)))
        const marker = zip.entries.find((e) =>
          /(^|\/)CookedPCConsole\/LWRebalance\.u$/i.test(e.path),
        )!
        const root = marker.path.slice(0, -'CookedPCConsole/LWRebalance.u'.length)
        const wanted = zip.entries.filter((e) => {
          const rel = e.path.slice(root.length)
          return e.path.startsWith(root) && LWR_FOLDERS.some((d) => rel.startsWith(`${d}/`))
        })
        for (const [i, e] of wanted.entries()) {
          progress?.(i, wanted.length)
          await put(e.path.slice(root.length), zip.read(e))
        }
      } else {
        const wanted = (await listTree(this.abs(found.source))).filter((f) =>
          LWR_FOLDERS.some((d) => f.path.startsWith(`${d}/`)),
        )
        for (const [i, f] of wanted.entries()) {
          progress?.(i, wanted.length)
          await put(
            f.path,
            new Uint8Array(await fs.readFile(path.join(this.abs(found.source), f.path))),
          )
        }
      }
      const { unpacked: _, ...rest } = found
      const manifest: BaseManifest = { ...rest, files, deletes, exePatches, docs }
      // The manifest last: a base without one was not unpacked whole.
      await fs.writeFile(path.join(tmp, 'manifest.json'), JSON.stringify(manifest))
      await fs.rm(dir, { recursive: true, force: true })
      await fs.rename(tmp, dir)
      return manifest
    } catch (e) {
      await fs.rm(tmp, { recursive: true, force: true })
      throw e
    }
  }

  /** One of a base's own notes, or null. */
  async doc(id: string, name: string): Promise<Uint8Array | null> {
    const m = await this.manifest(id)
    const real = m?.docs?.find((d) => d.toLowerCase() === name.toLowerCase())
    if (!real) return null
    return new Uint8Array(await fs.readFile(path.join(this.cache, id, 'docs', real)))
  }

  /** A base file's place in the cache. */
  async file(id: string, rel: string): Promise<string> {
    const m = await this.manifest(id)
    const f = m?.files.find((x) => x.path.toLowerCase() === rel.toLowerCase())
    if (!f) throw new Error(`${rel} is not in that base`)
    return path.join(this.cache, id, 'files', ...f.path.split('/'))
  }
}
