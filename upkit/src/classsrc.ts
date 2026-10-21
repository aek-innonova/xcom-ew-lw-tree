// A whole class's source (as `upkit class` writes it, edited) split back into
// what compiles: each function's source, and each state's code. Compared with
// what the package's own bytecode decompiles to, the ones that were edited are
// the change set.

import type { Change } from './changes.ts'
import { FunctionDecompiler } from './decompile.ts'
import { readableSource } from './fidelity.ts'
import { ClassDecompiler } from './classdecomp.ts'
import { typeOf, typeText } from './types.ts'
import type { Linker } from './linker.ts'
import type { Package } from './package.ts'
import { lex, lineAt } from './parse.ts'
import {
  parseClassHeader,
  parseConst,
  parseEnum,
  parseSignature,
  parseState,
  parseStruct,
  parseVar,
  type ConstDecl,
  type EnumDecl,
  type FunctionDecl,
  type StateDecl,
  type StructDecl,
  type VarDecl,
} from './declare.ts'

export interface ClassPart {
  /** "Function" in the class, "State.Function" in a state, or "State" for a state's code. */
  path: string
  kind: 'function' | 'state code' | 'var' | 'const' | 'enum' | 'struct' | 'state' | 'replication'
  text: string
  /** Where it starts in the source (an offset). */
  at?: number
}

const FUNCTION_WORDS = new Set(['function', 'event', 'delegate', 'operator', 'preoperator', 'postoperator'])
const MODIFIERS = new Set([
  'simulated', 'static', 'final', 'native', 'private', 'protected', 'public', 'exec', 'latent', 'iterator',
  'singular', 'reliable', 'unreliable', 'server', 'client', 'noexport', 'const', 'coerce', 'intrinsic', 'noexportheader',
  'virtual', 'editoronly', 'k2call', 'k2pure', 'k2override',
])

