// A PatchUPK mod as a .upkmod (features/upkmod-convert.md): the script
// applied to the packages (without the mod), every class it changed
// decompiled before and after, and the difference written as source diffs.
// Checked by applying the .upkmod to the same packages: every class it
// changes must read as the script leaves it, and every other object the
// script changed must be the same bytes. What is not code (a Flash movie, a
// texture, an object outside every class) is said, not converted.

import { readFileSync } from 'node:fs'
import { parseModScript } from '../../src/model/patchupk.ts'
import { applyScripts } from './apply.ts'
import { classPathIn } from './changes.ts'
import { decompileClass } from './classdecomp.ts'
import { Linker } from './linker.ts'
import { openPackage, type Package } from './package.ts'
import { applyUpkmodTo, asAdd, canonical, classHunks, formatUpkmod, lineOps, parseUpkmod, type ClassDiff } from './upkmod.ts'

export interface Converted {
  /** The .upkmod, or null when something does not convert (and --partial was not given). */
  text: string | null
  /** What it holds: classes changed, per package. */
  classes: string[]
  /** What the script changed that the .upkmod does not carry (not code, or not the same). */
  unconverted: string[]
  /** Said along the way (options taken as the script has them …). */
  notes: string[]
}

/** The class an object belongs to: its outermost class, or the class of a default object; null if none. */
function classOf(pkg: Package, ref: number): string | null {
  let r = ref
  let cls: string | null = null
  for (let guard = 0; r > 0 && guard < 64; guard++) {
    if (pkg.className(r) === 'Class') cls = pkg.path(r)
    r = pkg.exports[r - 1]!.outer
  }
  if (cls) return cls
  const name = pkg.objectName(ref)
  if (name.startsWith('Default__')) {
    const path = classPathIn(pkg, name.slice('Default__'.length))
    const c = pkg.find(path)
    if (c && pkg.className(c) === 'Class') return path
  }
  return null
}

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i])

/** A statement that does nothing: `;` alone, or a variable alone (a call has parentheses). */
const PADDING = /^\s*(;|(?!(return|break|continue|stop)\b)[A-Za-z_]\w*\s*;)\s*$/i

/** Two lines that are the same but for float constants written to another precision. */
function sameButPrecision(a: string, b: string): boolean {
  const x = canonical(a)
  const y = canonical(b)
  if (x.length !== y.length) return false
  return x.every((t, k) => {
    const u = y[k]!
    if (t === u) return true
    if (!t.startsWith('#:') || !u.startsWith('#:')) return false
    const p = Number(t.slice(2))
    const q = Number(u.slice(2))
    return Math.abs(p - q) <= 1e-5 * Math.max(1, Math.abs(p))
  })
}

/**
 * The script's version of a class, tidied (--tidy): what the mod adds without its
 * padding statements, and lines it rewrote only to another precision of a constant as
 * the version has them. Only the mod's own lines are touched. Returns the text and
 * what was tidied.
 */
function tidied(was: string, now: string): { text: string; padding: number; constants: number } {
  const ops = lineOps(was.replace(/\n$/, '').split('\n'), now.replace(/\n$/, '').split('\n'))
  let padding = 0
  let constants = 0
  const out: string[] = []
  for (let k = 0; k < ops.length; ) {
    if (ops[k]!.k === ' ') {
      out.push(ops[k++]!.text)
      continue
    }
    // A run of changes: what it takes away and what it adds (without padding).
    const removed: string[] = []
    const added: string[] = []
    for (; k < ops.length && ops[k]!.k !== ' '; k++) {
      const o = ops[k]!
      if (o.k === '-') removed.push(o.text)
      else if (PADDING.test(o.text)) padding++
      else added.push(o.text)
    }
    // Line for line where they are the same but for a constant's precision: the version's own.
    if (removed.length === added.length)
      added.forEach((l, n) => {
        if (sameButPrecision(removed[n]!, l)) {
          added[n] = removed[n]!
          constants++
        }
      })
    out.push(...added)
  }
  return { text: out.join('\n') + '\n', padding, constants }
}

