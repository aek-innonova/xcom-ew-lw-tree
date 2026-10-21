// Edits to objects' data: a function's (or state's) script replaced.

import { readStructHead } from './objects.ts'
import type { Package } from './package.ts'

/**
 * The object's data with its script replaced (memory and file sizes updated),
 * with another first child (a new local linked in) when given, and for a
 * state, where its label table now starts.
 */
export function withScript(
  pkg: Package,
  ref: number,
  code: Uint8Array,
  memSize: number,
  children?: number,
  labelTableOffset?: number,
): Uint8Array {
  const data = pkg.data(ref)
  const h = readStructHead(pkg, ref)
  const out = new Uint8Array(data.length - h.size + code.length)
  out.set(data.subarray(0, h.scriptAt - 8))
  const v = new DataView(out.buffer)
  v.setInt32(h.scriptAt - 8, memSize, true)
  v.setInt32(h.scriptAt - 4, code.length, true)
  out.set(code, h.scriptAt)
  out.set(data.subarray(h.end), h.scriptAt + code.length)
  // Children sits six fields before the script: children, cppText, line, textPos, memory size, size.
  if (children !== undefined) v.setInt32(h.scriptAt - 24, children, true)
  // A state's script is followed by its probe mask (4 bytes), then the label table's offset (2).
  if (labelTableOffset !== undefined) v.setUint16(h.scriptAt + code.length + 4, labelTableOffset, true)
  return out
}
