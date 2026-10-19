// The Long War Tech Tree as a Windows app (features/desktop-app.md): the
// site, bundled, in a locked-down window, with the game's files and the save
// folder in reach through a narrow bridge (preload.ts). Every file operation
// is confined to the game folder or the save folder the app found or the
// player chose; the page never sees Node.

import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { findGame, gameDirUnder, listInside, readInside, removeInside, writeInside } from './game'

const SCHEME = 'app'
const HOST = 'lwtree'
const ORIGIN = `${SCHEME}://${HOST}`
/** The built site (desktop/site, from the repository's dist/). */
const SITE = process.env.LWTREE_SITE ?? path.join(__dirname, '..', 'site')
// As on the website, the page can reach nothing but itself.
const CSP =
  "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"

// For tests: their own settings, and a game folder given on the command line.
if (process.env.LWTREE_USER_DATA) app.setPath('userData', process.env.LWTREE_USER_DATA)
const argGameDir = process.argv
  .find((a) => a.startsWith('--game-dir='))
  ?.slice('--game-dir='.length)

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
])

// --- Settings: the folders found or chosen -------------------------------------

interface Settings {
  gameRoot?: string
  savesDir?: string
}
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')
let settings: Settings = {}
async function loadSettings() {
  try {
    settings = JSON.parse(await fs.readFile(settingsFile(), 'utf8'))
  } catch {
    settings = {}
  }
}
async function saveSettings() {
  await fs.mkdir(path.dirname(settingsFile()), { recursive: true })
  await fs.writeFile(settingsFile(), JSON.stringify(settings, null, 1))
}

/** The game's own save folder (LWTREE_SAVES stands in for it in tests). */
const defaultSaves = () =>
  process.env.LWTREE_SAVES ??
  path.join(app.getPath('documents'), 'My Games', 'XCOM - Enemy Within', 'XComGame', 'SaveData')

// --- The bridge ----------------------------------------------------------------

const str = (v: unknown) => {
  if (typeof v !== 'string') throw new Error('bad argument')
  return v
}
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const needGame = () => {
  if (!settings.gameRoot) throw new Error('no game folder')
  return settings.gameRoot
}
const needSaves = () => {
  if (!settings.savesDir) throw new Error('no save folder')
  return settings.savesDir
}
/**
 * Whether a URL is the app's own page. (A custom scheme's URL has the origin
 * "null", so scheme and host are compared.)
 */
function ours(url: string | undefined): boolean {
  try {
    const u = new URL(url ?? '')
    return u.protocol === `${SCHEME}:` && u.host === HOST
  } catch {
    return false
  }
}
const gameInfo = () => (settings.gameRoot ? { root: settings.gameRoot } : null)

