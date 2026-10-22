// An Unreal Engine 3 package (.upk, .u) as Enemy Within has them (version
// 845): the summary, the name, import and export tables with every field
// kept, so a package can be written back exactly; objects' data by export.
//
// Object references are the engine's: 0 none, n > 0 export n − 1, n < 0
// import −n − 1. Names in the tables are an index and a number; a number n > 0
// makes the name "Name_(n − 1)", as the editor and PatchUPK show them.

import { Reader, Writer } from './bytes.ts'
import { lzoDecompress, unchunk } from './lzo.ts'

export const TAG = 0x9e2a83c1
/** A package's flag: stored in compressed chunks (the summary lists them). */
export const PKG_STORE_COMPRESSED = 0x02000000

export interface NameRef {
  index: number
  number: number
}
export interface NameEntry {
  name: string
  flags: bigint
}
export interface Import {
  classPackage: NameRef
  className: NameRef
  outer: number
  objectName: NameRef
}
export interface Export {
  classIndex: number
  superIndex: number
  outer: number
  objectName: NameRef
  archetype: number
  objectFlags: bigint
  serialSize: number
  serialOffset: number
  exportFlags: number
  netObjects: number[]
  packageGuid: Uint8Array
  packageFlags: number
}
export interface Summary {
  version: number
  licensee: number
  headerSize: number
  folderName: string
  packageFlags: number
  nameCount: number
  nameOffset: number
  exportCount: number
  exportOffset: number
  importCount: number
  importOffset: number
  dependsOffset: number
  /** Version 623 and later: import/export guids offset, their counts, thumbnail table offset. */
  extra: number[]
  guid: Uint8Array
  generations: { exports: number; names: number; netObjects: number }[]
  engineVersion: number
  cookerVersion: number
  compressionFlags: number
  chunks: { uOff: number; uSize: number; cOff: number; cSize: number }[]
  /** The rest of the summary, up to the name table, kept as it is. */
  rest: Uint8Array
}

/** Opens a package: decompressed first if it is compressed (whole, or by chunks). */
export function openPackage(bytes: Uint8Array): Package {
  return new Package(decompress(bytes))
}

export class Package {
  readonly bytes: Uint8Array
  summary!: Summary
  names: NameEntry[] = []
  imports: Import[] = []
  exports: Export[] = []
  /** Where the summary's fields are, for writing back. */
  private nameIndex = new Map<string, number>()

  constructor(bytes: Uint8Array) {
    this.bytes = bytes
    const r = new Reader(bytes)
    this.summary = readSummary(r)
    const s = this.summary
    if (s.compressionFlags || s.chunks.length) throw new Error('compressed: open it with openPackage')
    r.o = s.nameOffset
    for (let i = 0; i < s.nameCount; i++) {
      const name = r.fstr()
      this.names.push({ name, flags: r.u64() })
      if (!this.nameIndex.has(name.toLowerCase())) this.nameIndex.set(name.toLowerCase(), i)
    }
    r.o = s.importOffset
    for (let i = 0; i < s.importCount; i++)
      this.imports.push({
        classPackage: { index: r.i32(), number: r.i32() },
        className: { index: r.i32(), number: r.i32() },
        outer: r.i32(),
        objectName: { index: r.i32(), number: r.i32() },
      })
    r.o = s.exportOffset
    for (let i = 0; i < s.exportCount; i++) {
      const e: Export = {
        classIndex: r.i32(),
        superIndex: r.i32(),
        outer: r.i32(),
        objectName: { index: r.i32(), number: r.i32() },
        archetype: r.i32(),
        objectFlags: r.u64(),
        serialSize: r.i32(),
        serialOffset: r.i32(),
        exportFlags: r.u32(),
        netObjects: [],
        packageGuid: new Uint8Array(),
        packageFlags: 0,
      }
      const n = r.i32()
      for (let j = 0; j < n; j++) e.netObjects.push(r.i32())
      e.packageGuid = r.bytes(16).slice()
      e.packageFlags = r.u32()
      this.exports.push(e)
    }
  }

  /** A name reference as text: "Name", or "Name_(n−1)" with a number. */
  name(ref: NameRef): string {
    const base = this.names[ref.index]?.name ?? `?name${ref.index}`
    return ref.number ? `${base}_${ref.number - 1}` : base
  }
  /** The index of a name in the table, or −1. */
  findName(name: string): number {
    return this.nameIndex.get(name.toLowerCase()) ?? -1
  }

  /** An object's own name ("RecordKill"); "None" for 0. */
  objectName(ref: number): string {
    if (ref > 0) return this.name(this.exports[ref - 1]!.objectName)
    if (ref < 0) return this.name(this.imports[-ref - 1]!.objectName)
    return 'None'
  }
  /** An object's class name ("Function", "IntProperty", "Class"). */
  className(ref: number): string {
    if (ref > 0) {
      const c = this.exports[ref - 1]!.classIndex
      return c === 0 ? 'Class' : this.objectName(c)
    }
    if (ref < 0) return this.name(this.imports[-ref - 1]!.className)
    return 'None'
  }
  outerOf(ref: number): number {
    if (ref > 0) return this.exports[ref - 1]!.outer
    if (ref < 0) return this.imports[-ref - 1]!.outer
    return 0
  }
  /**
   * An object's path: its outers and itself, dot-separated. Exports without
   * the package ("XGUnit.RecordKill", as PatchUPK names them); imports from
   * their package ("Core.Object.Name").
   */
  path(ref: number): string {
    const parts: string[] = []
    for (let r = ref; r !== 0; r = this.outerOf(r)) parts.unshift(this.objectName(r))
    return parts.join('.')
  }
  /** Export references by path, built once. */
  private byPath?: Map<string, number>
  find(path: string): number {
    if (!this.byPath) {
      this.byPath = new Map()
      for (let i = 0; i < this.exports.length; i++) {
        const p = this.path(i + 1).toLowerCase()
        if (!this.byPath.has(p)) this.byPath.set(p, i + 1)
      }
    }
    return this.byPath.get(path.toLowerCase()) ?? 0
  }
  /** An export's serialized data. */
  data(ref: number): Uint8Array {
    const e = this.exports[ref - 1]!
    return this.bytes.subarray(e.serialOffset, e.serialOffset + e.serialSize)
  }
}

