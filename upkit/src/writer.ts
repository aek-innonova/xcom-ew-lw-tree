// Writing a package back: the summary, the name, import and export tables and
// the depends table rebuilt (so names, imports and exports can be added), and
// the objects' data laid out one of two ways:
//
// - "keep": every object where it was (shifted only if the header grew); an
//   object that grew goes to the end of the file, as PatchUPK moves it;
// - "compact": every object in export order, one after the other, no gaps.
//
// A package written with no changes in "keep" comes out byte for byte as it
// was (test/writer.spec.ts).

import { Writer } from './bytes.ts'
import {
  writeExport,
  writeImport,
  writeSummary,
  type Export,
  type Import,
  type NameEntry,
  type Package,
} from './package.ts'

export interface Changes {
  /** New data for existing exports, by reference (1-based). */
  data?: Map<number, Uint8Array>
  /** Names, imports and exports to add at the ends of their tables (with their data). */
  names?: NameEntry[]
  imports?: Import[]
  exports?: { entry: Export; data: Uint8Array }[]
  layout?: 'keep' | 'compact'
}

/** The package with the changes made, as a new file. */
export function writePackage(pkg: Package, changes: Changes = {}): Uint8Array {
  const s = pkg.summary
  const layout = changes.layout ?? 'keep'
  const names = [...pkg.names, ...(changes.names ?? [])]
  const imports = [...pkg.imports, ...(changes.imports ?? [])]
  const exports: Export[] = pkg.exports.map((e) => ({ ...e }))
  const datas: (Uint8Array | null)[] = pkg.exports.map((_, i) => changes.data?.get(i + 1) ?? null)
  for (const x of changes.exports ?? []) {
    exports.push({ ...x.entry })
    datas.push(x.data)
  }

  // The header's parts, then its size: the data starts right after it.
  const nameTable = new Writer()
  for (const n of names) nameTable.fstr(n.name).u64(n.flags)
  const importTable = new Writer()
  for (const i of imports) writeImport(importTable, i)
  // The depends table: kept as it is for existing exports, an empty entry for new ones.
  const oldDepends = pkg.bytes.subarray(s.dependsOffset, s.extra[0] || s.headerSize)
  const depends = new Writer()
  depends.bytes(oldDepends)
  for (let i = pkg.exports.length; i < exports.length; i++) depends.i32(0)
  // What lies between the depends table and the first object (guids, thumbnails: empty when cooked).
  const afterDepends = pkg.bytes.subarray(s.extra[0] || s.headerSize, s.headerSize)

  const summary = { ...s, generations: s.generations.map((g) => ({ ...g })) }
  summary.nameCount = names.length
  summary.importCount = imports.length
  summary.exportCount = exports.length
  if (summary.generations.length) {
    const g = summary.generations[summary.generations.length - 1]!
    // Counted up by what is added, not recounted: a patched package's own
    // count can be off (Long War added a name without counting it).
    g.names += names.length - pkg.names.length
    g.exports += exports.length - pkg.exports.length
  }
  // The export table's size depends only on the entries, not on the offsets in them.
  const exportTableSize = (() => {
    const w = new Writer()
    for (const e of exports) writeExport(w, e)
    return w.o
  })()
  const summarySize = (() => {
    const w = new Writer()
    writeSummary(w, summary)
    return w.o
  })()
  // Names start where they did; a decompressed package's summary is shorter
  // (no chunk list), and the gap stays.
  if (summarySize > s.nameOffset)
    throw new Error(`summary of ${summarySize} bytes before names at ${s.nameOffset}`)
  summary.nameOffset = s.nameOffset
  summary.importOffset = summary.nameOffset + nameTable.o
  summary.exportOffset = summary.importOffset + importTable.o
  summary.dependsOffset = summary.exportOffset + exportTableSize
  const guidsOffset = summary.dependsOffset + depends.o
  summary.headerSize = guidsOffset + afterDepends.length
  if (summary.extra.length) summary.extra = [guidsOffset, ...summary.extra.slice(1)]
  const shift = summary.headerSize - s.headerSize

  // The objects' data.
  const body = new Writer()
  const place = (i: number, bytes: Uint8Array) => {
    exports[i]!.serialOffset = summary.headerSize + body.o
    exports[i]!.serialSize = bytes.length
    body.bytes(bytes)
  }
  if (layout === 'compact') {
    for (let i = 0; i < exports.length; i++) {
      const bytes = datas[i] ?? pkg.data(i + 1)
      if (bytes.length) place(i, bytes)
      else exports[i]!.serialOffset = 0
    }
  } else {
    // Everything after the header as it is, then the objects that grew or are new.
    body.bytes(pkg.bytes.subarray(s.headerSize))
    for (let i = 0; i < pkg.exports.length; i++) {
      const old = pkg.exports[i]!
      const bytes = datas[i]
      if (old.serialSize) exports[i]!.serialOffset = old.serialOffset + shift
      if (!bytes) continue
      if (bytes.length <= old.serialSize) {
        // In place; what is left of the old object stays as it was.
        const at = old.serialOffset - s.headerSize
        exports[i]!.serialSize = bytes.length
        body.patchBytes(at, bytes)
      } else place(i, bytes)
    }
    for (let i = pkg.exports.length; i < exports.length; i++) place(i, datas[i]!)
  }

  const out = new Writer(summary.headerSize + body.o)
  writeSummary(out, summary)
  out.padTo(summary.nameOffset).bytes(nameTable.done()).bytes(importTable.done())
  for (const e of exports) writeExport(out, e)
  out.bytes(depends.done()).bytes(afterDepends)
  if (out.o !== summary.headerSize) throw new Error(`header written ${out.o}, expected ${summary.headerSize}`)
  out.bytes(body.done())
  return out.done()
}

/**
 * A package with nothing in it but the name None, its summary the template's
 * (a script package of the game's: its versions, its flags but compression),
 * a new GUID. What a new script package starts from.
 */
export function emptyPackage(template: Package): Uint8Array {
  const t = template.summary
  const names = new Writer()
  names.fstr('None').u64(0x7001000000000n)
  const nameOffset = t.nameOffset
  const headerSize = nameOffset + names.o
  const guid = new Uint8Array(16)
  crypto.getRandomValues(guid)
  const summary = {
    ...t,
    headerSize,
    // Stored as it is: not compressed (fully or by chunks).
    packageFlags: (t.packageFlags & ~0x6000000) >>> 0,
    nameCount: 1,
    nameOffset,
    exportCount: 0,
    exportOffset: headerSize,
    importCount: 0,
    importOffset: headerSize,
    dependsOffset: headerSize,
    extra: t.extra.length ? [headerSize, ...t.extra.slice(1).map(() => 0)] : [],
    guid,
    generations: [{ exports: 0, names: 1, netObjects: 0 }],
    compressionFlags: 0,
    chunks: [],
  }
  const w = new Writer(headerSize)
  writeSummary(w, summary)
  w.padTo(nameOffset).bytes(names.done())
  return w.done()
}
