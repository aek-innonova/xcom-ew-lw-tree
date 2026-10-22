// A change as a PatcherGUI / PatchUPK mod script: the mod format players
// already install, and the common case (a function rewritten; the names,
// imports and objects it needs added to the package's tables).
//
// The new script goes into [REPLACEMENT_CODE] as PatchUPK pseudo-code:
// token bytes in hex, object references as <Path>, names as <Name>. PatchUPK
// counts memory from the pseudo-code: a hex byte as one byte, a <reference>
// as eight. Writing references as <…> (not as their four hex bytes) is what
// makes the memory size it stores the engine's.

import { decodeScript, encodeScript, TOKENS, type Label, type NameValue, type Node, type Value } from './bytecode.ts'
import { Reader } from './bytes.ts'
import { readStructHead, readTags, STRUCT_CLASSES, type StructHead } from './objects.ts'
import type { Export, Import, Package } from './package.ts'

const hex = (n: number, bytes: number) => {
  const out: string[] = []
  for (let i = 0; i < bytes; i++) out.push(((n >>> (8 * i)) & 0xff).toString(16).padStart(2, '0').toUpperCase())
  return out.join(' ')
}

/** What a change adds to the package's tables, past their ends, in order. */
export interface Added {
  names?: string[]
  imports?: Import[]
  exports?: Export[]
}

/**
 * What PatchUPK finds for a <Path> and a <Name> in a package: the first import of that
 * full name (its package's name first), else the first export; the first name of that
 * text (both exact, as it compares).
 */
const FOUND = new WeakMap<Package, { objects: Map<string, number>; names: Map<string, number> }>()
function found(pkg: Package) {
  let f = FOUND.get(pkg)
  if (!f) {
    f = { objects: new Map(), names: new Map() }
    for (let i = 1; i <= pkg.imports.length; i++) if (!f.objects.has(pkg.path(-i))) f.objects.set(pkg.path(-i), -i)
    for (let i = 1; i <= pkg.exports.length; i++) if (!f.objects.has(pkg.path(i))) f.objects.set(pkg.path(i), i)
    pkg.names.forEach((n, i) => f!.names.has(n.name) || f!.names.set(n.name, i))
    FOUND.set(pkg, f)
  }
  return f
}

