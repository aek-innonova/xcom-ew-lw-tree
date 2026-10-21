// UnrealScript to bytecode, for a function of a package: its body (and its
// parameters' defaults) compiled against the package's own declarations and
// the packages it imports, the tokens chosen as Epic's compiler chose them
// (as measured on the game's code: test/compile.spec.ts).

import { encodeScript, memSizeOf, type NameValue, type Node, type Value } from './bytecode.ts'
import type { Linker, Located } from './linker.ts'
import type { FunctionObj, PropertyObj, ScriptObject } from './objects.ts'
import type { Package } from './package.ts'
import { Parser, type Expr, type FunctionSource, type Stmt } from './parse.ts'
import { CPF, FUNC, typeOf, type Ty } from './types.ts'

export class CompileError extends Error {}

const N = (op: number, ...args: Value[]): Node => ({ op, args, at: 0, mem: 0 })
const NATIVE = (index: number, params: Node[]): Node => ({
  op: index < 0x100 ? index : 0x60 + (index >> 8),
  native: index,
  args: [params],
  at: 0,
  mem: 0,
})

/** A jump target not placed yet. */
interface Label {
  label: true
  mem: number
}
const label = (): Label => ({ label: true, mem: -1 })

const PRIMS: Record<string, Ty> = {
  int: { k: 'int' },
  float: { k: 'float' },
  bool: { k: 'bool' },
  byte: { k: 'byte', enumOf: null },
  string: { k: 'string' },
  name: { k: 'name' },
}

/** PrimitiveCast codes by "from>to". */
const CAST: Record<string, number> = {
  'byte>int': 0x3a, 'byte>bool': 0x3b, 'byte>float': 0x3c, 'byte>string': 0x52,
  'int>byte': 0x3d, 'int>bool': 0x3e, 'int>float': 0x3f, 'int>string': 0x53,
  'bool>byte': 0x40, 'bool>int': 0x41, 'bool>float': 0x42, 'bool>string': 0x54,
  'float>byte': 0x43, 'float>int': 0x44, 'float>bool': 0x45, 'float>string': 0x55,
  'object>bool': 0x47, 'object>string': 0x56, 'object>interface': 0x46,
  'name>bool': 0x48, 'name>string': 0x57,
  'string>byte': 0x49, 'string>int': 0x4a, 'string>bool': 0x4b, 'string>float': 0x4c,
  'string>vector': 0x4d, 'string>rotator': 0x4e, 'string>name': 0x60,
  'vector>bool': 0x4f, 'vector>rotator': 0x50, 'vector>string': 0x58,
  'rotator>bool': 0x51, 'rotator>string': 0x59, 'rotator>vector': 0x39,
  'delegate>string': 0x5a, 'interface>object': 0x36, 'interface>bool': 0x37,
}
/** Conversions UnrealScript makes by itself. */
const AUTO = new Set(['byte>int', 'int>byte', 'byte>float', 'int>float', 'float>int', 'float>byte', 'interface>object'])

interface Gen {
  node: Node
  ty: Ty
}

const TYPES = new WeakMap<Package, Map<string, number>>()
const MEMBERS = new WeakMap<Package, Map<string, Located | null>>()

export class FunctionCompiler {
  readonly linker: Linker
  readonly pkg: Package
  readonly ref: number
  private fn!: FunctionObj
  /** The class the function belongs to, and its state if it is in one. */
  private cls!: Located
  private state: Located | null = null
  private locals = new Map<string, { ref: number; p: PropertyObj; ty: Ty }>()
  private params: { ref: number; p: PropertyObj; ty: Ty }[] = []
  private retRef = 0
  private retTy: Ty | null = null
  private imports = new Map<string, number>()
  /**
   * What the compiled code may add to the package: nothing (it must all be
   * there), names (a mod script can add those), or names, imports and new
   * local variables (a whole package).
   */
  allow: 'none' | 'names' | 'all' = 'none'
  /** Added by the compiled code (see additions()). */
  readonly added = {
    names: [] as string[],
    imports: [] as import('./package.ts').Import[],
    locals: [] as { name: string; dim: number; ty: Ty; ref: number; cls: string; refs: number[]; inner?: { ref: number; cls: string; refs: number[] } }[],
  }
  private labels = new Map<string, Label>()
  private loops: { breakTo: Label; continueTo: Label | null }[] = []

  constructor(linker: Linker, pkg: Package, ref: number) {
    this.linker = linker
    this.pkg = pkg
    this.ref = ref
    for (let i = 1; i <= pkg.imports.length; i++) {
      const key = pkg.path(-i).toLowerCase()
      if (!this.imports.has(key)) this.imports.set(key, -i)
    }
    this.fn = linker.object({ pkg, ref }) as FunctionObj
    let outer = pkg.outerOf(ref)
    if (pkg.className(outer) === 'State') {
      this.state = { pkg, ref: outer }
      outer = pkg.outerOf(outer)
    }
    this.cls = { pkg, ref: outer }
    for (let c = this.fn.head.children; c; ) {
      const p = linker.object({ pkg, ref: c }) as PropertyObj
      const ty = typeOf(linker, { pkg, ref: c }, p)
      if (p.flags & CPF.ReturnParm) {
        this.retRef = c
        this.retTy = ty
      } else {
        this.locals.set(pkg.objectName(c).toLowerCase(), { ref: c, p, ty })
        if (p.flags & CPF.Parm) this.params.push({ ref: c, p, ty })
      }
      c = p.next
    }
  }

  // --- Objects and their references here ---------------------------------------

