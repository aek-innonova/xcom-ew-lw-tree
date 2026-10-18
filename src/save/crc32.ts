// The CRC XCOM saves use to check their header and compressed body: CRC-32
// with polynomial 0x04c11db7 computed MSB-first (CRC-32/BZIP2), not zlib's
// reflected variant. Matches crc32b in xcomsave's util.cpp.

let table: Uint32Array | undefined

function makeTable(): Uint32Array {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n << 24
    for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1
    t[n] = c >>> 0
  }
  return t
}

export function crc32(bytes: Uint8Array): number {
  table ??= makeTable()
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = (c << 8) ^ table[((c >>> 24) ^ bytes[i]!) & 0xff]!
  return ~c >>> 0
}
