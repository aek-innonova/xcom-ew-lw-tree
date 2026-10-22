// Unreal Engine 3 packages (.upk) in the browser: the summary, the name,
// import and export tables, objects' data, and the few edits a mod makes
// (features/game-tools.md). Enemy Within's packages are version 845; the
// layout is the same one scripts/upk.py reads.
//
// Full object names follow PatcherGUI's convention, since mods name objects
// that way: an export's outer chain without the package ("XGUnit.RecordKill"),
// an import's with its package ("Core.Object.Name"); a name used more than
// once carries "_N" (N = number − 1).

import { lzoDecompress, unchunk } from './lzo.ts'

export interface UpkImport {
  className: string
  name: string
  outer: number
  fullName: string
  /** Where its entry in the import table is (28 bytes). */
  entryOffset: number
}
export interface UpkExport {
  classIndex: number
  superIndex: number
  outer: number
  name: string
  fullName: string
  /** The class's name ("Function", "State", "Class" for a class). */
  type: string
  /** Where the object's data is in the file, and how long it is. */
  size: number
  offset: number
  /** Where its entry in the export table is, and how long the entry is. */
  entryOffset: number
  entrySize: number
}
export interface UpkName {
  name: string
  /** Where its entry is, and how long the entry is. */
  offset: number
  size: number
}
export interface Upk {
  version: number
  licensee: number
  /** Bytes up to the first object's data: the summary and the tables. */
  headerSize: number
  compressed: boolean
  names: string[]
  imports: UpkImport[]
  exports: UpkExport[]
}

const TAG = 0x9e2a83c1

/** Appended after an object PatcherGUI moves (with the old size and offset); kept so its undo works on ours. */
export const PATCHUPK_MARK = new Uint8Array([
  0x7a, 0xa0, 0x56, 0xc9, 0x60, 0x5f, 0x7b, 0x31, 0x72, 0x5d, 0x4b, 0xc4, 0x7c, 0xd2, 0x4d, 0xd9,
])

class Reader {
  o: number
  private b: Uint8Array
  private v: DataView
  constructor(b: Uint8Array, o = 0) {
    this.b = b
    this.v = new DataView(b.buffer, b.byteOffset, b.byteLength)
    this.o = o
  }
  i32() {
    const x = this.v.getInt32(this.o, true)
    this.o += 4
    return x
  }
  u32() {
    const x = this.v.getUint32(this.o, true)
    this.o += 4
    return x
  }
  i16() {
    const x = this.v.getInt16(this.o, true)
    this.o += 2
    return x
  }
  fstr(): string {
    const n = this.i32()
    if (n === 0) return ''
    if (n < 0) {
      const s = new TextDecoder('utf-16le').decode(this.b.subarray(this.o, this.o - 2 * n))
      this.o -= 2 * n
      return s.replace(/\0+$/, '')
    }
    const s = new TextDecoder('latin1').decode(this.b.subarray(this.o, this.o + n))
    this.o += n
    return s.replace(/\0+$/, '')
  }
}

/** The summary's header size, from the first bytes of the file (64 are enough). */
export function headerSizeOf(head: Uint8Array): number {
  const r = new Reader(head)
  if (r.u32() !== TAG) throw new Error('not an Unreal package')
  r.i16()
  r.i16()
  return r.i32()
}

/** Where the summary's fields are, for the edits that move the tables. */
interface SummaryAt {
  headerSize: number
  nameCount: number
  nameOffset: number
  exportCount: number
  exportOffset: number
  importCount: number
  importOffset: number
  dependsOffset: number
  /** PatcherGUI's "SerialOffset" (UE3's ImportExportGuidsOffset): where object data begins, or 0. */
  serialOffset: number
  guid: number
  /** The generations' count; the last generation's net object count is 12 bytes in from its start. */
  generations: number
}

/**
 * A package's tables, and with the whole file its objects' data. Edits work
 * on the bytes in place (or grow them) and read the tables again.
 */
export class Package implements Upk {
  bytes: Uint8Array
  version = 0
  licensee = 0
  headerSize = 0
  compressed = false
  names: string[] = []
  nameEntries: UpkName[] = []
  imports: UpkImport[] = []
  exports: UpkExport[] = []
  private at!: SummaryAt
  private importByName = new Map<string, number>()
  private exportByName = new Map<string, number>()
  private nameIndex = new Map<string, number>()
  // parse() makes new maps rather than clearing these, so clones may share them.

