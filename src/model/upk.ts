// Reading Unreal Engine 3 packages (.upk) in the browser: the summary, the
// name table and the import and export tables, which is what the Tools page
// needs to tell installs apart and to find the objects a mod patches. The
// same reader as scripts/upk.py (Enemy Within's packages are version 845).

export interface UpkImport {
  className: string
  name: string
  outer: number
}
export interface UpkExport {
  classIndex: number
  superIndex: number
  outer: number
  name: string
  /** Where the object's data is in the file, and how long it is. */
  size: number
  offset: number
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

/** The summary's header size, from the first bytes of the file (enough: 64 KiB). */
export function headerSizeOf(head: Uint8Array): number {
  const r = new Reader(head)
  if (r.u32() !== TAG) throw new Error('not an Unreal package')
  r.i16()
  r.i16()
  return r.i32()
}

/** Reads a package's tables from its first `headerSize` bytes (or the whole file). */
export function readUpk(b: Uint8Array): Upk {
  const r = new Reader(b)
  if (r.u32() !== TAG) throw new Error('not an Unreal package')
  const version = r.i16()
  const licensee = r.i16()
  const headerSize = r.i32()
  r.fstr() // folder name
  r.u32() // package flags
  const [nc, no, ec, eo, ic, io] = [r.i32(), r.i32(), r.i32(), r.i32(), r.i32(), r.i32()]
  r.i32() // depends offset
  if (version >= 623) r.o += 16
  r.o += 16 // guid
  const generations = r.i32()
  r.o += 12 * generations
  r.i32() // engine version
  r.i32() // cooker version
  const compression = r.i32()
  const chunks = r.i32()
  const compressed = compression !== 0 || chunks !== 0
  if (compressed)
    return { version, licensee, headerSize, compressed, names: [], imports: [], exports: [] }

  const names: string[] = []
  r.o = no
  for (let i = 0; i < nc; i++) {
    names.push(r.fstr())
    r.o += 8 // flags
  }
  const nm = (i: number, num: number) => (names[i] ?? `?${i}`) + (num ? `_${num - 1}` : '')
  const imports: UpkImport[] = []
  r.o = io
  for (let i = 0; i < ic; i++) {
    r.o += 8 // class package
    const cls = r.i32()
    r.i32()
    const outer = r.i32()
    const name = r.i32()
    const num = r.i32()
    imports.push({ className: names[cls] ?? '', name: nm(name, num), outer })
  }
  const exports: UpkExport[] = []
  r.o = eo
  for (let i = 0; i < ec; i++) {
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
    exports.push({ classIndex, superIndex, outer, name: nm(name, num), size, offset })
  }
  return { version, licensee, headerSize, compressed, names, imports, exports }
}

/** An export's full name as PatchUPK writes it: "XGUnit.RecordKill", "XGBattle.Loading.NotifyKismetOfLoad". */
export function exportPath(pk: Upk, index: number): string {
  let e = pk.exports[index]!
  let path = e.name
  while (e.outer > 0) {
    e = pk.exports[e.outer - 1]!
    path = `${e.name}.${path}`
  }
  return path
}

/** Every export by its full name. */
export function exportsByPath(pk: Upk): Map<string, number> {
  const m = new Map<string, number>()
  pk.exports.forEach((_, i) => m.set(exportPath(pk, i), i))
  return m
}