export function convertScript(folder: string, script: string, opts: { partial?: boolean; with?: string[]; tidy?: boolean } = {}): Converted {
  const text = readFileSync(script, 'latin1')
  const info = parseModScript(text, script)
  const notes: string[] = []
  if (info.options.length)
    notes.push(`its options are taken as the script has them (a .upkmod has none yet): ${info.options.map((o) => `${o.name}=${o.value}`).join(', ')}`)
  // Mods it needs first (Sightlines needs the Mutator Enabler): applied before, not part of it.
  let start: Map<string, Uint8Array> | undefined
  if (opts.with?.length) {
    const pre = applyScripts(folder, opts.with, false)
    const bad = pre.scripts.find((x) => x.status === 'does-not-fit')
    if (bad) throw new Error(`${bad.script} does not fit these packages`)
    start = new Map(pre.packages.map((p) => [p.file.toLowerCase(), p.bytes]))
  }
  const run = applyScripts(folder, [script], false, start)
  const r = run.scripts[0]!
  if (r.status === 'installed') throw new Error('the mod is in these packages already: convert it on packages without it')
  if (r.status === 'does-not-fit') {
    const e = r.steps.find((s) => s.status === 'error')
    throw new Error(`the mod does not fit these packages (line ${e?.line}: ${e?.where} ${e?.what}: ${e?.note})`)
  }
  // The packages as they were and as the script leaves them, each with a linker over its kind.
  const before = new Map<string, Package>()
  const after = new Map<string, Package>()
  for (const p of run.packages) {
    before.set(p.file.toLowerCase(), openPackage(p.plain))
    after.set(p.file.toLowerCase(), openPackage(p.bytes))
  }
  const linkerOf = (side: Map<string, Package>) => {
    const l = new Linker([folder])
    for (const [file, pkg] of side) l.add(file.replace(/\.(upk|u)$/i, ''), pkg)
    return l
  }
  const lb = linkerOf(before)
  const la = linkerOf(after)
  const unconverted: string[] = []
  /** Each changed class: its source before (null: a new class) and after. */
  const diffs: { upk: string; cls: string; was: string | null; now: string }[] = []
  const said: string[] = []
  for (const p of run.packages.filter((x) => run.changed.includes(x.file))) {
    const b = before.get(p.file.toLowerCase())!
    const a = after.get(p.file.toLowerCase())!
    // The classes whose objects changed, or that have new ones; what changed outside every class.
    const touched = new Set<string>()
    for (let i = 1; i <= a.exports.length; i++) {
      const path = a.path(i)
      // (By its index where it is the same object: exports keep theirs, and two may share a path.)
      const was = i <= b.exports.length && b.path(i) === path ? i : b.find(path)
      if (was && same(b.data(was), a.data(i))) continue
      const cls = classOf(a, i)
      if (cls) touched.add(cls)
      else unconverted.push(`${p.file}: ${path} (${a.className(i)}): not code`)
    }
    for (const cls of touched) {
      const ref = b.find(cls)
      let now = decompileClass(la, a, cls)
      const name = a.objectName(a.find(cls))
      if (!ref || b.className(ref) !== 'Class') {
        diffs.push({ upk: p.file, cls: name, was: null, now })
        said.push(`${p.file}: ${name} (new)`)
        continue
      }
      const was = decompileClass(lb, b, cls)
      if (opts.tidy) {
        const t = tidied(was, now)
        if (t.padding || t.constants)
          notes.push(`${name}, tidied: ${t.padding} padding statement${t.padding === 1 ? '' : 's'} left out, ${t.constants} line${t.constants === 1 ? '' : 's'} kept as the version has ${t.constants === 1 ? 'it' : 'them'} (only a constant's precision differed)`)
        now = t.text
      }
      if (canonical(was).join(' ') === canonical(now).join(' ')) {
        // Its objects changed, its source did not: bytes the source does not say.
        unconverted.push(`${p.file}: ${cls}: its bytes changed where its source reads the same`)
        continue
      }
      diffs.push({ upk: p.file, cls: name, was, now })
      said.push(`${p.file}: ${name}`)
    }
  }
  // The .upkmod: more context where a hunk is not found once in what it was made from.
  let mod = ''
  let parsed = parseUpkmod('upkit mod 1\n')
  const applied = new Map<string, Uint8Array>()
  for (let context = 3; ; context *= 2) {
    const classes: ClassDiff[] = diffs.map((d) =>
      d.was === null
        ? { upk: d.upk, cls: d.cls, isNew: true, hunks: [{ block: [], lines: d.now.replace(/\n$/, '').split('\n').map((t) => ({ k: '+' as const, text: t })), line: 0 }], line: 0 }
        : { upk: d.upk, cls: d.cls, isNew: false, hunks: classHunks(d.was, d.now, context).map((h) => asAdd(h) ?? h), line: 0 },
    )
    mod = formatUpkmod({ name: info.name, author: info.author, description: info.description, tested: [], classes })
    parsed = parseUpkmod(mod)
    applied.clear()
    let ambiguous = false
    for (const upk of new Set(parsed.classes.map((c) => c.upk))) {
      const r2 = applyUpkmodTo(lb, before.get(upk.toLowerCase())!, upk.replace(/\.(upk|u)$/i, ''), parsed.classes.filter((c) => c.upk === upk))
      const err = r2.results.find((x) => x.status === 'error')
      if (err && /times in/.test(err.note ?? '') && context < 24) ambiguous = true
      else if (err || !r2.bytes) throw new Error(`the converted mod does not apply to the packages it was made from (${err ? `${err.cls} ${err.block}: ${err.note}` : 'nothing changed'}): a bug in upkit, please report it`)
      else applied.set(upk, r2.bytes)
    }
    if (!ambiguous) break
  }
  // Checked: applied to the packages as they were, every class it changes reads as the script
  // leaves it.
  for (const [upk, bytes] of applied) {
    const result = openPackage(bytes)
    const lr = new Linker([folder])
    for (const [file, pkg] of before) lr.add(file.replace(/\.(upk|u)$/i, ''), file === upk.toLowerCase() ? result : pkg)
    for (const c of parsed.classes.filter((x) => x.upk === upk)) {
      // (What it was made from: the script's version of the class, or that tidied.)
      const want = canonical(diffs.find((d) => d.upk === upk && d.cls === c.cls)!.now).join(' ')
      const got = canonical(decompileClass(lr, result, classPathIn(result, c.cls))).join(' ')
      if (want !== got) unconverted.push(`${upk}: ${c.cls}: the converted source does not compile to what the script makes`)
    }
  }
  const ok = !unconverted.length && diffs.length > 0
  return { text: ok || (opts.partial && diffs.length) ? mod : null, classes: said, unconverted, notes }
}