  constructor(bytes: Uint8Array) {
    this.bytes = bytes
    this.parse()
  }

  private parse() {
    const b = this.bytes
    const r = new Reader(b)
    if (r.u32() !== TAG) throw new Error('not an Unreal package')
    this.version = r.i16()
    this.licensee = r.i16()
    const at = { headerSize: r.o } as SummaryAt
    this.headerSize = r.i32()
    r.fstr() // folder name
    r.u32() // package flags
    at.nameCount = r.o
    const nc = r.i32()
    at.nameOffset = r.o
    const no = r.i32()
    at.exportCount = r.o
    const ec = r.i32()
    at.exportOffset = r.o
    const eo = r.i32()
    at.importCount = r.o
    const ic = r.i32()
    at.importOffset = r.o
    const io = r.i32()
    at.dependsOffset = r.o
    r.i32()
    at.serialOffset = 0
    if (this.version >= 623) {
      at.serialOffset = r.o
      r.o += 16
    }
    this.at = at
    at.guid = r.o
    r.o += 16
    at.generations = r.o
    const generations = r.i32()
    r.o += 12 * generations
    r.i32() // engine version
    r.i32() // cooker version
    const compression = r.i32()
    const chunks = r.i32()
    this.compressed = compression !== 0 || chunks !== 0
    this.names = []
    this.nameEntries = []
    this.imports = []
    this.exports = []
    this.importByName = new Map()
    this.exportByName = new Map()
    this.nameIndex = new Map()
    if (this.compressed) return

    r.o = no
    for (let i = 0; i < nc; i++) {
      const offset = r.o
      const name = r.fstr()
      r.o += 8 // flags
      this.names.push(name)
      this.nameEntries.push({ name, offset, size: r.o - offset })
      if (!this.nameIndex.has(name)) this.nameIndex.set(name, i)
    }
    const nm = (i: number, num: number) =>
      (this.names[i] ?? `?${i}`) + (num && this.names[i] !== 'None' ? `_${num - 1}` : '')
    r.o = io
    for (let i = 0; i < ic; i++) {
      const entryOffset = r.o
      r.o += 8 // class package
      const cls = r.i32()
      r.i32()
      const outer = r.i32()
      const name = r.i32()
      const num = r.i32()
      this.imports.push({
        className: this.names[cls] ?? '',
        name: nm(name, num),
        outer,
        fullName: '',
        entryOffset,
      })
    }
    r.o = eo
    for (let i = 0; i < ec; i++) {
      const entryOffset = r.o
      const classIndex = r.i32()
      const superIndex = r.i32()
      const outer = r.i32()
      const name = r.i32()
      const num = r.i32()
      r.i32() // archetype
      r.o += 8 // object flags
      const size = r.i32()
      const offset = r.i32()
      r.u32() // export flags
      const ngen = r.i32()
      r.o += 4 * ngen + 16 + 4 // generation net object counts, package guid, package flags
      this.exports.push({
        classIndex,
        superIndex,
        outer,
        name: nm(name, num),
        fullName: '',
        type: '',
        size,
        offset,
        entryOffset,
        entrySize: r.o - entryOffset,
      })
    }
    this.imports.forEach((e, i) => {
      e.fullName = this.fullNameOf(-(i + 1))
      if (!this.importByName.has(e.fullName)) this.importByName.set(e.fullName, -(i + 1))
    })
    this.exports.forEach((e, i) => {
      e.fullName = this.fullNameOf(i + 1)
      e.type = this.nameOf(e.classIndex) || 'Class'
      if (!this.exportByName.has(e.fullName)) this.exportByName.set(e.fullName, i + 1)
    })
  }

  /**
   * A copy to change: its own bytes, the tables shared until an edit reads
   * them again (parsing never alters the old ones).
   */
  clone(): Package {
    const c = Object.create(Package.prototype) as Package
    Object.assign(c, this)
    c.bytes = this.bytes.slice()
    return c
  }

