// Edits to objects' data: a function's (or state's) script replaced.

import { readStructHead } from './objects.ts'
import type { Package } from './package.ts'

/** The object's data with its script replaced (memory and file sizes updated). */
export function withScript(pkg: Package, ref: number, code: Uint8Array, memSize: number): Uint8Array {
  const data = pkg.data(ref)
  const h = readStructHead(pkg, ref)
  const out = new Uint8Array(data.length - h.size + code.length)
  out.set(data.subarray(0, h.scriptAt - 8))
  const v = new DataView(out.buffer)
  v.setInt32(h.scriptAt - 8, memSize, true)
  v.setInt32(h.scriptAt - 4, code.length, true)
  out.set(code, h.scriptAt)
  out.set(data.subarray(h.end), h.scriptAt + code.length)
  return out
}
