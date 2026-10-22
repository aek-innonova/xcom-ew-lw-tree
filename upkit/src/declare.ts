// New declarations in a class: member variables and functions the package
// does not have, added to it (a whole package; a mod script is made from it).
//
// Declared first, as the compiler lays them out: a property or a function
// object (with its parameters and return value) linked at the head of the
// class's (or state's) fields, as its last declaration is, and a function
// entered in the function map. The bodies are then compiled against that
// package like any edited function (the function exists by then).

import { Reader, Writer } from './bytes.ts'
import { encodeScript, memSizeOf } from './bytecode.ts'
import { withScript } from './edit.ts'
import { ClassDecompiler } from './classdecomp.ts'
import { FunctionCompiler, shared, type Shared } from './compile.ts'
import type { Linker, Located } from './linker.ts'
import { readObject, readStructHead, readTags, tagsStart, type ClassObj, type StateObj } from './objects.ts'
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
  /** Whether it has a body ({ … }) or is only declared (;). */
  hasBody: boolean
}

const CPF_NeedCtorLink = 0x400000n

/** What an array's flags pass to its element's property (as the compiler passes them), and its own. */
const PROPAGATE_TO_INNER =
  CPF.ExportObject | CPF.EditInline | CPF.EditInlineUse | CPF.Localized | CPF.Component | CPF.Config | CPF.AlwaysInit | CPF.EditConst | CPF.Deprecated | CPF.CrossLevelPassive | CPF.CrossLevelActive
function innerFlags(fc: FunctionCompiler, outer: bigint, inner: import('./types.ts').Ty): bigint {
  return (outer & PROPAGATE_TO_INNER) | (fc.needsCtor(inner) ? CPF_NeedCtorLink : 0n) | fc.typeFlags(inner)
}

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
  // The type: a word, with <…> after it.
  const typeStart = i
  i++
  if (t[i]?.v === '<') {
    let d = 0
    for (; i < t.length; i++) {
      if (t[i]!.v === '<') d++
      if (/^>+$/.test(t[i]!.v)) d -= t[i]!.v.length
      if (d <= 0) break
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
  if (keyword !== 'function' && keyword !== 'event' && keyword !== 'delegate')
    throw new DeclareError(`a new ${keyword || 'declaration'} is not declared yet (functions, events and delegates are)`)
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
        if (/^>+$/.test(t[i]!.v)) d -= t[i]!.v.length
        if (d <= 0) break
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
  const hasBody = t.slice(i).some((x) => x.v === '{')
  return { name, state, modifiers, keyword, returnType, params, isConst, hasBody }
}

/** The data of a class or state with another first field, and more functions in its map. */
function withFields(
  pkg: Package,
  ref: number,
  children: number,
  functions: { name: { index: number; number: number }; ref: number; text: string }[],
): Uint8Array {
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
  // Events the engine sends only when asked for: the probe mask asks for the new ones.
  v.setUint32(h.end, (v.getUint32(h.end, true) | probeBits(functions.map((f) => f.text))) >>> 0, true)
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
  const owners = new Map<number, { children: number; functions: { name: { index: number; number: number }; ref: number; text: string }[] }>()
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
    const { cls: pcls, refs: own } = fc.propertyClass(ty)
    let refs = own
    const inner = ty.k === 'array' ? { ref: nextRef++, ...fc.propertyClass(ty.inner) } : null
    if (inner) refs = [inner.ref]
    const all = flags | (fc.needsCtor(ty) ? CPF_NeedCtorLink : 0n) | fc.typeFlags(ty)
    exports.push(fc.propertyObject({ ref, outer, name, cls: pcls, refs, next, dim, flags: all, category: category ?? undefined }))
    if (inner && ty.k === 'array')
      exports.push(fc.propertyObject({ ref: inner.ref, outer: ref, name, cls: inner.cls, refs: inner.refs, next: 0, dim: 1, flags: innerFlags(fc, all, ty.inner) }))
    return ref
  }

  for (const v of vars)
    for (const n of v.names) {
      if (v.flags & CPF.Native) throw new DeclareError(`${n.name}: a native variable needs C++`)
      const o = owner(classRef)
      o.children = property(classRef, n.name, v.type, n.dim, v.flags, o.children, v.category)
    }

  // The class's own functions first: a state's function overrides one of them (declared here too, perhaps).
  const ownFunctions = new Map<string, Located>()
  for (const f of [...functions].sort((x, y) => (x.state ? 1 : 0) - (y.state ? 1 : 0))) {
    if (f.modifiers.has('native')) throw new DeclareError(`${f.name}: a native function needs C++`)
    const outer = f.state ? pkg.find(`${pkg.objectName(classRef)}.${f.state}`) : classRef
    if (!outer) throw new DeclareError(`${f.name}: no state ${f.state} in the class (new states are not declared yet)`)
    // What it overrides: the parent class's function (a state's: the class's own).
    const stateObj = f.state ? (readObject(pkg, outer) as StateObj) : null
    const parentState = stateObj?.head.superStruct ? linker.resolve(pkg, stateObj.head.superStruct) : null
    const superOf: Located | null = f.state
      ? ((parentState && fc.findFunction(f.name, parentState)) ??
        ownFunctions.get(f.name.toLowerCase()) ??
        fc.findFunction(f.name, { pkg, ref: classRef }))
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
    // A delegate has no body of its own (the bare return it is written with).
    let flags = f.keyword === 'delegate' ? FUNC.Delegate : f.hasBody ? FUNC.Defined : 0
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
    o.functions.push({ name, ref, text: f.name })
    if (!f.state) ownFunctions.set(f.name.toLowerCase(), { pkg, ref })
    // A delegate's hidden variable (__Name__Delegate): what is assigned to it is called.
    if (f.keyword === 'delegate') {
      const hidden = nextRef++
      exports.push(
        fc.propertyObject({ ref: hidden, outer, name: `__${f.name}__Delegate`, cls: 'DelegateProperty', refs: [ref, 0], next: o.children, dim: 1, flags: CPF_NeedCtorLink }),
      )
      o.children = hidden
    }
  }

  const data = new Map<number, Uint8Array>()
  for (const [ref, o] of owners) data.set(ref, withFields(pkg, ref, o.children, o.functions))
  const names = sh.names.map((name) => ({ name, flags: 0x7001000000000n }))
  return writePackage(pkg, { data, names, imports: sh.imports, exports, layout: 'keep' })
}