class Emitter {
  out: string[] = []
  pkg: Package
  added: Required<Added>
  /** Object references written as their four bytes (PatchUPK would find another object by the path): it then counts their memory as four, not eight. */
  short = 0
  constructor(pkg: Package, added: Added = {}) {
    this.pkg = pkg
    this.added = { names: added.names ?? [], imports: added.imports ?? [], exports: added.exports ?? [] }
  }
  obj(ref: number) {
    if (ref === 0) return this.out.push('<NullRef>')
    const path = this.path(ref)
    const isAdded = ref < 0 ? -ref > this.pkg.imports.length : ref > this.pkg.exports.length
    if (!isAdded && (/[\s<>]/.test(path) || found(this.pkg).objects.get(path) !== ref)) {
      this.short++
      return this.out.push(hex(ref, 4))
    }
    // PatchUPK reads <Word> without a dot as a name: a top-level object (a
    // package) is written <Class.Name>, which it reads as the object.
    this.out.push(path.includes('.') ? `<${path}>` : `<Class.${path}>`)
  }
  /** An object's path, one the change adds too (PatchUPK finds it by its path once added). */
  path(ref: number): string {
    const extra = ref < 0 ? -ref - this.pkg.imports.length - 1 : ref - this.pkg.exports.length - 1
    if (extra < 0) return this.pkg.path(ref)
    const e = ref < 0 ? this.added.imports[extra]! : this.added.exports[extra]!
    const name = this.nameText(e.objectName)
    return e.outer ? `${this.path(e.outer)}.${name}` : name
  }
  private nameText(n: NameValue) {
    const extra = n.index - this.pkg.names.length
    const base = extra >= 0 ? this.added.names[extra]! : this.pkg.names[n.index]!.name
    return n.number ? `${base}_${n.number - 1}` : base
  }
  /**
   * A name: <Name> where PatchUPK reads it back as this name (Name_N as the name and a
   * number), else its eight bytes (a name is eight bytes of memory either way): a space
   * in it, a name that ends in _ and a digit itself, a second entry of the same text.
   */
  name(n: NameValue) {
    const extra = n.index - this.pkg.names.length
    const base = extra >= 0 ? this.added.names[extra]! : this.pkg.names[n.index]!.name
    const us = base.lastIndexOf('_')
    const readsBack =
      !/[\s<>]/.test(base) && base !== '' && !(n.number === 0 && us >= 0 && /\d/.test(base[us + 1] ?? '')) && (extra >= 0 || found(this.pkg).names.get(base) === n.index)
    this.out.push(readsBack ? `<${this.nameText(n)}>` : `${hex(n.index, 4)} ${hex(n.number, 4)}`)
  }
  /** An import table entry (PatchUPK's ADD_IMPORT_ENTRY: 28 bytes, names and the outer as pseudo-code). */
  importEntry(imp: Import) {
    this.name(imp.classPackage)
    this.name(imp.className)
    this.obj(imp.outer)
    this.name(imp.objectName)
  }
  /**
   * An export table entry (PatchUPK's ADD_EXPORT_ENTRY: 68 bytes, without net
   * objects). PatchUPK puts the object's data at the end of the file (as many
   * bytes as its size says; see modScriptFrom for the link it means to make).
   */
  exportEntry(e: Export, size: number) {
    this.obj(e.classIndex)
    this.obj(e.superIndex)
    this.obj(e.outer)
    this.name(e.objectName)
    this.obj(e.archetype)
    this.out.push(hex(Number(e.objectFlags & 0xffffffffn), 4), hex(Number(e.objectFlags >> 32n), 4))
    this.out.push(hex(size, 4), hex(0, 4), hex(e.exportFlags, 4), hex(0, 4))
    this.out.push(hexBytes(e.packageGuid), hex(e.packageFlags, 4))
  }
  expr(n: Node) {
    if (n.native !== undefined) {
      if (n.op >= 0x70) this.out.push(hex(n.op, 1))
      else this.out.push(hex(0x60 + (n.native >> 8), 1), hex(n.native & 0xff, 1))
      for (const p of n.args[0] as Node[]) this.expr(p)
      this.out.push('16')
      return
    }
    this.out.push(hex(n.op, 1))
    TOKENS[n.op]!.args.forEach((a, i) => this.arg(a, n.args[i]!))
  }
  private arg(a: string, v: Value) {
    switch (a) {
      case 'expr':
        return this.expr(v as Node)
      case 'optexpr':
        if (v) this.expr(v as Node)
        return
      case 'obj':
        return this.obj(v as number)
      case 'name':
        return this.name(v as NameValue)
      case 'u8':
      case 'end':
        return this.out.push(hex(v as number, 1))
      case 'u16':
        return this.out.push(hex(v as number, 2))
      case 'i32':
        return this.out.push(hex(v as number, 4))
      case 'f32': {
        const b = new Uint8Array(new Float32Array([v as number]).buffer)
        return this.out.push([...b].map((x) => hex(x, 1)).join(' '))
      }
      case 'astr': {
        const s = v as string
        return this.out.push([...s, '\0'].map((c) => hex(c.charCodeAt(0), 1)).join(' '))
      }
      case 'ustr': {
        const s = v as string
        return this.out.push([...s, '\0'].map((c) => hex(c.charCodeAt(0), 2)).join(' '))
      }
      case 'params':
        for (const p of v as Node[]) this.expr(p)
        this.out.push('16')
        return
      case 'case': {
        const [next, e] = v as unknown as [number, Node | null]
        this.out.push(hex(next, 2))
        if (e) this.expr(e)
        return
      }
      case 'labels':
        for (const l of v as Label[]) {
          this.name(l.name)
          this.out.push(hex(l.offset, 4))
        }
        return
    }
  }
}

/** A script as PatchUPK pseudo-code, a statement a line (added: names the change adds, past the table's end). */
export function pseudoCode(pkg: Package, statements: Node[], added: Added = {}): string {
  return pseudoCodeOf(pkg, statements, added).text
}
function pseudoCodeOf(pkg: Package, statements: Node[], added: Added = {}): { text: string; short: number } {
  let short = 0
  const text = statements
    .map((s) => {
      const e = new Emitter(pkg, added)
      e.expr(s)
      short += e.short
      return e.out.join(' ')
    })
    .join('\n')
  return { text, short }
}