  /** This package's reference to an object, wherever it is defined. */
  refOf(at: Located): number {
    if (at.pkg === this.pkg) return at.ref
    const key = `${this.linker.nameOf(at.pkg)}.${at.pkg.path(at.ref)}`.toLowerCase()
    const r = this.imports.get(key)
    if (r !== undefined) return r
    if (this.allow !== 'all')
      throw new CompileError(`${at.pkg.path(at.ref)} is not imported by this package (a whole package, --out, can add it)`)
    // Imported here from now on: its outers first (up to its package), then itself.
    const outer = at.pkg.outerOf(at.ref)
    const outerRef = outer ? this.refOf({ pkg: at.pkg, ref: outer }) : this.packageImport(this.linker.nameOf(at.pkg))
    const e = at.pkg.exports[at.ref - 1]!
    const clsPkg = e.classIndex < 0 ? at.pkg.path(e.classIndex).split('.')[0]! : e.classIndex > 0 ? this.linker.nameOf(at.pkg) : 'Core'
    return this.addImport(key, clsPkg, at.pkg.className(at.ref), outerRef, at.pkg.objectName(at.ref))
  }
  private addImport(key: string, classPackage: string, className: string, outer: number, name: string): number {
    const ref = -(this.pkg.imports.length + this.added.imports.length + 1)
    this.added.imports.push({
      classPackage: this.nameRef(classPackage),
      className: this.nameRef(className),
      outer,
      objectName: this.nameRef(name),
    })
    this.imports.set(key, ref)
    return ref
  }
  private packageImport(name: string): number {
    const r = this.imports.get(name.toLowerCase())
    if (r !== undefined) return r
    return this.addImport(name.toLowerCase(), 'Core', 'Package', 0, name)
  }
  /** Core's class for a property kind ("IntProperty"): imported by every package with scripts, else added. */
  private coreClass(name: string): number {
    const r = this.imports.get(`core.${name}`.toLowerCase())
    if (r !== undefined) return r
    if (this.allow !== 'all') throw new CompileError(`Core.${name} is not imported by this package`)
    return this.addImport(`core.${name}`.toLowerCase(), 'Core', 'Class', this.packageImport('Core'), name)
  }
  private obj(at: Located): ScriptObject | null {
    return this.linker.object(at)
  }
  private nameRef(name: string): NameValue {
    const us = name.lastIndexOf('_')
    let base = name
    let number = 0
    if (us > 0 && /^\d+$/.test(name.slice(us + 1)) && this.pkg.findName(name) < 0) {
      base = name.slice(0, us)
      number = Number(name.slice(us + 1)) + 1
    }
    let index = this.pkg.findName(base)
    if (index < 0) {
      if (this.allow === 'none') throw new CompileError(`the name '${name}' is not in this package`)
      let k = this.added.names.findIndex((n) => n.toLowerCase() === base.toLowerCase())
      if (k < 0) k = this.added.names.push(base) - 1
      index = this.pkg.names.length + k
    }
    return { index, number }
  }

  /** A struct's (class's, state's) fields, its parents' after its own. */
  private *fields(at: Located): Generator<Located> {
    for (let s: Located | null = at; s; ) {
      const o = this.obj(s)
      if (!o || !('head' in o)) return
      for (let c = o.head.children; c; ) {
        const f = { pkg: s.pkg, ref: c }
        yield f
        const fo = this.obj(f)
        c = fo ? ('head' in fo ? fo.head.next : fo.next) : 0
        if (!fo) break
      }
      s = o.head.superStruct ? this.linker.resolve(s.pkg, o.head.superStruct) : null
    }
  }
  private member(at: Located, name: string, kind?: 'property' | 'function'): Located | null {
    let cache = MEMBERS.get(at.pkg)
    if (!cache) MEMBERS.set(at.pkg, (cache = new Map()))
    const key = `${at.ref}|${name.toLowerCase()}|${kind ?? ''}`
    if (!cache.has(key)) cache.set(key, this.memberUncached(at, name, kind))
    return cache.get(key)!
  }
  private memberUncached(at: Located, name: string, kind?: 'property' | 'function'): Located | null {
    const want = name.toLowerCase()
    for (const f of this.fields(at)) {
      if (f.pkg.objectName(f.ref).toLowerCase() !== want) continue
      const o = this.obj(f)
      if (!kind || o?.kind === kind) return f
    }
    return null
  }
  /** A function by name, as the function's scope sees it: its state, then the class's chain. */
  private findFunction(name: string, inClass?: Located): Located | null {
    if (!inClass && this.state) {
      const s = this.member(this.state, name, 'function')
      if (s) return s
    }
    return this.member(inClass ?? this.cls, name, 'function')
  }
  /** A class (or struct, enum) by name, from this package or the ones it imports. */
  private findType(name: string): Located | null {
    let types = TYPES.get(this.pkg)
    if (!types) {
      types = new Map()
      const kinds = ['Class', 'ScriptStruct', 'Enum']
      for (let i = this.pkg.imports.length; i >= 1; i--)
        if (kinds.includes(this.pkg.className(-i))) types.set(this.pkg.objectName(-i).toLowerCase(), -i)
      for (let i = this.pkg.exports.length; i >= 1; i--)
        if (kinds.includes(this.pkg.className(i))) types.set(this.pkg.objectName(i).toLowerCase(), i)
      TYPES.set(this.pkg, types)
    }
    const ref = types.get(name.toLowerCase())
    if (ref === undefined) return null
    return ref > 0 ? { pkg: this.pkg, ref } : (this.linker.resolve(this.pkg, ref) ?? { pkg: this.pkg, ref })
  }
  /** An enum value by name, from the enums this package has or imports. */
  private enumValue(name: string): { at: Located; index: number } | null {
    return this.linker.enumValues(this.pkg).get(name.toLowerCase()) ?? null
  }

  private propTy(at: Located): { p: PropertyObj; ty: Ty } {
    const p = this.obj(at) as PropertyObj
    return { p, ty: typeOf(this.linker, at, p) }
  }
  private fnInfo(at: Located): { fn: FunctionObj; params: { at: Located; p: PropertyObj; ty: Ty }[]; ret: { at: Located; ty: Ty } | null } {
    const fn = this.obj(at) as FunctionObj
    const params: { at: Located; p: PropertyObj; ty: Ty }[] = []
    let ret: { at: Located; ty: Ty } | null = null
    for (let c = fn.head.children; c; ) {
      const pat = { pkg: at.pkg, ref: c }
      const p = this.obj(pat) as PropertyObj
      if (!p || p.kind !== 'property') break
      if (p.flags & CPF.ReturnParm) ret = { at: pat, ty: typeOf(this.linker, pat, p) }
      else if (p.flags & CPF.Parm) params.push({ at: pat, p, ty: typeOf(this.linker, pat, p) })
      c = p.next
    }
    return { fn, params, ret }
  }

  // --- Types -----------------------------------------------------------------------

  private kindOf(t: Ty): string {
    if (t.k === 'struct' && t.struct) {
      const n = t.struct.pkg.objectName(t.struct.ref).toLowerCase()
      if (n === 'vector' || n === 'rotator') return n
    }
    if (t.k === 'class' || t.k === 'component') return 'object'
    return t.k
  }
  private same(a: Ty, b: Ty): boolean {
    const ka = this.kindOf(a)
    const kb = this.kindOf(b)
    if (ka !== kb) return (ka === 'object' && kb === 'none') || (ka === 'none' && kb === 'object')
    if (a.k === 'struct' && b.k === 'struct') return a.struct?.ref === b.struct?.ref && a.struct?.pkg === b.struct?.pkg
    return true
  }
  private convert(g: Gen, want: Ty | undefined, explicit = false): Gen {
    if (!want || want.k === 'unknown' || g.ty.k === 'unknown') return g
    const from = this.kindOf(g.ty)
    const to = this.kindOf(want)
    if (from === to || this.same(g.ty, want)) return g
    // An object (none, self) where an interface is wanted: InterfaceCast, the compiler's own.
    if (to === 'interface' && from !== 'interface' && want.k === 'interface' && want.cls)
      return { node: N(0x52, this.refOf(want.cls), g.node), ty: want }
    if (from === 'none') return g
    if (from === 'interface' && to === 'object') return { node: N(0x38, 0x36, g.node), ty: want }
    if (to === 'object' || to === 'interface' || to === 'delegate' || from === 'object' && to === 'none') return g
    const key = `${from}>${to}`
    const code = CAST[key]
    if (code === undefined || (!explicit && !AUTO.has(key))) return g
    return { node: N(0x38, code, g.node), ty: want }
  }