  /** An object reference's own name: > 0 an export (index + 1), < 0 an import. */
  nameOf(ref: number): string {
    if (ref > 0) return this.exports[ref - 1]?.name ?? ''
    if (ref < 0) return this.imports[-ref - 1]?.name ?? ''
    return ''
  }
  private outerOf(ref: number): number {
    if (ref > 0) return this.exports[ref - 1]?.outer ?? 0
    if (ref < 0) return this.imports[-ref - 1]?.outer ?? 0
    return 0
  }
  fullNameOf(ref: number): string {
    let name = this.nameOf(ref)
    for (let next = this.outerOf(ref), guard = 0; next !== 0 && guard < 64; guard++) {
      name = `${this.nameOf(next)}.${name}`
      next = this.outerOf(next)
    }
    return name
  }

  /** An object by full name: imports first unless only exports are wanted; 0 if none. */
  findObject(fullName: string, exportsOnly = false): number {
    if (!exportsOnly) {
      const i = this.importByName.get(fullName)
      if (i !== undefined) return i
    }
    return this.exportByName.get(fullName) ?? 0
  }

  /** A name's index in the name table, or −1. */
  findName(name: string): number {
    return this.nameIndex.get(name) ?? -1
  }

  /** An export's data (ref > 0). */
  exportData(ref: number): Uint8Array {
    const e = this.exports[ref - 1]!
    return this.bytes.subarray(e.offset, e.offset + e.size)
  }

  /**
   * Where a function's or state's script is inside its data: after the
   * object's (empty) property list and the UField/UStruct fields, the memory
   * size, the serial size, then the bytes. Null for objects without one.
   */
  scriptOf(ref: number): { relOffset: number; memSize: number; size: number } | null {
    const e = this.exports[ref - 1]
    if (!e || !['Function', 'State'].includes(e.type)) return null
    const d = this.exportData(ref)
    const v = new DataView(d.buffer, d.byteOffset, d.byteLength)
    // NetIndex, then the property list; functions and states carry none ("None").
    if (this.names[v.getInt32(4, true)] !== 'None') return null
    const memSize = v.getInt32(40, true)
    const size = v.getInt32(44, true)
    if (48 + size > d.length) return null
    return { relOffset: 48, memSize, size }
  }

  /** Overwrites bytes at an absolute offset. */
  write(offset: number, data: Uint8Array) {
    if (offset < 8 || offset + data.length > this.bytes.length)
      throw new Error('write outside the package')
    this.bytes.set(data, offset)
  }

  private setI32(offset: number, value: number) {
    new DataView(this.bytes.buffer, this.bytes.byteOffset).setInt32(offset, value, true)
  }
  private getI32(offset: number) {
    return new DataView(this.bytes.buffer, this.bytes.byteOffset).getInt32(offset, true)
  }

  /**
   * Moves an export's data to the end of the file at a new size, growing or
   * shrinking it at `at` (zeros where it grows), as PatcherGUI does: the old
   * data stays where it was, the export entry points at the copy, and the
   * mark, old size and old offset follow the copy.
   */
  moveResize(ref: number, newSize: number, at: number) {
    const e = this.exports[ref - 1]!
    const old = this.exportData(ref).slice()
    let data = old
    if (newSize !== old.length) {
      data = new Uint8Array(newSize)
      if (at > 0 && at < newSize) {
        const diff = newSize - old.length
        data.set(old.subarray(0, at))
        if (diff > 0) data.set(old.subarray(at), at + diff)
        else data.set(old.subarray(at - diff), at)
      } else data.set(old.subarray(0, Math.min(old.length, newSize)))
    }
    const offset = this.bytes.length
    const grown = new Uint8Array(offset + data.length + 24)
    grown.set(this.bytes)
    grown.set(data, offset)
    grown.set(PATCHUPK_MARK, offset + data.length)
    const tail = new DataView(grown.buffer, offset + data.length + 16, 8)
    tail.setInt32(0, e.size, true)
    tail.setInt32(4, e.offset, true)
    this.bytes = grown
    if (data.length !== e.size) this.setI32(e.entryOffset + 32, data.length)
    this.setI32(e.entryOffset + 36, offset)
    this.parse()
  }

