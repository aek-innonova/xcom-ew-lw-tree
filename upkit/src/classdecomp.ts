// A whole class as UnrealScript: its declaration, constants, enums, structs,
// variables, functions, states (their functions and code) and
// defaultproperties (from its default object). For reading; what compiles
// back is the functions (compile.ts).

import { Reader } from './bytes.ts'
import { floatText, FunctionDecompiler, stringText } from './decompile.ts'
import type { Linker, Located } from './linker.ts'
import { fidelity, fidelityNote, readableSource } from './fidelity.ts'
import { readStructHead, readTags, tagsStart, type ClassObj, type ConstObj, type EnumObj, type PropertyObj, type StateObj, type StructObj, type Tag } from './objects.ts'
import type { Package } from './package.ts'
import { CPF, typeOf, typeText, type Ty } from './types.ts'

const CLASS_FLAGS: [number, string][] = [
  [0x1, 'abstract'],
  [0x8, 'transient'],
  [0x80, 'native'],
  [0x100, 'noexport'],
  [0x200, 'placeable'],
  [0x400, 'perobjectconfig'],
  [0x800, 'nativereplication'],
  [0x1000, 'editinlinenew'],
  [0x2000, 'collapsecategories'],
  [0x1000000, 'hidden'],
  [0x2000000, 'deprecated'],
  [0x4000000, 'hidedropdown'],
]
const VAR_FLAGS: [bigint, string][] = [
  [CPF.Const, 'const'],
  [CPF.Config, 'config'],
  [CPF.GlobalConfig, 'globalconfig'],
  [CPF.Localized, 'localized'],
  [CPF.Transient, 'transient'],
  [CPF.Native, 'native'],
  [CPF.EditConst, 'editconst'],
  [CPF.Input, 'input'],
  [CPF.Deprecated, 'deprecated'],
  [CPF.EditInline, 'editinline'],
  [CPF.NoClear, 'noclear'],
  [CPF.NoImport, 'noimport'],
  [CPF.DuplicateTransient, 'duplicatetransient'],
  [CPF.NoExport, 'noexport'],
  [CPF.RepNotify, 'repnotify'],
  [CPF.Interp, 'interp'],
  [CPF.NonTransactional, 'nontransactional'],
  [CPF.PrivateWrite, 'privatewrite'],
  [CPF.ProtectedWrite, 'protectedwrite'],
  [CPF.EditHide, 'edithide'],
  [CPF.EditTextBox, 'edittextbox'],
  [CPF.CrossLevelPassive, 'crosslevelpassive'],
  [CPF.CrossLevelActive, 'crosslevelactive'],
]

/** Structs whose values are stored as raw fields, not tagged properties. */
const ATOMIC: Record<string, (r: Reader) => string> = {
  vector: (r) => `(X=${floatText(r.f32())},Y=${floatText(r.f32())},Z=${floatText(r.f32())})`,
  rotator: (r) => `(Pitch=${r.i32()},Yaw=${r.i32()},Roll=${r.i32()})`,
  vector2d: (r) => `(X=${floatText(r.f32())},Y=${floatText(r.f32())})`,
  color: (r) => {
    const [b, g, rr, a] = [r.u8(), r.u8(), r.u8(), r.u8()]
    return `(R=${rr},G=${g},B=${b},A=${a})`
  },
  linearcolor: (r) => `(R=${floatText(r.f32())},G=${floatText(r.f32())},B=${floatText(r.f32())},A=${floatText(r.f32())})`,
  guid: (r) => `(A=${r.i32()},B=${r.i32()},C=${r.i32()},D=${r.i32()})`,
  plane: (r) => `(X=${floatText(r.f32())},Y=${floatText(r.f32())},Z=${floatText(r.f32())},W=${floatText(r.f32())})`,
  quat: (r) => `(X=${floatText(r.f32())},Y=${floatText(r.f32())},Z=${floatText(r.f32())},W=${floatText(r.f32())})`,
  intpoint: (r) => `(X=${r.i32()},Y=${r.i32()})`,
  box: (r) => {
    const v = () => `(X=${floatText(r.f32())},Y=${floatText(r.f32())},Z=${floatText(r.f32())})`
    return `(Min=${v()},Max=${v()},IsValid=${r.u8()})`
  },
}