function readSummary(r: Reader): Summary {
  if (r.u32() !== TAG) throw new Error('not an Unreal package')
  const s = {
    version: r.i16(),
    licensee: r.i16(),
    headerSize: r.i32(),
    folderName: r.fstr(),
    packageFlags: r.u32(),
    nameCount: r.i32(),
    nameOffset: r.i32(),
    exportCount: r.i32(),
    exportOffset: r.i32(),
    importCount: r.i32(),
    importOffset: r.i32(),
    dependsOffset: r.i32(),
  } as Summary
  s.extra = s.version >= 623 ? [r.i32(), r.i32(), r.i32(), r.i32()] : []
  s.guid = r.bytes(16).slice()
  const g = r.i32()
  s.generations = Array.from({ length: g }, () => ({
    exports: r.i32(),
    names: r.i32(),
    netObjects: r.i32(),
  }))
  s.engineVersion = r.i32()
  s.cookerVersion = r.i32()
  s.compressionFlags = r.i32()
  const n = r.i32()
  s.chunks = Array.from({ length: n }, () => ({
    uOff: r.i32(),
    uSize: r.i32(),
    cOff: r.i32(),
    cSize: r.i32(),
  }))
  // Package source, packages to cook, texture allocations: kept as bytes. The
  // name table follows; a compressed package's starts in its first chunk.
  const end = n ? s.chunks[0]!.cOff : s.nameOffset
  s.rest = r.bytes(Math.max(0, end - r.o)).slice()
  return s
}

/** Writes a summary as read (its counts and offsets as they are in it now). */
export function writeSummary(w: Writer, s: Summary) {
  w.u32(TAG).i16(s.version).i16(s.licensee).i32(s.headerSize).fstr(s.folderName).u32(s.packageFlags)
  w.i32(s.nameCount).i32(s.nameOffset).i32(s.exportCount).i32(s.exportOffset)
  w.i32(s.importCount).i32(s.importOffset).i32(s.dependsOffset)
  for (const x of s.extra) w.i32(x)
  w.bytes(s.guid).i32(s.generations.length)
  for (const g of s.generations) w.i32(g.exports).i32(g.names).i32(g.netObjects)
  w.i32(s.engineVersion).i32(s.cookerVersion).i32(s.compressionFlags).i32(s.chunks.length)
  for (const c of s.chunks) w.i32(c.uOff).i32(c.uSize).i32(c.cOff).i32(c.cSize)
  w.bytes(s.rest)
}

export function writeImport(w: Writer, i: Import) {
  w.i32(i.classPackage.index).i32(i.classPackage.number)
  w.i32(i.className.index).i32(i.className.number)
  w.i32(i.outer).i32(i.objectName.index).i32(i.objectName.number)
}
export function writeExport(w: Writer, e: Export) {
  w.i32(e.classIndex).i32(e.superIndex).i32(e.outer)
  w.i32(e.objectName.index).i32(e.objectName.number).i32(e.archetype)
  w.u64(e.objectFlags).i32(e.serialSize).i32(e.serialOffset).u32(e.exportFlags)
  w.i32(e.netObjects.length)
  for (const n of e.netObjects) w.i32(n)
  w.bytes(e.packageGuid).u32(e.packageFlags)
}

/** A package with its compression taken off (whole-file LZO, or LZO chunks). */
export function decompress(b: Uint8Array): Uint8Array {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  if (v.getUint32(0, true) !== TAG) throw new Error('not an Unreal package')
  // Compressed whole (a .uncompressed_size beside it): one LZO chunk, the package inside.
  if (v.getInt32(4, true) === 0x20000) return decompress(unchunk(b, v.getInt32(12, true)))
  const r = new Reader(b)
  const s = readSummary(r)
  if (!s.compressionFlags && !s.chunks.length) return b
  if (s.compressionFlags !== 2) throw new Error(`compression ${s.compressionFlags} is not LZO`)
  const size = Math.max(...s.chunks.map((c) => c.uOff + c.uSize))
  const out = new Uint8Array(size)
  // The summary, rewritten as uncompressed: no compression flags, no chunks,
  // and not flagged as stored compressed: with that flag on and no chunks the
  // game reads the package as compressed and fails (an array assertion as it
  // loads it; seen with XComUIShell_SF.upk). Long War's uncompressed seek-free
  // packages have it off. (A package compressed whole keeps it inside, and
  // loads so: Long War's XComGame.upk.)
  const w = new Writer()
  writeSummary(w, { ...s, packageFlags: s.packageFlags & ~PKG_STORE_COMPRESSED, compressionFlags: 0, chunks: [] })
  const head = w.done()
  out.set(head)
  for (const c of s.chunks) {
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
  // The summary is shorter without its chunk list: the rest of the header
  // starts where the first chunk did. Pad the gap so offsets stay as they are.
  if (head.length > s.chunks[0]!.uOff) throw new Error('summary longer than the first chunk offset')
  return out
}
