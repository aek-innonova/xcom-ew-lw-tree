// The bridge between the page and the app (main.ts): only these calls, each
// checked and confined there. The page reads it as window.lwtreeDesktop
// (src/state/desktop.ts).

import { contextBridge, ipcRenderer } from 'electron'

const call = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)

contextBridge.exposeInMainWorld('lwtreeDesktop', {
  info: () => call('app:info'),
  openExternal: (url: string) => call('app:open', url),
  openFile: (kind: 'save' | 'ini') => call('file:open', kind),
  game: {
    current: () => call('game:current'),
    find: () => call('game:find'),
    choose: () => call('game:choose'),
    forget: () => call('game:forget'),
    read: (path: string, start?: number, end?: number) => call('game:read', path, start, end),
    list: (dir: string) => call('game:list', dir),
    write: (path: string, data: Uint8Array) => call('game:write', path, data),
    remove: (path: string) => call('game:remove', path),
    hash: (path: string) => call('game:hash', path),
    copy: (from: unknown, to: string) => call('game:copy', from, to),
  },
  bases: {
    list: () => call('bases:list'),
    unpack: (id: string) => call('bases:unpack', id),
    read: (id: string, path: string) => call('bases:read', id, path),
    doc: (id: string, name: string) => call('bases:doc', id, name),
    onProgress: (f: (p: unknown) => void) => {
      ipcRenderer.on('bases:progress', (_e, p) => f(p))
    },
  },
  library: {
    info: () => call('library:info'),
    files: () => call('library:files'),
    read: (path: string) => call('library:read', path),
    write: (path: string, data: Uint8Array) => call('library:write', path, data),
    trash: (path: string) => call('library:trash', path),
    open: () => call('library:open'),
  },
  bundle: {
    state: () => call('bundle:state'),
    check: () => call('bundle:check'),
    good: () => call('bundle:good'),
    restart: () => call('bundle:restart'),
    installShell: () => call('shell:install'),
    onState: (f: (s: unknown) => void) => {
      ipcRenderer.on('bundle:state', (_e, s) => f(s))
    },
  },
  saves: {
    current: () => call('saves:current'),
    choose: () => call('saves:choose'),
    useDefault: () => call('saves:default'),
    forget: () => call('saves:forget'),
    list: () => call('saves:list'),
    read: (name: string, start?: number, end?: number) => call('saves:read', name, start, end),
  },
})
