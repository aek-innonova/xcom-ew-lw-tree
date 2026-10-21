// LZO1X decompression: Unreal packages compress their chunks with it, and
// texture caches on PC store their blocks with it. Written from the format as
// LZO's documentation describes it. Decodes into an output of known size.

export function lzoDecompress(src: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size)
  let ip = 0
  let op = 0
  let t = 0
  const need = (n: number) => {
    if (op + n > size) throw new Error('LZO: output overrun')
  }
  const literals = (n: number) => {
    need(n)
    if (ip + n > src.length) throw new Error('LZO: input overrun')
    out.set(src.subarray(ip, ip + n), op)
    ip += n
    op += n
  }
  const copy = (from: number, n: number) => {
    if (from < 0) throw new Error('LZO: lookbehind overrun')
    need(n)
    for (let i = 0; i < n; i++) out[op++] = out[from + i]!
  }
  /** A run length: zero bytes add 255 each, then the next byte and `base`. */
  const length = (base: number) => {
    let n = 0
    while (src[ip] === 0) {
      n += 255
      ip++
    }
    return n + base + src[ip++]!
  }

  // The first byte may start with a literal run.
  let state: 'loop' | 'first' | 'match' | 'next' = 'loop'
  if (src[0]! > 17) {
    t = src[ip++]! - 17
    if (t < 4) state = 'next'
    else {
      literals(t)
      state = 'first'
    }
  }
  for (;;) {
    if (state === 'loop') {
      t = src[ip++]!
      if (t >= 16) {
        state = 'match'
        continue
      }
      if (t === 0) t = length(15)
      literals(t + 3)
      state = 'first'
      continue
    }
    if (state === 'first') {
      t = src[ip++]!
      if (t >= 16) {
        state = 'match'
        continue
      }
      // A 3-byte match from far behind, right after a literal run.
      const from = op - (1 + 0x0800) - (t >> 2) - (src[ip++]! << 2)
      copy(from, 3)
    } else if (state === 'next') {
      literals(t)
      t = src[ip++]!
      state = 'match'
      continue
    } else {
      // A match.
      if (t >= 64) {
        const from = op - 1 - ((t >> 2) & 7) - (src[ip++]! << 3)
        copy(from, (t >> 5) - 1 + 2)
      } else if (t >= 32) {
        t &= 31
        if (t === 0) t = length(31)
        const from = op - 1 - ((src[ip]! >> 2) + (src[ip + 1]! << 6))
        ip += 2
        copy(from, t + 2)
      } else if (t >= 16) {
        let from = op - ((t & 8) << 11)
        t &= 7
        if (t === 0) t = length(7)
        from -= (src[ip]! >> 2) + (src[ip + 1]! << 6)
        ip += 2
        if (from === op) break // the end of the stream
        copy(from - 0x4000, t + 2)
      } else {
        const from = op - 1 - (t >> 2) - (src[ip++]! << 2)
        copy(from, 2)
      }
    }
    // After a match: up to 3 literals, given by the low bits of the byte two back.
    t = src[ip - 2]! & 3
    if (t === 0) state = 'loop'
    else state = 'next'
  }
  if (op !== size) throw new Error(`LZO: ${op} bytes, not ${size}`)
  return out
}

/** Bytes stored as an LZO "chunk": tag, block size, sizes, the block table, the blocks. */
export function unchunk(b: Uint8Array, size: number): Uint8Array {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  if (v.getUint32(0, true) !== 0x9e2a83c1) throw new Error('not a compressed chunk')
  const blockSize = v.getInt32(4, true)
  const total = v.getInt32(12, true)
  const n = Math.ceil(total / blockSize)
  let p = 16 + 8 * n
  const out = new Uint8Array(size)
  let o = 0
  for (let i = 0; i < n; i++) {
    const c = v.getInt32(16 + 8 * i, true)
    const u = v.getInt32(20 + 8 * i, true)
    out.set(lzoDecompress(b.subarray(p, p + c), u), o)
    p += c
    o += u
  }
  return out
}
