// New declarations in a class: member variables and functions the package
// does not have, added to it (a whole package; a mod script cannot add objects).
//
// Declared first, as the compiler lays them out: a property or a function
// object (with its parameters and return value) linked at the head of the
// class's (or state's) fields, as its last declaration is, and a function
// entered in the function map. The bodies are then compiled against that
// package like any edited function (the function exists by then).

import { Writer } from './bytes.ts'
import { FunctionCompiler, shared, type Shared } from './compile.ts'
import type { Linker, Located } from './linker.ts'
import { readObject, readStructHead, type ClassObj, type StateObj } from './objects.ts'
import type { Package } from './package.ts'
import { lex, type Tok } from './parse.ts'
import { CPF, FUNC } from './types.ts'
import { writePackage } from './writer.ts'

export class DeclareError extends Error {}

export interface VarDecl {
  names: { name: string; dim: number }[]
  type: string
  flags: bigint
  category: string | null
}

export interface ParamDecl {
  name: string
  type: string
  dim: number
  out: boolean
  optional: boolean
  coerce: boolean
  isConst: boolean
}

export interface FunctionDecl {
  name: string
  /** The state it is declared in, or null for the class. */
  state: string | null
  modifiers: Set<string>
  keyword: string
  returnType: string | null
  params: ParamDecl[]
  isConst: boolean
}

const CPF_NeedCtorLink = 0x400000n

const VAR_MODIFIERS: Record<string, bigint> = {
  const: CPF.Const,
  config: CPF.Config,
  globalconfig: CPF.GlobalConfig | CPF.Config,
  localized: CPF.Localized | CPF.Const,
  transient: CPF.Transient,
  editconst: CPF.EditConst,
  input: CPF.Input,
  deprecated: CPF.Deprecated,
  editinline: CPF.EditInline,
  noclear: CPF.NoClear,
  noimport: CPF.NoImport,
  duplicatetransient: CPF.DuplicateTransient,
  noexport: CPF.NoExport,
  repnotify: CPF.RepNotify,
  interp: CPF.Interp | CPF.Edit,
  nontransactional: CPF.NonTransactional,
  privatewrite: CPF.PrivateWrite,
  protectedwrite: CPF.ProtectedWrite,
  edithide: CPF.EditHide,
  edittextbox: CPF.EditTextBox,
  crosslevelpassive: CPF.CrossLevelPassive,
  crosslevelactive: CPF.CrossLevelActive,
  // Said, nothing stored: protected and private are the compiler's checks.
  private: 0n,
  protected: 0n,
  public: 0n,
}

/** A type as written: Name, array<…>, class<…> (tokens joined back). */
function typeText(toks: Tok[]): string {
  return toks.map((t) => t.v).join('')
}

