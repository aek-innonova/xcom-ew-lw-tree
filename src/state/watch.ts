// Following the player's SaveData folder (File System Access API; Chromium
// browsers). The folder is picked once; its handle is kept in IndexedDB so a
// reload can pick up where it left off, asking the browser for permission
// again where it requires that. The folder is checked every few seconds and
// the newest save loaded when it changes. Nothing leaves the browser.

import { reactive } from 'vue'
import { fileKey, isSaveName, newestSave, type FileInfo } from '@/model/live'
import { importSaves, loadSave } from './store'

// The parts of the API TypeScript's DOM library does not describe yet.
type Permission = 'granted' | 'denied' | 'prompt'
interface DirectoryHandle {
  name: string
  kind: 'directory'
  values(): AsyncIterable<{
    kind: 'file' | 'directory'
    name: string
    getFile?: () => Promise<File>
  }>
  queryPermission(opts: { mode: 'read' }): Promise<Permission>
  requestPermission(opts: { mode: 'read' }): Promise<Permission>
}
declare global {
  interface Window {
    showDirectoryPicker?: (opts?: { id?: string; mode?: 'read' }) => Promise<DirectoryHandle>
  }
}

export const POLL_MS = 3000
/** A save that keeps failing (not one being written) stops being retried. */
const MAX_TRIES = 5

export const watcher = reactive({
  supported: typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function',
  status: 'off' as 'off' | 'needs-permission' | 'watching',
  folder: null as string | null,
  /** The save last loaded from the folder. */
  lastFile: null as string | null,
  lastLoadedAt: null as number | null,
  error: null as string | null,
})

let handle: DirectoryHandle | null = null
let timer: ReturnType<typeof setInterval> | undefined
let loadedKey: string | null = null
let failing: { key: string; tries: number } | null = null
let busy = false

// --- IndexedDB: one store, one key, holding the directory handle -------------

const DB_NAME = 'lwtree'
const STORE = 'handles'
const KEY = 'savedata'

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function stored<T>(
  mode: IDBTransactionMode,
  op: (s: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const d = await db()
  return new Promise((resolve, reject) => {
    const req = op(d.transaction(STORE, mode).objectStore(STORE))
    req.onsuccess = () => resolve(req.result as T)
    req.onerror = () => reject(req.error)
  })
}

// --- Watching ----------------------------------------------------------------

async function listSaves(dir: DirectoryHandle): Promise<{ info: FileInfo; file: File }[]> {
  const out: { info: FileInfo; file: File }[] = []
  for await (const entry of dir.values()) {
    if (entry.kind !== 'file' || !isSaveName(entry.name) || !entry.getFile) continue
    const file = await entry.getFile()
    out.push({ info: { name: entry.name, lastModified: file.lastModified, size: file.size }, file })
  }
  return out
}

/** One look at the folder; loads the newest save if it is new. */
export async function checkFolder(): Promise<void> {
  if (!handle || busy) return
  busy = true
  try {
    const saves = await listSaves(handle)
    const newest = newestSave(saves.map((s) => s.info))
    if (!newest) return
    const key = fileKey(newest)
    if (key === loadedKey) return
    if (failing?.key === key && failing.tries >= MAX_TRIES) return
    const file = saves.find((s) => s.info.name === newest.name)!.file
    const ok = loadSave(newest.name, new Uint8Array(await file.arrayBuffer()), true)
    if (ok) {
      loadedKey = key
      failing = null
      watcher.lastFile = newest.name
      watcher.lastLoadedAt = Date.now()
      watcher.error = null
    } else {
      // Probably still being written; try again on the next look.
      failing = { key, tries: failing?.key === key ? failing.tries + 1 : 1 }
      if (failing.tries >= MAX_TRIES) watcher.error = `${newest.name} could not be read`
    }
  } catch (e) {
    // The folder went away or permission was withdrawn.
    watcher.error = (e as Error).message
    stopTimer()
    watcher.status = 'needs-permission'
  } finally {
    busy = false
  }
}

function startTimer() {
  stopTimer()
  watcher.status = 'watching'
  void checkFolder()
  timer = setInterval(() => void checkFolder(), POLL_MS)
}

function stopTimer() {
  if (timer !== undefined) clearInterval(timer)
  timer = undefined
}

/** Asks the player for the folder and starts watching it. */
export async function chooseFolder(): Promise<void> {
  if (!window.showDirectoryPicker) return
  let dir: DirectoryHandle
  try {
    dir = await window.showDirectoryPicker({ id: 'xcom-savedata', mode: 'read' })
  } catch {
    return // the player cancelled
  }
  handle = dir
  loadedKey = null
  watcher.folder = dir.name
  watcher.error = null
  await stored('readwrite', (s) => s.put(dir, KEY)).catch(() => undefined)
  startTimer()
}

/** On start-up: picks up a folder chosen before, if the browser still allows it. */
export async function restoreWatch(): Promise<void> {
  if (!watcher.supported) return
  const dir = await stored<DirectoryHandle | undefined>('readonly', (s) => s.get(KEY)).catch(
    () => undefined,
  )
  if (!dir) return
  handle = dir
  watcher.folder = dir.name
  const permission = await dir.queryPermission({ mode: 'read' }).catch(() => 'denied' as Permission)
  if (permission === 'granted') startTimer()
  else watcher.status = 'needs-permission'
}

/** After a reload: the browser wants a click before it lets the page read the folder again. */
export async function resumeWatch(): Promise<void> {
  if (!handle) return
  const permission = await handle
    .requestPermission({ mode: 'read' })
    .catch(() => 'denied' as Permission)
  if (permission === 'granted') startTimer()
}

export async function stopWatch(): Promise<void> {
  stopTimer()
  handle = null
  loadedKey = null
  failing = null
  Object.assign(watcher, {
    status: 'off',
    folder: null,
    lastFile: null,
    lastLoadedAt: null,
    error: null,
  })
  await stored('readwrite', (s) => s.delete(KEY)).catch(() => undefined)
}

/** Fills a campaign's history from every save of it in the watched folder. */
export async function importCampaignFromFolder(game: number): Promise<void> {
  if (!handle) return
  const sources = []
  for await (const entry of handle.values()) {
    if (entry.kind !== 'file' || !isSaveName(entry.name) || !entry.getFile) continue
    // Called as a method: a detached getFile loses its handle ("Illegal invocation").
    const getFile = () => entry.getFile!()
    sources.push({
      name: entry.name,
      head: async () => new Uint8Array(await (await getFile()).slice(0, 12).arrayBuffer()),
      bytes: async () => new Uint8Array(await (await getFile()).arrayBuffer()),
    })
  }
  await importSaves(sources, game)
}
