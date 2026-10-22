// A set of edits compiled together: functions' and states' new source, into a
// whole package or a PatchUPK mod script. The compilers share what they add
// (names, imports, new locals), so one change set numbers them once.

import { encodeScript, type Node } from './bytecode.ts'
import { binaryOperators, FunctionCompiler, shared, type Shared } from './compile.ts'
import { classEdits } from './classsrc.ts'
import { declare, declareClass, declareFields, declareReplication, declareStruct, declareSubobjects, parseClassHeader, subobjectsOf } from './declare.ts'
import { defaultsBlock, defaultsChanges, structDefaults } from './defaults.ts'
import { withScript } from './edit.ts'
import type { Linker } from './linker.ts'
import { Reader } from './bytes.ts'
import { readStructHead, readTags } from './objects.ts'
import { openPackage, type Package } from './package.ts'
import { lineAt } from './parse.ts'
import { modScriptFrom } from './patch.ts'
import { writePackage } from './writer.ts'

export interface Change {
  /** The function or state. */
  ref: number
  /** Its new source: a function's declaration and body, or a state's code. */
  text: string
  /** The line its source starts on in the file it came from (for errors; 1 if it is the file). */
  line?: number
}

/** A class's defaultproperties, as its source has them (and its structs' edited defaults). */
export interface DefaultsSource {
  classRef: number
  block: string | null
  structs?: { ref: number; block: string }[]
}

/** What the defaults change: the default object, its components, the structs' defaults. */
function defaultsEdits(linker: Linker, pkg: Package, d: DefaultsSource, names: { shared: Shared; allow: 'none' | 'names' | 'all' }) {
  const edits = d.block === null ? [] : defaultsChanges(linker, pkg, d.classRef, d.block, names)
  for (const s of d.structs ?? []) {
    const data = structDefaults(linker, pkg, d.classRef, s.ref, s.block, names)
    const old = pkg.data(s.ref)
    if (data.length !== old.length || data.some((b, i) => b !== old[i])) edits.push({ ref: s.ref, data })
  }
  return edits
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
    const w = written(fc, pkg, one)
    data.set(c.ref, w.data)
    for (const [ref, d] of w.edits) data.set(ref, d)
    exports.push(...w.exports)
    sh.exports += w.exports.length
  }
  const objects: number[] = []
  if (defaults)
    for (const e of defaultsEdits(linker, pkg, defaults, { shared: sh, allow: 'all' })) {
      data.set(e.ref, e.data)
      objects.push(e.ref)
    }
  const names = sh.names.map((name) => ({ name, flags: 0x7001000000000n }))
  const bytes = writePackage(pkg, { data, names, imports: sh.imports, exports, layout })
  return { bytes, compiled, objects, added: { names: names.length, imports: sh.imports.length, exports: exports.length } }
}

/**
 * The changes as a PatchUPK mod script: the one that makes the package into
 * what packageWith makes of it (what the code needs added, names, imports,
 * new locals, added the way PatchUPK adds it).
 */
export function modScriptWith(
  linker: Linker,
  pkg: Package,
  upk: string,
  changes: Change[],
  info: { name: string; author?: string; description?: string },
  defaults?: DefaultsSource,
): { text: string; compiled: Compiled[]; objects: number[]; names: string[]; imports: string[] } {
  const r = packageWith(linker, pkg, changes, 'keep', defaults)
  const out = openPackage(r.bytes)
  return {
    text: modScriptFrom(info, upk, pkg, out),
    compiled: r.compiled,
    objects: r.objects,
    names: out.names.slice(pkg.names.length).map((n) => n.name),
    imports: out.imports.slice(pkg.imports.length).map((_, i) => out.path(-(pkg.imports.length + i + 1))),
  }
}

/** A property's data with its flags set (after its index, its tags, its next and its array size). */
function withFlags(pkg: Package, ref: number, flags: bigint): Uint8Array {
  const d = pkg.data(ref).slice()
  const r = new Reader(d)
  r.i32()
  readTags(r, pkg)
  new DataView(d.buffer, d.byteOffset).setBigUint64(r.o + 8, flags, true)
  return d
}

/**
 * A compiled function's (or state's) object as it is to be, and what else the
 * package gets for it: its new locals (objects), and the last child before them
 * linked to the first.
 */
function written(fc: FunctionCompiler, pkg: Package, one: Compiled) {
  if (one.labelTableOffset !== undefined)
    return { data: withScript(pkg, one.ref, one.code, one.memSize, undefined, one.labelTableOffset), exports: [], edits: new Map<number, Uint8Array>() }
  const add = fc.additions()
  const data = withScript(pkg, one.ref, one.code, one.memSize, add.children)
  // New locals: whether the function now copies struct defaults into them (its flag after the script).
  if (add.exports.length) {
    const at = readStructHead(pkg, one.ref).scriptAt + one.code.length + 3
    const v = new DataView(data.buffer, data.byteOffset)
    const flags = v.getUint32(at, true)
    v.setUint32(at, (fc.localsNeedDefaults() ? flags | 0x800000 : flags & ~0x800000) >>> 0, true)
  }
  return { data, exports: add.exports, edits: add.edits }
}