/** var[(Category)] modifiers Type Name[dim], Name[dim]; */
export function parseVar(text: string, className: string): VarDecl {
  const t = lex(text).filter((x) => x.t !== 'eof')
  let i = 0
  if (t[i]?.v.toLowerCase() !== 'var') throw new DeclareError(`not a variable: ${text}`)
  i++
  let flags = 0n
  let category: string | null = null
  if (t[i]?.v === '(') {
    flags |= CPF.Edit
    i++
    // (A category can be several words.)
    const words: string[] = []
    while (i < t.length && t[i]!.v !== ')') words.push(t[i++]!.v)
    if (t[i]?.v !== ')') throw new DeclareError(`var(: no )`)
    category = words.length ? words.join(' ') : className
    i++
  }
  for (;;) {
    const w = t[i]?.v.toLowerCase() ?? ''
    if (t[i]?.t === 'id' && w in VAR_MODIFIERS && t[i + 1]?.t === 'id') {
      flags |= VAR_MODIFIERS[w]!
      i++
      continue
    }
    if (t[i]?.t === 'id' && (w === 'native' || w === 'export') && t[i + 1]?.t === 'id') {
      // (Read; declare() refuses a new one: C++ would have to have it.)
      flags |= CPF.Native
      i++
      continue
    }
    break
  }
  if (t[i]?.v.toLowerCase() === 'delegate') throw new DeclareError('a delegate variable is not declared yet')
  // The type: a word, with <…> after it.
  const typeStart = i
  i++
  if (t[i]?.v === '<') {
    let d = 0
    for (; i < t.length; i++) {
      if (t[i]!.v === '<') d++
      if (t[i]!.v === '>' && --d === 0) break
      if (t[i]!.v === '>>') {
        d -= 2
        if (d <= 0) break
      }
    }
    i++
  }
  const type = typeText(t.slice(typeStart, i))
  const names: { name: string; dim: number }[] = []
  for (;;) {
    const n = t[i++]
    if (!n || n.t !== 'id') throw new DeclareError(`var ${type}: a name expected`)
    let dim = 1
    if (t[i]?.v === '[') {
      dim = Number(t[i + 1]!.v)
      i += 3
    }
    names.push({ name: n.v, dim })
    if (t[i]?.v === ',') {
      i++
      continue
    }
    break
  }
  return { names, type, flags, category }
}

const FUNCTION_MODIFIERS = new Set([
  'simulated', 'static', 'final', 'private', 'protected', 'public', 'exec', 'latent', 'iterator', 'singular',
  'reliable', 'unreliable', 'server', 'client', 'native', 'noexport', 'intrinsic', 'k2call', 'k2pure', 'k2override',
])

/** A function's declaration: modifiers, keyword, return type, name, parameters. */
export function parseSignature(text: string, state: string | null): FunctionDecl {
  const t = lex(text).filter((x) => x.t !== 'eof')
  let i = 0
  const modifiers = new Set<string>()
  while (t[i]?.t === 'id' && FUNCTION_MODIFIERS.has(t[i]!.v.toLowerCase())) {
    modifiers.add(t[i]!.v.toLowerCase())
    i++
    if (t[i]?.v === '(') while (t[i] && t[i++]!.v !== ')');
  }
  const keyword = (t[i++]?.v ?? '').toLowerCase()
  if (keyword !== 'function' && keyword !== 'event') throw new DeclareError(`a new ${keyword || 'declaration'} is not declared yet (functions and events are)`)
  // The name is the word before the parameter list; any words between are the return type.
  let open = i
  while (open < t.length && t[open]!.v !== '(') open++
  const name = t[open - 1]!.v
  const returnType = open - 1 > i ? typeText(t.slice(i, open - 1)) : null
  i = open + 1
  const params: ParamDecl[] = []
  while (i < t.length && t[i]!.v !== ')') {
    const p: ParamDecl = { name: '', type: '', dim: 1, out: false, optional: false, coerce: false, isConst: false }
    for (;;) {
      const w = t[i]!.v.toLowerCase()
      if (w === 'out') p.out = true
      else if (w === 'optional') p.optional = true
      else if (w === 'coerce') p.coerce = true
      else if (w === 'const') p.isConst = true
      else if (w === 'skip' || w === 'init') {
        /* (said, not stored) */
      } else break
      i++
    }
    const typeStart = i
    i++
    if (t[i]?.v === '<') {
      let d = 0
      for (; i < t.length; i++) {
        if (t[i]!.v === '<') d++
        if (t[i]!.v === '>' && --d === 0) break
      }
      i++
    }
    p.type = typeText(t.slice(typeStart, i))
    p.name = t[i++]!.v
    if (t[i]?.v === '[') {
      p.dim = Number(t[i + 1]!.v)
      i += 3
    }
    // A default (= value): compiled with the body.
    if (t[i]?.v === '=') {
      let d = 0
      for (i++; i < t.length; i++) {
        const v = t[i]!.v
        if (v === '(') d++
        if (v === ')' && d-- === 0) break
        if (v === ',' && d === 0) break
      }
    }
    params.push(p)
    if (t[i]?.v === ',') i++
  }
  i++
  const isConst = t[i]?.v.toLowerCase() === 'const'
  return { name, state, modifiers, keyword, returnType, params, isConst }
}