export class ClassDecompiler {
  readonly linker: Linker
  readonly pkg: Package
  readonly ref: number
  /** Whether each function is compiled back and a difference noted (slower). */
  checked: boolean
  constructor(linker: Linker, pkg: Package, ref: number, checked = true) {
    this.linker = linker
    this.pkg = pkg
    this.ref = ref
    this.checked = checked
  }

  private obj(ref: number): string {
    return ref ? this.pkg.objectName(ref) : 'None'
  }
  /** A struct's (class's, state's) fields as they are linked, from its first child. */
  private chain(ref: number): number[] {
    const out: number[] = []
    const o = this.linker.object({ pkg: this.pkg, ref })
    const first = o && 'head' in o ? o.head.children : 0
    for (let c = first; c && out.length < 100000; ) {
      out.push(c)
      const f = this.linker.object({ pkg: this.pkg, ref: c })
      c = f ? ('head' in f ? f.head.next : f.next) : 0
    }
    return out
  }
  /** Exports directly inside an object, in export (declaration) order. */
  private inside(outer: number): number[] {
    const out: number[] = []
    for (let i = 1; i <= this.pkg.exports.length; i++) if (this.pkg.exports[i - 1]!.outer === outer) out.push(i)
    return out
  }
  private object<T>(ref: number): T {
    return this.linker.object({ pkg: this.pkg, ref }) as T
  }

  decompile(): string {
    const pkg = this.pkg
    const c = this.object<ClassObj>(this.ref)
    const lines: string[] = []
    const name = pkg.objectName(this.ref)
    const isInterface = !!(c.classFlags & 0x4000)
    const head: string[] = [`${isInterface ? 'interface' : 'class'} ${name}`]
    if (c.head.superStruct) head.push(`extends ${this.obj(c.head.superStruct)}`)
    if (c.within && this.obj(c.within) !== 'Object') head.push(`within ${this.obj(c.within)}`)
    for (const [f, w] of CLASS_FLAGS) if (c.classFlags & f) head.push(w)
    if (c.classFlags & 0x4 && c.configName !== 'None') head.push(`config(${c.configName})`)
    const own = c.interfaces.filter((x) => x.cls).map((x) => this.obj(x.cls))
    if (own.length) head.push(`implements(${own.join(', ')})`)
    if (c.hideCategories.length) head.push(`hidecategories(${c.hideCategories.join(', ')})`)
    lines.push(head.join('\n    ') + ';', '')

    const members = this.inside(this.ref)
    const kinds = (k: string) => members.filter((m) => pkg.className(m) === k)
    for (const m of kinds('Const')) lines.push(`const ${pkg.objectName(m)} = ${this.object<ConstObj>(m).value};`)
    if (kinds('Const').length) lines.push('')
    for (const m of kinds('Enum')) lines.push(...this.enumText(m), '')
    for (const m of kinds('ScriptStruct')) lines.push(...this.structText(m), '')
    // Variables in declaration order: a class's fields chain from the last declared.
    const vars = this.chain(this.ref)
      .reverse()
      .filter((m) => pkg.className(m).endsWith('Property') && !/^__.*__Delegate$/.test(pkg.objectName(m)))
    for (const m of vars) lines.push(this.varText(m))
    if (vars.length) lines.push('')
    for (const m of kinds('Function')) lines.push(this.functionText(m))
    for (const m of kinds('State')) lines.push(...this.stateText(m), '')
    lines.push(...this.defaults(c.defaultObject))
    return lines.join('\n') + '\n'
  }

  private enumText(ref: number): string[] {
    const e = this.object<EnumObj>(ref)
    const names = e.names.filter((n, i) => !(i === e.names.length - 1 && n.endsWith('_MAX')))
    return [`enum ${this.pkg.objectName(ref)}`, '{', ...names.map((n, i) => `    ${n}${i < names.length - 1 ? ',' : ''}`), '};']
  }

  private typeOf(ref: number): Ty {
    return typeOf(this.linker, { pkg: this.pkg, ref }, this.object<PropertyObj>(ref))
  }

