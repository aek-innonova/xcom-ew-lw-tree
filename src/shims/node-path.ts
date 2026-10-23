// See node-fs.ts: what upkit's Linker uses of node:path, for the browser.
export const join = (...parts: string[]): string => parts.join('/')