  // --- Expressions -----------------------------------------------------------------

  /** The property an expression's value comes from (switch, context), or 0. */
  private propOf(n: Node): number {
    switch (n.op) {
      case 0x00:
      case 0x01:
      case 0x02:
      case 0x03:
      case 0x48:
        return n.args[0] as number
      case 0x2d:
        return this.propOf(n.args[0] as Node)
      case 0x19:
      case 0x12:
        return n.args[2] as number
      case 0x35:
        return n.args[0] as number
      case 0x10:
      case 0x1a:
        return this.propOf(n.args[1] as Node)
    }
    return (n as Node & { retProp?: number }).retProp ?? 0
  }

  private boolWrap(node: Node, ty: Ty): Node {
    return ty.k === 'bool' ? N(0x2d, node) : node
  }

  private variable(name: string): Gen | null {
    const l = this.locals.get(name.toLowerCase())
    if (l) {
      const op = l.p.flags & CPF.OutParm ? 0x48 : 0x00
      return { node: this.boolWrap(N(op, l.ref), l.ty), ty: l.ty }
    }
    const f = this.member(this.cls, name, 'property')
    if (f) {
      let { ty } = this.propTy(f)
      // In a class declared "within X", Outer is an X.
      if (name.toLowerCase() === 'outer') ty = this.withinType() ?? ty
      return { node: this.boolWrap(N(0x01, this.refOf(f)), ty), ty }
    }
    return null
  }
  private withinType(): Ty | null {
    for (let s: Located | null = this.cls; s; ) {
      const o = this.obj(s)
      if (!o || o.kind !== 'class') return null
      if (o.within) {
        const w = this.linker.resolve(s.pkg, o.within)
        if (w && w.pkg.objectName(w.ref) !== 'Object') return { k: 'object', cls: w }
      }
      s = o.head.superStruct ? this.linker.resolve(s.pkg, o.head.superStruct) : null
    }
    return null
  }

  /** Generated code by expression (generating has no side effects): operands are asked for twice. */
  private memo = new WeakMap<Expr, Map<string, Gen>>()
  gen(e: Expr, want?: Ty, lvalue = false): Gen {
    let m = this.memo.get(e)
    if (!m) this.memo.set(e, (m = new Map()))
    const key = `${lvalue}|${want?.k === 'delegate'}`
    let g = m.get(key)
    if (!g) m.set(key, (g = this.gen1(e, want, lvalue)))
    return lvalue ? g : this.convert(g, want)
  }

  private literalInt(v: number, hex?: number): Node {
    if (hex === 2) return N(0x2c, v)
    if (hex === 8) return N(0x1d, v)
    if (v === 0) return N(0x25)
    if (v === 1) return N(0x26)
    if (v > 1 && v <= 255) return N(0x2c, v)
    return N(0x1d, v)
  }

  private gen1(e: Expr, want: Ty | undefined, lvalue: boolean): Gen {
    switch (e.k) {
      case 'int':
        return { node: this.literalInt(e.v, e.hex), ty: { k: 'int' } }
      case 'float':
        return { node: N(0x1e, e.v), ty: { k: 'float' } }
      case 'str':
        return { node: /^[\x00-\xff]*$/.test(e.v) ? N(0x1f, e.v) : N(0x34, e.v), ty: { k: 'string' } }
      case 'name':
        return { node: N(0x21, this.nameRef(e.v)), ty: { k: 'name' } }
      case 'bool':
        return { node: N(e.v ? 0x27 : 0x28), ty: { k: 'bool' } }
      case 'none':
        return { node: N(want?.k === 'delegate' ? 0x3f : 0x2a), ty: { k: 'none' } }
      case 'self':
        return { node: N(0x17), ty: { k: 'object', cls: this.cls } }
      case 'objlit': {
        const ref = this.findPath(e.path)
        const at = this.linker.resolve(this.pkg, ref) ?? { pkg: this.pkg, ref }
        if (e.cls.toLowerCase() === 'class') return { node: N(0x20, ref), ty: { k: 'class', meta: at } }
        return { node: N(0x20, ref), ty: { k: 'object', cls: this.findType(e.cls) } }
      }
      case 'id': {
        const v = this.variable(e.name)
        if (v) return v
        // An enum's value by its name: a byte constant.
        const ev = this.enumValue(e.name)
        if (ev) return { node: N(0x24, ev.index), ty: { k: 'byte', enumOf: ev.at } }
        // A function's name as a value: a delegate to it. A declared delegate is
        // its hidden property (__Name__Delegate); any other function, by name.
        const f = this.findFunction(e.name)
        if (f) {
          const fo = this.obj(f) as FunctionObj
          const hidden = fo.flags & FUNC.Delegate ? this.member(this.cls, `__${e.name}__Delegate`, 'property') : null
          if (hidden) return { node: N(0x43, this.nameRef(e.name), this.refOf(hidden)), ty: { k: 'delegate', fn: f } }
          return { node: N(0x4b, this.nameRef(e.name)), ty: { k: 'delegate', fn: f } }
        }
        throw new CompileError(`unknown name ${e.name}`)
      }
      case 'default': {
        const f = this.member(this.cls, e.name, 'property')
        if (!f) throw new CompileError(`no default.${e.name}`)
        const { ty } = this.propTy(f)
        return { node: this.boolWrap(N(0x02, this.refOf(f)), ty), ty }
      }
      case 'member':
        return this.memberAccess(e.obj, e.name, lvalue)
      case 'ctxlit': {
        const o = this.gen(e.obj)
        const lit = this.gen(e.e)
        return { node: N(0x19, this.unwrapBool(o.node), memSizeOf(lit.node), this.propOf(o.node), 0, lit.node), ty: lit.ty }
      }
      case 'defmember': {
        const o = this.gen(e.obj)
        const cls = o.ty.k === 'class' ? o.ty.meta : null
        const f = cls && this.member(cls, e.name, 'property')
        if (!f) throw new CompileError(`no default.${e.name}`)
        const { ty } = this.propTy(f)
        const inner = this.boolWrap(N(0x02, this.refOf(f)), ty)
        return { node: N(0x12, o.node, memSizeOf(inner), this.refOf(f), 0, inner), ty }
      }
      case 'index': {
        const a = this.gen(e.arr, undefined, lvalue)
        const i = this.gen(e.idx, { k: 'int' })
        if (a.ty.k === 'array') {
          const ty = a.ty.inner
          return { node: this.boolWrap(N(0x10, i.node, a.node), ty), ty }
        }
        return { node: N(0x1a, i.node, this.unwrapBool(a.node)), ty: a.ty }
      }
      case 'call':
        return this.call(e, want)
      case 'assign': {
        const l = this.gen(e.l, undefined, true)
        const r = this.gen(e.r, l.ty)
        const op = l.ty.k === 'bool' ? 0x14 : l.ty.k === 'delegate' ? 0x44 : 0x0f
        return { node: N(op, l.node, r.node), ty: l.ty }
      }
      case 'cond': {
        const c = this.gen(e.c, { k: 'bool' })
        const a = this.gen(e.a, want)
        const b = this.gen(e.b, want ?? a.ty)
        return { node: N(0x45, c.node, memSizeOf(a.node), a.node, memSizeOf(b.node), b.node), ty: a.ty }
      }
      case 'metacast': {
        const cls = this.findType(e.cls)
        if (!cls) throw new CompileError(`no class ${e.cls}`)
        const x = this.gen(e.e)
        return { node: N(0x13, this.refOf(cls), x.node), ty: { k: 'class', meta: cls } }
      }
      case 'new': {
        const part = (x: Expr | null | undefined) => (x ? this.gen(x).node : N(0x0b))
        const cls = this.gen(e.cls)
        const meta = cls.ty.k === 'class' ? cls.ty.meta : null
        return {
          node: N(0x11, part(e.args[0]), part(e.args[1]), part(e.args[2]), cls.node, part(e.template)),
          ty: { k: 'object', cls: meta },
        }
      }
      case 'rot':
        return { node: N(0x22, ...e.v.map((x) => this.constNum(x))), ty: this.coreStruct('Rotator') }
      case 'vect':
        return { node: N(0x23, ...e.v.map((x) => this.constNum(x))), ty: this.coreStruct('Vector') }
      case 'pre':
      case 'post':
      case 'bin':
        return this.operator(e)
      case 'static': {
        // A static function as a delegate: Class.static.Func.
        const o = this.gen(e.obj)
        const inner = N(0x43, this.nameRef(e.name), 0)
        return { node: N(0x12, o.node, memSizeOf(inner), 0, 7, inner), ty: { k: 'delegate', fn: null } }
      }
      case 'super':
      case 'global':
        throw new CompileError(`${e.k} without a call`)
    }
  }

