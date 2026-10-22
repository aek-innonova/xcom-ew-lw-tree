// Whether a function's UnrealScript says all its bytecode says. Hand patches
// (PatchUPK's hex, as Long War's and LWR's packages carry) can hold bytecode
// no UnrealScript compiles to: a flag set otherwise, a skip size that is not
// what it skips. The decompiler writes the closest source; compiled, that is
// what Epic's compiler would write, and it differs from the patch in those
// places. Said where it happens, so nobody takes the source for the bytes.

import { decodeScript, encodeScript, tokenName, TOKENS, walk, type NameValue, type Node } from './bytecode.ts'
import { binaryOperators, FunctionCompiler } from './compile.ts'
import { FunctionDecompiler } from './decompile.ts'
import type { Linker } from './linker.ts'
import { readStructHead } from './objects.ts'
import type { Package } from './package.ts'
import { lineAt } from './parse.ts'

export interface Fidelity {
  same: boolean
  /** Where they part: the statement (0-based, in the script) and the token there in each. */
  statement?: number
  original?: string
  compiled?: string
  error?: string
}

const flat = (n: Node, out: string[]) => {
  // (Floats as 32 bits store them.)
  out.push(`${tokenName(n)}(${n.args.filter((a) => typeof a !== 'object').map((a) => (n.op === 0x1e && typeof a === 'number' ? Math.fround(a) : a)).join(',')})`)
  for (const a of n.args) {
    if (a && typeof a === 'object' && 'op' in (a as object)) flat(a as Node, out)
    else if (Array.isArray(a)) for (const x of a as unknown[]) if (x && typeof x === 'object' && 'op' in (x as object)) flat(x as Node, out)
  }
}

export function fidelity(linker: Linker, pkg: Package, ref: number, source: string): Fidelity {
  const h = readStructHead(pkg, ref)
  const orig = pkg.data(ref).subarray(h.scriptAt, h.end)
  let compiled: Node[]
  try {
    compiled = new FunctionCompiler(linker, pkg, ref).compileStatements(source, binaryOperators(linker))
  } catch (e) {
    return { same: false, error: (e as Error).message }
  }
  // The same bytes: the same (a float made here and one read from 32 bits compare equal so).
  const code = encodeScript(compiled).code
  if (code.length === orig.length && code.every((b, i) => b === orig[i])) return { same: true }
  const none = pkg.findName('None')
  const original = decodeScript(orig, (n) => n.index === none).statements
  for (let i = 0; i < Math.max(original.length, compiled.length); i++) {
    const a: string[] = []
    const b: string[] = []
    if (original[i]) flat(original[i]!, a)
    if (compiled[i]) flat(compiled[i]!, b)
    const k = a.findIndex((x, j) => x !== b[j])
    if (k >= 0 || a.length !== b.length) {
      const at = k >= 0 ? k : Math.min(a.length, b.length)
      return { same: false, statement: i, original: a[at] ?? '(nothing)', compiled: b[at] ?? '(nothing)' }
    }
  }
  return { same: true }
}

/** The note the decompiler puts above a function whose source does not say all its bytes. */
export function fidelityNote(f: Fidelity, text = ''): string {
  if (f.same) return text.includes('__asm(') ? `// upkit: this function's bytecode holds what UnrealScript does not say (a hand patch?), written as __asm(…): it compiles back to the same bytes.\n` : ''
  if (f.error) return `// upkit: this source does not compile back yet (${f.error}).\n`
  return (
    `// upkit: this function's bytecode holds something UnrealScript does not say (a hand patch?).\n` +
    `// Compiled, this source differs from it from statement ${f.statement! + 1}: ${f.original} in the package, ${f.compiled} compiled.\n`
  )
}

/**
 * A function's source as it is best read: the widening conversions the compiler
 * makes on its own left out (float(1) + x reads 1 + x; int(eMode) == int(eOff)
 * reads eMode == eOff), where that compiles to the very bytes the exact source
 * does; else the exact source. (float(I) / 2 without its float would divide ints.)
 */
export function readableSource(linker: Linker, pkg: Package, ref: number): string {
  const best = readableOrExact(linker, pkg, ref)
  // Where the source does not compile back to the bytes (a hand patch): the bytes kept as __asm.
  if (readStructHead(pkg, ref).size && !fidelity(linker, pkg, ref, best).same) return asmSource(linker, pkg, ref) ?? best
  return best
}
function readableOrExact(linker: Linker, pkg: Package, ref: number): string {
  const exact = new FunctionDecompiler(linker, pkg, ref).decompile()
  const d = new FunctionDecompiler(linker, pkg, ref)
  d.readable = true
  const pretty = d.decompile()
  if (pretty === exact) return exact
  try {
    const ops = binaryOperators(linker)
    const a = new FunctionCompiler(linker, pkg, ref).compile(exact, ops).code
    const b = new FunctionCompiler(linker, pkg, ref).compile(pretty, ops).code
    if (a.length === b.length && a.every((x, i) => x === b[i])) return pretty
  } catch {
    // the exact one, then
  }
  return exact
}