  /**
   * Inserts bytes into the header (the summary and tables) at `insertAt`:
   * the header size, the given table offsets and every object's data offset
   * follow, as PatcherGUI's additions do. (It takes a missing SerialOffset as
   * the header size and writes it back.)
   */
  private insertInHeader(insertAt: number, data: Uint8Array, moved: (keyof SummaryAt)[]) {
    const at = this.at
    const n = data.length
    const grown = new Uint8Array(this.bytes.length + n)
    grown.set(this.bytes.subarray(0, insertAt))
    grown.set(data, insertAt)
    grown.set(this.bytes.subarray(insertAt), insertAt + n)
    const exportOffsets = this.exports.map((e) => e.entryOffset)
    const serial = at.serialOffset ? this.getI32(at.serialOffset) : 0
    this.bytes = grown
    const add = (field: number, by: number) => this.setI32(field, this.getI32(field) + by)
    add(at.headerSize, n)
    for (const f of moved) add(at[f], n)
    if (at.serialOffset) this.setI32(at.serialOffset, (serial || this.headerSize) + n)
    for (const entryOffset of exportOffsets)
      add(entryOffset + (entryOffset >= insertAt ? n : 0) + 36, n)
  }

  /**
   * Adds a name at the end of the name table: everything after it moves down
   * by the entry's size, and the summary and every export's offset follow
   * (as PatcherGUI's ADD_NAME_ENTRY does).
   */
  addName(entry: Uint8Array) {
    const last = this.nameEntries[this.nameEntries.length - 1]
    const insertAt = last ? last.offset + last.size : this.getI32(this.at.nameOffset)
    this.insertInHeader(insertAt, entry, ['importOffset', 'exportOffset', 'dependsOffset'])
    this.setI32(this.at.nameCount, this.getI32(this.at.nameCount) + 1)
    this.parse()
  }

  /** Adds an import (its 28-byte entry) at the end of the import table, as ADD_IMPORT_ENTRY does. */
  addImport(entry: Uint8Array) {
    if (entry.length !== 28) throw new Error(`an import entry is 28 bytes, not ${entry.length}`)
    const insertAt = this.getI32(this.at.importOffset) + 28 * this.imports.length
    this.insertInHeader(insertAt, entry, ['exportOffset', 'dependsOffset'])
    this.setI32(this.at.importCount, this.getI32(this.at.importCount) + 1)
    this.parse()
  }

  /**
   * Adds an export (its entry, with no net objects: 68 bytes) at the end of
   * the export table, its data at the end of the file, as ADD_EXPORT_ENTRY
   * does: as long as the entry's serial size says (at least 16 bytes), its
   * net index (its own index, as the game's cooked packages have it), None
   * for its properties, then zeros. Then what PatchUPK means to do and does
   * not: links it as its owner's last child (when the owner is a class,
   * state, function or struct) and counts it among the net objects (the game
   * logs it as invalid otherwise). And what the format has: an empty entry
   * for it in the depends table. Returns its reference.
   */
  addExport(entry: Uint8Array): number {
    const entryView = new DataView(entry.buffer, entry.byteOffset, entry.byteLength)
    if (entry.length !== 68 || entryView.getInt32(44, true) !== 0)
      throw new Error('an export entry is 68 bytes, without net objects')
    const size = entryView.getInt32(32, true)
    if (size < 16) throw new Error(`an added object takes at least 16 bytes, not ${size}`)
    const last = this.exports[this.exports.length - 1]
    const insertAt = last ? last.entryOffset + last.entrySize : this.getI32(this.at.exportOffset)
    this.insertInHeader(insertAt, entry, ['dependsOffset'])
    this.setI32(this.at.exportCount, this.getI32(this.at.exportCount) + 1)
    const dependsEnd = this.at.serialOffset ? this.getI32(this.at.serialOffset) : this.getI32(this.at.headerSize)
    this.insertInHeader(dependsEnd, new Uint8Array(4), [])
    this.parse()
    const ref = this.exports.length
    const e = this.exports[ref - 1]!
    const data = new Uint8Array(size)
    const dv = new DataView(data.buffer)
    dv.setInt32(0, ref - 1, true)
    dv.setInt32(4, this.findName('None'), true)
    const offset = this.bytes.length
    const grown = new Uint8Array(offset + size)
    grown.set(this.bytes)
    grown.set(data, offset)
    this.bytes = grown
    this.setI32(e.entryOffset + 36, offset)
    const gens = this.getI32(this.at.generations)
    if (gens > 0) {
      const net = this.at.generations + 4 + 12 * (gens - 1) + 8
      this.setI32(net, Math.max(this.getI32(net), this.exports.length))
    }
    this.parse()
    this.linkChild(e.outer, ref)
    return ref
  }