/** The class's functions and states' code, from its source. */
export function splitClass(src: string): ClassPart[] {
  // defaultproperties are not code (and hold text the lexer need not read).
  const dp = /^\s*defaultproperties\b/im.exec(src)
  const code = dp ? src.slice(0, dp.index) : src
  const toks = lex(code)
  const parts: ClassPart[] = []
  const at = (i: number) => toks[i]!
  const isWord = (i: number, w: string) => at(i).t === 'id' && at(i).v.toLowerCase() === w

  /** The index after the bracket that closes the one at i. */
  const skipBlock = (i: number): number => {
    let d = 0
    for (; at(i).t !== 'eof'; i++) {
      if (at(i).v === '{' && at(i).t === 'op') d++
      if (at(i).v === '}' && at(i).t === 'op' && --d === 0) return i + 1
    }
    return i
  }

  /**
   * A function declaration starting at i (its modifiers first): its name, and
   * the index after it (its body's closing bracket, or its semicolon).
   */
  const functionAt = (i: number): { name: string; end: number; kw: number } | null => {
    let j = i
    while (at(j).t === 'id' && MODIFIERS.has(at(j).v.toLowerCase())) {
      j++
      if (at(j).v === '(') j = skipParens(j)
    }
    if (!(at(j).t === 'id' && FUNCTION_WORDS.has(at(j).v.toLowerCase()))) return null
    const kw = j
    // The name is the token before the parameter list.
    let k = j + 1
    while (at(k).t !== 'eof' && !(at(k + 1).v === '(' && at(k + 1).t === 'op')) {
      if (at(k).v === '(' && at(k).t === 'op') k = skipParens(k) - 1 // operator(16)
      k++
    }
    const name = at(k).v
    k = skipParens(k + 1)
    while (at(k).t !== 'eof' && at(k).v !== '{' && at(k).v !== ';') k++
    return { name, end: at(k).v === ';' ? k + 1 : skipBlock(k), kw }
  }
  const skipParens = (i: number): number => {
    let d = 0
    for (; at(i).t !== 'eof'; i++) {
      if (at(i).v === '(') d++
      if (at(i).v === ')' && --d === 0) return i + 1
    }
    return i
  }
  // From a token up to the next one after the part (comments between parts go with the earlier).
  const text = (from: number, to: number) => code.slice(at(from).pos, at(to).pos)

  /** The members of a class body or a state body, from i up to (not including) stop. */
  const members = (i: number, stop: number, state: string | null) => {
    let codeStart = -1
    while (i < stop) {
      const t = at(i)
      const f = functionAt(i)
      if (f) {
        parts.push({ path: state ? `${state}.${f.name}` : f.name, kind: 'function', text: text(i, f.end), at: at(i).pos })
        i = f.end
        continue
      }
      if (!state) {
        // A state: [auto] [simulated] state Name [extends Other] { … }
        let j = i
        while (isWord(j, 'auto') || isWord(j, 'simulated')) j++
        if (isWord(j, 'state')) {
          const name = at(j + 1).v
          let k = j + 2
          while (at(k).v !== '{' && at(k).t !== 'eof') k++
          const end = skipBlock(k)
          // The state itself (its header), then its functions and code.
          parts.push({ path: name, kind: 'state', text: text(i, k) })
          members(k + 1, end - 1, name)
          i = end
          continue
        }
        // Declarations up to their semicolon (var delegate<…> is not a delegate's declaration).
        if (isWord(i, 'var') || isWord(i, 'const')) {
          const from = i
          while (at(i).v !== ';' && at(i).t !== 'eof') i++
          i++
          if (isWord(from, 'var')) parts.push({ path: '', kind: 'var', text: text(from, i) })
          else parts.push({ path: at(from + 1).v, kind: 'const', text: text(from, i) })
          continue
        }
        // An enum or a struct: its block, and the semicolon after it.
        if (isWord(i, 'enum') || isWord(i, 'struct')) {
          const from = i
          while (at(i).v !== '{' && at(i).t !== 'eof') i++
          // (struct [native] Name [extends Other]: the name is the word before the block or "extends".)
          let n = i - 1
          if (isWord(n - 1, 'extends')) n -= 2
          const name = at(n).v
          i = skipBlock(i)
          if (at(i).v === ';') i++
          parts.push({ path: name, kind: isWord(from, 'enum') ? 'enum' : 'struct', text: text(from, i) })
          continue
        }
        // The replication block: what is replicated, and when.
        if (isWord(i, 'replication') && at(i + 1).v === '{') {
          const end = skipBlock(i + 1)
          parts.push({ path: '', kind: 'replication', text: text(i, end) })
          i = end
          continue
        }
        // Anything else with a block (cpptext): skipped whole.
        if (t.v === '{' && t.t === 'op') {
          i = skipBlock(i)
          continue
        }
        i++
        continue
      }
      // In a state: ignores …; and its code (the rest).
      if (isWord(i, 'ignores')) {
        while (at(i).v !== ';' && i < stop) i++
        i++
        continue
      }
      codeStart = i
      break
    }
    if (state && codeStart >= 0) parts.push({ path: state, kind: 'state code', text: text(codeStart, stop), at: at(codeStart).pos })
  }
  members(0, toks.length - 1, null)
  return parts
}

const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n')

/** A struct's structdefaultproperties as the decompiler writes them. */
function structDefaultsText(linker: Linker, pkg: Package, classRef: number, ref: number): string {
  const o = linker.object({ pkg, ref })
  if (o?.kind !== 'struct') return ''
  const cd = new ClassDecompiler(linker, pkg, classRef, false)
  return o.defaults.map((t) => cd.tagLine(t, { pkg, ref })).join('\n')
}

/** How a constant, enum or struct the package has is declared otherwise in source (null: as it is). */
function declaredOtherwise(linker: Linker, pkg: Package, ref: number, kind: string, text: string): string | null {
  const o = linker.object({ pkg, ref })
  try {
    if (kind === 'const' && o?.kind === 'const') {
      const v = parseConst(text).value
      return v.replace(/\s+/g, '') === o.value.replace(/\s+/g, '') ? null : `its value is ${o.value} in the package`
    }
    if (kind === 'enum' && o?.kind === 'enum') {
      const want = parseEnum(text).values.map((x) => x.toLowerCase())
      const has = o.names.filter((x, i, a) => !(i === a.length - 1 && x.endsWith('_MAX'))).map((x) => x.toLowerCase())
      return want.join(',') === has.join(',') ? null : 'its values differ from the package'
    }
    if (kind === 'struct' && o?.kind === 'struct') {
      const want = parseStruct(text).vars.flatMap((v) => v.names.map((n) => `${n.name}:${v.type}`.toLowerCase().replace(/\s+/g, '')))
      const has: string[] = []
      for (let c = o.head.children; c; ) {
        const f = linker.object({ pkg, ref: c })
        if (!f || f.kind !== 'property') break
        has.push(`${pkg.objectName(c)}:${typeText(typeOf(linker, { pkg, ref: c }, f))}`.toLowerCase().replace(/\s+/g, ''))
        c = f.next
      }
      return want.join(',') === has.join(',') ? null : 'its members differ from the package'
    }
  } catch {
    return null
  }
  return null
}

