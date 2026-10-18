// LZO1X decompression, a port of lzo1x_decompress_safe from minilzo 2.09
// (the copy vendored in xcomsave). XCOM EW on PC compresses its saves with it.

export class LzoError extends Error {}

/**
 * Decompresses `src` into `dst` and returns the number of bytes written.
 * Every read and write is bounds-checked: a corrupt stream throws instead of
 * producing garbage.
 */
export function lzo1xDecompress(src: Uint8Array, dst: Uint8Array): number {
  const ipEnd = src.length
  const opEnd = dst.length
  let ip = 0
  let op = 0
  let t = 0
  let mPos = 0

  const needIp = (n: number) => {
    if (ip + n > ipEnd) throw new LzoError('LZO input overrun')
  }
  const needOp = (n: number) => {
    if (op + n > opEnd) throw new LzoError('LZO output overrun')
  }
  const testLb = () => {
    if (mPos < 0 || mPos >= op) throw new LzoError('LZO lookbehind overrun')
  }
  const copyLiterals = (n: number) => {
    needOp(n)
    needIp(n)
    dst.set(src.subarray(ip, ip + n), op)
    ip += n
    op += n
  }
  // Matches may overlap their own output, so copy byte by byte.
  const copyMatch = (n: number) => {
    testLb()
    needOp(n)
    for (let i = 0; i < n; i++) dst[op++] = dst[mPos++]!
  }
  // Long lengths: a run of zero bytes adds 255 each, then a final byte.
  const extendLength = (base: number) => {
    let n = 0
    needIp(1)
    while (src[ip] === 0) {
      n += 255
      ip++
      needIp(1)
    }
    return n + base + src[ip++]!
  }

  const enum S {
    LoopTop,
    FirstLiteralRun,
    Match,
    MatchDone,
    MatchNext,
  }
  let state: S

  needIp(1)
  if (src[0]! > 17) {
    t = src[ip++]! - 17
    if (t < 4) {
      state = S.MatchNext
    } else {
      copyLiterals(t)
      state = S.FirstLiteralRun
    }
  } else {
    state = S.LoopTop
  }

  for (;;) {
    switch (state) {
      case S.LoopTop:
        needIp(3)
        t = src[ip++]!
        if (t >= 16) {
          state = S.Match
          break
        }
        if (t === 0) t = extendLength(15)
        copyLiterals(t + 3)
        state = S.FirstLiteralRun
        break

      case S.FirstLiteralRun:
        needIp(1)
        t = src[ip++]!
        if (t >= 16) {
          state = S.Match
          break
        }
        needIp(1)
        mPos = op - (1 + 0x0800) - (t >> 2) - (src[ip++]! << 2)
        copyMatch(3)
        state = S.MatchDone
        break

      case S.Match:
        if (t >= 64) {
          needIp(1)
          mPos = op - 1 - ((t >> 2) & 7) - (src[ip++]! << 3)
          t = (t >> 5) - 1
          copyMatch(t + 2)
        } else if (t >= 32) {
          t &= 31
          if (t === 0) t = extendLength(31)
          needIp(2)
          mPos = op - 1 - ((src[ip]! >> 2) + (src[ip + 1]! << 6))
          ip += 2
          copyMatch(t + 2)
        } else if (t >= 16) {
          mPos = op - ((t & 8) << 11)
          t &= 7
          if (t === 0) t = extendLength(7)
          needIp(2)
          mPos -= (src[ip]! >> 2) + (src[ip + 1]! << 6)
          ip += 2
          if (mPos === op) {
            // End-of-stream marker.
            if (ip !== ipEnd) throw new LzoError('LZO input not fully consumed')
            return op
          }
          mPos -= 0x4000
          copyMatch(t + 2)
        } else {
          needIp(1)
          mPos = op - 1 - (t >> 2) - (src[ip++]! << 2)
          copyMatch(2)
        }
        state = S.MatchDone
        break

      case S.MatchDone:
        t = src[ip - 2]! & 3
        state = t === 0 ? S.LoopTop : S.MatchNext
        break

      case S.MatchNext:
        copyLiterals(t)
        needIp(1)
        t = src[ip++]!
        state = S.Match
        break
    }
  }
}
