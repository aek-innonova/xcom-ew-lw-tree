// Reading a zip (features/game-bases.md): LWR comes as one. Its central
// directory, and each file stored or deflated (Node's zlib), checked by its
// CRC-32.

import { crc32, inflateRawSync } from 'node:zlib'

export interface ZipEntry {
  /** Its path in the zip, with "/". */
  path: string
  size: number
  compressedSize: number
  method: number
  crc: number
  offset: number
}

export interface Zip {
  entries: ZipEntry[]
  read(e: ZipEntry): Uint8Array
}

export function readZip(b: Uint8Array): Zip {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  // The end of central directory record: within the last 64 KiB + 22 bytes.
  let end = -1
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--)
    if (v.getUint32(i, true) === 0x06054b50) {
      end = i
      break
    }
  if (end < 0) throw new Error('not a zip file')
  let count = v.getUint16(end + 10, true)
  let at = v.getUint32(end + 16, true)
  // Zip64, for archives past 4 GiB or 65535 entries.
  if (at === 0xffffffff || count === 0xffff) {
    const loc = end - 20
    if (v.getUint32(loc, true) !== 0x07064b50) throw new Error('a zip the app does not read')
    const z = Number(v.getBigUint64(loc + 8, true))
    count = Number(v.getBigUint64(z + 32, true))
    at = Number(v.getBigUint64(z + 48, true))
  }
  const entries: ZipEntry[] = []
  for (let i = 0; i < count; i++) {
    if (v.getUint32(at, true) !== 0x02014b50) throw new Error('damaged zip (directory)')
    const flags = v.getUint16(at + 8, true)
    const method = v.getUint16(at + 10, true)
    const crc = v.getUint32(at + 16, true)
    let compressedSize = v.getUint32(at + 20, true)
    let size = v.getUint32(at + 24, true)
    const nameLen = v.getUint16(at + 28, true)
    const extraLen = v.getUint16(at + 30, true)
    const commentLen = v.getUint16(at + 32, true)
    let offset = v.getUint32(at + 42, true)
    const name = b.subarray(at + 46, at + 46 + nameLen)
    // Names not marked UTF-8 are in the old DOS code page; read as Latin-1, plain ASCII names (all
    // the ones that matter here) come out right.
    const path = new TextDecoder(flags & 0x800 ? 'utf-8' : 'latin1').decode(name)
    // Zip64 sizes and offset, in that order, for the fields that are full.
    for (let x = at + 46 + nameLen; x < at + 46 + nameLen + extraLen;) {
      const id = v.getUint16(x, true)
      const len = v.getUint16(x + 2, true)
      if (id === 1) {
        let p = x + 4
        const next = () => {
          const n = Number(v.getBigUint64(p, true))
          p += 8
          return n
        }
        if (size === 0xffffffff) size = next()
        if (compressedSize === 0xffffffff) compressedSize = next()
        if (offset === 0xffffffff) offset = next()
      }
      x += 4 + len
    }
    if (flags & 1) throw new Error(`${path} is encrypted`)
    if (!path.endsWith('/'))
      entries.push({ path: path.replace(/\\/g, '/'), size, compressedSize, method, crc, offset })
    at += 46 + nameLen + extraLen + commentLen
  }
  return {
    entries,
    read(e) {
      if (v.getUint32(e.offset, true) !== 0x04034b50) throw new Error('damaged zip (file)')
      const start =
        e.offset + 30 + v.getUint16(e.offset + 26, true) + v.getUint16(e.offset + 28, true)
      const raw = b.subarray(start, start + e.compressedSize)
      let out: Uint8Array
      if (e.method === 0) out = raw
      else if (e.method === 8) out = inflateRawSync(raw)
      else throw new Error(`${e.path}: a compression the app does not read (${e.method})`)
      if (out.length !== e.size || crc32(out) >>> 0 !== e.crc)
        throw new Error(`${e.path} did not unpack whole`)
      return out
    },
  }
}