  private unwrapBool(n: Node): Node {
    return n.op === 0x2d ? (n.args[0] as Node) : n
  }

  private constNum(x: Expr): number {
    if (x.k === 'int' || x.k === 'float') return x.v
    throw new CompileError('rot()/vect() take numbers')
  }
  private coreStruct(name: string): Ty {
    const core = this.linker.package('Core')
    const ref = core?.find(`Object.${name}`)
    return { k: 'struct', struct: core && ref ? { pkg: core, ref } : null }
  }

  private findPath(path: string): number {
    const r = this.pkg.find(path)
    if (r) return r
    const i = this.imports.get(path.toLowerCase())
    if (i !== undefined) return i
    throw new CompileError(`no object ${path} in this package`)
  }

  private memberAccess(objE: Expr, name: string, lvalue: boolean): Gen {
    const o = this.gen(objE, undefined, lvalue)
    if (o.ty.k === 'array' && name.toLowerCase() === 'length') return { node: N(0x36, this.unwrapBool(o.node)), ty: { k: 'int' } }
    if (o.ty.k === 'struct' && o.ty.struct) {
      const f = this.member(o.ty.struct, name, 'property')
      if (!f) throw new CompileError(`no ${name} in ${o.ty.struct.pkg.objectName(o.ty.struct.ref)}`)
      const { ty } = this.propTy(f)
      // Written: the link applied to the variable itself is marked (a.c = …; in a.b.c = … it is b).
      const base = this.unwrapBool(o.node)
      const node = N(0x35, this.refOf(f), this.refOf(o.ty.struct), 0, lvalue && base.op !== 0x35 ? 1 : 0, base)
      return { node: this.boolWrap(node, ty), ty }
    }
    const cls = o.ty.k === 'object' || o.ty.k === 'interface' || o.ty.k === 'component' ? o.ty.cls : o.ty.k === 'class' ? this.findType('Class') : null
    if (!cls) throw new CompileError(`${name} of something that is not an object`)
    const f = this.member(cls, name, 'property')
    if (!f) {
      // An object's function as a delegate: obj.Func.
      if (this.member(cls, name, 'function')) {
        const inner = N(0x43, this.nameRef(name), 0)
        return { node: N(0x19, o.node, memSizeOf(inner), 0, 7, inner), ty: { k: 'delegate', fn: null } }
      }
      throw new CompileError(`no ${name} in ${cls.pkg.objectName(cls.ref)}`)
    }
    const { ty } = this.propTy(f)
    const ref = this.refOf(f)
    const inner = this.boolWrap(N(0x01, ref), ty)
    const ctx = o.ty.k === 'interface' ? N(0x51, o.node) : o.node
    return { node: N(0x19, ctx, memSizeOf(inner), ref, 0, inner), ty }
  }

  // --- Calls ---------------------------------------------------------------------------

  private argsFor(params: { at: Located; p: PropertyObj; ty: Ty }[], args: (Expr | null)[], native: boolean): Node[] {
    const out: Node[] = []
    for (let i = 0; i < params.length; i++) {
      const p = params[i]!
      const a = args[i]
      if (!a) {
        if (!(p.p.flags & CPF.OptionalParm)) throw new CompileError(`missing argument ${p.at.pkg.objectName(p.at.ref)}`)
        out.push(N(0x4a))
        continue
      }
      const out_ = !!(p.p.flags & CPF.OutParm)
      let g = out_ ? this.gen(a, undefined, true) : this.gen(a, p.ty)
      if (!out_ && p.p.flags & CPF.CoerceParm) g = this.convert(g, p.ty, true)
      let node = g.node
      if (native && p.p.flags & CPF.SkipParm) node = N(0x18, memSizeOf(node) + 1, node)
      out.push(node)
    }
    // Arguments beyond the parameters (a variadic native): as they are.
    for (let i = params.length; i < args.length; i++) if (args[i]) out.push(this.gen(args[i]!).node)
    return out
  }

  /** A call of a function found: native by index, final by object, else virtual by name. */
  private callNode(at: Located, args: (Expr | null)[], forceFinal = false): Gen {
    const info = this.fnInfo(at)
    const f = info.fn
    let node: Node
    if (f.native && f.flags & FUNC.Final) node = NATIVE(f.native, this.argsFor(info.params, args, true))
    else if (forceFinal || f.flags & (FUNC.Final | FUNC.Private) || (f.flags & FUNC.Static && f.flags & FUNC.Final))
      node = N(0x1c, this.refOf(at), this.argsFor(info.params, args, false))
    else node = N(0x1b, this.nameRef(at.pkg.objectName(at.ref)), this.argsFor(info.params, args, false))
    // The return value's property, where this package imports it (a member call's context names it).
    const retProp = info.ret ? this.refOfMaybe(info.ret.at) : 0
    ;(node as Node & { retProp?: number }).retProp = retProp
    return { node, ty: info.ret?.ty ?? { k: 'none' } }
  }

