// Reading an Inno Setup installer (features/game-bases.md): the Long War
// installer is Inno Setup 5.5.0 with LZMA. The app reads its file list and
// its files itself, as the Long War Mod Manager did with innounp, with no
// external tool.
//
// The format as innoextract documents it in its source (zlib licence; read,
// not copied):
// - The loader's offset table (found by its magic) says where the setup
//   data starts (setup-0) and where the files are (setup-1).
// - setup-0 is a version string, then two compressed blocks: the header with
//   every entry, then the file locations.
// - A block is CRC-checked 4 KiB pieces of an LZMA stream.
// - setup-1 is chunks ("zlb\x1a" + LZMA). A file is a slice of a chunk,
//   checked by its SHA-1.
//
// Only what the app needs is read: the header's strings and counts, the
// [Files] entries and the file locations. The header's later fields change
// from version to version, so the [Files] entries are found by reading them:
// the place where all of them read cleanly, one after another, each
// pointing at its own file location.

import { createHash } from 'node:crypto'
import { lzmaDecode, lzmaProps } from './lzma'

const LOADER_MAGIC = [0x72, 0x44, 0x6c, 0x50, 0x74, 0x53, 0xcd, 0xe6, 0xd7, 0x7b, 0x0b, 0x2a] // "rDlPtS" + 5.1.5
const CHUNK_MAGIC = [0x7a, 0x6c, 0x62, 0x1a] // "zlb\x1a"
/** The setup data versions this reader knows (the Long War installer is 5.5.0). */
const VERSIONS = /^Inno Setup Setup Data \((5\.5\.[0-6])\)$/

export interface InnoFile {
  /** Where it goes: "{app}\XComGame\CookedPCConsole\XComGame.upk". */
  destination: string
  /** Its conditions in the script ("language\english"), if any. */
  components: string
  languages: string
  check: string
  size: number
  sha1: string
  /** Executables Inno stored with its call-instruction filter (not read here). */
  filtered: boolean
  location: number
}

interface Location {
  chunkOffset: number
  fileOffset: number
  fileSize: number
  chunkSize: number
  sha1: string
  compressed: boolean
  encrypted: boolean
  filtered: boolean
}

export interface InnoSetup {
  version: string
  appName: string
  appVersion: string
  defaultDir: string
  files: InnoFile[]
  /** A file's bytes, checked against its SHA-1. */
  read(f: InnoFile): Uint8Array
}

