// A set of edits compiled together: functions' and states' new source, into a
// whole package or a PatchUPK mod script. The compilers share what they add
// (names, imports, new locals), so one change set numbers them once.

import { encodeScript, type Node } from './bytecode.ts'
import { binaryOperators, FunctionCompiler, shared } from './compile.ts'
import { classEdits } from './classsrc.ts'
import { declare, declareClass, declareFields, declareStruct, parseClassHeader } from './declare.ts'
import { defaultsBlock, defaultsChanges, structDefaults } from './defaults.ts'
import { withScript } from './edit.ts'
import type { Linker } from './linker.ts'
import { readStructHead } from './objects.ts'
import { openPackage, type Package } from './package.ts'
import { modScript } from './patch.ts'
import { writePackage } from './writer.ts'

export interface Change {
  /** The function or state. */
  ref: number
  /** Its new source: a function's declaration and body, or a state's code. */
  text: string
}

/** A class's defaultproperties, as its source has them. */
export interface DefaultsSource {
  classRef: number
  block: string
}

export interface Compiled {
  ref: number
  statements: Node[]
  code: Uint8Array
  memSize: number
  /** A state's: where its label table's entries start. */
  labelTableOffset?: number
}

/** The changes as a whole new package (names, imports and new locals added as needed). */
export function packageWith(
  linker: Linker,
  pkg: Package,
  changes: Change[],
  layout: 'keep' | 'compact' = 'keep',
  defaults?: DefaultsSource,
): { bytes: Uint8Array; compiled: Compiled[]; objects: number[]; added: { names: number; imports: number; exports: number } } {
  const ops = binaryOperators(linker)
  const sh = shared()
  const data = new Map<number, Uint8Array>()
  const exports: { entry: import('./package.ts').Export; data: Uint8Array }[] = []
  const compiled: Compiled[] = []
  for (const c of changes) {
    const fc = new FunctionCompiler(linker, pkg, c.ref, sh)
    fc.allow = 'all'
    const one = compileOne(fc, pkg, c, ops)
    compiled.push(one)
    if (one.labelTableOffset !== undefined) {
      data.set(c.ref, withScript(pkg, c.ref, one.code, one.memSize, undefined, one.labelTableOffset))
      continue
    }
    const add = fc.additions()
    const fdata = withScript(pkg, c.ref, one.code, one.memSize, add.children)
    // New locals: whether the function now copies struct defaults into them (its flag after the script).
    if (add.exports.length) {
      const at = readStructHead(pkg, c.ref).scriptAt + one.code.length + 3
      const v = new DataView(fdata.buffer, fdata.byteOffset)
      const flags = v.getUint32(at, true)
      v.setUint32(at, (fc.localsNeedDefaults() ? flags | 0x800000 : flags & ~0x800000) >>> 0, true)
    }
    data.set(c.ref, fdata)
    for (const [ref, d] of add.edits) data.set(ref, d)
    exports.push(...add.exports)
    sh.exports += add.exports.length
  }
  const objects: number[] = []
  if (defaults)
    for (const e of defaultsChanges(linker, pkg, defaults.classRef, defaults.block, { shared: sh, allow: 'all' })) {
      data.set(e.ref, e.data)
      objects.push(e.ref)
    }
  const names = sh.names.map((name) => ({ name, flags: 0x7001000000000n }))
  const bytes = writePackage(pkg, { data, names, imports: sh.imports, exports, layout })
  return { bytes, compiled, objects, added: { names: names.length, imports: sh.imports.length, exports: exports.length } }
}

/**
 * The changes as a PatchUPK mod script. It can add names; a change that needs
 * a new import or local fails with the compiler's word on it (a whole package can).
 */
export function modScriptWith(
  linker: Linker,
  pkg: Package,
  upk: string,
  changes: Change[],
  info: { name: string; author?: string; description?: string },
  defaults?: DefaultsSource,
): { text: string; compiled: Compiled[]; objects: number[]; names: string[] } {
  const ops = binaryOperators(linker)
  const sh = shared()
  const compiled: Compiled[] = []
  for (const c of changes) {
    const fc = new FunctionCompiler(linker, pkg, c.ref, sh)
    fc.allow = 'names'
    compiled.push(compileOne(fc, pkg, c, ops))
  }
  const edits = defaults ? defaultsChanges(linker, pkg, defaults.classRef, defaults.block, { shared: sh, allow: 'names' }) : []
  const text = modScript(
    info,
    compiled.map((c) => ({
      upk,
      pkg,
      ref: c.ref,
      statements: c.statements,
      names: sh.names,
      // A state's label table moves with its code: the offset the state keeps of it, set after.
      after:
        c.labelTableOffset === undefined
          ? undefined
          : { at: readStructHead(pkg, c.ref).scriptAt + c.code.length + 4, bytes: u16(c.labelTableOffset) },
    })),
    edits.map((e) => ({ upk, pkg, ref: e.ref, data: e.data, names: sh.names })),
  )
  return { text, compiled, objects: edits.map((e) => e.ref), names: sh.names }
}