  private varText(ref: number, indent = ''): string {
    const p = this.object<PropertyObj>(ref)
    const mods: string[] = []
    for (const [f, w] of VAR_FLAGS) if (p.flags & f) mods.push(w)
    const edit = p.flags & CPF.Edit ? `(${p.category !== 'None' && p.category !== this.pkg.objectName(this.pkg.outerOf(ref)) ? p.category : ''})` : ''
    const dim = p.arrayDim > 1 ? `[${p.arrayDim}]` : ''
    return `${indent}var${edit} ${[...mods, typeText(this.typeOf(ref))].join(' ')} ${this.pkg.objectName(ref)}${dim};`
  }

  private structText(ref: number): string[] {
    const s = this.object<StructObj>(ref)
    const sup = s.head.superStruct ? ` extends ${this.obj(s.head.superStruct)}` : ''
    const out = [`struct ${s.structFlags & 0x1 ? 'native ' : ''}${this.pkg.objectName(ref)}${sup}`, '{']
    // Members in declaration order: a struct's fields chain from the first (its layout).
    for (const m of this.chain(ref)) if (this.pkg.className(m).endsWith('Property')) out.push(this.varText(m, '    '))
    if (s.defaults.length) {
      out.push('', '    structdefaultproperties', '    {')
      for (const t of s.defaults) out.push(`        ${this.tagLine(t, { pkg: this.pkg, ref })}`)
      out.push('    }')
    }
    out.push('};')
    return out
  }

  private functionText(ref: number, indent = ''): string {
    try {
      const text = readableSource(this.linker, this.pkg, ref)
      const note = this.checked && readStructHead(this.pkg, ref).size ? fidelityNote(fidelity(this.linker, this.pkg, ref, text)) : ''
      return (note + text)
        .split('\n')
        .map((l) => (l ? indent + l : l))
        .join('\n')
    } catch (e) {
      return `${indent}// ${this.pkg.path(ref)}: not decompiled (${(e as Error).message})\n`
    }
  }

  private stateText(ref: number): string[] {
    const s = this.object<StateObj>(ref)
    const sup = s.head.superStruct ? ` extends ${this.obj(s.head.superStruct)}` : ''
    const mods = [s.stateFlags & 0x2 ? 'auto' : '', s.stateFlags & 0x4 ? 'simulated' : ''].filter(Boolean)
    const out = [`${[...mods, 'state'].join(' ')} ${this.pkg.objectName(ref)}${sup}`, '{']
    for (const m of this.inside(ref)) if (this.pkg.className(m) === 'Function') out.push(this.functionText(m, '    '))
    const code = new FunctionDecompiler(this.linker, this.pkg, ref).decompileStateCode()
    // (A blank line before the code, one: the functions above end with one.)
    if (code) out.push(...(out.at(-1)?.trim() === '' || out.at(-1)?.endsWith('\n') ? [] : ['']), code.trimEnd())
    out.push('}')
    return out
  }

  // --- defaultproperties ---------------------------------------------------------

  /** The property a tag sets, looked up in the class (or struct) and its parents. */
  propFor(scope: Located, name: string): Located | null {
    const want = name.toLowerCase()
    for (let s: Located | null = scope; s; ) {
      const o = this.linker.object(s)
      if (!o || !('head' in o)) return null
      for (let c = o.head.children; c; ) {
        const f = { pkg: s.pkg, ref: c }
        const fo = this.linker.object(f)
        if (!fo) break
        if (s.pkg.objectName(c).toLowerCase() === want && fo.kind === 'property') return f
        c = 'head' in fo ? fo.head.next : fo.next
      }
      s = o.head.superStruct ? this.linker.resolve(s.pkg, o.head.superStruct) : null
    }
    return null
  }

