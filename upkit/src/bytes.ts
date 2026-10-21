// Little-endian reading and writing over byte arrays: the two halves every
// format here is built from.

const latin1 = new TextDecoder('latin1')
const utf16 = new TextDecoder('utf-16le')

export class Reader {
  o: number
  readonly b: Uint8Array
  private readonly v: DataView
  constructor(b: Uint8Array, o = 0) {
    this.b = b
    this.o = o
    this.v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  }
  get left(): number {
    return this.b.length - this.o
  }
  private need(n: number) {
    if (this.o + n > this.b.length)
      throw new RangeError(`read past the end (${n} bytes at ${this.o} of ${this.b.length})`)
  }
  u8(): number {
    this.need(1)
    return this.b[this.o++]!
  }
  u16(): number {
    this.need(2)
    const x = this.v.getUint16(this.o, true)
    this.o += 2
    return x
  }
  i16(): number {
    this.need(2)
    const x = this.v.getInt16(this.o, true)
    this.o += 2
    return x
  }
  i32(): number {
    this.need(4)
    const x = this.v.getInt32(this.o, true)
    this.o += 4
    return x
  }
  u32(): number {
    this.need(4)
    const x = this.v.getUint32(this.o, true)
    this.o += 4
    return x
  }
  /** A 64-bit value as a bigint (flags). */
  u64(): bigint {
    this.need(8)
    const x = this.v.getBigUint64(this.o, true)
    this.o += 8
    return x
  }
  f32(): number {
    this.need(4)
    const x = this.v.getFloat32(this.o, true)
    this.o += 4
    return x
  }
  bytes(n: number): Uint8Array {
    this.need(n)
    const x = this.b.subarray(this.o, this.o + n)
    this.o += n
    return x
  }
  /** An FString: a length (negative: UTF-16 characters), then the text with its terminator. */
  fstr(): string {
    const n = this.i32()
    if (n === 0) return ''
    if (n < 0) return utf16.decode(this.bytes(-2 * n)).replace(/\0$/, '')
    return latin1.decode(this.bytes(n)).replace(/\0$/, '')
  }
}

export class Writer {
  private buf: Uint8Array
  private v: DataView
  o = 0
  constructor(size = 1024) {
    this.buf = new Uint8Array(size)
    this.v = new DataView(this.buf.buffer)
  }
  private room(n: number) {
    if (this.o + n <= this.buf.length) return
    let size = this.buf.length * 2
    while (size < this.o + n) size *= 2
    const next = new Uint8Array(size)
    next.set(this.buf.subarray(0, this.o))
    this.buf = next
    this.v = new DataView(next.buffer)
  }
  u8(x: number): this {
    this.room(1)
    this.buf[this.o++] = x & 0xff
    return this
  }
  u16(x: number): this {
    this.room(2)
    this.v.setUint16(this.o, x, true)
    this.o += 2
    return this
  }
  i16(x: number): this {
    this.room(2)
    this.v.setInt16(this.o, x, true)
    this.o += 2
    return this
  }
  i32(x: number): this {
    this.room(4)
    this.v.setInt32(this.o, x, true)
    this.o += 4
    return this
  }
  u32(x: number): this {
    this.room(4)
    this.v.setUint32(this.o, x >>> 0, true)
    this.o += 4
    return this
  }
  u64(x: bigint): this {
    this.room(8)
    this.v.setBigUint64(this.o, x, true)
    this.o += 8
    return this
  }
  f32(x: number): this {
    this.room(4)
    this.v.setFloat32(this.o, x, true)
    this.o += 4
    return this
  }
  bytes(b: Uint8Array): this {
    this.room(b.length)
    this.buf.set(b, this.o)
    this.o += b.length
    return this
  }
  /** An FString as the engine writes it: Latin-1 with a terminator, UTF-16 when it must be. */
  fstr(s: string): this {
    if (s === '') return this.i32(0)
    if (/^[\x00-\xff]*$/.test(s)) {
      this.i32(s.length + 1)
      for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i))
      return this.u8(0)
    }
    this.i32(-(s.length + 1))
    for (let i = 0; i < s.length; i++) this.u16(s.charCodeAt(i))
    return this.u16(0)
  }
  /** Overwrites at an earlier position (sizes and offsets known only later). */
  patchI32(at: number, x: number): this {
    this.v.setInt32(at, x, true)
    return this
  }
  patchU16(at: number, x: number): this {
    this.v.setUint16(at, x, true)
    return this
  }
  done(): Uint8Array {
    return this.buf.slice(0, this.o)
  }
}