function compileOne(fc: FunctionCompiler, pkg: Package, c: Change, ops: Record<string, number>): Compiled {
  if (pkg.className(c.ref) === 'State') {
    const r = fc.compileStateCode(c.text, ops)
    const { code, memSize } = encodeScript(r.statements)
    return { ref: c.ref, statements: r.statements, code, memSize, labelTableOffset: r.labelTableOffset }
  }
  const statements = fc.compileStatements(c.text, ops)
  const { code, memSize } = encodeScript(statements)
  return { ref: c.ref, statements, code, memSize }
}

const u16 = (v: number) => new Uint8Array([v & 0xff, (v >> 8) & 0xff])

/**
 * Classes' sources into a whole package: classes it does not have declared
 * first (parents before the classes extending them), then every class's new
 * member variables and functions, then every edited or new function, state
 * code and default compiled. In that order, the classes can name each other.
 */
export function classesPackage(
  linker: Linker,
  pkg: Package,
  pkgName: string,
  sources: string[],
  layout: 'keep' | 'compact' = 'keep',
): { bytes: Uint8Array; compiled: string[]; objects: string[]; declared: string[]; added: { names: number; imports: number; exports: number } } {
  let target = pkg
  let bytes = pkg.bytes
  const step = (b: Uint8Array) => {
    bytes = b
    target = openPackage(b)
    linker.add(pkgName, target)
  }
  const classes = sources.map((src) => ({ src, name: parseClassHeader(src).name, head: parseClassHeader(src) }))
  const declared: string[] = []
  const implicit = new Map<string, string[]>()
  // The new classes, each after its parent if that is new too.
  const pending = classes.filter((c) => !pkg.find(c.name))
  while (pending.length) {
    const i = pending.findIndex((c) => !pending.some((p) => p.name.toLowerCase() === c.head.parent.toLowerCase()))
    if (i < 0) throw new Error(`the classes ${pending.map((c) => c.name).join(', ')} extend each other`)
    const c = pending.splice(i, 1)[0]!
    const r = declareClass(linker, target, c.head)
    step(r.bytes)
    implicit.set(c.name, r.defaults)
    declared.push(c.name)
  }
  // Then, for all the classes (each step can name what the one before declared):
  // constants, enums and states; structs; delegates; variables and functions.
  for (const c of classes) {
    const e = classEdits(linker, target, c.name, c.src)
    if (!e.consts.length && !e.enums.length && !e.states.length) continue
    step(declareFields(linker, target, target.find(c.name), e))
    declared.push(...[...e.consts, ...e.enums, ...e.states].map((x) => `${c.name}.${x.name}`))
  }
  const structDefaultsToDo: { cls: string; name: string; block: string }[] = []
  for (const c of classes)
    for (const s of classEdits(linker, target, c.name, c.src).structs) {
      step(declareStruct(linker, target, target.find(c.name), s))
      declared.push(`${c.name}.${s.name}`)
      if (s.defaults?.trim()) structDefaultsToDo.push({ cls: c.name, name: s.name, block: s.defaults })
    }
  for (const c of classes) {
    const e = classEdits(linker, target, c.name, c.src)
    const delegates = e.functions.filter((f) => f.keyword === 'delegate')
    if (!delegates.length) continue
    step(declare(linker, target, target.find(c.name), [], delegates))
    declared.push(...delegates.map((f) => f.path))
  }
  for (const c of classes) {
    const e = classEdits(linker, target, c.name, c.src)
    if (!e.vars.length && !e.functions.length) continue
    step(declare(linker, target, target.find(c.name), e.vars, e.functions))
    declared.push(...e.vars.flatMap((v) => v.names.map((n) => `${c.name}.${n.name}`)), ...e.functions.map((f) => f.path))
  }
  // Structs' defaults, now that every type they name is there.
  for (const d of structDefaultsToDo) {
    const ref = target.find(`${d.cls}.${d.name}`)
    const sh = shared()
    const data = structDefaults(linker, target, target.find(d.cls), ref, d.block, { shared: sh, allow: 'all' })
    step(writePackage(target, { data: new Map([[ref, data]]), names: sh.names.map((name) => ({ name, flags: 0x7001000000000n })) }))
  }
  const compiled: string[] = []
  const objects: string[] = []
  const added = { names: target.names.length - pkg.names.length, imports: target.imports.length - pkg.imports.length, exports: target.exports.length - pkg.exports.length }
  for (const c of classes) {
    const e = classEdits(linker, target, c.name, c.src)
    const own = defaultsBlock(c.src)
    const extra = implicit.get(c.name) ?? []
    const block = extra.length || own !== null ? [...extra, own ?? ''].join('\n') : null
    const classRef = target.find(c.name)
    const r = packageWith(linker, target, e.changes, 'keep', block === null ? undefined : { classRef, block })
    if (!e.changes.length && !r.objects.length) continue
    compiled.push(...e.changes.map((x) => x.path))
    objects.push(...r.objects.map((o) => target.path(o)))
    added.names += r.added.names
    added.imports += r.added.imports
    added.exports += r.added.exports
    step(r.bytes)
  }
  if (layout === 'compact') bytes = writePackage(target, { layout: 'compact' })
  return { bytes, compiled, objects, declared, added }
}
