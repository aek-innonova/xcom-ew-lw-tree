// Unreal Engine 3 packages (.upk) in the browser: the summary, the name,
// import and export tables, objects' data, and the few edits a mod makes
// (features/game-tools.md). Enemy Within's packages are version 845; the
// layout is the same one scripts/upk.py reads.
//
// Full object names follow PatcherGUI's convention, since mods name objects
// that way: an export's outer chain without the package ("XGUnit.RecordKill"),
// an import's with its package ("Core.Object.Name"); a name used more than
// once carries "_N" (N = number − 1).

export interface UpkImport {
  className: string
  name: string
  outer: number
  fullName: string
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
  /** Where its entry in the export table is. */
  entryOffset: number
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
  private v: DataView
  constructor(
    private b: Uint8Array,
    o = 0,
  ) {
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
    r.o += 16 // guid
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
   * Adds a name at the end of the name table: everything after it moves down
   * by the entry's size, and the summary and every export's offset follow
   * (as PatcherGUI's ADD_NAME_ENTRY does).
   */
  addName(entry: Uint8Array) {
    const at = this.at
    const last = this.nameEntries[this.nameEntries.length - 1]
    const insertAt = last ? last.offset + last.size : this.getI32(at.nameOffset)
    const n = entry.length
    const grown = new Uint8Array(this.bytes.length + n)
    grown.set(this.bytes.subarray(0, insertAt))
    grown.set(entry, insertAt)
    grown.set(this.bytes.subarray(insertAt), insertAt + n)
    const exportOffsets = this.exports.map((e) => e.entryOffset)
    this.bytes = grown
    const add = (field: number, by: number) => this.setI32(field, this.getI32(field) + by)
    const serial = at.serialOffset ? this.getI32(at.serialOffset) : 0
    add(at.headerSize, n)
    add(at.nameCount, 1)
    add(at.importOffset, n)
    add(at.exportOffset, n)
    add(at.dependsOffset, n)
    // PatcherGUI takes a missing SerialOffset as the header size and writes it back.
    if (at.serialOffset) this.setI32(at.serialOffset, (serial || this.headerSize) + n)
    for (const entryOffset of exportOffsets)
      add(entryOffset + (entryOffset >= insertAt ? n : 0) + 36, n)
    this.parse()
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