/** A function's declaration, without its parameters' defaults (those compile with the body): to compare. */
export function declaration(text: string): string {
  try {
    const d = parseSignature(text, null)
    return JSON.stringify([
      [...d.modifiers].sort(),
      d.keyword,
      d.returnType?.toLowerCase() ?? null,
      d.params.map((p) => [p.name.toLowerCase(), p.type.toLowerCase(), p.dim, p.out, p.optional, p.coerce, p.isConst]),
      d.isConst,
    ])
  } catch {
    return ''
  }
}

const same = (a: string, b: string) => {
  const x = lex(a)
  const y = lex(b)
  return x.length === y.length && x.every((t, i) => t.t === y[i]!.t && t.v === y[i]!.v)
}

/** A class's source against its package: what was edited, and what is new. */
export interface ClassEdits {
  /** Functions and states' code whose source differs from what the package decompiles to. */
  changes: (Change & { path: string })[]
  /** Member variables the class does not have. */
  vars: VarDecl[]
  /** Functions the class (or a state of it) does not have, with their source (delegates among them). */
  functions: (FunctionDecl & { path: string; text: string })[]
  consts: ConstDecl[]
  enums: EnumDecl[]
  structs: StructDecl[]
  states: StateDecl[]
  /** A new class's replication block (an existing class's must be as the package has it). */
  replication: string | null
  /** Structs the class has whose structdefaultproperties were edited: compiled into the struct. */
  structDefaults: { ref: number; path: string; block: string }[]
}

