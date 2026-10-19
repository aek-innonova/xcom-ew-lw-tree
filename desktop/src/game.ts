// The game's files from the app's main process (features/desktop-app.md):
// finding the game the way installers do, and keeping every path the page
// asks for inside the folder the app found or the player chose.

import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'

/** XCOM: Enemy Unknown's Steam app; Enemy Within (and Long War in it) lives in its folder. */
export const STEAM_APP = '200510'
const LOOK_LIMIT_MS = 3000

/** A look at the disk with a time limit: a drive that does not answer counts as having nothing. */
function within<T>(ms: number, p: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([
    p.catch(() => fallback),
    new Promise<T>((done) => setTimeout(() => done(fallback), ms)),
  ])
}

export async function isDir(p: string): Promise<boolean> {
  return within(
    LOOK_LIMIT_MS,
    fs.stat(p).then((s) => s.isDirectory()),
    false,
  )
}

export async function isGameDir(p: string): Promise<boolean> {
  return (await isDir(path.join(p, 'CookedPCConsole'))) && (await isDir(path.join(p, 'Config')))
}

/**
 * XComGame at or below a folder (the game folder or XEW). Enemy Within is
 * XEW/XComGame; the game folder's own XComGame is Enemy Unknown's, so XEW
 * comes first.
 */
export async function gameDirUnder(p: string): Promise<string | null> {
  for (const c of [path.join(p, 'XEW', 'XComGame'), p, path.join(p, 'XComGame')])
    if (await isGameDir(c)) return c
  return null
}

/** One value out of `reg query` output ("    SteamPath    REG_SZ    c:/program files (x86)/steam"). */
export function regValue(out: string, name: string): string {
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*(\S+)\s+(REG_\w+)\s+(.*)$/.exec(line)
    if (m && m[1]!.toLowerCase() === name.toLowerCase()) return path.win32.normalize(m[3]!.trim())
  }
  return ''
}

/**
 * A registry value through Windows' reg tool, trying the 64- then the 32-bit
 * view. The uninstall entry turns up in either: 32-bit (WOW6432Node) on some
 * machines, 64-bit on others (seen on the Windows test bench), so both are read.
 */
async function regQuery(key: string, name: string): Promise<string> {
  if (process.platform !== 'win32') return ''
  for (const view of ['/reg:64', '/reg:32']) {
    const out = await within(
      LOOK_LIMIT_MS,
      new Promise<string>((done) =>
        execFile('reg', ['query', key, '/v', name, view], { windowsHide: true }, (_e, stdout) =>
          done(stdout ?? ''),
        ),
      ),
      '',
    )
    const v = regValue(out, name)
    if (v) return v
  }
  return ''
}

/**
 * From Steam's libraryfolders.vdf, the libraries whose "apps" list holds the
 * app; an older file without app lists gives every library it names.
 */
export function librariesWithApp(vdf: string, app: string): string[] {
  const found: string[] = []
  const re = /"path"\s+"([^"]+)"/g
  const hits = [...vdf.matchAll(re)]
  hits.forEach((m, i) => {
    const block = vdf.slice(m.index! + m[0].length, hits[i + 1]?.index ?? vdf.length)
    if (!block.includes('"apps"') || block.includes(`"${app}"`))
      found.push(m[1]!.replace(/\\\\/g, '\\'))
  })
  return found
}

export interface Found {
  root: string
  /** Where it looked, in order. */
  looked: string[]
}

/**
 * The game as Steam registered it with Windows (its uninstall entry's
 * InstallLocation), else in the library Steam's own list says holds it.
 * No drive searching.
 */