export interface ClassDecl {
  name: string
  parent: string
  within: string | null
  config: string | null
  flags: number
  /** Flags the parent's that it drops (notplaceable). */
  clears: number
  /** The interfaces it implements (its own: a subclass does not list its parent's). */
  interfaces: string[]
}

const CLASS_MODIFIERS: Record<string, number> = {
  abstract: 0x1,
  transient: 0x8,
  placeable: 0x200,
  perobjectconfig: 0x400,
  editinlinenew: 0x1000,
  collapsecategories: 0x2000,
  deprecated: 0x2000000,
  hidedropdown: 0x4000000,
}

/** class Name extends Parent [within Outer] [modifiers]; */
export function parseClassHeader(src: string): ClassDecl {
  // class Name extends Parent …; or interface Name [extends Other] … (an interface's parent: Interface).
  const m = /^\s*(class|interface)\s+(\w+)(?:\s+extends\s+(\w+))?([^;]*);/im.exec(src.replace(/\/\/.*$/gm, ''))
  if (!m) throw new DeclareError('no "class Name extends Parent …;" declaration')
  const isInterface = m[1]!.toLowerCase() === 'interface'
  if (!isInterface && !m[3]) throw new DeclareError(`class ${m[2]}: it extends what? (class ${m[2]} extends Object …;)`)
  const d: ClassDecl = { name: m[2]!, parent: m[3] ?? 'Interface', within: null, config: null, flags: isInterface ? 0x1 : 0, clears: 0, interfaces: [] }
  const rest = m[4]!
  const within = /\bwithin\s+(\w+)/i.exec(rest)
  if (within) d.within = within[1]!
  const implementsList = /\bimplements\s*\(([^)]*)\)/i.exec(rest)
  if (implementsList) d.interfaces = implementsList[1]!.split(',').map((x) => x.trim()).filter(Boolean)
  const config = /\bconfig\s*\(\s*(\w+)\s*\)/i.exec(rest)
  if (config) {
    d.config = config[1]!
    d.flags |= 0x4
  }
  for (const w of rest.replace(/\([^)]*\)/g, ' ').split(/\s+/).map((x) => x.toLowerCase()).filter(Boolean)) {
    if (w === 'native' || w === 'nativereplication') throw new DeclareError(`a new ${w} class needs C++`)
    if (w === 'notplaceable') d.clears |= 0x200
    else if (w in CLASS_MODIFIERS) d.flags |= CLASS_MODIFIERS[w]!
  }
  return d
}

