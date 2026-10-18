// The game's files, however the page reaches them: today the browser's
// folder access (File System Access, Chromium); a local helper program could
// stand in for it later (features/game-tools.md). Paths are relative to the
// XComGame folder and use "/".

import type { DirectoryHandle, Permission } from './watch'

interface FileHandle {
  kind: 'file'
  getFile(): Promise<File>
  createWritable(): Promise<{ write(data: Uint8Array): Promise<void>; close(): Promise<void> }>
}
export interface Dir extends DirectoryHandle {
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<Dir>
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandle>
  removeEntry(name: string): Promise<void>
  queryPermission(opts: { mode: 'read' | 'readwrite' }): Promise<Permission>
  requestPermission(opts: { mode: 'read' | 'readwrite' }): Promise<Permission>
}

export interface GameFiles {
  /** A file's bytes, or null if there is none. */
  read(path: string): Promise<Uint8Array | null>
  /** A file's size and contents as a File (for reading part of a big package). */
  file(path: string): Promise<File | null>
  /** File names in a folder ([] if none). */
  list(dir: string): Promise<string[]>
  /** Writes a whole file (creating folders), replacing it at once. */
  write(path: string, data: Uint8Array): Promise<void>
  remove(path: string): Promise<void>
  /** Whether writing is allowed; asks the browser when `ask` (needs a click). */
  canWrite(ask: boolean): Promise<boolean>
}

const split = (path: string) => path.split('/').filter(Boolean)

/** The game's files through a folder handle (its XComGame folder). */
export function folderFiles(dir: Dir): GameFiles {
  async function walk(parts: string[], create = false): Promise<Dir | null> {
    let d = dir
    try {
      for (const p of parts) d = await d.getDirectoryHandle(p, { create })
      return d
    } catch {
      return null
    }
  }
  async function handle(path: string, create = false): Promise<FileHandle | null> {
    const parts = split(path)
    const d = await walk(parts.slice(0, -1), create)
    if (!d) return null
    try {
      return await d.getFileHandle(parts[parts.length - 1]!, { create })
    } catch {
      return null
    }
  }
  // Names as the folder has them, whatever case a mod writes them in.
  async function actual(path: string): Promise<string> {
    const parts = split(path)
    const d = await walk(parts.slice(0, -1))
    if (!d) return path
    const want = parts[parts.length - 1]!.toLowerCase()
    for await (const e of d.values())
      if (e.name.toLowerCase() === want) return [...parts.slice(0, -1), e.name].join('/')
    return path
  }
  return {
    async file(path) {
      const h = await handle(await actual(path))
      return h ? h.getFile() : null
    },
    async read(path) {
      const f = await this.file(path)
      return f ? new Uint8Array(await f.arrayBuffer()) : null
    },
    async list(path) {
      const d = await walk(split(path))
      if (!d) return []
      const out: string[] = []
      for await (const e of d.values()) if (e.kind === 'file') out.push(e.name)
      return out
    },
    async write(path, data) {
      const h = await handle(await actual(path), true)
      if (!h) throw new Error(`cannot write ${path}`)
      const w = await h.createWritable()
      await w.write(data)
      await w.close()
    },
    async remove(path) {
      const parts = split(await actual(path))
      const d = await walk(parts.slice(0, -1))
      await d?.removeEntry(parts[parts.length - 1]!)
    },
    async canWrite(ask) {
      const p = await dir.queryPermission({ mode: 'readwrite' }).catch(() => 'denied' as Permission)
      if (p === 'granted') return true
      if (!ask) return false
      return (
        (await dir.requestPermission({ mode: 'readwrite' }).catch(() => 'denied' as Permission)) ===
        'granted'
      )
    },
  }
}

export async function sha256(data: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>)
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// --- Through the helper program (helper/main.go) -----------------------------

/** Where the helper listens (it serves 127.0.0.1 only). */
export const HELPER = 'http://127.0.0.1:47801'

/** Whether the helper is running (the one call that needs no pairing code). */
export async function helperRunning(base = HELPER): Promise<boolean> {
  try {
    const r = await fetch(`${base}/v1/hello`, { signal: AbortSignal.timeout(1500) })
    return r.ok && (await r.json()).app === 'lwtree-helper'
  } catch {
    return false
  }
}

export class WrongCode extends Error {}

/** The helper's game folder, if the code is right. */
export async function helperInfo(
  code: string,
  base = HELPER,
): Promise<{ root: string; name: string }> {
  const r = await fetch(`${base}/v1/info`, { headers: { 'X-Lwtree-Code': code } })
  if (r.status === 401) throw new WrongCode('wrong pairing code')
  if (!r.ok) throw new Error(`the helper said ${r.status}`)
  return r.json()
}

/** The game's files through the helper. */
export function helperFiles(code: string, base = HELPER): GameFiles {
  const call = async (method: string, what: string, path: string, body?: Uint8Array) => {
    const r = await fetch(`${base}/v1/${what}?path=${encodeURIComponent(path)}`, {
      method,
      headers: { 'X-Lwtree-Code': code },
      body: body as BodyInit | undefined,
    })
    if (r.status === 404) return null
    if (!r.ok) throw new Error(`${path}: ${(await r.text()).trim() || r.status}`)
    return r
  }
  return {
    async read(path) {
      const r = await call('GET', 'file', path)
      return r ? new Uint8Array(await r.arrayBuffer()) : null
    },
    async file(path) {
      const bytes = await this.read(path)
      return bytes ? new File([bytes as BlobPart], path.split('/').pop()!) : null
    },
    async list(path) {
      const r = await call('GET', 'list', path)
      return r ? r.json() : []
    },
    async write(path, data) {
      await call('PUT', 'file', path, data)
    },
    async remove(path) {
      await call('DELETE', 'file', path)
    },
    async canWrite() {
      return true
    },
  }
}