/**
 * Where two nodes part: the first node of the original (in its order) that
 * differs, else null. Offsets and sizes (16-bit: jump targets, skips) are
 * compared only with offsets: one that differs follows from something after
 * it, which is where they part.
 */
function partsAt(x: Node, y: Node, offsets = false): Node | null {
  if (x.op !== y.op || x.native !== y.native) return x
  const kinds = x.native !== undefined ? ['params'] : (TOKENS[x.op]?.args ?? [])
  for (let i = 0; i < kinds.length; i++) {
    const a = x.args[i]
    const b = y.args[i]
    switch (kinds[i]) {
      case 'expr':
      case 'optexpr': {
        if (!a || !b) {
          if (a || b) return x
          break
        }
        const r = partsAt(a as Node, b as Node, offsets)
        if (r) return r
        break
      }
      case 'params': {
        const as = a as Node[]
        const bs = b as Node[]
        if (as.length !== bs.length) return x
        for (let k = 0; k < as.length; k++) {
          const r = partsAt(as[k]!, bs[k]!, offsets)
          if (r) return r
        }
        break
      }
      case 'case': {
        const [na, ea] = a as unknown as [number, Node | null]
        const [nb, eb] = b as unknown as [number, Node | null]
        if ((offsets && na !== nb) || !ea !== !eb) return x
        if (ea && eb) {
          const r = partsAt(ea, eb, offsets)
          if (r) return r
        }
        break
      }
      case 'name': {
        const na = a as NameValue
        const nb = b as NameValue
        if (na.index !== nb.index || na.number !== nb.number) return x
        break
      }
      case 'f32':
        if (Math.fround(a as number) !== Math.fround(b as number)) return x
        break
      case 'labels':
        if (offsets && JSON.stringify(a) !== JSON.stringify(b)) return x
        break
      case 'u16':
        if (offsets && a !== b) return x
        break
      default:
        if (a !== b) return x
    }
  }
  return null
}

/**
 * A function's source with the places its bytes say what UnrealScript cannot
 * written as __asm(…), as few as it takes: compiled, the very bytes. Found by
 * compiling and looking: where the bytes part, that node; where the source
 * does not compile, the least of its statement that, written so, does. Null
 * where that does not get there.
 */
