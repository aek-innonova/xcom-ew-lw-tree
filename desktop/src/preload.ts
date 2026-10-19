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
