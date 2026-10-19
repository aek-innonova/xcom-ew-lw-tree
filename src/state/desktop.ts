// When the site runs inside the desktop app (desktop/, features/desktop-app.md):
// the app's bridge, and the shapes the rest of the site already uses on top of
// it: GameFiles for Tools, a folder handle for the save-folder watcher.

import type { GameFiles } from './gamefiles'

export interface DesktopGame {
  root: string
}
export interface SaveEntry {
  name: string
  size: number
  lastModified: number
}

/** The shell's bundles and updates (desktop/src/bundles.ts). */
export interface BundleState {
  shellVersion: string
  serving: string
  base: string
  ready?: string
  shell?: { version: string; needed: boolean; downloaded: boolean }
  checking: boolean
  lastCheck?: string
  error?: string
}

/** window.lwtreeDesktop, from desktop/src/preload.ts. */
export interface DesktopApi {
  info(): Promise<{ version: string; platform: string }>
  openExternal(url: string): Promise<void>
  /** The app's file dialog, starting in the save folder or the game's Config. */
  openFile(kind: 'save' | 'ini'): Promise<{ name: string; data: Uint8Array } | null>
  game: {
    current(): Promise<DesktopGame | null>
    find(): Promise<{ game: DesktopGame | null; looked: string[] }>
    choose(): Promise<{ game: DesktopGame | null; error: string | null }>
    forget(): Promise<void>
    read(path: string, start?: number, end?: number): Promise<Uint8Array | null>
    list(dir: string): Promise<string[]>
    write(path: string, data: Uint8Array): Promise<void>
    remove(path: string): Promise<void>
  }
  /** From shell 0.2.0 (older shells have no updates): check before use. */
  bundle?: {
    state(): Promise<BundleState>
    check(): Promise<BundleState>
    good(): Promise<void>
    restart(): Promise<boolean>
    installShell(): Promise<boolean>
    onState(f: (s: BundleState) => void): void
  }
  saves: {
    current(): Promise<string | null>
    choose(): Promise<string | null>
    useDefault(): Promise<string | null>
    forget(): Promise<void>
    list(): Promise<SaveEntry[]>
    read(name: string, start?: number, end?: number): Promise<Uint8Array | null>
  }
}

declare global {
  interface Window {
    lwtreeDesktop?: DesktopApi
  }
}

/** The app's bridge, or undefined on the website. */
export const desktop: DesktopApi | undefined =
  typeof window !== 'undefined' ? window.lwtreeDesktop : undefined

/** The game's files through the app. */
export function desktopFiles(api: DesktopApi): GameFiles {
  return {
    read: (path) => api.game.read(path),
    async file(path) {
      const b = await api.game.read(path)
      return b ? new File([b as BlobPart], path.split('/').pop()!) : null
    },
    list: (dir) => api.game.list(dir),
    write: (path, data) => api.game.write(path, data),
    remove: (path) => api.game.remove(path),
    canWrite: async () => true,
  }
}

/**
 * A save file as the watcher reads it (watch.ts): name, size and date from the
 * listing; bytes only when asked, whole or a slice.
 */
function saveFile(api: DesktopApi, e: SaveEntry, start?: number, end?: number) {
  const read = async () => (await api.saves.read(e.name, start, end)) ?? new Uint8Array()
  return {
    name: e.name,
    size: e.size,
    lastModified: e.lastModified,
    arrayBuffer: async () => {
      const b = await read()
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
    },
    slice: (s: number, t: number) => saveFile(api, e, s, t),
  }
}

/** The save folder as the watcher's folder handle (only what it uses). */
export function desktopSaveFolder(api: DesktopApi, folder: string) {
  return {
    name: folder.split(/[\\/]/).filter(Boolean).pop() ?? folder,
    kind: 'directory' as const,
    async *values() {
      for (const e of await api.saves.list())
        yield {
          kind: 'file' as const,
          name: e.name,
          getFile: async () => saveFile(api, e) as unknown as File,
        }
    },
    queryPermission: async () => 'granted' as const,
    requestPermission: async () => 'granted' as const,
  }
}