  private call(e: Expr & { k: 'call' }, want: Ty | undefined): Gen {
    const fn = e.fn
    const args = e.args
    if (fn.k === 'id') {
      const lower = fn.name.toLowerCase()
      // A cast: int(x), string(x) …; byte(5) is a byte constant.
      if (lower in PRIMS && args.length === 1 && args[0]) {
        const a = args[0]
        if (lower === 'byte' && a.k === 'int' && a.hex === undefined && a.v >= 0 && a.v <= 255)
          return { node: N(0x24, a.v), ty: { k: 'byte', enumOf: null } }
        const g = this.gen(a)
        return this.convert(g, PRIMS[lower], true)
      }
      if ((lower === 'vector' || lower === 'rotator') && args.length === 1 && args[0])
        return this.convert(this.gen(args[0]), this.coreStruct(lower === 'vector' ? 'Vector' : 'Rotator'), true)
      // A class cast.
      const t = this.findType(fn.name)
      if (t && args.length === 1 && args[0] && t.pkg.className(t.ref) === 'Class') {
        let g = this.gen(args[0])
        const isIface = this.isInterface(t)
        // An object to an interface: InterfaceCast; an interface to another: DynamicCast; an
        // interface to a class: made an object first.
        const fromIface = g.ty.k === 'interface'
        if (fromIface && !isIface) g = { node: N(0x38, 0x36, g.node), ty: { k: 'object', cls: null } }
        // To an interface: none and self by InterfaceCast, any other object by DynamicCast.
        const op = isIface && (g.node.op === 0x2a || g.node.op === 0x17) ? 0x52 : 0x2e
        return { node: N(op, this.refOf(t), g.node), ty: { k: isIface ? 'interface' : 'object', cls: t } as Ty }
      }
      // A delegate variable called: local (1) or the class's (0), with the delegate's signature.
      const local = this.locals.get(lower)
      const member = local ? null : this.member(this.cls, fn.name, 'property')
      const dv = local ? { ref: local.ref, ty: local.ty } : member ? { ref: this.refOf(member), ty: this.propTy(member).ty } : null
      if (dv && dv.ty.k === 'delegate' && dv.ty.fn) {
        const info = this.fnInfo(dv.ty.fn)
        const node = N(0x42, local ? 1 : 0, dv.ref, this.nameRef(dv.ty.fn.pkg.objectName(dv.ty.fn.ref)), this.argsFor(info.params, args, false))
        ;(node as Node & { retProp?: number }).retProp = info.ret ? this.refOfMaybe(info.ret.at) : 0
        return { node, ty: info.ret?.ty ?? { k: 'none' } }
      }
      const f = this.findFunction(fn.name)
      if (f) {
        // A declared delegate called by its own name: through its hidden property.
        const fo = this.obj(f) as FunctionObj
        const hidden = fo.flags & FUNC.Delegate ? this.member(this.cls, `__${fn.name}__Delegate`, 'property') : null
        if (hidden) {
          const info = this.fnInfo(f)
          const node = N(0x42, 0, this.refOf(hidden), this.nameRef(fn.name), this.argsFor(info.params, args, false))
          ;(node as Node & { retProp?: number }).retProp = info.ret ? this.refOfMaybe(info.ret.at) : 0
          return { node, ty: info.ret?.ty ?? { k: 'none' } }
        }
        return this.callNode(f, args)
      }
      throw new CompileError(`no function ${fn.name}`)
    }
    if (fn.k === 'super') {
      const owner = fn.cls
        ? fn.cls.includes('.')
          ? this.linker.resolve(this.pkg, this.findPath(fn.cls))
          : this.findType(fn.cls)
        : this.superClass()
      const f = owner && this.findFunction(fn.name, owner)
      if (!f) throw new CompileError(`no super.${fn.name}`)
      return this.callNode(f, args, true)
    }
    if (fn.k === 'global') {
      const f = this.findFunction(fn.name, this.cls)
      const info = f ? this.fnInfo(f) : null
      const node = N(0x37, this.nameRef(fn.name), info ? this.argsFor(info.params, args, false) : args.map((a) => (a ? this.gen(a).node : N(0x4a))))
      ;(node as Node & { retProp?: number }).retProp = info?.ret ? this.refOfMaybe(info.ret.at) : 0
      return { node, ty: info?.ret?.ty ?? { k: 'none' } }
    }
    if (fn.k === 'static') {
      const o = this.gen(fn.obj)
      const cls = o.ty.k === 'class' ? o.ty.meta : null
      const f = cls && this.findFunction(fn.name, cls)
      if (!f) throw new CompileError(`no static ${fn.name}`)
      const c = this.callNode(f, args)
      const retProp = (c.node as Node & { retProp?: number }).retProp ?? 0
      return { node: N(0x12, o.node, memSizeOf(c.node), retProp, 0, c.node), ty: c.ty }
    }
    if (fn.k === 'member') {
      const o = this.gen(fn.obj, undefined, true)
      const m = fn.name.toLowerCase()
      if (o.ty.k === 'array') return this.arrayMethod(o, m, args)
      const cls = o.ty.k === 'object' || o.ty.k === 'interface' || o.ty.k === 'component' ? o.ty.cls : o.ty.k === 'class' ? this.findType('Class') : null
      const f = cls && this.findFunction(fn.name, cls)
      if (!f) throw new CompileError(`no function ${fn.name}`)
      const c = this.callNode(f, args)
      const retProp = (c.node as Node & { retProp?: number }).retProp ?? 0
      const ctx = o.ty.k === 'interface' ? N(0x51, o.node) : this.unwrapBool(o.node)
      const node = N(0x19, ctx, memSizeOf(c.node), retProp, 0, c.node)
      ;(node as Node & { retProp?: number }).retProp = retProp
      return { node, ty: c.ty }
    }
    throw new CompileError('cannot call this')
  }

  private isInterface(t: Located): boolean {
    for (let s: Located | null = t; s; ) {
      if (s.pkg.objectName(s.ref) === 'Interface') return true
      const o = this.obj(s)
      if (!o || !('head' in o) || !o.head.superStruct) return false
      s = this.linker.resolve(s.pkg, o.head.superStruct)
    }
    return false
  }
  private superClass(): Located | null {
    const o = this.obj(this.cls)
    return o && 'head' in o && o.head.superStruct ? this.linker.resolve(this.pkg, o.head.superStruct) : null
  }

