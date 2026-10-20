// The shell's site bundles and its updates (features/desktop-updates.md),
// after Mimiri's bundle manager: the base bundle shipped with the installer,
// newer signed bundles kept in the app's user data, the active one served,
// a new one switched to at the player's restart, rolled back if it never
// reports that it started. Electron-free, so its tests run in plain Node.

import { randomUUID } from 'node:crypto'
import { existsSync, promises as fs, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import {
  compareVersions,
  openBundle,
  sha256,
  unpack,
  verifyFile,
  type SignedBundle,
  type TrustedKeys,
  type UpdateInfo,
} from './bundle-format'

interface Config {
  /** "base" or a version under bundles/. */
  active: string
  previous?: string
  /** A version switched to that has not yet reported a good start, and how often it was started. */
  unproven?: string
  starts?: number
  /** Versions that failed: never installed again. */
  bad?: string[]
}

export interface BundleState {
  shellVersion: string
  /** The bundle being served. */
  serving: string
  base: string
  /** A newer bundle installed and waiting for a restart. */
  ready?: string
  /** A newer shell the server offers (the bundle needs it, or it is simply newer). */
  shell?: { version: string; needed: boolean; downloaded: boolean; fetching?: boolean }
  checking: boolean
  lastCheck?: string
  error?: string
}

export type Fetch = (
  url: string,
) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>

export interface StoreOptions {
  /** Where bundles live (user data). */
  dir: string
  /** The bundle shipped with the shell, and its version. */
  baseDir: string
  baseVersion: string
  shellVersion: string
  keys: TrustedKeys
  /** The update server ("https://xcom.innonova.ch") and channel ("staging"); none: no updates. */
  updateUrl?: string
  channel: string
  fetch: Fetch
  /** Called when the state changes outside a check (a newer app fetched in the background). */
  onChange?: () => void
}

/** Whether a bundle folder is whole: its manifest's files all there at their size. */
export function bundleIsWhole(dir: string): boolean {
  try {
    if (!existsSync(path.join(dir, 'index.html'))) return false
    const manifest = JSON.parse(readFileSync(path.join(dir, '.bundle-manifest.json'), 'utf8')) as {
      path: string
      size: number
    }[]
    return manifest.every((f) => {
      const p = path.join(dir, f.path)
      return existsSync(p) && statSync(p).size === f.size
    })
  } catch {
    return false
  }
}

export class BundleStore {
  private config: Config = { active: 'base' }
  private configPath: string
  private servingPath: string
  private servingVersion: string
  state: BundleState
  private shellInstaller?: string

  constructor(private o: StoreOptions) {
    this.configPath = path.join(o.dir, 'config.json')
    this.servingPath = o.baseDir
    this.servingVersion = o.baseVersion
    this.state = {
      shellVersion: o.shellVersion,
      serving: o.baseVersion,
      base: o.baseVersion,
      checking: false,
    }
  }

  get activeDir() {
    return this.servingPath
  }

  /**
   * At start: pick the bundle to serve. A bundle that was started before
   * and never reported good is rolled back; one older than the base, not
   * whole, or needing a newer shell is passed over for the base.
   */
  async start(): Promise<void> {
    await fs.mkdir(this.o.dir, { recursive: true })
    // Downloads cut short are swept away.
    for (const e of await fs.readdir(this.o.dir))
      if (e.includes('.downloading'))
        await fs.rm(path.join(this.o.dir, e), { recursive: true, force: true })
    try {
      this.config = { active: 'base', ...JSON.parse(await fs.readFile(this.configPath, 'utf8')) }
    } catch {
      this.config = { active: 'base' }
    }
    if (this.config.unproven && this.config.unproven === this.config.active) {
      this.config.starts = (this.config.starts ?? 0) + 1
      if (this.config.starts > 1) {
        // It was started and never said it worked: back to the one before.
        this.config.bad = [...new Set([...(this.config.bad ?? []), this.config.active])]
        this.config.active = this.config.previous ?? 'base'
        delete this.config.unproven
        delete this.config.starts
      }
      await this.save()
    }
    this.pickServing()
  }

  private pickServing() {
    const v = this.config.active
    const dir = path.join(this.o.dir, v)
    const usable =
      v !== 'base' &&
      compareVersions(v, this.o.baseVersion) > 0 &&
      bundleIsWhole(dir) &&
      this.minShellOk(dir)
    this.servingPath = usable ? dir : this.o.baseDir
    this.servingVersion = usable ? v : this.o.baseVersion
    this.state.serving = this.servingVersion
  }

  private minShellOk(dir: string): boolean {
    try {
      const info = JSON.parse(readFileSync(path.join(dir, '.bundle-info.json'), 'utf8'))
      return compareVersions(info.minShellVersion, this.o.shellVersion) <= 0
    } catch {
      return false
    }
  }

  private async save() {
    await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 1))
  }

  /** The page started and works: the bundle it runs is good, and old bundles go. */
  async good(): Promise<void> {
    if (this.config.unproven === this.servingVersion) {
      delete this.config.unproven
      delete this.config.starts
      await this.save()
    }
    const keep = new Set([
      this.config.active,
      this.config.previous,
      this.servingVersion,
      this.state.ready,
    ])
    for (const e of await fs.readdir(this.o.dir).catch(() => [] as string[]))
      if (e !== 'config.json' && !keep.has(e) && !e.includes('.downloading'))
        await fs.rm(path.join(this.o.dir, e), { recursive: true, force: true })
  }

  private async get(url: string): Promise<Uint8Array> {
    const r = await this.o.fetch(url)
    if (!r.ok) throw new Error(`${url}: ${r.status}`)
    return new Uint8Array(await r.arrayBuffer())
  }

  /**
   * Asks the update server what is new. A newer bundle this shell can run
   * is downloaded, checked and installed, ready for the next start; a newer
   * shell is reported (and downloaded and checked when the bundle needs it).
   */
  async check(): Promise<BundleState> {
    if (!this.o.updateUrl || this.state.checking) return this.state
    this.state.checking = true
    this.state.error = undefined
    try {
      const base = this.o.updateUrl.replace(/\/+$/, '')
      const info = JSON.parse(
        new TextDecoder().decode(
          await this.get(`${base}/bundle/${this.o.channel}.json?r=${Date.now()}`),
        ),
      ) as UpdateInfo
      const newest = this.state.ready ?? this.servingVersion
      const b = info.bundle
      const newer =
        compareVersions(b.version, newest) > 0 && !(this.config.bad ?? []).includes(b.version)
      const fits = compareVersions(b.minShellVersion, this.o.shellVersion) <= 0
      if (newer && fits) await this.install(`${base}/${b.url}`, b.version)
      if (info.shell && compareVersions(info.shell.version, this.o.shellVersion) > 0) {
        const needed = newer && !fits
        const had = this.state.shell
        const same = had?.version === info.shell.version
        this.state.shell = {
          version: info.shell.version,
          needed,
          downloaded: same ? had.downloaded : false,
          fetching: same ? had.fetching : false,
        }
        // Fetched in the background, so "Install it and restart" starts at once.
        if (!this.state.shell.downloaded && !this.state.shell.fetching)
          this.fetchInBackground(`${base}/${info.shell.url}`, info.shell)
      }
      this.state.lastCheck = new Date().toISOString()
    } catch (e) {
      this.state.error = (e as Error).message
    } finally {
      this.state.checking = false
    }
    return this.state
  }

  /** Downloads, checks and installs a bundle; it becomes active at the next start. */
  async install(url: string, expectVersion: string): Promise<void> {
    const signed = JSON.parse(new TextDecoder().decode(await this.get(url))) as SignedBundle
    const payload = openBundle(signed, this.o.keys)
    if (payload.version !== expectVersion)
      throw new Error('the bundle is not the version announced')
    if (compareVersions(payload.version, this.servingVersion) <= 0) throw new Error('not newer')
    const tmp = path.join(this.o.dir, `${payload.version}.downloading-${randomUUID()}`)
    try {
      const manifest: { path: string; size: number }[] = []
      for (const f of unpack(payload)) {
        const p = path.join(tmp, ...f.path.split('/'))
        await fs.mkdir(path.dirname(p), { recursive: true })
        await fs.writeFile(p, f.data)
        manifest.push({ path: f.path, size: f.data.length })
      }
      await fs.writeFile(path.join(tmp, '.bundle-manifest.json'), JSON.stringify(manifest))
      await fs.writeFile(
        path.join(tmp, '.bundle-info.json'),
        JSON.stringify({
          version: payload.version,
          minShellVersion: payload.minShellVersion,
          releaseDate: payload.releaseDate,
        }),
      )
      if (!bundleIsWhole(tmp)) throw new Error('the bundle did not unpack whole')
      const final = path.join(this.o.dir, payload.version)
      await fs.rm(final, { recursive: true, force: true })
      await fs.rename(tmp, final)
    } catch (e) {
      await fs.rm(tmp, { recursive: true, force: true })
      throw e
    }
    if (this.config.active !== payload.version) this.config.previous = this.config.active
    this.config.active = payload.version
    this.config.unproven = payload.version
    this.config.starts = 0
    await this.save()
    this.state.ready = payload.version
  }

  /** Serves the ready bundle now (the page reloads into it). */
  activate(): boolean {
    if (!this.state.ready) return false
    this.pickServing()
    if (this.servingVersion !== this.state.ready) return false
    // A start of it: if it never reports good, the next start rolls it back.
    this.config.starts = 1
    void this.save()
    this.state.ready = undefined
    return true
  }

  private async downloadShell(url: string, s: NonNullable<UpdateInfo['shell']>) {
    const data = await this.get(url)
    if (data.length !== s.size || sha256(data) !== s.sha256)
      throw new Error('the new app download is damaged')
    if (!verifyFile(data, s.signature, s.key, this.o.keys))
      throw new Error('the new app is not signed by us')
    const file = path.join(this.o.dir, `shell-${s.version}.exe`)
    await fs.writeFile(file, data)
    this.shellInstaller = file
    if (this.state.shell) this.state.shell.downloaded = true
  }

  /** Downloads and checks a newer shell without holding up the check; says when done. */
  private fetchInBackground(url: string, s: NonNullable<UpdateInfo['shell']>) {
    if (this.state.shell) this.state.shell.fetching = true
    this.downloadShell(url, s)
      .catch((e) => (this.state.error = (e as Error).message))
      .finally(() => {
        if (this.state.shell) this.state.shell.fetching = false
        this.o.onChange?.()
      })
  }

  /** The checked installer of a newer shell, if one was downloaded. */
  get installer(): string | undefined {
    return this.shellInstaller
  }

  /** Downloads and checks the newer shell when the player asks for it. */
  async fetchShell(): Promise<string | undefined> {
    if (this.shellInstaller) return this.shellInstaller
    const base = this.o.updateUrl?.replace(/\/+$/, '')
    if (!base) return undefined
    const info = JSON.parse(
      new TextDecoder().decode(
        await this.get(`${base}/bundle/${this.o.channel}.json?r=${Date.now()}`),
      ),
    ) as UpdateInfo
    if (!info.shell || compareVersions(info.shell.version, this.o.shellVersion) <= 0)
      return undefined
    await this.downloadShell(`${base}/${info.shell.url}`, info.shell)
    return this.shellInstaller
  }
}