const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(b: Uint8Array, from = 0, to = b.length): number {
  let c = 0xffffffff
  for (let i = from; i < to; i++) c = crcTable[(c ^ b[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const u32 = (b: Uint8Array, at: number) =>
  (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0
const u64 = (b: Uint8Array, at: number) => u32(b, at) + u32(b, at + 4) * 0x1_0000_0000
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')
const ansi = (b: Uint8Array) => new TextDecoder('windows-1252').decode(b)

function indexOf(b: Uint8Array, needle: number[], from = 0): number {
  outer: for (let i = from; i <= b.length - needle.length; i++) {
    for (let k = 0; k < needle.length; k++) if (b[i + k] !== needle[k]) continue outer
    return i
  }
  return -1
}

/** The loader's offset table: where setup-0 and setup-1 are. */
function offsets(exe: Uint8Array): { header: number; data: number } {
  for (let at = indexOf(exe, LOADER_MAGIC); at >= 0; at = indexOf(exe, LOADER_MAGIC, at + 1)) {
    // magic, revision, total size, exe offset, exe size, exe CRC, setup-0, setup-1, CRC of all that
    const end = at + 12 + 4 * 7
    if (end + 4 > exe.length) break
    if (u32(exe, at + 12) !== 1) continue
    if (crc32(exe, at, end) !== u32(exe, end)) continue
    return { header: u32(exe, end - 8), data: u32(exe, end - 4) }
  }
  throw new Error('not an Inno Setup installer the app knows')
}

/** One compressed block of setup-0, and where the next one starts. */
function block(exe: Uint8Array, at: number): { data: Uint8Array; next: number } {
  const stored = u32(exe, at + 4)
  if (crc32(exe, at + 4, at + 9) !== u32(exe, at)) throw new Error('damaged installer (block)')
  const compressed = exe[at + 8] !== 0
  const end = at + 9 + stored
  // 4 KiB pieces, each after its CRC.
  const parts: Uint8Array[] = []
  for (let p = at + 9; p < end;) {
    const len = Math.min(4096, end - p - 4)
    if (crc32(exe, p + 4, p + 4 + len) !== u32(exe, p)) throw new Error('damaged installer (block)')
    parts.push(exe.subarray(p + 4, p + 4 + len))
    p += 4 + len
  }
  const raw = Buffer.concat(parts)
  if (!compressed) return { data: raw, next: end }
  // LZMA with its five property bytes and no size: decoded to its end
  // marker, in an output that grows until it fits.
  const props = lzmaProps(raw, 0)
  for (let size = raw.length * 8; ; size *= 4) {
    try {
      const data = lzmaDecode(raw, 5, props, size)
      if (data.length < size) return { data, next: end }
    } catch (e) {
      if (!/longer than expected|ends early/.test((e as Error).message)) throw e
      if (size > 1 << 28) throw e
    }
  }
}

class Reader {
  constructor(
    public b: Uint8Array,
    public at = 0,
  ) {}
  str(): string {
    const n = u32(this.b, this.at)
    if (n > this.b.length - this.at - 4) throw new Error('bad string')
    const s = ansi(this.b.subarray(this.at + 4, this.at + 4 + n))
    this.at += 4 + n
    return s
  }
  u32() {
    const v = u32(this.b, this.at)
    this.at += 4
    return v
  }
  skip(n: number) {
    this.at += n
    if (this.at > this.b.length) throw new Error('past the end')
  }
}

/** One [Files] entry (Inno Setup 5.2.5 to 5.5.x). */
function fileEntry(r: Reader): Omit<InnoFile, 'size' | 'sha1' | 'filtered'> {
  r.str() // source (external files only)
  const destination = r.str()
  r.str() // font name
  r.str() // strong assembly name
  const components = r.str()
  r.str() // tasks
  const languages = r.str()
  const check = r.str()
  r.str() // after install
  r.str() // before install
  r.skip(20) // Windows versions: min and only-below, each Windows and NT
  const location = r.u32()
  r.skip(4 + 8 + 2) // attributes, external size, permission
  r.skip(4) // 32 option flags
  r.skip(1) // type
  return { destination, components, languages, check, location }
}

export function readInnoSetup(exe: Uint8Array): InnoSetup {
  const { header, data } = offsets(exe)
  const id = ansi(exe.subarray(header, header + 64)).replace(/\0+$/, '')
  const v = VERSIONS.exec(id)
  if (!v) throw new Error(`an Inno Setup version the app does not read (${id})`)
  const first = block(exe, header + 64)
  const second = block(exe, first.next)

  // The header's strings, then the counts.
  const r = new Reader(first.data)
  const s: string[] = []
  for (let i = 0; i < 31; i++) s.push(r.str())
  r.skip(32) // the lead-byte set (ANSI installers)
  const counts = Array.from({ length: 16 }, () => r.u32())
  const fileCount = counts[7]!
  const locationCount = counts[8]!

  // The file locations: fixed records in the second block.
  const LOC = 74
  if (second.data.length !== locationCount * LOC)
    throw new Error('the installer is not laid out as expected (locations)')
  const locations: Location[] = []
  for (let i = 0; i < locationCount; i++) {
    const p = i * LOC
    const flags = second.data[p + 72]! | (second.data[p + 73]! << 8)
    locations.push({
      chunkOffset: u32(second.data, p + 8),
      fileOffset: u64(second.data, p + 12),
      fileSize: u64(second.data, p + 20),
      chunkSize: u64(second.data, p + 28),
      sha1: hex(second.data.subarray(p + 36, p + 56)),
      // VersionInfoValid, VersionInfoNotValid, TimeStampInUTC, IsUninstallerExe,
      // CallInstructionOptimized, Touch, ChunkEncrypted, ChunkCompressed, SolidBreak
      filtered: (flags & (1 << 4)) !== 0,
      encrypted: (flags & (1 << 6)) !== 0,
      compressed: (flags & (1 << 7)) !== 0,
    })
  }

  // The [Files] entries: where all of them read, in a row.
  let entries: Omit<InnoFile, 'size' | 'sha1' | 'filtered'>[] | null = null
  for (let at = r.at; at < first.data.length && !entries; at++) {
    try {
      const fr = new Reader(first.data, at)
      const found = []
      for (let i = 0; i < fileCount; i++) {
        const e = fileEntry(fr)
        // Every file goes to a "{app}"-like place, or nowhere (the uninstaller's
        // own entry), and points at a file location or none.
        const external = e.location === 0xffffffff
        if (!(e.destination.startsWith('{') || (external && !e.destination))) throw new Error('no')
        if (!external && e.location >= locationCount) throw new Error('no')
        found.push(e)
      }
      entries = found
    } catch {
      // not here
    }
  }
  if (!entries) throw new Error('the installer is not laid out as expected (files)')

  const files: InnoFile[] = entries
    .filter((e) => e.location !== 0xffffffff)
    .map((e) => {
      const l = locations[e.location]!
      return { ...e, size: l.fileSize, sha1: l.sha1, filtered: l.filtered }
    })

  // Chunks are decoded once each, as far as the files asked for need.
  const chunks = new Map<number, Uint8Array>()
  function chunk(l: Location, need: number): Uint8Array {
    const have = chunks.get(l.chunkOffset)
    if (have && have.length >= need) return have
    const at = data + l.chunkOffset
    if (indexOf(exe.subarray(at, at + 4), CHUNK_MAGIC) !== 0)
      throw new Error('damaged installer (chunk)')
    const body = exe.subarray(at + 4, at + 4 + l.chunkSize)
    // The chunk's full size: the end of the furthest file in it.
    let size = 0
    for (const o of locations)
      if (o.chunkOffset === l.chunkOffset) size = Math.max(size, o.fileOffset + o.fileSize)
    const out = l.compressed ? lzmaDecode(body, 5, lzmaProps(body, 0), size) : body
    chunks.clear() // one chunk at a time: they can be large
    chunks.set(l.chunkOffset, out)
    return out
  }

  return {
    version: v[1]!,
    appName: s[0]!,
    appVersion: s[9]!,
    defaultDir: s[10]!,
    files,
    read(f) {
      const l = locations[f.location]!
      if (l.encrypted) throw new Error(`${f.destination} is encrypted`)
      if (l.filtered) throw new Error(`${f.destination} is stored filtered (not read)`)
      const c = chunk(l, l.fileOffset + l.fileSize)
      const bytes = c.subarray(l.fileOffset, l.fileOffset + l.fileSize)
      if (createHash('sha1').update(bytes).digest('hex') !== l.sha1)
        throw new Error(`${f.destination} did not unpack whole`)
      return bytes
    },
  }
}
