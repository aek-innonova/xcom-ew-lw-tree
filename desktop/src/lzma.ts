// An LZMA (the original, "LZMA1") decoder, for the Long War installer's
// files (inno.ts, features/game-bases.md). Written from the algorithm as
// the LZMA SDK's specification describes it (public domain); nothing is
// copied from an implementation.
//
// Decodes into one output buffer that is also the dictionary, so it needs
// the output's size, or an upper bound, up front.

const PROB_BITS = 11
const PROB_INIT = 1 << (PROB_BITS - 1)
const MOVE_BITS = 5
const TOP = 1 << 24

const probs = (n: number) => new Uint16Array(n).fill(PROB_INIT)

export interface LzmaProps {
  lc: number
  lp: number
  pb: number
  dictSize: number
}

/** The five property bytes before an LZMA stream: lc/lp/pb, then the dictionary size. */
export function lzmaProps(b: Uint8Array, at = 0): LzmaProps {
  let d = b[at]!
  if (d >= 9 * 5 * 5) throw new Error('bad LZMA properties')
  const lc = d % 9
  d = (d / 9) | 0
  const lp = d % 5
  const pb = (d / 5) | 0
  const dictSize = (b[at + 1]! | (b[at + 2]! << 8) | (b[at + 3]! << 16) | (b[at + 4]! << 24)) >>> 0
  return { lc, lp, pb, dictSize }
}

class RangeDecoder {
  range = 0xffffffff
  code = 0
  constructor(
    private input: Uint8Array,
    public pos: number,
  ) {
    if (input[pos] !== 0) throw new Error('bad LZMA stream')
    this.pos++
    for (let i = 0; i < 4; i++) this.code = ((this.code << 8) | this.next()) >>> 0
  }
  next(): number {
    if (this.pos >= this.input.length) throw new Error('the LZMA stream ends early')
    return this.input[this.pos++]!
  }
  bit(p: Uint16Array, i: number): number {
    const bound = (this.range >>> PROB_BITS) * p[i]!
    let b: number
    if (this.code >>> 0 < bound >>> 0) {
      this.range = bound >>> 0
      p[i]! += ((1 << PROB_BITS) - p[i]!) >>> MOVE_BITS
      b = 0
    } else {
      this.range = (this.range - bound) >>> 0
      this.code = (this.code - bound) >>> 0
      p[i]! -= p[i]! >>> MOVE_BITS
      b = 1
    }
    if (this.range < TOP) {
      this.range = (this.range << 8) >>> 0
      this.code = ((this.code << 8) | this.next()) >>> 0
    }
    return b
  }
  direct(n: number): number {
    let r = 0
    while (n--) {
      this.range >>>= 1
      let bit = 0
      if (this.code >= this.range) {
        this.code = (this.code - this.range) >>> 0
        bit = 1
      }
      r = ((r << 1) | bit) >>> 0
      if (this.range < TOP) {
        this.range = (this.range << 8) >>> 0
        this.code = ((this.code << 8) | this.next()) >>> 0
      }
    }
    return r
  }
  tree(p: Uint16Array, base: number, bits: number): number {
    let m = 1
    for (let i = 0; i < bits; i++) m = (m << 1) | this.bit(p, base + m)
    return m - (1 << bits)
  }
  reverse(p: Uint16Array, base: number, bits: number): number {
    let m = 1
    let r = 0
    for (let i = 0; i < bits; i++) {
      const b = this.bit(p, base + m)
      m = (m << 1) | b
      r |= b << i
    }
    return r
  }
}

class LenDecoder {
  choice = probs(2)
  low: Uint16Array
  mid: Uint16Array
  high = probs(1 << 8)
  constructor(posStates: number) {
    this.low = probs(posStates << 3)
    this.mid = probs(posStates << 3)
  }
  decode(rc: RangeDecoder, posState: number): number {
    if (!rc.bit(this.choice, 0)) return rc.tree(this.low, posState << 3, 3)
    if (!rc.bit(this.choice, 1)) return 8 + rc.tree(this.mid, posState << 3, 3)
    return 16 + rc.tree(this.high, 0, 8)
  }
}