export interface ModInfo {
  name: string
  author?: string
  description?: string
}

/**
 * A mod script that replaces functions' (or states') code with these statements:
 * PatchUPK's own form for it (the names and imports the code needs added first).
 * (A change compiled from source is written by modScriptFrom, from the whole package.)
 */
export function modScript(
  info: ModInfo,
  changes: {
    upk: string
    pkg: Package
    ref: number
    statements: Node[]
    /** What the changes add to the package's tables (names, imports; all of them, shared). */
    added?: Added
  }[],
): string {
  const added = new Set<string>()
  const addedImports = new Set<number>()
  const lines = [`MOD_NAME=${info.name}`]
  if (info.author) lines.push(`AUTHOR=${info.author}`)
  if (info.description) lines.push(`DESCRIPTION=${info.description}`)
  let upk = ''
  for (const c of changes) {
    if (c.upk !== upk) lines.push('', `UPK_FILE=${(upk = c.upk)}`)
    // Names the code needs that the package lacks: added first (PatchUPK's ADD_NAME_ENTRY),
    // after which <Name> finds them.
    for (const n of c.added?.names ?? []) {
      if (added.has(n)) continue
      added.add(n)
      lines.push('', '[ADD_NAME_ENTRY]', nameEntry(n))
    }
    // Then imports (ADD_IMPORT_ENTRY appends each to the table, at the reference the code has for it).
    for (const [i, imp] of (c.added?.imports ?? []).entries()) {
      if (addedImports.has(i)) continue
      addedImports.add(i)
      const e = new Emitter(c.pkg, c.added)
      e.importEntry(imp)
      lines.push('', '[ADD_IMPORT_ENTRY]', e.out.join(' '))
    }
    const code = pseudoCodeOf(c.pkg, c.statements, c.added)
    lines.push('', `OBJECT=${c.pkg.path(c.ref)}:AUTO`, '[REPLACEMENT_CODE]', code.text)
    // References written as bytes: the memory size PatchUPK stored is short by four for each; set to the engine's.
    if (code.short)
      lines.push('', `OBJECT=${c.pkg.path(c.ref)}`, `REL_OFFSET=${readStructHead(c.pkg, c.ref).scriptAt - 8}`, '[MODDED_HEX]', hexBytes(u32(encodeScript(c.statements).memSize)))
  }
  return lines.join('\n') + '\n'
}

const u32 = (v: number) => new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff])
const hexBytes = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join(' ')

/** Where two versions of an object's data (the same size) differ: runs of bytes (a few unchanged between them join the run). */
function changedRuns(orig: Uint8Array, data: Uint8Array): { at: number; bytes: Uint8Array }[] {
  const runs: { at: number; bytes: Uint8Array }[] = []
  for (let i = 0; i < data.length; ) {
    if (data[i] === orig[i]) {
      i++
      continue
    }
    let j = i
    let last = i
    while (j < data.length && j - last < 8) {
      if (data[j] !== orig[j]) last = j
      j++
    }
    runs.push({ at: i, bytes: data.subarray(i, last + 1) })
    i = last + 1
  }
  return runs
}

/**
 * An object's data changed (default properties): the same size as hex at
 * offsets in it; another size as the part that changed, found and replaced
 * (BEFORE_HEX / AFTER_HEX), the object resized to fit (AUTO).
 */
export function objectEditLines(pkg: Package, ref: number, data: Uint8Array, orig = pkg.data(ref)): string[] {
  const path = pkg.path(ref)
  if (pkg.find(path) !== ref) throw new Error(`${path}: another object has that path, so a mod script cannot name it (--out can)`)
  const lines: string[] = []
  if (data.length === orig.length) {
    const runs = changedRuns(orig, data)
    if (!runs.length) return lines
    lines.push('', `OBJECT=${path}`)
    for (const r of runs) lines.push(`REL_OFFSET=${r.at}`, '[MODDED_HEX]', hexBytes(r.bytes))
    return lines
  }
  let p = 0
  while (p < orig.length && p < data.length && orig[p] === data[p]) p++
  let q = 0
  while (q < orig.length - p && q < data.length - p && orig[orig.length - 1 - q] === data[data.length - 1 - q]) q++
  // What is replaced must be found once in the object: widened backwards until it is.
  const count = (b: Uint8Array) => {
    let n = 0
    for (let i = 0; i + b.length <= orig.length; i++) if (b.every((x, k) => orig[i + k] === x) && ++n > 1) break
    return n
  }
  while (p > 0 && (p === orig.length - q || count(orig.subarray(p, orig.length - q)) !== 1)) p--
  lines.push('', `OBJECT=${path}:AUTO`, '[BEFORE_HEX]', hexBytes(orig.subarray(p, orig.length - q)), '[AFTER_HEX]', hexBytes(data.subarray(p, data.length - q)))
  return lines
}