  private arrayMethod(arr: Gen, m: string, args: (Expr | null)[]): Gen {
    const a = this.unwrapBool(arr.node)
    const inner = arr.ty.k === 'array' ? arr.ty.inner : undefined
    const arg = (i: number, t?: Ty) => this.gen(args[i]!, t).node
    switch (m) {
      case 'additem': {
        const x = arg(0, inner)
        return { node: N(0x55, a, memSizeOf(x) + 1, x, 0x16), ty: { k: 'int' } }
      }
      case 'removeitem': {
        const x = arg(0, inner)
        return { node: N(0x56, a, memSizeOf(x) + 1, x, 0x16), ty: { k: 'int' } }
      }
      case 'insertitem': {
        const i = arg(0, { k: 'int' })
        const x = arg(1, inner)
        return { node: N(0x57, a, memSizeOf(i) + memSizeOf(x) + 1, i, x, 0x16), ty: { k: 'int' } }
      }
      case 'find': {
        if (args.length === 2) {
          const f = arg(0)
          const v = arg(1)
          return { node: N(0x47, a, memSizeOf(f) + memSizeOf(v) + 1, f, v, 0x16), ty: { k: 'int' } }
        }
        const x = arg(0, inner)
        return { node: N(0x46, a, memSizeOf(x) + 1, x, 0x16), ty: { k: 'int' } }
      }
      case 'add':
        return { node: N(0x54, a, arg(0, { k: 'int' }), 0x16), ty: { k: 'int' } }
      case 'insert':
        return { node: N(0x39, a, arg(0, { k: 'int' }), arg(1, { k: 'int' }), 0x16), ty: { k: 'none' } }
      case 'remove':
        return { node: N(0x40, a, arg(0, { k: 'int' }), arg(1, { k: 'int' }), 0x16), ty: { k: 'none' } }
      case 'sort': {
        const d = arg(0)
        return { node: N(0x59, a, memSizeOf(d) + 1, d, 0x16), ty: { k: 'none' } }
      }
    }
    throw new CompileError(`no array method ${m}`)
  }

  // --- Operators -------------------------------------------------------------------------

  private operators?: Map<string, Located[]>
  private operatorsFor(symbol: string): Located[] {
    if (!this.operators) {
      this.operators = new Map()
      for (const name of ['Core', 'Engine']) {
        const pkg = this.linker.package(name)
        if (!pkg) continue
        for (let i = 1; i <= pkg.exports.length; i++) {
          if (pkg.className(i) !== 'Function') continue
          const fo = this.linker.object({ pkg, ref: i }) as FunctionObj
          if (!(fo.flags & FUNC.Operator)) continue
          const k = fo.friendlyName.toLowerCase()
          this.operators.set(k, [...(this.operators.get(k) ?? []), { pkg, ref: i }])
        }
      }
    }
    return this.operators.get(symbol.toLowerCase()) ?? []
  }

  private operator(e: Expr & { k: 'pre' | 'post' | 'bin' }): Gen {
    const operands = e.k === 'bin' ? [e.l, e.r] : [e.e]
    const types = operands.map((x) => this.gen(x, undefined, true).ty)
    // Delegates compare with their own tokens: with a delegate (or none), or with a function.
    if (e.k === 'bin' && (e.op === '==' || e.op === '!=') && (types[0]!.k === 'delegate' || types[1]!.k === 'delegate')) {
      const l = this.gen(operands[0]!, { k: 'delegate', fn: null })
      const r = this.gen(operands[1]!, { k: 'delegate', fn: null })
      const withFn = r.node.op === 0x4b || l.node.op === 0x4b
      const op = e.op === '==' ? (withFn ? 0x3d : 0x3b) : withFn ? 0x3e : 0x3c
      return { node: N(op, [l.node, r.node]), ty: { k: 'bool' } }
    }
    const cands = this.operatorsFor(e.op).filter((at) => {
      const info = this.fnInfo(at)
      if (info.params.length !== operands.length) return false
      const pre = !!(info.fn.flags & FUNC.PreOperator)
      return e.k === 'post' ? !pre : e.k === 'pre' ? pre : true
    })
    let best: Located | null = null
    let bestCost = Infinity
    for (const c of cands) {
      const info = this.fnInfo(c)
      let cost = 0
      for (let i = 0; i < types.length; i++) {
        const from = this.kindOf(types[i]!)
        const to = this.kindOf(info.params[i]!.ty)
        if (from === to) {
          if (from === 'struct' && !this.same(types[i]!, info.params[i]!.ty)) cost += 100
          continue
        }
        if (from === 'none' && (to === 'object' || to === 'interface' || to === 'delegate')) continue
        if ((from === 'object' || from === 'interface') && to === 'object') {
          cost += 1
          continue
        }
        const key = `${from}>${to}`
        cost += AUTO.has(key) ? 10 : 1000
      }
      if (cost < bestCost) {
        bestCost = cost
        best = c
      }
    }
    if (!best || bestCost >= 1000) throw new CompileError(`no operator ${e.op} for ${types.map((t) => t.k).join(', ')}`)
    const info = this.fnInfo(best)
    const ps = info.params.map((p, i) => {
      const out = !!(p.p.flags & CPF.OutParm)
      const g = out ? this.gen(operands[i]!, undefined, true) : this.gen(operands[i]!, p.ty)
      return p.p.flags & CPF.SkipParm ? N(0x18, memSizeOf(g.node) + 1, g.node) : g.node
    })
    const node = NATIVE(info.fn.native, ps)
    ;(node as Node & { retProp?: number }).retProp = info.ret ? this.refOfMaybe(info.ret.at) : 0
    return { node, ty: info.ret?.ty ?? { k: 'none' } }
  }
  /** This package's reference to an object if it already has one (never adds an import), else 0. */
  private refOfMaybe(at: Located): number {
    if (at.pkg === this.pkg) return at.ref
    return this.imports.get(`${this.linker.nameOf(at.pkg)}.${at.pkg.path(at.ref)}`.toLowerCase()) ?? 0
  }

  // --- Statements ------------------------------------------------------------------------

  private out: (Node | Label)[] = []
  private noEpilogue = false
  private emit(n: Node | Label) {
    this.out.push(n)
  }
  private labelFor(name: string): Label {
    if (!this.labels.has(name)) this.labels.set(name, label())
    return this.labels.get(name)!
  }

  private stmts(ss: Stmt[]) {
    for (const s of ss) this.stmt(s)
  }