export function asmSource(linker: Linker, pkg: Package, ref: number): string | null {
  const h = readStructHead(pkg, ref)
  const orig = pkg.data(ref).subarray(h.scriptAt, h.end)
  const none = pkg.findName('None')
  const original = decodeScript(orig, (n) => n.index === none).statements
  const ops = binaryOperators(linker)
  const attempt = (marks: Set<number>) => {
    const d = new FunctionDecompiler(linker, pkg, ref)
    d.asm = marks
    const text = d.decompile()
    try {
      return { text, d, compiled: new FunctionCompiler(linker, pkg, ref).compileStatements(text, ops), error: null }
    } catch (e) {
      return { text, d, compiled: null, error: e as Error & { pos?: number } }
    }
  }
  // Each node's parent, to write one that will not come out right alone as part of its parent;
  // and its statement, written whole as a last resort (all tokens: always the bytes).
  const parent = new Map<number, Node>()
  const statementOf = new Map<number, Node>()
  for (const st of original)
    for (const n of walk(st)) {
      statementOf.set(n.at, st)
      for (const c of walk(n)) if (c !== n && !parent.has(c.at)) parent.set(c.at, n)
    }
  const all = (st: Node | undefined, into: Set<number>) => {
    let grew = false
    if (st)
      for (const n of walk(st))
        if (!into.has(n.at)) {
          into.add(n.at)
          grew = true
        }
    return grew
  }
  const errorLine = (t: ReturnType<typeof attempt>) => (t.error?.pos === undefined ? -1 : lineAt(t.text, t.error.pos) - 1)
  let marks = new Set<number>()
  const debug = process.env.UPKIT_ASM_DEBUG ? (m: string) => console.error(`asm ${pkg.path(ref)}: ${m}`) : null
  for (let round = 0; round < 400; round++) {
    const r = attempt(marks)
    debug?.(`round ${round}, ${marks.size} marked, ${r.compiled ? 'compiled' : `error ${r.error?.message} (line ${errorLine(r) + 1})`}`)
    if (r.compiled) {
      const code = encodeScript(r.compiled).code
      if (code.length === orig.length && code.every((b, i) => b === orig[i])) return r.text
      let at: Node | null = null
      for (const offsets of [false, true])
        for (let i = 0; i < original.length && !at; i++) {
          if (!r.compiled[i]) return null
          at = partsAt(original[i]!, r.compiled[i]!, offsets)
        }
      // (The same tokens, and more of them compiled: nothing of the original to write otherwise.)
      if (debug && at) {
        const shallow = (n: Node) => `${tokenName(n)}(${n.args.map((a) => (a && typeof a === 'object' ? ('op' in (a as object) ? tokenName(a as Node) : JSON.stringify(a)) : String(a))).join(', ')})`
        const comp = r.compiled.flatMap((st) => [...walk(st)])
        const orig = original.flatMap((st) => [...walk(st)])
        const k = orig.indexOf(at)
        debug(`parts at ${shallow(at)} @${at.at}${marks.has(at.at) ? ' (marked)' : ''}; compiled there: ${comp[k] ? shallow(comp[k]!) : '-'}`)
      } else debug?.('no node parts')
      if (!at) return null
      if (!marks.has(at.at)) {
        marks.add(at.at)
        continue
      }
      // Written so and still parting there: all of it so, else its parent too.
      let grew = false
      for (const n of walk(at))
        if (!marks.has(n.at)) {
          marks.add(n.at)
          grew = true
        }
      for (let p = parent.get(at.at); !grew && p; p = parent.get(p.at))
        if (!marks.has(p.at)) {
          marks.add(p.at)
          grew = true
        }
      if (!grew) grew = all(statementOf.get(at.at), marks)
      if (!grew) return null
      continue
    }
    // Not compiled: the statements on the line it stopped at.
    const line = errorLine(r)
    const stmts = line >= 0 ? r.d.lineNodes.get(line) : undefined
    if (!stmts) return null
    const onLine = stmts.flatMap((st) => [...walk(st)])
    // A name it does not know (another function's local, a subclass's member read without a
    // cast): every node on the line that names it, with the context it is read through.
    const named = /unknown name (\w+)|^no (\w+) in /.exec(r.error!.message)
    if (named) {
      const name = (named[1] ?? named[2]!).toLowerCase()
      let grew = false
      for (const n of onLine) {
        const ref = [0x00, 0x01, 0x02, 0x48, 0x1c].includes(n.op) || n.op === 0x35 ? (n.args[0] as number) : 0
        const callName = n.op === 0x1b ? pkg.name(n.args[0] as NameValue) : ''
        if (!(ref && pkg.objectName(ref).toLowerCase() === name) && callName.toLowerCase() !== name) continue
        for (let x: Node | undefined = n; x; ) {
          if (!marks.has(x.at)) {
            marks.add(x.at)
            grew = true
          }
          const p = parent.get(x.at)
          x = p && (p.op === 0x19 || p.op === 0x12) && p.args[4] === x ? p : undefined
        }
      }
      if (grew) continue
    }
    // Else the least of a statement on the line that, written so, gets past it.
    const past = (t: ReturnType<typeof attempt>) => !!t.compiled || errorLine(t) > line
    let fixed = false
    for (const c of [...onLine].reverse()) {
      const trial = new Set(marks)
      for (const n of walk(c)) trial.add(n.at)
      if (!past(attempt(trial))) continue
      // Then as little of it as still gets past.
      for (const n of walk(c)) {
        if (n === c || marks.has(n.at)) continue
        trial.delete(n.at)
        if (!past(attempt(trial))) trial.add(n.at)
      }
      marks = trial
      fixed = true
      break
    }
    // Else the line's statements whole.
    if (!fixed) {
      let grew = false
      for (const st of stmts) grew = all(statementOf.get(st.at) ?? st, marks) || grew
      if (!grew) return null
    }
  }
  return null
}

/** A class's replication as best read (its conditions readable where they compile to the same bytes). */
export function readableReplication(linker: Linker, pkg: Package, classRef: number): string {
  const d = new FunctionDecompiler(linker, pkg, classRef)
  d.check = (text, node) => {
    try {
      const a = encodeScript([new FunctionCompiler(linker, pkg, classRef).compileExpression(text, { k: 'bool' })]).code
      const b = encodeScript([node]).code
      return a.length === b.length && a.every((x, i) => x === b[i])
    } catch {
      return false
    }
  }
  return d.decompileReplication()
}

/** A state's code as best read (as readableSource does for a function: only where it compiles the same). */
export function readableStateCode(linker: Linker, pkg: Package, ref: number): string {
  const exact = new FunctionDecompiler(linker, pkg, ref).decompileStateCode()
  const d = new FunctionDecompiler(linker, pkg, ref)
  d.readable = true
  const pretty = d.decompileStateCode()
  if (pretty === exact) return exact
  try {
    const ops = binaryOperators(linker)
    const a = encodeScript(new FunctionCompiler(linker, pkg, ref).compileStateCode(exact, ops).statements).code
    const b = encodeScript(new FunctionCompiler(linker, pkg, ref).compileStateCode(pretty, ops).statements).code
    if (a.length === b.length && a.every((x, i) => x === b[i])) return pretty
  } catch {
    // the exact one, then
  }
  return exact
}