/** The data of a class or state with another first field, and more functions in its map. */
function withFields(pkg: Package, ref: number, children: number, functions: { name: { index: number; number: number }; ref: number }[]): Uint8Array {
  const data = pkg.data(ref)
  const h = readStructHead(pkg, ref)
  // After the script: probe mask (4), label table offset (2), state flags (4), then the map.
  const mapAt = h.end + 10
  const count = new DataView(data.buffer, data.byteOffset).getInt32(mapAt, true)
  const entriesEnd = mapAt + 4 + count * 12
  const w = new Writer(data.length + functions.length * 12)
  w.bytes(data.subarray(0, entriesEnd))
  for (const f of functions) w.i32(f.name.index).i32(f.name.number).i32(f.ref)
  w.bytes(data.subarray(entriesEnd))
  const out = w.done()
  const v = new DataView(out.buffer, out.byteOffset)
  v.setInt32(h.scriptAt - 24, children, true)
  v.setInt32(mapAt, count + functions.length, true)
  return out
}

/**
 * The package with the new declarations in it: properties and functions
 * (bodies a bare return, compiled next). Names and imports they need are added.
 */
export function declare(linker: Linker, pkg: Package, classRef: number, vars: VarDecl[], functions: FunctionDecl[], sh: Shared = shared()): Uint8Array {
  const fc = new FunctionCompiler(linker, pkg, classRef, sh)
  fc.allow = 'all'
  const cls = readObject(pkg, classRef) as ClassObj
  if (vars.length && cls.classFlags & 0x80)
    throw new DeclareError(`${pkg.objectName(classRef)} is a native class: its C++ fixes its variables, so none can be added`)
  const exports: { entry: import('./package.ts').Export; data: Uint8Array }[] = []
  let nextRef = pkg.exports.length + 1
  // Per class or state: its first field and the functions added to its map.
  const owners = new Map<number, { children: number; functions: { name: { index: number; number: number }; ref: number }[] }>()
  const owner = (ref: number) => {
    let o = owners.get(ref)
    if (!o) {
      const so = readObject(pkg, ref) as StateObj
      owners.set(ref, (o = { children: so.head.children, functions: [] }))
    }
    return o
  }

  const property = (outer: number, name: string, type: string, dim: number, flags: bigint, next: number, category?: string | null) => {
    const ty = fc.typeFromText(type)
    const ref = nextRef++
    let { cls: pcls, refs } = fc.propertyClass(ty)
    const inner = ty.k === 'array' ? { ref: nextRef++, ...fc.propertyClass(ty.inner) } : null
    if (inner) refs = [inner.ref]
    const all = flags | (fc.needsCtor(ty) ? CPF_NeedCtorLink : 0n)
    exports.push(fc.propertyObject({ ref, outer, name, cls: pcls, refs, next, dim, flags: all, category: category ?? undefined }))
    if (inner) exports.push(fc.propertyObject({ ref: inner.ref, outer: ref, name, cls: inner.cls, refs: inner.refs, next: 0, dim: 1, flags: 0n }))
    return ref
  }

  for (const v of vars)
    for (const n of v.names) {
      if (v.flags & CPF.Native) throw new DeclareError(`${n.name}: a native variable needs C++`)
      const o = owner(classRef)
      o.children = property(classRef, n.name, v.type, n.dim, v.flags, o.children, v.category)
    }

  for (const f of functions) {
    if (f.modifiers.has('native')) throw new DeclareError(`${f.name}: a native function needs C++`)
    const outer = f.state ? pkg.find(`${pkg.objectName(classRef)}.${f.state}`) : classRef
    if (!outer) throw new DeclareError(`${f.name}: no state ${f.state} in the class (new states are not declared yet)`)
    // What it overrides: the parent class's function (a state's: the class's own).
    const superOf: Located | null = f.state
      ? fc.findFunction(f.name, { pkg, ref: classRef })
      : cls.head.superStruct
        ? fc.findFunction(f.name, linker.resolve(pkg, cls.head.superStruct)!)
        : null
    const superRef = superOf ? fc.refOf(superOf) : 0
    const ref = nextRef++
    const o = owner(outer)
    // The function first, then its parameters and return value, linked in that order.
    const fnAt = exports.length
    exports.push(null as never)
    const parms: number[] = []
    let flags = FUNC.Defined
    for (const p of f.params) {
      let pf = CPF.Parm
      if (p.out) pf |= CPF.OutParm
      if (p.optional) pf |= CPF.OptionalParm
      if (p.coerce) pf |= CPF.CoerceParm
      if (p.isConst) pf |= CPF.Const
      if (p.out) flags |= FUNC.HasOutParms
      if (p.optional) flags |= FUNC.HasOptionalParms
      parms.push(property(ref, p.name, p.type, p.dim, pf, 0))
    }
    if (f.returnType) parms.push(property(ref, 'ReturnValue', f.returnType, 1, CPF.Parm | CPF.OutParm | CPF.ReturnParm, 0))
    // Each parameter's next is the one after it: set now that they all have references.
    for (let k = 0; k + 1 < parms.length; k++) {
      const e = exports[parms[k]! - pkg.exports.length - 1]!
      new DataView(e.data.buffer, e.data.byteOffset).setInt32(12, parms[k + 1]!, true)
    }
    const m = f.modifiers
    if (m.has('final')) flags |= FUNC.Final
    if (m.has('iterator')) flags |= FUNC.Iterator
    if (m.has('latent')) flags |= FUNC.Latent
    if (m.has('singular')) flags |= FUNC.Singular
    if (m.has('simulated')) flags |= FUNC.Simulated
    if (m.has('exec')) flags |= FUNC.Exec
    if (m.has('static')) flags |= FUNC.Static
    if (f.keyword === 'event') flags |= FUNC.Event
    if (f.isConst) flags |= FUNC.Const
    flags |= m.has('private') ? FUNC.Private : m.has('protected') ? FUNC.Protected : FUNC.Public
    const name = fc.nameRef(f.name)
    const none = fc.nameRef('None')
    const w = new Writer(96)
    w.i32(ref - 1) // its own index
    w.i32(none.index).i32(none.number)
    w.i32(o.children) // next: the field declared before it
    w.i32(superRef)
    w.i32(0) // script text
    w.i32(parms[0] ?? 0) // children
    w.i32(0).i32(0).i32(0) // C++ text, line, text position
    // The body for now: return; and the end.
    w.i32(3).i32(3).u8(0x04).u8(0x0b).u8(0x53)
    w.u16(0).u8(0).u32(flags)
    w.i32(name.index).i32(name.number)
    exports[fnAt] = {
      entry: {
        classIndex: fc.coreClass('Function'),
        superIndex: superRef,
        outer,
        objectName: name,
        archetype: 0,
        objectFlags: 0x7000400000000n,
        serialSize: 0,
        serialOffset: 0,
        exportFlags: 0,
        netObjects: [],
        packageGuid: new Uint8Array(16),
        packageFlags: 0,
      },
      data: w.done(),
    }
    o.children = ref
    o.functions.push({ name, ref })
  }

  const data = new Map<number, Uint8Array>()
  for (const [ref, o] of owners) data.set(ref, withFields(pkg, ref, o.children, o.functions))
  const names = sh.names.map((name) => ({ name, flags: 0x7001000000000n }))
  return writePackage(pkg, { data, names, imports: sh.imports, exports, layout: 'keep' })
}