  private stmt(s: Stmt) {
    switch (s.k) {
      case 'nothing':
        return this.emit(N(0x0b))
      case 'block':
        return this.stmts(s.body)
      case 'expr': {
        // upkit's dialect for tokens a source does not say: iterator steps, no closing return.
        if (s.e.k === 'id' && /^__/.test(s.e.name)) {
          const raw = s.e.name.toLowerCase()
          if (raw === '__iteratornext') return this.emit(N(0x31))
          if (raw === '__iteratorpop') return this.emit(N(0x30))
          if (raw === '__noepilogue') {
            this.noEpilogue = true
            return
          }
        }
        const g = this.gen(s.e)
        const k = g.ty.k
        // A value dropped that needs cleaning up: a string or struct from a call.
        const isCall = g.node.native !== undefined || [0x1b, 0x1c, 0x19, 0x12, 0x37].includes(g.node.op)
        const retProp = (g.node as Node & { retProp?: number }).retProp ?? 0
        if (isCall && retProp && (k === 'string' || k === 'struct' || k === 'array') && g.node.op !== 0x0f)
          return this.emit(N(0x0e, retProp, g.node))
        return this.emit(g.node)
      }
      case 'return': {
        // return; in a function with a value returns what is in its return value.
        if (!s.e) return this.emit(N(0x04, this.retRef ? N(0x3a, this.retRef) : N(0x0b)))
        return this.emit(N(0x04, this.gen(s.e, this.retTy ?? undefined).node))
      }
      case 'if': {
        const c = this.gen(s.c, { k: 'bool' })
        const elseL = label()
        this.emit(N(0x07, elseL as unknown as Value, c.node))
        this.stmts(s.then)
        if (s.else) {
          const end = label()
          this.emit(N(0x06, end as unknown as Value))
          this.emit(elseL)
          this.stmts(s.else)
          this.emit(end)
        } else this.emit(elseL)
        return
      }
      case 'while': {
        const top = label()
        const end = label()
        this.emit(top)
        this.emit(N(0x07, end as unknown as Value, this.gen(s.c, { k: 'bool' }).node))
        this.loops.push({ breakTo: end, continueTo: top })
        this.stmts(s.body)
        this.loops.pop()
        this.emit(N(0x06, top as unknown as Value))
        this.emit(end)
        return
      }
      case 'for': {
        if (s.init) this.emit(this.gen(s.init).node)
        const top = label()
        const end = label()
        const step = label()
        this.emit(top)
        this.emit(N(0x07, end as unknown as Value, this.gen(s.c, { k: 'bool' }).node))
        this.loops.push({ breakTo: end, continueTo: step })
        this.stmts(s.body)
        this.loops.pop()
        this.emit(step)
        if (s.step) this.emit(this.gen(s.step).node)
        this.emit(N(0x06, top as unknown as Value))
        this.emit(end)
        return
      }
      case 'do': {
        const top = label()
        const end = label()
        const cond = label()
        this.emit(top)
        this.loops.push({ breakTo: end, continueTo: cond })
        this.stmts(s.body)
        this.loops.pop()
        this.emit(cond)
        this.emit(N(0x07, top as unknown as Value, this.gen(s.c, { k: 'bool' }).node))
        this.emit(end)
        return
      }
      case 'foreach': {
        const pop = label()
        const next = label()
        const it = this.iterator(s.e, pop)
        this.emit(it)
        this.loops.push({ breakTo: pop, continueTo: next })
        this.stmts(s.body)
        this.loops.pop()
        this.emit(next)
        this.emit(N(0x31))
        this.emit(pop)
        this.emit(N(0x30))
        return
      }
      case 'switch': {
        const g = this.gen(s.e)
        const prop = this.propOf(g.node)
        const size = prop ? 0 : g.ty.k === 'byte' ? 1 : 4
        this.emit(N(0x05, prop, size, g.node))
        const end = label()
        this.loops.push({ breakTo: end, continueTo: this.loops.at(-1)?.continueTo ?? null })
        let pending: Label | null = null
        for (const c of s.cases) {
          if (pending) this.emit(pending)
          if (c.v) {
            const next = label()
            this.emit(N(0x0a, [next, this.gen(c.v, g.ty).node] as unknown as Value))
            pending = next
          } else {
            this.emit(N(0x0a, [0xffff, null] as unknown as Value))
            pending = null
          }
          this.stmts(c.body)
        }
        if (pending) this.emit(pending)
        this.loops.pop()
        this.emit(end)
        return
      }
      case 'break': {
        const l = this.loops.at(-1)
        if (!l) throw new CompileError('break outside a loop')
        return this.emit(N(0x06, l.breakTo as unknown as Value))
      }
      case 'continue': {
        const l = [...this.loops].reverse().find((x) => x.continueTo)
        if (!l) throw new CompileError('continue outside a loop')
        return this.emit(N(0x06, l.continueTo as unknown as Value))
      }
      case 'goto':
        return this.emit(N(0x06, this.labelFor(s.label) as unknown as Value))
      case 'ifgoto':
        return this.emit(N(0x07, this.labelFor(s.label) as unknown as Value, this.gen(s.c, { k: 'bool' }).node))
      case 'label':
        return this.emit(this.labelFor(s.name))
      case 'assert':
        return this.emit(N(0x09, 0, 0, this.gen(s.e, { k: 'bool' }).node))
      case 'stop':
        return this.emit(N(0x08))
    }
  }

  /** foreach's head: an iterator function call, or Array(Item[, Index]). */
  private iterator(e: Expr, pop: Label): Node {
    if (e.k === 'call') {
      // Array(Item[, Index]): the array is a variable, not a function.
      const arr = e.fn.k === 'id' ? this.variable(e.fn.name) : e.fn.k === 'member' ? this.tryGen(e.fn, false) : null
      if (arr && arr.ty.k === 'array') {
        const item = this.gen(e.args[0]!, undefined, true)
        const idx = e.args[1] ? this.gen(e.args[1], undefined, true).node : N(0x4a)
        return N(0x58, this.unwrapBool(arr.node), this.unwrapBool(item.node), e.args[1] ? 1 : 0, idx, pop as unknown as Value)
      }
      return N(0x2f, this.gen(e).node, pop as unknown as Value)
    }
    throw new CompileError('foreach needs an iterator call')
  }
  private tryGen(e: Expr, lvalue = true): Gen | null {
    try {
      return this.gen(e, undefined, lvalue)
    } catch {
      return null
    }
  }

  // --- The whole function -----------------------------------------------------------------

  /** Compiles the function's source (declaration and body) to its script's statements. */
  compileStatements(src: string, binary?: Record<string, number>): Node[] {
    const parser = new Parser(src, binary)
    const f: FunctionSource = parser.function()
    this.out = []
    // A slot per optional parameter first: its default, or nothing.
    for (const p of this.params) {
      if (!(p.p.flags & CPF.OptionalParm)) continue
      const d = f.defaults.get(this.pkg.objectName(p.ref).toLowerCase())
      if (d) {
        const g = this.gen(d, p.ty)
        this.emit(N(0x49, memSizeOf(g.node) + 1, g.node, 0x15))
      } else this.emit(N(0x0b))
    }
    // A native function without a body: the stub (each parameter as NativeParm, then nothing).
    if (!f.body && this.fn.flags & FUNC.Native) {
      for (const p of this.params) this.emit(N(0x29, p.ref))
      this.emit(N(0x0b))
      this.emit(N(0x53))
      return this.layout()
    }
    if (f.body) this.declareLocals(f.body)
    if (f.body) this.stmts(f.body)
    // The epilogue: a return with the return value (none in a hand patch that left it out), and the end.
    if (!this.noEpilogue) this.emit(N(0x04, this.retRef ? N(0x3a, this.retRef) : N(0x0b)))
    this.emit(N(0x53))
    return this.layout()
  }