/**
 * Decodes a raw LZMA stream (no header) into `size` bytes: exactly that many
 * when the stream has no end marker, or up to its end marker.
 */
export function lzmaDecode(
  input: Uint8Array,
  at: number,
  props: LzmaProps,
  size: number,
): Uint8Array {
  const { lc, lp, pb } = props
  const out = new Uint8Array(size)
  const rc = new RangeDecoder(input, at)
  const lit = probs(0x300 << (lc + lp))
  const posStates = 1 << pb
  const isMatch = probs(12 << 4)
  const isRep = probs(12)
  const isRepG0 = probs(12)
  const isRepG1 = probs(12)
  const isRepG2 = probs(12)
  const isRep0Long = probs(12 << 4)
  const posSlot = probs(4 << 6)
  const posDecoders = probs(115)
  const align = probs(16)
  const lenDec = new LenDecoder(posStates)
  const repLenDec = new LenDecoder(posStates)
  const pbMask = posStates - 1
  const lpMask = (1 << lp) - 1

  let pos = 0
  let state = 0
  let rep0 = 0
  let rep1 = 0
  let rep2 = 0
  let rep3 = 0
  while (pos < size) {
    const posState = pos & pbMask
    if (!rc.bit(isMatch, (state << 4) + posState)) {
      // A literal.
      const prev = pos > 0 ? out[pos - 1]! : 0
      const base = 0x300 * (((pos & lpMask) << lc) + (prev >>> (8 - lc)))
      let symbol = 1
      if (state >= 7) {
        let match = out[pos - rep0 - 1]!
        do {
          const matchBit = (match >>> 7) & 1
          match <<= 1
          const b = rc.bit(lit, base + ((1 + matchBit) << 8) + symbol)
          symbol = (symbol << 1) | b
          if (matchBit !== b) break
        } while (symbol < 0x100)
      }
      while (symbol < 0x100) symbol = (symbol << 1) | rc.bit(lit, base + symbol)
      out[pos++] = symbol - 0x100
      state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6
      continue
    }
    let len: number
    if (rc.bit(isRep, state)) {
      if (pos === 0) throw new Error('bad LZMA stream')
      if (!rc.bit(isRepG0, state)) {
        if (!rc.bit(isRep0Long, (state << 4) + posState)) {
          // A single byte from rep0.
          state = state < 7 ? 9 : 11
          out[pos] = out[pos - rep0 - 1]!
          pos++
          continue
        }
      } else {
        let dist: number
        if (!rc.bit(isRepG1, state)) dist = rep1
        else {
          if (!rc.bit(isRepG2, state)) dist = rep2
          else {
            dist = rep3
            rep3 = rep2
          }
          rep2 = rep1
        }
        rep1 = rep0
        rep0 = dist
      }
      len = repLenDec.decode(rc, posState)
      state = state < 7 ? 8 : 11
    } else {
      rep3 = rep2
      rep2 = rep1
      rep1 = rep0
      len = lenDec.decode(rc, posState)
      state = state < 7 ? 7 : 10
      // The distance.
      const slot = rc.tree(posSlot, (len < 3 ? len : 3) << 6, 6)
      if (slot < 4) rep0 = slot
      else {
        const direct = (slot >>> 1) - 1
        let dist = ((2 | (slot & 1)) << direct) >>> 0
        if (slot < 14) dist += rc.reverse(posDecoders, dist - slot, direct)
        else {
          dist = (dist + (rc.direct(direct - 4) << 4)) >>> 0
          dist += rc.reverse(align, 0, 4)
        }
        rep0 = dist >>> 0
        if (rep0 === 0xffffffff) break // the end marker
      }
      if (rep0 >= pos) throw new Error('bad LZMA stream')
    }
    len += 2
    if (pos + len > size) throw new Error('the LZMA stream is longer than expected')
    for (let src = pos - rep0 - 1; len > 0; len--) out[pos++] = out[src++]!
  }
  return pos === size ? out : out.subarray(0, pos)
}