  /** Where an object's UField fields begin: after its net index and (empty) properties; a class object has none. */
  private fieldsAt(ref: number): number {
    const e = this.exports[ref - 1]!
    if (e.type === 'Class') return 4
    if (this.names[this.getI32(e.offset + 4)] !== 'None')
      throw new Error(`${e.fullName} has properties of its own: its fields cannot be found`)
    return 12
  }

  /** Makes `child` its owner's last child: the owner's first, or the next of the one now last. */
  private linkChild(owner: number, child: number) {
    if (owner < 1 || !['Class', 'State', 'Function', 'ScriptStruct'].includes(this.exports[owner - 1]!.type)) return
    const o = this.exports[owner - 1]!
    const childrenAt = o.offset + this.fieldsAt(owner) + 12
    let c = this.getI32(childrenAt)
    if (!c) return this.setI32(childrenAt, child)
    const seen = new Set<number>()
    for (;;) {
      if (seen.has(c) || c < 1 || c > this.exports.length) throw new Error(`${o.fullName}: its children cannot be followed`)
      seen.add(c)
      const nextAt = this.exports[c - 1]!.offset + this.fieldsAt(c)
      const next = this.getI32(nextAt)
      if (!next) return this.setI32(nextAt, child)
      c = next
    }
  }

  /**
   * Resizes an export's data where it is (PatchUPK's INPL): grown or shrunk
   * at `at`, everything after it in the file moved, and the offsets of the
   * objects after it with it.
   */
  resizeInPlace(ref: number, newSize: number, at: number) {
    const e = this.exports[ref - 1]!
    const diff = newSize - e.size
    if (!diff) return
    const pos = e.offset + Math.max(0, Math.min(at, e.size))
    const b = this.bytes
    const out = new Uint8Array(b.length + diff)
    if (diff > 0) {
      out.set(b.subarray(0, pos))
      out.set(b.subarray(pos), pos + diff)
    } else {
      out.set(b.subarray(0, pos))
      out.set(b.subarray(pos - diff), pos)
    }
    const after = this.exports.filter((x) => x.offset > e.offset).map((x) => x.entryOffset)
    this.bytes = out
    this.setI32(e.entryOffset + 32, newSize)
    for (const entryOffset of after) this.setI32(entryOffset + 36, this.getI32(entryOffset + 36) + diff)
    this.parse()
  }

  /** Whether the export's data was moved by PatcherGUI (or by us): the mark after it, with the old size and offset. */
  movedFrom(ref: number): { size: number; offset: number } | null {
    const e = this.exports[ref - 1]!
    const at = e.offset + e.size
    if (at + 24 > this.bytes.length) return null
    for (let i = 0; i < 16; i++) if (this.bytes[at + i] !== PATCHUPK_MARK[i]) return null
    return { size: this.getI32(at + 16), offset: this.getI32(at + 20) }
  }

  /** Points the export back at its data before a move (PatchUPK's EXPAND_UNDO); the moved copy stays. */
  undoMove(ref: number): boolean {
    const old = this.movedFrom(ref)
    if (!old) return false
    const e = this.exports[ref - 1]!
    this.setI32(e.entryOffset + 32, old.size)
    this.setI32(e.entryOffset + 36, old.offset)
    this.parse()
    return true
  }

  /** Renames a name in place (the new one as long as the old one). */
  rename(index: number, name: string) {
    const entry = this.nameEntries[index]!
    const n = this.getI32(entry.offset)
    if (n !== name.length + 1) throw new Error(`${entry.name} can only be renamed to a name of ${n - 1} characters`)
    for (let i = 0; i < name.length; i++) this.bytes[entry.offset + 4 + i] = name.charCodeAt(i) & 0xff
    this.parse()
  }

  /** The package's GUID as PatchUPK writes it: four 32-bit words in hex. */
  guid(): string {
    let s = ''
    for (let i = 0; i < 4; i++) s += (this.getI32(this.at.guid + 4 * i) >>> 0).toString(16).toUpperCase().padStart(8, '0')
    return s
  }
}

/** Reads a package's tables from its first `headerSize` bytes (or the whole file). */
export function readUpk(b: Uint8Array): Upk {
  return new Package(b)
}

/** An export's full name as PatchUPK writes it: "XGUnit.RecordKill", "XGBattle.Loading.NotifyKismetOfLoad". */
export function exportPath(pk: Upk, index: number): string {
  return pk.exports[index]!.fullName
}