/** Events the engine sends only to a class (or state) whose probe mask has their bit. */
const PROBES: Record<string, number> = {
  destroyed: 0, gainedchild: 1, lostchild: 2, hitwall: 3, falling: 4, landed: 5, touch: 6, untouch: 7, bump: 8,
  beginstate: 9, endstate: 10, basechange: 11, attach: 12, detach: 13, encroachingon: 14, encroachedby: 15,
  tick: 17, postbeginplay: 29,
}
/** The probe bits for the functions a class or state defines. */
export function probeBits(names: string[]): number {
  let m = 0
  for (const n of names) {
    const b = PROBES[n.toLowerCase()]
    if (b !== undefined) m |= 1 << b
  }
  return m >>> 0
}

/** Flags a class does not pass on (abstract, native, its C++ export and replication, …). */
const NOT_INHERITED = 0x1 | 0x80 | 0x100 | 0x800 | 0x8000000

/**
 * The package with a new class in it: the class (no fields yet), its default
 * object, and a copy of each component its parent's default object owns (the
 * copy's archetype the parent's). Returned with the defaultproperties lines
 * that point the class's defaults at its own components.
 */
export function declareClass(linker: Linker, pkg: Package, d: ClassDecl, sh: Shared = shared()): { bytes: Uint8Array; defaults: string[] } {
  if (pkg.find(d.name)) throw new DeclareError(`${d.name} is in the package already`)
  // A compiler for this package, to find and import what the class names (any function of it will do).
  let anyRef = 0
  for (let i = 1; i <= pkg.exports.length && !anyRef; i++) if (['Class', 'Function'].includes(pkg.className(i))) anyRef = i
  const fc = anyRef ? new FunctionCompiler(linker, pkg, anyRef, sh) : FunctionCompiler.forPackage(linker, pkg, sh)
  fc.allow = 'all'
  const parent = fc.findClass(d.parent)
  if (!parent) throw new DeclareError(`no class ${d.parent} to extend`)
  const pc = linker.object(parent) as ClassObj
  const within = d.within ? fc.findClass(d.within) : pc.within ? linker.resolve(parent.pkg, pc.within) : null
  const exports: { entry: import('./package.ts').Export; data: Uint8Array }[] = []
  const classRef = pkg.exports.length + 1
  const defaultRef = classRef + 1
  const parentDefault = pc.defaultObject ? linker.resolve(parent.pkg, pc.defaultObject) : null
  const entry = (classIndex: number, superIndex: number, outer: number, name: string, archetype: number, objectFlags: bigint) => ({
    classIndex,
    superIndex,
    outer,
    objectName: fc.nameRef(name),
    archetype,
    objectFlags,
    serialSize: 0,
    serialOffset: 0,
    exportFlags: 0,
    netObjects: [],
    packageGuid: new Uint8Array(16),
    packageFlags: 0,
  })
  // The parent's components: copied under the new default object.
  const components: { name: string; ref: number; cls: number; archetype: number }[] = []
  let nextRef = defaultRef + 1
  for (const c of pc.componentMap) {
    // (One the cook stripped, editor-only: mapped to nothing, as the parent maps it.)
    if (!c.obj) {
      components.push({ name: c.name, ref: 0, cls: 0, archetype: 0 })
      continue
    }
    const at = linker.resolve(parent.pkg, c.obj)
    if (!at) throw new DeclareError(`${d.parent}'s component ${c.name} is not found`)
    const clsAt = linker.resolve(at.pkg, at.pkg.exports[at.ref - 1]!.classIndex)
    if (!clsAt) throw new DeclareError(`${d.parent}'s component ${c.name}: its class is not found`)
    components.push({ name: c.name, ref: nextRef++, cls: fc.refOf(clsAt), archetype: fc.refOf(at) })
  }
  const parentRef = fc.refOf(parent)
  const withinRef = within ? fc.refOf(within) : 0
  const none = fc.nameRef('None')
  const configName = fc.nameRef(d.config ?? pc.configName)
  const hide = pc.hideCategories.map((n) => fc.nameRef(n))

  const w = new Writer(256)
  w.i32(classRef - 1) // its own index (a class has no tagged properties)
  w.i32(0) // next
  w.i32(parentRef)
  w.i32(0) // script text
  w.i32(0) // children: none yet
  w.i32(0).i32(-1).i32(-1) // C++ text, line, text position
  w.i32(0).i32(0) // no script
  w.u32((pc.probeMask >>> 0) | 0).u16(0xffff).u32(2) // probe mask, no label table, state flags
  w.i32(0) // function map: none yet
  w.u32(((pc.classFlags & ~NOT_INHERITED & ~d.clears) | d.flags | 0x2 | 0x10) >>> 0) // … compiled, parsed
  w.i32(withinRef)
  w.i32(configName.index).i32(configName.number)
  w.i32(components.length)
  for (const c of components) {
    const n = fc.nameRef(c.name)
    w.i32(n.index).i32(n.number).i32(c.ref)
  }
  w.i32(d.interfaces.length)
  for (const i of d.interfaces) {
    const at = fc.findClass(i)
    if (!at) throw new DeclareError(`${d.name} implements ${i}: no such interface`)
    w.i32(fc.refOf(at)).i32(0) // (implemented in script: no property)
  }
  w.i32(0) // don't sort
  w.i32(hide.length)
  for (const n of hide) w.i32(n.index).i32(n.number)
  w.i32(0).i32(0).i32(0).i32(0) // auto expand, auto collapse, force script order, class groups
  w.fstr('') // native class name
  w.i32(none.index).i32(none.number) // DLL bind name
  w.i32(defaultRef)
  exports.push({ entry: entry(0, parentRef, 0, d.name, 0, 0xf000400000000n), data: w.done() })

  const dw = new Writer(16)
  dw.i32(defaultRef - 1).i32(none.index).i32(none.number)
  exports.push({
    entry: entry(classRef, 0, 0, `Default__${d.name}`, parentDefault ? fc.refOf(parentDefault) : 0, 0x7000400000200n),
    data: dw.done(),
  })
  for (const c of components) {
    if (!c.ref) continue
    const n = fc.nameRef(c.name)
    const cw = new Writer(32)
    cw.i32(0).i32(n.index).i32(n.number) // template owner class, template name
    cw.i32(c.ref - 1).i32(none.index).i32(none.number)
    exports.push({ entry: entry(c.cls, 0, defaultRef, c.name, c.archetype, 0x4000400000000n), data: cw.done() })
  }

  // Defaults that pointed at the parent's components point at the class's own.
  const defaults: string[] = []
  if (parentDefault && components.length) {
    const cd = new ClassDecompiler(linker, parent.pkg, parent.ref, false)
    const r = new Reader(parent.pkg.data(parentDefault.ref))
    r.o = tagsStart(linker, parent.pkg, parentDefault.ref)
    const prefix = `'${parent.pkg.objectName(parentDefault.ref)}.`
    for (const t of readTags(r, parent.pkg)) {
      const line = cd.tagLine(t, parent)
      if (line.includes(prefix)) defaults.push(...line.split('\n').map((l) => l.trim().split(prefix).join(`'Default__${d.name}.`)))
    }
  }
  const names = sh.names.map((name) => ({ name, flags: 0x7001000000000n }))
  return { bytes: writePackage(pkg, { names, imports: sh.imports, exports, layout: 'keep' }), defaults }
}

