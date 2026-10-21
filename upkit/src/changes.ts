// A set of edits compiled together: functions' and states' new source, into a
// whole package or a PatchUPK mod script. The compilers share what they add
// (names, imports, new locals), so one change set numbers them once.

import { encodeScript, type Node } from './bytecode.ts'
import { binaryOperators, FunctionCompiler, shared } from './compile.ts'
import { defaultsChanges } from './defaults.ts'
import { withScript } from './edit.ts'
import type { Linker } from './linker.ts'
import { readStructHead } from './objects.ts'
import type { Package } from './package.ts'
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
    data.set(c.ref, withScript(pkg, c.ref, one.code, one.memSize, add.children))
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
