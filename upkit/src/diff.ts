// Two versions of a package compared function by function (and state code by
// state code): what was changed, added or taken away, each changed one as a
// unified diff of its decompiled source. What a mod did to the game, in
// UnrealScript.

import { ClassDecompiler } from './classdecomp.ts'
import { readableSource, readableStateCode } from './fidelity.ts'
import type { Linker } from './linker.ts'
import type { Package } from './package.ts'
import { lex } from './parse.ts'

export interface DiffResult {
  changed: string[]
  added: string[]
  removed: string[]
  /** The unified diffs, one after the other. */
  text: string
}

const source = (linker: Linker, pkg: Package, ref: number): string => {
  try {
    if (pkg.className(ref) === 'State') return readableStateCode(linker, pkg, ref)
    return readableSource(linker, pkg, ref)
  } catch (e) {
    return `// not decompiled: ${(e as Error).message}\n`
  }
}

/** For reading: without the empty statements patches pad with (their bytes, not their meaning). */
const readable = (src: string) =>
  src
    .split('\n')
    .filter((l) => !/^\s*;\s*$/.test(l))
    .join('\n')

const sameTokens = (a: string, b: string) => {
  const x = lex(a)
  const y = lex(b)
  return x.length === y.length && x.every((t, i) => t.t === y[i]!.t && t.v === y[i]!.v)
}

/** A unified diff of two texts' lines (longest common subsequence; functions are short). */
export function unifiedDiff(a: string, b: string, nameA: string, nameB: string, context = 2): string {
  const x = a.replace(/\n$/, '').split('\n')
  const y = b.replace(/\n$/, '').split('\n')
  const n = x.length
  const m = y.length
  // lcs[i][j]: the common subsequence's length of x[i..] and y[j..].
  const lcs = Array.from({ length: n + 1 }, () => new Int32Array(m + 1))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) lcs[i]![j] = x[i] === y[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
  // The edit, line by line: each with its place in a (before it) and in b.
  const ops: { k: ' ' | '-' | '+'; line: string; i: number; j: number }[] = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) ops.push({ k: ' ', line: x[i]!, i: i++, j: j++ })
    // (What goes, before what comes.)
    else if (i < n && (j === m || lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) ops.push({ k: '-', line: x[i]!, i: i++, j })
    else ops.push({ k: '+', line: y[j]!, i, j: j++ })
  }
  // Hunks: changes closer than twice the context together, with the context around them.
  const out = [`--- ${nameA}`, `+++ ${nameB}`]
  const changes = ops.map((o, k) => (o.k === ' ' ? -1 : k)).filter((k) => k >= 0)
  for (let c = 0; c < changes.length; ) {
    let last = c
    while (last + 1 < changes.length && changes[last + 1]! - changes[last]! <= context * 2 + 1) last++
    const from = Math.max(0, changes[c]! - context)
    const to = Math.min(ops.length, changes[last]! + context + 1)
    const hunk = ops.slice(from, to)
    const lenA = hunk.filter((o) => o.k !== '+').length
    const lenB = hunk.filter((o) => o.k !== '-').length
    out.push(`@@ -${hunk[0]!.i + (lenA ? 1 : 0)},${lenA} +${hunk[0]!.j + (lenB ? 1 : 0)},${lenB} @@`)
    for (const o of hunk) out.push(`${o.k}${o.line}`)
    c = last + 1
  }
  return out.join('\n') + '\n'
}

/** Two packages' functions and states' code compared (those whose path has the filter in it). */
export function diffPackages(la: Linker, a: Package, lb: Linker, b: Package, filter = ''): DiffResult {
  const paths = (p: Package) => {
    const m = new Map<string, number>()
    for (let i = 1; i <= p.exports.length; i++) {
      const k = p.className(i)
      if (k !== 'Function' && k !== 'State') continue
      const path = p.path(i)
      if (!filter || path.toLowerCase().includes(filter.toLowerCase())) m.set(path, i)
    }
    return m
  }
  const pa = paths(a)
  const pb = paths(b)
  const r: DiffResult = { changed: [], added: [], removed: [], text: '' }
  const parts: string[] = []
  for (const [path, ra] of pa) {
    const rb = pb.get(path)
    if (!rb) {
      r.removed.push(path)
      continue
    }
    const sa = source(la, a, ra)
    const sb = source(lb, b, rb)
    if (sameTokens(sa, sb)) continue
    r.changed.push(path)
    parts.push(unifiedDiff(readable(sa), readable(sb), `a/${path}`, `b/${path}`))
  }
  for (const [path, rb] of pb)
    if (!pa.has(path)) {
      r.added.push(path)
      parts.push(unifiedDiff('', readable(source(lb, b, rb)), '/dev/null', `b/${path}`))
    }
  // Classes' defaults: what the other version's default objects hold otherwise.
  for (let i = 1; i <= a.exports.length; i++) {
    if (a.className(i) !== 'Class') continue
    const name = a.objectName(i)
    if (filter && !name.toLowerCase().includes(filter.toLowerCase().split('.')[0]!)) continue
    const j = b.find(name)
    if (!j || b.className(j) !== 'Class') continue
    let da = ''
    let db = ''
    try {
      da = new ClassDecompiler(la, a, i, false).defaultsText()
      db = new ClassDecompiler(lb, b, j, false).defaultsText()
    } catch {
      continue
    }
    if (da === db) continue
    r.changed.push(`${name} (defaultproperties)`)
    parts.push(unifiedDiff(da, db, `a/${name} (defaultproperties)`, `b/${name} (defaultproperties)`))
  }
  r.text = parts.join('')
  return r
}