  /** Local variables the source declares that the function does not have yet: new properties. */
  private declareLocals(body: Stmt[]) {
    for (const st of body) {
      if (st.k !== 'local') continue
      for (const { name, dim } of st.names) {
        if (this.locals.has(name.toLowerCase())) continue
        if (this.allow !== 'all') throw new CompileError(`a new local variable ${name} (a whole package, --out, can add it)`)
        const ty = this.typeFromText(st.type)
        const ref = this.pkg.exports.length + this.added.locals.reduce((n, l) => n + (l.inner ? 2 : 1), 0) + 1
        const { cls, refs } = this.propertyClass(ty)
        const local: (typeof this.added.locals)[number] = { name, dim, ty, ref, cls, refs }
        if (ty.k === 'array') {
          const inner = this.propertyClass(ty.inner)
          local.inner = { ref: ref + 1, cls: inner.cls, refs: inner.refs }
          local.refs = [ref + 1]
        }
        this.added.locals.push(local)
        const p = { kind: 'property', type: cls, flags: 0n, arrayDim: dim, refs: local.refs } as unknown as PropertyObj
        this.locals.set(name.toLowerCase(), { ref, p, ty })
        this.nameRef(name)
      }
    }
  }
  private typeFromText(text: string): Ty {
    const t = text.trim()
    const lower = t.toLowerCase()
    if (lower in PRIMS) return PRIMS[lower]!
    if (lower === 'vector' || lower === 'rotator') return this.coreStruct(lower === 'vector' ? 'Vector' : 'Rotator')
    let m = /^array<(.+)>$/i.exec(t)
    if (m) return { k: 'array', inner: this.typeFromText(m[1]!) }
    m = /^class<(.+)>$/i.exec(t)
    if (m) return { k: 'class', meta: this.findType(m[1]!) }
    if (lower === 'class') return { k: 'class', meta: this.findType('Object') }
    const found = this.findType(t)
    if (!found) throw new CompileError(`no type ${t}`)
    const kind = found.pkg.className(found.ref)
    if (kind === 'Enum') return { k: 'byte', enumOf: found }
    if (kind === 'ScriptStruct') return { k: 'struct', struct: found }
    return this.isInterface(found) ? { k: 'interface', cls: found } : { k: 'object', cls: found }
  }
  private propertyClass(ty: Ty): { cls: string; refs: number[] } {
    const r = (at: Located | null | undefined) => (at ? this.refOf(at) : 0)
    switch (ty.k) {
      case 'int':
        return { cls: 'IntProperty', refs: [] }
      case 'float':
        return { cls: 'FloatProperty', refs: [] }
      case 'bool':
        return { cls: 'BoolProperty', refs: [] }
      case 'string':
        return { cls: 'StrProperty', refs: [] }
      case 'name':
        return { cls: 'NameProperty', refs: [] }
      case 'byte':
        return { cls: 'ByteProperty', refs: [r(ty.enumOf)] }
      case 'object':
        return { cls: 'ObjectProperty', refs: [r(ty.cls)] }
      case 'interface':
        return { cls: 'InterfaceProperty', refs: [r(ty.cls)] }
      case 'class':
        return { cls: 'ClassProperty', refs: [r(this.findType('Class')), r(ty.meta)] }
      case 'struct':
        return { cls: 'StructProperty', refs: [r(ty.struct)] }
      case 'array':
        return { cls: 'ArrayProperty', refs: [0] }
    }
    throw new CompileError(`a local of type ${ty.k} is not covered`)
  }

  /**
   * What the package needs added for the compiled code: names, imports, the
   * new locals as exports, and the function's data with them linked in (the
   * script itself is put in by the caller, edit.ts).
   */
  additions(): { names: import('./package.ts').NameEntry[]; imports: import('./package.ts').Import[]; exports: { entry: import('./package.ts').Export; data: Uint8Array }[]; children: number } {
    const exports: { entry: import('./package.ts').Export; data: Uint8Array }[] = []
    const none = this.nameRef('None')
    const fnHead = this.fn.head.children
    const property = (ref: number, outer: number, name: string, cls: string, refs: number[], next: number, dim: number) => {
      const w: number[] = []
      const i32 = (x: number) => {
        const b = new Uint8Array(4)
        new DataView(b.buffer).setInt32(0, x, true)
        w.push(...b)
      }
      i32(ref - 1) // the object's own index
      i32(none.index)
      i32(none.number)
      i32(next)
      i32(dim)
      i32(0)
      i32(0) // flags: a local's are none
      i32(none.index)
      i32(none.number) // category
      i32(0) // array enum
      for (const x of refs) i32(x)
      const n = this.nameRef(name)
      exports.push({
        entry: {
          classIndex: this.coreClass(cls),
          superIndex: 0,
          outer,
          objectName: n,
          archetype: 0,
          objectFlags: 0x7000400000000n,
          serialSize: 0,
          serialOffset: 0,
          exportFlags: 0,
          netObjects: [],
          packageGuid: new Uint8Array(16),
          packageFlags: 0,
        },
        data: new Uint8Array(w),
      })
    }
    const locals = this.added.locals
    locals.forEach((l, k) => {
      const next = k + 1 < locals.length ? locals[k + 1]!.ref : fnHead
      property(l.ref, this.ref, l.name, l.cls, l.refs, next, l.dim)
      if (l.inner) property(l.inner.ref, l.ref, l.name, l.inner.cls, l.inner.refs, 0, 1)
    })
    return {
      names: this.added.names.map((name) => ({ name, flags: 0x7001000000000n })),
      imports: this.added.imports,
      exports,
      children: locals.length ? locals[0]!.ref : fnHead,
    }
  }

  /** Places the labels: each takes the memory offset of what follows it. */
  private layout(): Node[] {
    const nodes: Node[] = []
    let mem = 0
    for (const x of this.out) {
      if ('label' in x) x.mem = mem
      else {
        nodes.push(x)
        mem += memSizeOf(x)
      }
    }
    for (const [name, l] of this.labels) if (l.mem < 0) throw new CompileError(`no label ${name}`)
    const fix = (n: Node) => {
      n.args = n.args.map((a) => {
        if (a && typeof a === 'object' && 'label' in (a as object)) return (a as unknown as Label).mem
        if (Array.isArray(a) && a.length === 2 && a[0] && typeof a[0] === 'object' && 'label' in (a[0] as object))
          return [(a[0] as unknown as Label).mem, a[1]] as unknown as Value
        return a
      })
    }
    for (const n of nodes) fix(n)
    return nodes
  }

  /** Compiles to the script's bytes and memory size. */
  compile(src: string, binary?: Record<string, number>): { code: Uint8Array; memSize: number } {
    return encodeScript(this.compileStatements(src, binary))
  }
}

/** Binary operators' bindings, from the natives that define them (what the decompiler parenthesizes by). */
export function binaryOperators(linker: Linker): Record<string, number> {
  const out: Record<string, number> = {}
  for (const name of ['Core', 'Engine']) {
    const pkg = linker.package(name)
    if (!pkg) continue
    for (let i = 1; i <= pkg.exports.length; i++) {
      if (pkg.className(i) !== 'Function') continue
      const fo = linker.object({ pkg, ref: i }) as FunctionObj
      if (!(fo.flags & FUNC.Operator) || fo.flags & FUNC.PreOperator || !fo.precedence) continue
      out[fo.friendlyName] ??= fo.precedence
    }
  }
  return out
}
