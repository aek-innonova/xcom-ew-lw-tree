// Two script packages compared object by object, by path: the code of every
// function and state token for token, and every declaration's fields (its
// references as full paths, so numbering does not matter).

import { decodeScript, tokenName, TOKENS, type Node } from '../../src/bytecode.ts'
import { readObject, readStructHead } from '../../src/objects.ts'
import type { Package } from '../../src/package.ts'

const fullPath = (own: string) => (p: Package, ref: number) => (ref > 0 ? `${own}.${p.path(ref)}` : ref < 0 ? p.path(ref) : '0').toLowerCase()

function tokens(p: Package, ref: number, P: (p: Package, r: number) => string): string[] {
  const out: string[] = []
  const flat = (n: Node) => {
    const def = n.native !== undefined ? null : TOKENS[n.op]
    const parts = [n.native !== undefined ? `native${n.native}` : tokenName(n)]
    n.args.forEach((x, i) => {
      const kind = def?.args[i]
      if (kind === 'obj') parts.push(P(p, x as number))
      else if (kind === 'name') parts.push(p.name(x as never).toLowerCase())
      else if (typeof x === 'number' || typeof x === 'string') parts.push(String(x))
    })
    out.push(parts.join(' '))
    for (const x of n.args) {
      if (x && typeof x === 'object' && 'op' in (x as object)) flat(x as Node)
      else if (Array.isArray(x)) for (const y of x as unknown[]) if (y && typeof y === 'object' && 'op' in (y as object)) flat(y as Node)
    }
  }
  const h = readStructHead(p, ref)
  const none = p.findName('None')
  for (const s of decodeScript(p.data(ref).subarray(h.scriptAt, h.end), (n) => n.index === none).statements) flat(s)
  return out
}

/** Functions and states whose code is the same, token for token. */
export function sameCode(a: Package, b: Package, own: string): { total: number; same: number } {
  const P = fullPath(own)
  let total = 0
  let same = 0
  for (let ref = 1; ref <= a.exports.length; ref++) {
    const k = a.className(ref)
    if (k !== 'Function' && k !== 'State') continue
    total++
    const r2 = b.find(a.path(ref))
    if (!r2) continue
    const x = tokens(a, ref, P)
    const y = tokens(b, r2, P)
    if (x.length === y.length && x.every((t, i) => t === y[i])) same++
  }
  return { total, same }
}

/** Objects whose declarations are the same (kind, flags, links, members, defaults). */
export function sameDeclarations(a: Package, b: Package, own: string): { total: number; same: number } {
  const P = fullPath(own)
  const chain = (p: Package, first: number) => {
    const out: string[] = []
    for (let c = first, n = 0; c && n < 5000; n++) {
      out.push(p.objectName(c))
      const o = readObject(p, c) as { head?: { next: number }; next?: number } | null
      c = o ? (o.head ? o.head.next : (o.next ?? 0)) : 0
    }
    return out.join(',')
  }
  const describe = (p: Package, r: number) => {
    const o = readObject(p, r) as Record<string, any> | null
    const e = p.exports[r - 1]!
    const d: Record<string, unknown> = { cls: P(p, e.classIndex), sup: P(p, e.superIndex), outer: P(p, e.outer), arche: P(p, e.archetype), flags: e.objectFlags.toString(16) }
    if (!o) return d
    if (o.kind === 'property') Object.assign(d, { type: o.type, pflags: o.flags.toString(16), dim: o.arrayDim, refs: o.refs.map((x: number) => P(p, x)) })
    if (o.kind === 'const') d.value = o.value
    if (o.kind === 'enum') d.names = o.names.join(',')
    if (o.head) Object.assign(d, { super: P(p, o.head.superStruct) })
    if (o.head && o.kind !== 'class') d.children = chain(p, o.head.children)
    if (o.kind === 'function') Object.assign(d, { fflags: o.flags >>> 0, native: o.native })
    if (o.kind === 'state') Object.assign(d, { probe: o.probeMask >>> 0, stateFlags: o.stateFlags })
    if (o.kind === 'class') Object.assign(d, { classFlags: o.classFlags >>> 0, within: P(p, o.within), comps: o.componentMap.length })
    if (o.kind === 'struct') Object.assign(d, { sflags: o.structFlags, defaults: o.defaults.map((t: any) => `${t.name}:${t.type}:${t.size}`).join(',') })
    return JSON.stringify(d)
  }
  let total = 0
  let same = 0
  for (let r = 1; r <= a.exports.length; r++) {
    if (a.className(r) === 'TextBuffer' || a.className(r) === 'MetaData') continue
    total++
    const r2 = b.find(a.path(r))
    if (r2 && describe(a, r) === describe(b, r2)) same++
  }
  return { total, same }
}