export async function findGame(): Promise<Found | null> {
  const looked: string[] = []
  const check = async (dir: string) => {
    looked.push(dir)
    return gameDirUnder(dir)
  }
  for (const hive of ['HKLM', 'HKCU']) {
    const dir = await regQuery(
      `${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Steam App ${STEAM_APP}`,
      'InstallLocation',
    )
    if (dir) {
      const root = await check(dir)
      if (root) return { root, looked }
    }
  }
  const steams = [
    await regQuery('HKCU\\Software\\Valve\\Steam', 'SteamPath'),
    await regQuery('HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath'),
  ].filter(Boolean)
  const seen = new Set<string>()
  for (const steam of steams) {
    const libs: string[] = []
    for (const f of [
      path.join('steamapps', 'libraryfolders.vdf'),
      path.join('config', 'libraryfolders.vdf'),
    ]) {
      const text = await within(LOOK_LIMIT_MS, fs.readFile(path.join(steam, f), 'utf8'), '')
      libs.push(...librariesWithApp(text, STEAM_APP))
    }
    libs.push(steam)
    for (const lib of libs) {
      const key = lib.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      const root = await check(path.join(lib, 'steamapps', 'common', 'XCom-Enemy-Unknown'))
      if (root) return { root, looked }
    }
  }
  return null
}

/**
 * A path the page asks for ("CookedPCConsole/XComGame.upk") as a file inside
 * root; anything that would leave it is refused. Names match whatever their
 * case, as on Windows.
 */
export async function inside(root: string, rel: string): Promise<string> {
  if (typeof rel !== 'string' || !rel || /^[\\/]|:/.test(rel)) throw new Error('bad path')
  let p = root
  for (const part of rel.split(/[\\/]/)) {
    if (!part || part === '.' || part === '..') throw new Error('bad path')
    // Resolve to the real on-disk name, whatever case was asked for. Windows'
    // own case-insensitive lookup would otherwise keep the asked case, so this
    // reads the directory on both platforms. A part not there yet (a file
    // about to be written) keeps what was asked.
    const names = await fs.readdir(p).catch(() => [] as string[])
    const real =
      names.find((n) => n === part) ?? names.find((n) => n.toLowerCase() === part.toLowerCase())
    p = path.join(p, real ?? part)
  }
  const r = path.relative(root, p)
  if (r.startsWith('..') || path.isAbsolute(r)) throw new Error('bad path')
  return p
}

export async function readInside(root: string, rel: string, start?: number, end?: number) {
  const p = await inside(root, rel)
  try {
    if (start === undefined) return new Uint8Array(await fs.readFile(p))
    const h = await fs.open(p, 'r')
    try {
      const len = Math.max(0, (end ?? (await h.stat()).size) - start)
      const buf = Buffer.alloc(len)
      const { bytesRead } = await h.read(buf, 0, len, start)
      return new Uint8Array(buf.subarray(0, bytesRead))
    } finally {
      await h.close()
    }
  } catch {
    return null
  }
}

export async function listInside(root: string, rel: string) {
  const p = rel ? await inside(root, rel) : root
  const entries = await fs.readdir(p, { withFileTypes: true }).catch(() => [])
  const out: { name: string; size: number; lastModified: number }[] = []
  for (const e of entries) {
    if (!e.isFile()) continue
    const s = await fs.stat(path.join(p, e.name)).catch(() => null)
    if (s) out.push({ name: e.name, size: s.size, lastModified: s.mtimeMs })
  }
  return out
}

/** Writes a whole file: to a temporary file beside it, then into place at once. */
export async function writeInside(root: string, rel: string, data: Uint8Array) {
  const p = await inside(root, rel)
  await fs.mkdir(path.dirname(p), { recursive: true })
  const tmp = path.join(path.dirname(p), `.lwtree-${process.pid}-${Date.now()}`)
  try {
    await fs.writeFile(tmp, data)
    await fs.rename(tmp, p)
  } catch (e) {
    await fs.rm(tmp, { force: true })
    throw e
  }
}

export async function removeInside(root: string, rel: string) {
  await fs.rm(await inside(root, rel), { force: true })
}

/**
 * Every file under a folder, as paths with "/" (the player's library). Folders
 * whose names start with "." are passed over; the walk stops at a depth and a
 * count no library comes near.
 */
export async function listTree(root: string, depth = 8, limit = 20000) {
  const out: { path: string; size: number; modified: number }[] = []
  async function walk(dir: string, rel: string, d: number) {
    if (d > depth || out.length >= limit) return
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const p = path.join(dir, e.name)
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) await walk(p, r, d + 1)
      else if (e.isFile()) {
        const s = await fs.stat(p).catch(() => null)
        if (s) out.push({ path: r, size: s.size, modified: s.mtimeMs })
      }
      if (out.length >= limit) return
    }
  }
  await walk(root, '', 0)
  return out
}