/** Every export by its full name. */
export function exportsByPath(pk: Upk): Map<string, number> {
  const m = new Map<string, number>()
  pk.exports.forEach((e, i) => m.set(e.fullName, i))
  return m
}

/**
 * A compressed package made whole (features/game-images.md): its summary as
 * stored, then every chunk's LZO blocks unpacked in place, and the summary
 * told it is not compressed any more, so it reads like any other package.
 */
export function decompressPackage(b: Uint8Array): Uint8Array {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const r = new Reader(b)
  if (r.u32() !== TAG) throw new Error('not an Unreal package')
  // A package compressed whole (with a .uncompressed_size beside it): one LZO
  // chunk, the package inside.
  if (v.getInt32(4, true) === 0x20000) return decompressPackage(unchunk(b, v.getInt32(12, true)))
  const version = r.i16()
  r.i16()
  r.i32() // header size
  r.fstr()
  const packageFlagsAt = r.o
  r.u32()
  r.o += 4 * 7 // names, exports, imports: counts and offsets; depends offset
  if (version >= 623) r.o += 16
  r.o += 16
  const generations = r.i32()
  r.o += 12 * generations
  r.o += 8 // engine and cooker versions
  const flagsAt = r.o
  const flags = r.i32()
  const count = r.i32()
  if (!flags && !count) return b
  if (flags !== 2) throw new Error(`a package compression the app does not read (${flags})`)
  const chunks = Array.from({ length: count }, () => ({
    uOff: r.i32(),
    uSize: r.i32(),
    cOff: r.i32(),
    cSize: r.i32(),
  }))
  const size = Math.max(...chunks.map((c) => c.uOff + c.uSize))
  const out = new Uint8Array(size)
  out.set(b.subarray(0, chunks[0]!.uOff))
  for (const c of chunks) {
    let p = c.cOff
    if (v.getUint32(p, true) !== TAG) throw new Error('damaged package (chunk)')
    const blockSize = v.getInt32(p + 4, true)
    const total = v.getInt32(p + 12, true)
    const n = Math.ceil(total / blockSize)
    const blocks = Array.from({ length: n }, (_, i) => ({
      c: v.getInt32(p + 16 + 8 * i, true),
      u: v.getInt32(p + 20 + 8 * i, true),
    }))
    p += 16 + 8 * n
    let o = c.uOff
    for (const bl of blocks) {
      out.set(lzoDecompress(b.subarray(p, p + bl.c), bl.u), o)
      p += bl.c
      o += bl.u
    }
  }
  // Not compressed any more: no chunks, and not flagged as stored compressed
  // (the game fails to load a package written so with the flag still on).
  const ov = new DataView(out.buffer)
  ov.setInt32(flagsAt, 0, true)
  ov.setInt32(flagsAt + 4, 0, true)
  ov.setUint32(packageFlagsAt, ov.getUint32(packageFlagsAt, true) & ~PKG_STORE_COMPRESSED, true)
  return out
}

/** A package's flag: stored in compressed chunks. */
export const PKG_STORE_COMPRESSED = 0x02000000

/**
 * A package as mod scripts work on it: decompressed if the game ships it
 * compressed (whole, or in chunks), since that is how it is written back.
 * `plain` is the bytes worked on; `compressed` whether they differ from the file's.
 */
export function scriptPackage(bytes: Uint8Array): { pkg: Package; plain: Uint8Array; compressed: boolean } {
  const plain = decompressPackage(bytes)
  return { pkg: new Package(plain === bytes ? bytes : plain.slice()), plain, compressed: plain !== bytes }
}

/** An enum's names, in value order (an Enum export: no properties, then its names). */
export function readEnum(pkg: Package, name: string): string[] {
  const i = pkg.exports.findIndex((e) => e.type === 'Enum' && e.name === name)
  if (i < 0) return []
  const e = pkg.exports[i]!
  const v = new DataView(pkg.bytes.buffer, pkg.bytes.byteOffset, pkg.bytes.byteLength)
  let o = e.offset + 4 // net index
  // Enums carry no properties but "None".
  if (pkg.names[v.getInt32(o, true)] === 'None') o += 8
  // UField: the next field in its scope.
  o += 4
  const n = v.getInt32(o, true)
  o += 4
  const out: string[] = []
  for (let k = 0; k < n && o + 8 <= e.offset + e.size; k++) {
    out.push(pkg.names[v.getInt32(o, true)] ?? '')
    o += 8
  }
  return out
}
