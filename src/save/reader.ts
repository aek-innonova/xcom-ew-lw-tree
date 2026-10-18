// Little-endian cursor over a byte buffer with XCOM's string encoding.
// Port of xcomsave's xcom_io (reading half).

import type { XcomString } from './types'

export class SaveFormatError extends Error {
  constructor(
    message: string,
    readonly offset?: number,
  ) {
    super(offset === undefined ? message : `${message} (at byte ${offset})`)
  }
}

const utf16 = new TextDecoder('utf-16le')

export class Reader {
  private readonly view: DataView
  pos = 0

  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  get length(): number {
    return this.bytes.length
  }

  eof(): boolean {
    return this.pos >= this.bytes.length
  }

  private need(n: number, what: string) {
    if (n < 0 || this.pos + n > this.bytes.length) {
      throw new SaveFormatError(`unexpected end of data reading ${what}`, this.pos)
    }
  }

  int(): number {
    this.need(4, 'int')
    const v = this.view.getInt32(this.pos, true)
    this.pos += 4
    return v
  }

  uint(): number {
    return this.int() >>> 0
  }

  float(): number {
    this.need(4, 'float')
    const v = this.view.getFloat32(this.pos, true)
    this.pos += 4
    return v
  }

  byte(): number {
    this.need(1, 'byte')
    return this.bytes[this.pos++]!
  }

  bool(): boolean {
    return this.int() !== 0
  }

  raw(n: number): Uint8Array {
    this.need(n, `${n} raw bytes`)
    const out = this.bytes.subarray(this.pos, this.pos + n)
    this.pos += n
    return out
  }

  /**
   * A length-prefixed string: positive length is Latin-1 with a NUL terminator,
   * negative is UTF-16LE. With `strict` false, anything that does not look like
   * a well-formed string yields "" (used to sniff array contents), and the
   * caller is expected to rewind.
   */
  xstring(strict = true): XcomString {
    const start = this.pos
    let length: number
    try {
      length = this.int()
    } catch (e) {
      if (strict) throw e
      return { str: '', is_wide: false }
    }
    if (length === 0) return { str: '', is_wide: false }

    const fail = (msg: string): XcomString => {
      if (strict) throw new SaveFormatError(msg, start)
      return { str: '', is_wide: false }
    }

    if (length < 0) {
      const chars = -length
      if (this.pos + chars * 2 > this.bytes.length) return fail('invalid UTF-16 string length')
      const body = this.bytes.subarray(this.pos, this.pos + chars * 2)
      this.pos += chars * 2
      let end = 0
      while (end + 1 < body.length && (body[end] !== 0 || body[end + 1] !== 0)) end += 2
      return { str: utf16.decode(body.subarray(0, end)), is_wide: true }
    }

    if (this.pos + length > this.bytes.length) return fail('invalid string length')
    const body = this.bytes.subarray(this.pos, this.pos + length)
    const nul = body.indexOf(0)
    if (nul !== length - 1)
      return fail(`string length mismatch: expected ${length - 1}, found ${nul}`)
    this.pos += length
    let s = ''
    for (let i = 0; i < nul; i++) s += String.fromCharCode(body[i]!)
    return { str: s, is_wide: false }
  }

  /** A string that must be narrow (names, class names, enum values). */
  string(): string {
    const at = this.pos
    const s = this.xstring()
    if (s.is_wide) throw new SaveFormatError('found UTF-16 string in unexpected location', at)
    return s.str
  }
}

export function toHex(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += b.toString(16).padStart(2, '0')
  return s
}