  private value(r: Reader, ty: Ty, structName?: string): string {
    switch (ty.k) {
      case 'int':
        return String(r.i32())
      case 'float':
        return floatText(r.f32())
      case 'bool':
        return r.u8() ? 'true' : 'false'
      case 'name':
        return this.pkg.name({ index: r.i32(), number: r.i32() })
      case 'string':
        return stringText(r.fstr())
      case 'byte':
        return ty.enumOf ? this.pkg.name({ index: r.i32(), number: r.i32() }) : String(r.u8())
      case 'object':
      case 'class':
      case 'interface':
      case 'component': {
        const ref = r.i32()
        if (!ref) return 'None'
        const cls = this.pkg.className(ref)
        return `${cls}'${this.pkg.path(ref)}'`
      }
      case 'delegate': {
        const obj = r.i32()
        const fn = this.pkg.name({ index: r.i32(), number: r.i32() })
        return obj ? `${this.pkg.path(obj)}.${fn}` : fn
      }
      case 'struct': {
        const sn = (structName ?? (ty.struct ? ty.struct.pkg.objectName(ty.struct.ref) : '')).toLowerCase()
        if (ATOMIC[sn]) return ATOMIC[sn](r)
        const tags = readTags(r, this.pkg)
        return `(${tags.map((t) => this.tagLine(t, ty.struct)).join(',')})`
      }
      default:
        return '?'
    }
  }

  tagLine(t: Tag, scope: Located | null): string {
    const at = scope ? this.propFor(scope, t.name) : null
    const p = at ? (this.linker.object(at) as PropertyObj) : null
    let ty: Ty = p ? typeOf(this.linker, at!, p) : { k: 'unknown' }
    const idx = t.arrayIndex ? `(${t.arrayIndex})` : ''
    const r = new Reader(t.value)
    try {
      if (t.type === 'BoolProperty') return `${t.name}${idx}=${t.boolValue ? 'true' : 'false'}`
      if (t.type === 'ArrayProperty') {
        const n = r.i32()
        const inner = ty.k === 'array' ? ty.inner : { k: 'unknown' as const }
        const items: string[] = []
        for (let i = 0; i < n; i++) items.push(`${t.name}(${i})=${this.value(r, inner)}`)
        return items.length ? items.join('\n        ') : `${t.name}.Empty`
      }
      if (ty.k === 'unknown') ty = this.tyFromTag(t)
      return `${t.name}${idx}=${this.value(r, ty, t.structName)}`
    } catch {
      return `${t.name}${idx}=<${t.size} bytes>`
    }
  }

  /** A type from the tag alone, where the declaration is not to be found. */
  private tyFromTag(t: Tag): Ty {
    switch (t.type) {
      case 'IntProperty':
        return { k: 'int' }
      case 'FloatProperty':
        return { k: 'float' }
      case 'NameProperty':
        return { k: 'name' }
      case 'StrProperty':
        return { k: 'string' }
      case 'ByteProperty':
        return { k: 'byte', enumOf: t.enumName && t.enumName !== 'None' ? ({} as Located) : null }
      case 'ObjectProperty':
      case 'ComponentProperty':
      case 'ClassProperty':
      case 'InterfaceProperty':
        return { k: 'object', cls: null }
      case 'StructProperty':
        return { k: 'struct', struct: null }
    }
    return { k: 'unknown' }
  }

  private defaults(ref: number): string[] {
    if (!ref || ref < 0) return []
    const pkg = this.pkg
    const r = new Reader(pkg.data(ref))
    r.o = tagsStart(this.linker, pkg, ref)
    let tags: Tag[]
    try {
      tags = readTags(r, pkg)
    } catch {
      return ['// defaultproperties: not read']
    }
    const out = ['defaultproperties', '{']
    // Subobjects (components) the defaults own.
    for (const sub of this.inside(ref)) {
      const sr = new Reader(pkg.data(sub))
      sr.o = tagsStart(this.linker, pkg, sub)
      let st: Tag[] = []
      try {
        st = readTags(sr, pkg)
      } catch {
        // left out
      }
      const cls = this.linker.resolve(pkg, pkg.exports[sub - 1]!.classIndex)
      out.push(`    Begin Object Class=${pkg.className(sub)} Name=${pkg.objectName(sub)}`)
      for (const t of st) out.push(`        ${this.tagLine(t, cls)}`)
      out.push('    End Object')
    }
    for (const t of tags) out.push(`    ${this.tagLine(t, { pkg, ref: this.ref })}`)
    out.push('}')
    return out
  }
}

/** A class's UnrealScript, by its name in the package. */
export function decompileClass(linker: Linker, pkg: Package, name: string): string {
  const ref = pkg.find(name)
  if (!ref || pkg.className(ref) !== 'Class') throw new Error(`no class ${name}`)
  return new ClassDecompiler(linker, pkg, ref).decompile()
}