export function classEdits(
  linker: Linker,
  pkg: Package,
  className: string,
  src: string,
  /** Paths compiled whatever they decompile to now (just declared: their bodies are stubs). */
  always: Set<string> = new Set(),
): ClassEdits {
  const out: ClassEdits = { changes: [], vars: [], functions: [], consts: [], enums: [], structs: [], states: [], replication: null, structDefaults: [] }
  // The class's own declaration: what it extends and is within stay as the package has them.
  const own = pkg.find(className)
  const co = own ? linker.object({ pkg, ref: own }) : null
  if (co?.kind === 'class') {
    let head: ReturnType<typeof parseClassHeader> | null = null
    try {
      head = parseClassHeader(src)
    } catch {
      head = null
    }
    const parent = co.head.superStruct ? pkg.objectName(co.head.superStruct) : null
    if (head && parent && head.parent.toLowerCase() !== parent.toLowerCase())
      throw new Error(`${className} extends ${parent} in the package, not ${head.parent}; a changed class declaration is not compiled`)
    const within = co.within ? pkg.objectName(co.within) : 'Object'
    if (head?.within && head.within.toLowerCase() !== within.toLowerCase())
      throw new Error(`${className} is within ${within} in the package, not ${head.within}; a changed class declaration is not compiled`)
  }
  for (const p of splitClass(src)) {
    if (p.kind === 'replication') {
      // A class just declared takes it; one the package had keeps its own.
      if (always.has(className.toLowerCase())) out.replication = p.text
      else if (own && !same(new FunctionDecompiler(linker, pkg, own).decompileReplication(), p.text))
        throw new Error(`${className}: its replication differs from the package's; a changed replication is not compiled`)
      continue
    }
    // Declarations the class may not have yet: known by name.
    if (p.kind === 'const' || p.kind === 'enum' || p.kind === 'struct' || p.kind === 'state') {
      const has = pkg.find(`${className}.${p.path}`)
      if (has) {
        // One the class has, declared otherwise: not compiled (it stays as the package has it).
        const differs = declaredOtherwise(linker, pkg, has, p.kind, p.text)
        if (differs) throw new Error(`${className}.${p.path}: ${differs}; a changed ${p.kind} is not compiled`)
        // A struct's defaults edited: those compile (into the struct, as a class's do into its default object).
        if (p.kind === 'struct') {
          const block = parseStruct(p.text).defaults ?? ''
          if (lines(block) !== lines(structDefaultsText(linker, pkg, own!, has)))
            out.structDefaults.push({ ref: has, path: `${className}.${p.path}`, block })
        }
        continue
      }
      if (p.kind === 'const') out.consts.push(parseConst(p.text))
      else if (p.kind === 'enum') out.enums.push(parseEnum(p.text))
      else if (p.kind === 'struct') out.structs.push(parseStruct(p.text))
      else out.states.push(parseState(p.text))
      continue
    }
    if (p.kind === 'var') {
      // (A declaration upkit does not declare, a delegate's, is fine when the class has it.)
      const last = /(\w+)\s*(?:\[[^\]]*\])?\s*;\s*$/.exec(p.text)?.[1]
      if (last && pkg.find(`${className}.${last}`) && /\bdelegate\s*</i.test(p.text)) continue
      const v = parseVar(p.text, className)
      const fresh = v.names.filter((n) => !pkg.find(`${className}.${n.name}`))
      // One the class has, declared with another type: not compiled (its type stays).
      for (const n of v.names) {
        const ref = pkg.find(`${className}.${n.name}`)
        const prop = ref ? linker.object({ pkg, ref }) : null
        if (prop?.kind !== 'property') continue
        const has = typeText(typeOf(linker, { pkg, ref }, prop)).toLowerCase().replace(/\s+/g, '')
        if (has !== '?' && has !== v.type.toLowerCase().replace(/\s+/g, '') && !/\?/.test(has))
          throw new Error(`${className}.${n.name}: declared ${v.type}, the package has it ${has}; a changed type is not compiled`)
      }
      if (fresh.length) out.vars.push({ ...v, names: fresh })
      continue
    }
    const path = `${className}.${p.path}`
    const ref = pkg.find(path)
    const kind = ref ? pkg.className(ref) : ''
    // An operator is named by its symbol in source and otherwise as an object (Not_PreBool):
    // one the class has (by symbol) is kept as it is (operators are native, and not compiled).
    if (!ref && p.kind === 'function' && /\b(pre|post)?operator\b/i.test(p.text)) {
      const symbol = p.path.split('.').pop()!
      const owner = pkg.find(className)
      let has = false
      for (let i = 1; i <= pkg.exports.length && !has; i++)
        if (pkg.exports[i - 1]!.outer === owner && pkg.className(i) === 'Function') {
          const o = linker.object({ pkg, ref: i })
          has = o?.kind === 'function' && o.friendlyName === symbol
        }
      if (has) continue
    }
    if (!ref && p.kind === 'function') {
      const dot = p.path.indexOf('.')
      out.functions.push({ ...parseSignature(p.text, dot > 0 ? p.path.slice(0, dot) : null), path, text: p.text })
      continue
    }
    // (The code of a state not declared yet: compiled once it is.)
    if (!ref && p.kind === 'state code') continue
    if (!ref || (p.kind === 'function' ? kind !== 'Function' : kind !== 'State'))
      throw new Error(`${path} is not in the package (new states are not compiled yet)`)
    const d = new FunctionDecompiler(linker, pkg, ref)
    let original: string
    try {
      original = p.kind === 'function' ? readableSource(linker, pkg, ref) : d.decompileStateCode()
    } catch {
      original = ''
    }
    const edited = always.has(path.toLowerCase()) || !same(original, p.text)
    // Its declaration as the package has it: a body is compiled, a changed declaration is not.
    if (edited && p.kind === 'function' && !always.has(path.toLowerCase()) && declaration(original) !== declaration(p.text))
      throw new Error(`${path}: its declaration changed (modifiers, return type, parameters); only a body is compiled, the declaration stays as the package has it`)
    if (edited) out.changes.push({ ref, text: p.text, path, line: p.at === undefined ? 1 : lineAt(src, p.at) })
  }
  return out
}

/** What was edited in a class's source (new declarations are an error here: see classEdits). */
export function classChanges(linker: Linker, pkg: Package, className: string, src: string): (Change & { path: string })[] {
  const e = classEdits(linker, pkg, className, src)
  const fresh = [
    ...e.vars.flatMap((v) => v.names.map((n) => n.name)),
    ...e.functions.map((f) => f.path),
    ...[...e.consts, ...e.enums, ...e.structs, ...e.states].map((x) => x.name),
  ]
  if (fresh.length) throw new Error(`new declarations (${fresh.join(', ')}) need a whole package (--out)`)
  return e.changes
}