/**
 * A mod script that makes the original package into another (a whole package
 * upkit wrote from it with the keep layout: the original's tables a prefix of
 * its own). What it adds, added the way PatchUPK adds it; each object that
 * differs then written as the other has it: code as pseudo-code, the rest as
 * hex. PatchUPK means to link each object it adds as its owner's last child,
 * but writes the link at the end of the file instead (it seeks its stream's
 * reading position and writes at the writing one; Long War's PatchUPK.exe
 * too: four bytes more per object). So every link is written here, as the
 * other package has it, and so is each place a PatchUPK that did link would
 * have written to: the script holds with either.
 */
export function modScriptFrom(info: ModInfo, upk: string, orig: Package, out: Package): string {
  const same = (a: unknown, b: unknown) => JSON.stringify(a, (_, v) => (typeof v === 'bigint' ? v.toString() : v)) === JSON.stringify(b, (_, v) => (typeof v === 'bigint' ? v.toString() : v))
  orig.names.forEach((n, i) => {
    if (out.names[i]?.name !== n.name) throw new Error(`name ${i} is ${out.names[i]?.name} there, ${n.name} here: not this package's names and more`)
  })
  orig.imports.forEach((imp, i) => {
    if (!same(imp, out.imports[i])) throw new Error(`import ${orig.path(-(i + 1))} differs there: not this package's imports and more`)
  })
  orig.exports.forEach((e, i) => {
    const { serialOffset: _a, serialSize: _b, ...x } = e
    const { serialOffset: _c, serialSize: _d, ...y } = out.exports[i]!
    if (!same(x, y)) throw new Error(`${orig.path(i + 1)}'s entry differs there: not this package's objects and more`)
  })
  const added: Required<Added> = {
    names: out.names.slice(orig.names.length).map((n) => n.name),
    imports: out.imports.slice(orig.imports.length),
    exports: out.exports.slice(orig.exports.length),
  }
  const lines = [`MOD_NAME=${info.name}`]
  if (info.author) lines.push(`AUTHOR=${info.author}`)
  if (info.description) lines.push(`DESCRIPTION=${info.description}`)
  lines.push('', `UPK_FILE=${upk}`)
  for (const n of added.names) lines.push('', '[ADD_NAME_ENTRY]', nameEntry(n))
  for (const imp of added.imports) {
    const e = new Emitter(orig, added)
    e.importEntry(imp)
    lines.push('', '[ADD_IMPORT_ENTRY]', e.out.join(' '))
  }
  // Where a PatchUPK that links would write: followed on the objects as they would then be.
  const linked = new Map<number, Uint8Array>()
  const dataOf = (ref: number) => linked.get(ref) ?? orig.data(ref)
  const i32 = (d: Uint8Array, at: number) => new DataView(d.buffer, d.byteOffset).getInt32(at, true)
  const forced: { ref: number; at: number }[] = []
  const setI32 = (ref: number, at: number, v: number) => {
    const d = linked.get(ref) ?? orig.data(ref).slice()
    new DataView(d.buffer, d.byteOffset).setInt32(at, v, true)
    linked.set(ref, d)
    if (ref <= orig.exports.length) forced.push({ ref, at })
  }
  // Where a field's next is, and a struct's first child (a class object has no tagged properties).
  const nextAt = (ref: number) => {
    if (out.className(ref) === 'Class') return 4
    const r = new Reader(dataOf(ref))
    r.i32()
    readTags(r, out)
    return r.o
  }
  const link = (owner: number, child: number) => {
    if (owner < 1 || !STRUCT_CLASSES.has(out.className(owner))) return
    const firstAt = nextAt(owner) + 12
    let c = i32(dataOf(owner), firstAt)
    if (!c) return setI32(owner, firstAt, child)
    const seen = new Set<number>()
    let last = c
    for (; c; c = i32(dataOf(c), nextAt(c))) {
      if (seen.has(c)) throw new Error(`${out.path(owner)}: its children go round`)
      seen.add(c)
      last = c
    }
    setI32(last, nextAt(last), child)
  }
  const none = out.findName('None')
  added.exports.forEach((x, k) => {
    const ref = orig.exports.length + k + 1
    const size = out.data(ref).length
    if (x.netObjects.length || size < 16) throw new Error(`${out.path(ref)}: an object PatchUPK cannot add (net objects, or under 16 bytes)`)
    const e = new Emitter(orig, added)
    e.exportEntry(x, size)
    lines.push('', '[ADD_EXPORT_ENTRY]', e.out.join(' '))
    // What PatchUPK puts there: the index before it, None, zeros; then (it means to) link it.
    const ph = new Uint8Array(size)
    new DataView(ph.buffer).setInt32(0, ref - 1, true)
    new DataView(ph.buffer).setInt32(4, none, true)
    linked.set(ref, ph)
    link(x.outer, ref)
  })
  // Each new object's data, over what PatchUPK put there.
  added.exports.forEach((_, k) => {
    const ref = orig.exports.length + k + 1
    lines.push('', `OBJECT=${new Emitter(orig, added).path(ref)}`, 'REL_OFFSET=0', '[MODDED_HEX]', hexBytes(out.data(ref)))
  })
  const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i])
  for (let i = 1; i <= orig.exports.length; i++) {
    const want = out.data(i)
    let have = orig.data(i)
    if (equal(want, have)) continue
    const cls = orig.className(i)
    if (cls === 'Function' || cls === 'State') {
      const ho = readStructHead(orig, i)
      const hw = readStructHead(out, i)
      const code = want.subarray(hw.scriptAt, hw.end)
      if (!equal(have.subarray(ho.scriptAt, ho.end), code)) {
        const pc = pseudoCodeOf(orig, decodeScript(code, (n) => n.index === none).statements, added)
        lines.push('', `OBJECT=${orig.path(i)}:AUTO`, '[REPLACEMENT_CODE]', pc.text)
        // What PatchUPK makes of it: the code replaced, its memory size as PatchUPK counts it.
        have = replacedScript(have, ho, code, hw.memSize - 4 * pc.short)
      }
    }
    lines.push(...objectEditLines(orig, i, want, have))
  }
  // Where a linking PatchUPK would have written: as the other package has it. (Each place is
  // in an object's head, before any code: where it is does not move as code is replaced.)
  const done = new Set<string>()
  for (const { ref, at } of forced) {
    if (done.has(`${ref}:${at}`)) continue
    done.add(`${ref}:${at}`)
    if (orig.find(orig.path(ref)) !== ref) throw new Error(`${orig.path(ref)}: another object has that path, so a mod script cannot name it (--out can)`)
    lines.push('', `OBJECT=${orig.path(ref)}`, `REL_OFFSET=${at}`, '[MODDED_HEX]', hexBytes(out.data(ref).subarray(at, at + 4)))
  }
  return lines.join('\n') + '\n'
}

/** An object's data with its script replaced (the sizes before it set). */
function replacedScript(data: Uint8Array, h: StructHead, code: Uint8Array, memSize: number): Uint8Array {
  const out = new Uint8Array(data.length - h.size + code.length)
  out.set(data.subarray(0, h.scriptAt))
  const v = new DataView(out.buffer)
  v.setInt32(h.scriptAt - 8, memSize, true)
  v.setInt32(h.scriptAt - 4, code.length, true)
  out.set(code, h.scriptAt)
  out.set(data.subarray(h.end), h.scriptAt + code.length)
  return out
}

/** A name table entry in pseudo-code: its length, its text, its flags (as the game's names have). */
function nameEntry(name: string): string {
  return `<%i ${name.length + 1}> <%t "${name}"> <%u 0x00000000> <%u 0x00070010>`
}