function bridge(win: BrowserWindow) {
  const handle = (channel: string, f: (...args: unknown[]) => unknown) =>
    ipcMain.handle(channel, (event, ...args) => {
      // Only our own page may use the bridge.
      if (!ours(event.senderFrame?.url)) throw new Error('not allowed')
      return f(...args)
    })

  handle('app:info', () => ({ version: app.getVersion(), platform: process.platform }))
  handle('app:open', (url) => {
    const u = new URL(str(url))
    if (u.protocol === 'https:' || u.protocol === 'http:') void shell.openExternal(u.href)
  })

  handle('game:current', () => gameInfo())
  handle('game:find', async () => {
    const given = argGameDir ? await gameDirUnder(argGameDir) : null
    const found = given ? { root: given, looked: [argGameDir!] } : await findGame()
    if (found) {
      settings.gameRoot = found.root
      await saveSettings()
    }
    return { game: gameInfo(), looked: found?.looked ?? [] }
  })
  handle('game:choose', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'The game folder (XCom-Enemy-Unknown, or its XEW)',
      properties: ['openDirectory'],
      defaultPath: settings.gameRoot,
    })
    if (r.canceled || !r.filePaths[0]) return { game: gameInfo(), error: null }
    const root = await gameDirUnder(r.filePaths[0])
    if (!root)
      return {
        game: gameInfo(),
        error: `No game files (XEW\\XComGame with CookedPCConsole and Config) in ${r.filePaths[0]}.`,
      }
    settings.gameRoot = root
    await saveSettings()
    return { game: gameInfo(), error: null }
  })
  handle('game:forget', async () => {
    delete settings.gameRoot
    await saveSettings()
  })
  handle('game:read', (p, start, end) => readInside(needGame(), str(p), num(start), num(end)))
  handle('game:list', async (p) => (await listInside(needGame(), str(p))).map((e) => e.name))
  handle('game:write', (p, data) => {
    if (!(data instanceof Uint8Array)) throw new Error('bad data')
    return writeInside(needGame(), str(p), data)
  })
  handle('game:remove', (p) => removeInside(needGame(), str(p)))

  handle('saves:current', () => settings.savesDir ?? null)
  handle('saves:choose', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'The save folder (SaveData)',
      properties: ['openDirectory'],
      defaultPath: settings.savesDir ?? defaultSaves(),
    })
    if (r.canceled || !r.filePaths[0]) return settings.savesDir ?? null
    settings.savesDir = r.filePaths[0]
    await saveSettings()
    return settings.savesDir
  })
  handle('saves:default', async () => {
    const dir = defaultSaves()
    if (
      !(await fs
        .stat(dir)
        .then((s) => s.isDirectory())
        .catch(() => false))
    )
      return null
    settings.savesDir = dir
    await saveSettings()
    return dir
  })
  handle('saves:forget', async () => {
    delete settings.savesDir
    await saveSettings()
  })
  // Open one file through the app's own dialog, starting where it belongs (a
  // page's file input always opens where the last dialog was).
  handle('file:open', async (kind) => {
    const k = str(kind)
    const defaultPath =
      k === 'save'
        ? (settings.savesDir ?? defaultSaves())
        : settings.gameRoot
          ? path.join(settings.gameRoot, 'Config')
          : undefined
    const r = await dialog.showOpenDialog(win, {
      title: k === 'save' ? 'A save' : 'DefaultGameCore.ini',
      properties: ['openFile'],
      defaultPath,
      filters:
        k === 'ini'
          ? [
              { name: 'INI', extensions: ['ini'] },
              { name: 'All files', extensions: ['*'] },
            ]
          : [],
    })
    const file = r.filePaths[0]
    if (r.canceled || !file) return null
    return { name: path.basename(file), data: new Uint8Array(await fs.readFile(file)) }
  })
  handle('saves:list', () => listInside(needSaves(), ''))
  handle('saves:read', (name, start, end) =>
    readInside(needSaves(), path.basename(str(name)), num(start), num(end)),
  )
}

// --- The window ----------------------------------------------------------------

async function serveSite(request: Request): Promise<Response> {
  const url = new URL(request.url)
  if (url.host !== HOST) return new Response('not found', { status: 404 })
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
  const file = path.join(SITE, rel)
  if (path.relative(SITE, file).startsWith('..')) return new Response('not found', { status: 404 })
  const found = await fs
    .stat(file)
    .then((s) => s.isFile())
    .catch(() => false)
  const res = await net.fetch(pathToFileURL(found ? file : path.join(SITE, 'index.html')).href)
  const headers = new Headers(res.headers)
  headers.set('Content-Security-Policy', CSP)
  if (rel.endsWith('.js')) headers.set('Content-Type', 'text/javascript')
  return new Response(res.body, { status: res.status, headers })
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1500,
    height: 950,
    title: 'Long War Tech Tree',
    autoHideMenuBar: true,
    backgroundColor: '#08121c',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  })
  // The page stays on the app; links to the web open in the browser.
  win.webContents.on('will-navigate', (e, url) => {
    if (!ours(url)) {
      e.preventDefault()
      if (/^https?:/.test(url)) void shell.openExternal(url)
    }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  bridge(win)
  await win.loadURL(`${ORIGIN}/`)
}

app.whenReady().then(async () => {
  await loadSettings()
  protocol.handle(SCHEME, serveSite)
  await createWindow()
})
app.on('window-all-closed', () => app.quit())