function compileOne(fc: FunctionCompiler, pkg: Package, c: Change, ops: Record<string, number>): Compiled {
  try {
    return compileOne1(fc, pkg, c, ops)
  } catch (e) {
    // Said with where: the function (or state) and the line in the file.
    const pos = (e as { pos?: number }).pos
    const line = pos === undefined ? null : (c.line ?? 1) + lineAt(c.text, pos) - 1
    const err = new Error(`${pkg.path(c.ref)}${line ? `, line ${line}` : ''}: ${(e as Error).message}`)
    throw err
  }
}
function compileOne1(fc: FunctionCompiler, pkg: Package, c: Change, ops: Record<string, number>): Compiled {
  if (pkg.className(c.ref) === 'State') {
    const r = fc.compileStateCode(c.text, ops)
    const { code, memSize } = encodeScript(r.statements)
    return { ref: c.ref, statements: r.statements, code, memSize, labelTableOffset: r.labelTableOffset }
  }
  const statements = fc.compileStatements(c.text, ops)
  const { code, memSize } = encodeScript(statements)
  return { ref: c.ref, statements, code, memSize }
}


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
): { bytes: Uint8Array; compiled: string[]; objects: string[]; declared: string[]; modified: string[]; added: { names: number; imports: number; exports: number } } {
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
  // (Classes just declared: their replication, among other things, comes from their source.)
  const newClasses = new Set(declared.map((d) => d.toLowerCase()))
  // Components their defaults declare that their default objects do not have.
  for (const c of classes) {
    const block = defaultsBlock(c.src)
    const subs = block ? subobjectsOf(block) : []
    if (!subs.length) continue
    const b = declareSubobjects(linker, target, target.find(c.name), subs)
    if (b !== target.bytes) step(b)
  }
  // Then, for all the classes (each step can name what the one before declared):
  // constants, enums and states; structs; delegates; variables and functions.
  for (const c of classes) {
    const e = classEdits(linker, target, c.name, c.src, newClasses)
    if (!e.consts.length && !e.enums.length && !e.states.length) continue
    step(declareFields(linker, target, target.find(c.name), e))
    declared.push(...[...e.consts, ...e.enums, ...e.states].map((x) => `${c.name}.${x.name}`))
  }
  // Structs, each once the types its members name are there (a struct can use one declared later).
  const structDefaultsToDo: { cls: string; name: string; block: string }[] = []
  let structs = classes.flatMap((c) => classEdits(linker, target, c.name, c.src, newClasses).structs.map((s) => ({ c, s })))
  while (structs.length) {
    const left: typeof structs = []
    let lastError: unknown = null
    for (const { c, s } of structs) {
      try {
        step(declareStruct(linker, target, target.find(c.name), s))
      } catch (e) {
        if (!(e as Error).message.startsWith('no type ')) throw e
        left.push({ c, s })
        lastError = e
        continue
      }
      declared.push(`${c.name}.${s.name}`)
      if (s.defaults?.trim()) structDefaultsToDo.push({ cls: c.name, name: s.name, block: s.defaults })
    }
    if (left.length === structs.length) throw lastError
    structs = left
  }
  for (const c of classes) {
    const e = classEdits(linker, target, c.name, c.src, newClasses)
    const delegates = e.functions.filter((f) => f.keyword === 'delegate')
    if (!delegates.length) continue
    step(declare(linker, target, target.find(c.name), [], delegates))
    declared.push(...delegates.map((f) => f.path))
  }
  for (const c of classes) {
    const e = classEdits(linker, target, c.name, c.src, newClasses)
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
  // Variables whose modifiers changed: their flags.
  const modified: string[] = []
  for (const c of classes) {
    const e = classEdits(linker, target, c.name, c.src, newClasses)
    if (!e.varFlags.length) continue
    step(writePackage(target, { data: new Map(e.varFlags.map((x) => [x.ref, withFlags(target, x.ref, x.flags)])) }))
    modified.push(...e.varFlags.map((x) => x.path))
  }
  const compiled: string[] = []
  const objects: string[] = []
  const added = { names: target.names.length - pkg.names.length, imports: target.imports.length - pkg.imports.length, exports: target.exports.length - pkg.exports.length }
  const fresh = new Set(declared.map((d) => d.toLowerCase()))
  for (const c of classes) {
    const e = classEdits(linker, target, c.name, c.src, fresh)
    const own = defaultsBlock(c.src)
    const extra = implicit.get(c.name) ?? []
    const block = extra.length || own !== null ? [...extra, own ?? ''].join('\n') : null
    const classRef = target.find(c.name)
    const structs = e.structDefaults.map((x) => ({ ref: x.ref, block: x.block }))
    const r = packageWith(linker, target, e.changes, 'keep', block === null && !structs.length ? undefined : { classRef, block, structs })
    if (!e.changes.length && !r.objects.length && !e.replication) continue
    compiled.push(...e.changes.map((x) => x.path))
    objects.push(...r.objects.map((o) => target.path(o)))
    added.names += r.added.names
    added.imports += r.added.imports
    added.exports += r.added.exports
    step(r.bytes)
    // A new class's replication, once its variables are there.
    if (e.replication) {
      step(declareReplication(linker, target, target.find(c.name), e.replication))
      compiled.push(`${c.name} (replication)`)
    }
  }
  if (layout === 'compact') bytes = writePackage(target, { layout: 'compact' })
  return { bytes, compiled, objects, declared, modified, added }
}