export interface ConstDecl {
  name: string
  value: string
}
/** const NAME = value; (the value kept as written, as the compiler keeps it) */
export function parseConst(text: string): ConstDecl {
  const m = /^\s*const\s+(\w+)\s*=\s*([\s\S]*?)\s*;\s*$/i.exec(text)
  if (!m) throw new DeclareError(`not a constant: ${text}`)
  return { name: m[1]!, value: m[2]! }
}

export interface EnumDecl {
  name: string
  values: string[]
}
/** enum Name { A, B, C }; */
export function parseEnum(text: string): EnumDecl {
  const m = /^\s*enum\s+(\w+)\s*\{([\s\S]*)\}\s*;?\s*$/i.exec(text.replace(/\/\/.*$/gm, ''))
  if (!m) throw new DeclareError(`not an enum: ${text}`)
  return { name: m[1]!, values: m[2]!.split(',').map((x) => x.trim()).filter(Boolean) }
}

export interface StructDecl {
  name: string
  /** Declared native (read; declareStruct refuses a new one: C++ would have to have it). */
  native: boolean
  parent: string | null
  vars: VarDecl[]
  /** Its structdefaultproperties block's body, if it has one. */
  defaults: string | null
}
/** struct Name [extends Other] { var …; structdefaultproperties { … } }; */
export function parseStruct(text: string): StructDecl {
  const m = /^\s*struct\s+(?:(\w+)\s+)??(\w+)(?:\s+extends\s+(\w+))?\s*\{([\s\S]*)\}\s*;?\s*$/i.exec(text)
  if (!m) throw new DeclareError(`not a struct: ${text.slice(0, 60)}`)
  let body = m[4]!
  let defaults: string | null = null
  const d = /structdefaultproperties\s*\{/i.exec(body)
  if (d) {
    let depth = 1
    let i = d.index + d[0].length
    for (; i < body.length && depth; i++) {
      if (body[i] === '{') depth++
      if (body[i] === '}') depth--
    }
    defaults = body.slice(d.index + d[0].length, i - 1)
    body = body.slice(0, d.index) + body.slice(i)
  }
  const vars = (body.match(/\bvar\b[^;]*;/g) ?? []).map((v) => parseVar(v, m[2]!))
  return { name: m[2]!, native: m[1]?.toLowerCase() === 'native', parent: m[3] ?? null, vars, defaults }
}

export interface StateDecl {
  name: string
  parent: string | null
  flags: number
}
/** [auto] [simulated] state Name [extends Other] */
export function parseState(text: string): StateDecl {
  const m = /^\s*((?:\w+\s+)*?)state\s+(\w+)(?:\s+extends\s+(\w+))?/i.exec(text)
  if (!m) throw new DeclareError(`not a state: ${text}`)
  const mods = m[1]!.toLowerCase()
  return { name: m[2]!, parent: m[3] ?? null, flags: (/\bauto\b/.test(mods) ? 0x2 : 0) | (/\bsimulated\b/.test(mods) ? 0x4 : 0) }
}

/** A field of a class by name and kind (State, ScriptStruct …), in it or its parents. */
function fieldOf(linker: Linker, cls: Located, name: string, kind: string): Located | null {
  const want = name.toLowerCase()
  for (let s: Located | null = cls; s; ) {
    const o = linker.object(s)
    if (!o || !('head' in o)) return null
    for (let c = o.head.children; c; ) {
      const f = { pkg: s.pkg, ref: c }
      const fo = linker.object(f)
      if (s.pkg.className(c) === kind && s.pkg.objectName(c).toLowerCase() === want) return f
      if (!fo) break
      c = 'head' in fo ? fo.head.next : fo.next
    }
    s = o.head.superStruct ? linker.resolve(s.pkg, o.head.superStruct) : null
  }
  return null
}

/**
 * The package with a class's new constants, enums and states (states empty:
 * their functions and code come as any function's do), linked first among its fields.
 */
export function declareFields(
  linker: Linker,
  pkg: Package,
  classRef: number,
  d: { consts: ConstDecl[]; enums: EnumDecl[]; states: StateDecl[] },
  sh: Shared = shared(),
): Uint8Array {
  const fc = new FunctionCompiler(linker, pkg, classRef, sh)
  fc.allow = 'all'
  const cls = readObject(pkg, classRef) as ClassObj
  const parentClass = cls.head.superStruct ? linker.resolve(pkg, cls.head.superStruct) : null
  const none = fc.nameRef('None')
  const exports: { entry: import('./package.ts').Export; data: Uint8Array }[] = []
  let children = cls.head.children
  let ref = pkg.exports.length
  const entry = (kind: string, name: string, superIndex = 0) => ({
    classIndex: fc.coreClass(kind),
    superIndex,
    outer: classRef,
    objectName: fc.nameRef(name),
    archetype: 0,
    objectFlags: 0x7000400000000n,
    serialSize: 0,
    serialOffset: 0,
    exportFlags: 0,
    netObjects: [],
    packageGuid: new Uint8Array(16),
    packageFlags: 0,
  })
  for (const c of d.consts) {
    ref++
    const w = new Writer(32)
    w.i32(ref - 1).i32(none.index).i32(none.number).i32(children).fstr(c.value)
    exports.push({ entry: entry('Const', c.name), data: w.done() })
    children = ref
  }
  for (const e of d.enums) {
    ref++
    const w = new Writer(32)
    w.i32(ref - 1).i32(none.index).i32(none.number).i32(children)
    const values = [...e.values, `${e.name}_MAX`]
    w.i32(values.length)
    for (const v of values) {
      const n = fc.nameRef(v)
      w.i32(n.index).i32(n.number)
    }
    exports.push({ entry: entry('Enum', e.name), data: w.done() })
    children = ref
  }
  // States: one extending another of these after it (declared here, so found here).
  const here = new Map<string, number>()
  const states = [...d.states]
  const ordered: StateDecl[] = []
  while (states.length) {
    const i = states.findIndex((x) => !x.parent || !states.some((y) => y.name.toLowerCase() === x.parent!.toLowerCase()))
    ordered.push(states.splice(i < 0 ? 0 : i, 1)[0]!)
  }
  for (const s of ordered) {
    ref++
    // What it extends: the state named (here or in the class), or the parent class's state of its name.
    const inBatch = s.parent ? here.get(s.parent.toLowerCase()) : undefined
    const parent: Located | null = inBatch
      ? { pkg, ref: inBatch }
      : s.parent
        ? fieldOf(linker, { pkg, ref: classRef }, s.parent, 'State')
        : parentClass
          ? fieldOf(linker, parentClass, s.name, 'State')
          : null
    if (s.parent && !parent) throw new DeclareError(`state ${s.name} extends ${s.parent}: no such state`)
    const superRef = parent ? fc.refOf(parent) : 0
    const w = new Writer(64)
    w.i32(ref - 1).i32(none.index).i32(none.number)
    w.i32(children).i32(superRef).i32(0).i32(0) // next, super, script text, children
    w.i32(0).i32(0).i32(0) // C++ text, line, text position
    w.i32(2).i32(2).u8(0x08).u8(0x53) // no code yet: stop, and the end
    w.u32(0).u16(0xffff).u32(s.flags).i32(0) // probe mask, no label table, flags, no functions
    exports.push({ entry: entry('State', s.name, superRef), data: w.done() })
    here.set(s.name.toLowerCase(), ref)
    children = ref
  }
  const data = new Map<number, Uint8Array>()
  if (exports.length) {
    const cdata = pkg.data(classRef).slice()
    new DataView(cdata.buffer).setInt32(readStructHead(pkg, classRef).scriptAt - 24, children, true)
    data.set(classRef, cdata)
  }
  const names = sh.names.map((name) => ({ name, flags: 0x7001000000000n }))
  return writePackage(pkg, { data, names, imports: sh.imports, exports, layout: 'keep' })
}

/** The package with a new struct in a class: its members in declaration order (its defaults: structDefaults). */
export function declareStruct(linker: Linker, pkg: Package, classRef: number, s: StructDecl, sh: Shared = shared()): Uint8Array {
  if (s.native) throw new DeclareError(`struct ${s.name}: a native struct needs C++`)
  const fc = new FunctionCompiler(linker, pkg, classRef, sh)
  fc.allow = 'all'
  const cls = readObject(pkg, classRef) as ClassObj
  const none = fc.nameRef('None')
  const parent = s.parent ? fc.typeFromText(s.parent) : null
  if (parent && parent.k !== 'struct') throw new DeclareError(`struct ${s.name} extends ${s.parent}: not a struct`)
  const superRef = parent?.k === 'struct' && parent.struct ? fc.refOf(parent.struct) : 0
  const structRef = pkg.exports.length + 1
  const exports: { entry: import('./package.ts').Export; data: Uint8Array }[] = [null as never]
  // Members: each linked to the next (the first is the struct's first child).
  const members: number[] = []
  let nextRef = structRef + 1
  for (const v of s.vars)
    for (const n of v.names) {
      const ty = fc.typeFromText(v.type)
      const ref = nextRef++
      const { cls: pcls, refs: own } = fc.propertyClass(ty)
      let refs = own
      const inner = ty.k === 'array' ? { ref: nextRef++, ...fc.propertyClass(ty.inner) } : null
      if (inner) refs = [inner.ref]
      const flags = v.flags | (fc.needsCtor(ty) ? 0x400000n : 0n) | fc.typeFlags(ty)
      exports[ref - structRef] = fc.propertyObject({ ref, outer: structRef, name: n.name, cls: pcls, refs, next: 0, dim: n.dim, flags, category: v.category ?? undefined })
      if (inner && ty.k === 'array')
        exports[inner.ref - structRef] = fc.propertyObject({ ref: inner.ref, outer: ref, name: n.name, cls: inner.cls, refs: inner.refs, next: 0, dim: 1, flags: innerFlags(fc, flags, ty.inner) })
      members.push(ref)
    }
  for (let k = 0; k + 1 < members.length; k++) {
    const e = exports[members[k]! - structRef]!
    new DataView(e.data.buffer, e.data.byteOffset).setInt32(12, members[k + 1]!, true)
  }
  const w = new Writer(64)
  w.i32(structRef - 1).i32(none.index).i32(none.number)
  w.i32(cls.head.children).i32(superRef).i32(0).i32(members[0] ?? 0) // next, super, script text, children
  w.i32(0).i32(0).i32(0).i32(0).i32(0) // C++ text, line, text position, no script
  w.u32(0) // struct flags
  w.i32(none.index).i32(none.number) // defaults: none yet
  exports[0] = {
    entry: {
      classIndex: fc.coreClass('ScriptStruct'),
      superIndex: superRef,
      outer: classRef,
      objectName: fc.nameRef(s.name),
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
  const cdata = pkg.data(classRef).slice()
  new DataView(cdata.buffer).setInt32(readStructHead(pkg, classRef).scriptAt - 24, structRef, true)
  const names = sh.names.map((name) => ({ name, flags: 0x7001000000000n }))
  return writePackage(pkg, { data: new Map([[classRef, cdata]]), names, imports: sh.imports, exports, layout: 'keep' })
}

/** The component subobjects a class's defaults declare (Begin Object Class=X Name=Y). */
export function subobjectsOf(block: string): { cls: string; name: string }[] {
  const out: { cls: string; name: string }[] = []
  for (const m of block.matchAll(/^\s*Begin\s+Object\b([^\n]*)$/gim)) {
    const cls = /\bClass=(\w+)/i.exec(m[1]!)?.[1]
    const name = /\bName=(\w+)/i.exec(m[1]!)?.[1]
    if (cls && name) out.push({ cls, name })
  }
  return out
}

/**
 * The package with the subobjects a class's defaults declare and its default
 * object does not have: each a template of its class, archetyped from the
 * parent's of that name (else its class's default object), in the class's
 * component map.
 */
export function declareSubobjects(linker: Linker, pkg: Package, classRef: number, subs: { cls: string; name: string }[], sh: Shared = shared()): Uint8Array {
  const fc = new FunctionCompiler(linker, pkg, classRef, sh)
  fc.allow = 'all'
  const cls = readObject(pkg, classRef) as ClassObj
  const dobj = cls.defaultObject
  const dname = pkg.objectName(dobj)
  const parent = cls.head.superStruct ? linker.resolve(pkg, cls.head.superStruct) : null
  const pc = parent ? (linker.object(parent) as ClassObj) : null
  const parentDefault = pc?.defaultObject ? linker.resolve(parent!.pkg, pc.defaultObject) : null
  const none = fc.nameRef('None')
  const exports: { entry: import('./package.ts').Export; data: Uint8Array }[] = []
  const map = cls.componentMap.map((c) => ({ name: c.name, obj: c.obj }))
  let ref = pkg.exports.length
  for (const s of subs) {
    if (pkg.find(`${dname}.${s.name}`)) continue
    const k = fc.findClass(s.cls)
    if (!k) throw new DeclareError(`Begin Object Class=${s.cls}: no such class`)
    // Its archetype: the parent's template of that name, else the class's default object.
    let arche: Located | null = null
    if (parentDefault)
      for (let i = 1; i <= parentDefault.pkg.exports.length && !arche; i++)
        if (parentDefault.pkg.exports[i - 1]!.outer === parentDefault.ref && parentDefault.pkg.objectName(i).toLowerCase() === s.name.toLowerCase())
          arche = { pkg: parentDefault.pkg, ref: i }
    if (!arche) {
      const ko = linker.object(k) as ClassObj | null
      arche = ko?.defaultObject ? linker.resolve(k.pkg, ko.defaultObject) : null
    }
    ref++
    const n = fc.nameRef(s.name)
    const w = new Writer(32)
    w.i32(0).i32(n.index).i32(n.number) // template owner class, template name
    w.i32(ref - 1).i32(none.index).i32(none.number)
    exports.push({
      entry: {
        classIndex: fc.refOf(k),
        superIndex: 0,
        outer: dobj,
        objectName: n,
        archetype: arche ? fc.refOf(arche) : 0,
        objectFlags: 0x4000400000000n,
        serialSize: 0,
        serialOffset: 0,
        exportFlags: 0,
        netObjects: [],
        packageGuid: new Uint8Array(16),
        packageFlags: 0,
      },
      data: w.done(),
    })
    const at = map.findIndex((c) => c.name.toLowerCase() === s.name.toLowerCase())
    if (at >= 0) map[at]!.obj = ref
    else map.push({ name: s.name, obj: ref })
  }
  if (!exports.length) return pkg.bytes
  // The class's component map, rewritten (it follows the function map, the flags, within and the config name).
  const data = pkg.data(classRef)
  const h = readStructHead(pkg, classRef)
  const v = new DataView(data.buffer, data.byteOffset)
  const funcs = v.getInt32(h.end + 10, true)
  const mapAt = h.end + 14 + funcs * 12 + 16
  const oldCount = v.getInt32(mapAt, true)
  const w = new Writer(data.length + map.length * 12)
  w.bytes(data.subarray(0, mapAt)).i32(map.length)
  for (const c of map) {
    const n = fc.nameRef(c.name)
    w.i32(n.index).i32(n.number).i32(c.obj)
  }
  w.bytes(data.subarray(mapAt + 4 + oldCount * 12))
  const names = sh.names.map((name) => ({ name, flags: 0x7001000000000n }))
  return writePackage(pkg, { data: new Map([[classRef, w.done()]]), names, imports: sh.imports, exports, layout: 'keep' })
}

/** replication { if (condition) A, B; … }: each condition and the members it replicates. */
export function parseReplication(text: string): { condition: string; names: string[] }[] {
  const body = text.slice(text.indexOf('{') + 1, text.lastIndexOf('}'))
  const out: { condition: string; names: string[] }[] = []
  let i = 0
  while (i < body.length) {
    const m = /\bif\s*\(/g
    m.lastIndex = i
    const found = m.exec(body)
    if (!found) break
    // The condition: to its parenthesis' match.
    let depth = 1
    let j = found.index + found[0].length
    const start = j
    for (; j < body.length && depth; j++) {
      if (body[j] === '(') depth++
      if (body[j] === ')') depth--
    }
    const condition = body.slice(start, j - 1)
    const semi = body.indexOf(';', j)
    if (semi < 0) throw new DeclareError('replication: a list without its ;')
    out.push({ condition, names: body.slice(j, semi).split(',').map((x) => x.trim()).filter(Boolean) })
    i = semi + 1
  }
  return out
}

/**
 * The package with a new class's replication compiled: its conditions as the
 * class's script (one after the other, then the end), each member it names
 * marked replicated with its condition's offset.
 */
export function declareReplication(linker: Linker, pkg: Package, classRef: number, text: string, sh: Shared = shared()): Uint8Array {
  const fc = new FunctionCompiler(linker, pkg, classRef, sh)
  fc.allow = 'all'
  const entries = parseReplication(text)
  const nodes: import('./bytecode.ts').Node[] = []
  const offsets: number[] = []
  let mem = 0
  for (const e of entries) {
    const node = fc.compileExpression(e.condition, { k: 'bool' })
    offsets.push(mem)
    mem += memSizeOf(node)
    nodes.push(node)
  }
  nodes.push({ op: 0x53, args: [], at: 0, mem: 0 })
  const { code, memSize } = encodeScript(nodes)
  const data = new Map<number, Uint8Array>()
  data.set(classRef, withScript(pkg, classRef, code, memSize))
  const className = pkg.objectName(classRef)
  entries.forEach((e, k) => {
    for (const name of e.names) {
      const ref = pkg.find(`${className}.${name}`)
      const o = ref ? readObject(pkg, ref) : null
      if (!o || o.kind !== 'property') throw new DeclareError(`replication: ${className} has no variable ${name}`)
      data.set(ref, withRepOffset(pkg, ref, offsets[k]!))
    }
  })
  const names = sh.names.map((name) => ({ name, flags: 0x7001000000000n }))
  return writePackage(pkg, { data, names, imports: sh.imports, layout: 'keep' })
}

/** A property's data marked replicated (CPF_Net), with the offset of its condition after its array enum. */
function withRepOffset(pkg: Package, ref: number, offset: number): Uint8Array {
  const data = pkg.data(ref)
  const r = new Reader(data)
  r.i32()
  readTags(r, pkg)
  r.i32() // next
  r.i32() // array dimension
  const flagsAt = r.o
  const flags = new DataView(data.buffer, data.byteOffset).getBigUint64(flagsAt, true)
  const afterEnum = flagsAt + 8 + 8 + 4 // flags, category, array enum
  const w = new Writer(data.length + 2)
  if (flags & CPF.Net) {
    w.bytes(data)
    const out = w.done()
    new DataView(out.buffer, out.byteOffset).setUint16(afterEnum, offset, true)
    return out
  }
  w.bytes(data.subarray(0, afterEnum)).u16(offset).bytes(data.subarray(afterEnum))
  const out = w.done()
  new DataView(out.buffer, out.byteOffset).setBigUint64(flagsAt, flags | CPF.Net, true)
  return out
}
