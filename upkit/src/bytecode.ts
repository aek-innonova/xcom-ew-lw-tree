// UnrealScript bytecode (UE3, package version 845): every token, its operands,
// decoded to a tree and encoded back. One table drives both directions, so
// what is read is what is written.
//
// Offsets inside the code (jumps, skips, case links) count memory bytes: an
// object reference is 4 bytes in the file and 8 in memory. Each node keeps
// both positions; `memSize` checks the stored memory size against ours.

import { Reader, Writer } from './bytes.ts'

/** An operand's kind. `end` is a terminator byte (0x16, 0x15) kept as read. */
export type Arg =
  | 'expr'
  | 'obj'
  | 'name'
  | 'u8'
  | 'u16'
  | 'i32'
  | 'f32'
  | 'astr'
  | 'ustr'
  | 'params'
  | 'case'
  | 'labels'
  | 'end'
  | 'optexpr'

export interface TokenDef {
  name: string
  args: Arg[]
}

/** EExprToken, as Enemy Within's engine numbers them. */
export const TOKENS: Record<number, TokenDef> = {
  0x00: { name: 'LocalVariable', args: ['obj'] },
  0x01: { name: 'InstanceVariable', args: ['obj'] },
  0x02: { name: 'DefaultVariable', args: ['obj'] },
  0x03: { name: 'StateVariable', args: ['obj'] },
  0x04: { name: 'Return', args: ['expr'] },
  0x05: { name: 'Switch', args: ['obj', 'u8', 'expr'] },
  0x06: { name: 'Jump', args: ['u16'] },
  0x07: { name: 'JumpIfNot', args: ['u16', 'expr'] },
  0x08: { name: 'Stop', args: [] },
  0x09: { name: 'Assert', args: ['u16', 'u8', 'expr'] },
  0x0a: { name: 'Case', args: ['case'] },
  0x0b: { name: 'Nothing', args: [] },
  0x0c: { name: 'LabelTable', args: ['labels'] },
  0x0d: { name: 'GotoLabel', args: ['expr'] },
  0x0e: { name: 'EatReturnValue', args: ['obj', 'expr'] },
  0x0f: { name: 'Let', args: ['expr', 'expr'] },
  0x10: { name: 'DynArrayElement', args: ['expr', 'expr'] },
  0x11: { name: 'New', args: ['expr', 'expr', 'expr', 'expr', 'expr'] },
  0x12: { name: 'ClassContext', args: ['expr', 'u16', 'obj', 'u8', 'expr'] },
  0x13: { name: 'MetaCast', args: ['obj', 'expr'] },
  0x14: { name: 'LetBool', args: ['expr', 'expr'] },
  0x15: { name: 'EndParmValue', args: [] },
  0x16: { name: 'EndFunctionParms', args: [] },
  0x17: { name: 'Self', args: [] },
  0x18: { name: 'Skip', args: ['u16', 'expr'] },
  0x19: { name: 'Context', args: ['expr', 'u16', 'obj', 'u8', 'expr'] },
  0x1a: { name: 'ArrayElement', args: ['expr', 'expr'] },
  0x1b: { name: 'VirtualFunction', args: ['name', 'params'] },
  0x1c: { name: 'FinalFunction', args: ['obj', 'params'] },
  0x1d: { name: 'IntConst', args: ['i32'] },
  0x1e: { name: 'FloatConst', args: ['f32'] },
  0x1f: { name: 'StringConst', args: ['astr'] },
  0x20: { name: 'ObjectConst', args: ['obj'] },
  0x21: { name: 'NameConst', args: ['name'] },
  0x22: { name: 'RotationConst', args: ['i32', 'i32', 'i32'] },
  0x23: { name: 'VectorConst', args: ['f32', 'f32', 'f32'] },
  0x24: { name: 'ByteConst', args: ['u8'] },
  0x25: { name: 'IntZero', args: [] },
  0x26: { name: 'IntOne', args: [] },
  0x27: { name: 'True', args: [] },
  0x28: { name: 'False', args: [] },
  0x29: { name: 'NativeParm', args: ['obj'] },
  0x2a: { name: 'NoObject', args: [] },
  0x2c: { name: 'IntConstByte', args: ['u8'] },
  0x2d: { name: 'BoolVariable', args: ['expr'] },
  0x2e: { name: 'DynamicCast', args: ['obj', 'expr'] },
  0x2f: { name: 'Iterator', args: ['expr', 'u16'] },
  0x30: { name: 'IteratorPop', args: [] },
  0x31: { name: 'IteratorNext', args: [] },
  0x32: { name: 'StructCmpEq', args: ['obj', 'expr', 'expr'] },
  0x33: { name: 'StructCmpNe', args: ['obj', 'expr', 'expr'] },
  0x34: { name: 'UnicodeStringConst', args: ['ustr'] },
  0x35: { name: 'StructMember', args: ['obj', 'obj', 'u8', 'u8', 'expr'] },
  0x36: { name: 'DynArrayLength', args: ['expr'] },
  0x37: { name: 'GlobalFunction', args: ['name', 'params'] },
  0x38: { name: 'PrimitiveCast', args: ['u8', 'expr'] },
  0x39: { name: 'DynArrayInsert', args: ['expr', 'expr', 'expr', 'end'] },
  0x3a: { name: 'ReturnNothing', args: ['obj'] },
  0x3b: { name: 'EqualEqual_DelDel', args: ['params'] },
  0x3c: { name: 'NotEqual_DelDel', args: ['params'] },
  0x3d: { name: 'EqualEqual_DelFunc', args: ['params'] },
  0x3e: { name: 'NotEqual_DelFunc', args: ['params'] },
  0x3f: { name: 'EmptyDelegate', args: [] },
  0x40: { name: 'DynArrayRemove', args: ['expr', 'expr', 'expr', 'end'] },
  0x41: { name: 'DebugInfo', args: ['i32', 'i32', 'i32', 'u8'] },
  0x42: { name: 'DelegateFunction', args: ['u8', 'obj', 'name', 'params'] },
  0x43: { name: 'DelegateProperty', args: ['name', 'obj'] },
  0x44: { name: 'LetDelegate', args: ['expr', 'expr'] },
  0x45: { name: 'Conditional', args: ['expr', 'u16', 'expr', 'u16', 'expr'] },
  0x46: { name: 'DynArrayFind', args: ['expr', 'u16', 'expr', 'end'] },
  0x47: { name: 'DynArrayFindStruct', args: ['expr', 'u16', 'expr', 'expr', 'end'] },
  0x48: { name: 'LocalOutVariable', args: ['obj'] },
  0x49: { name: 'DefaultParmValue', args: ['u16', 'expr', 'end'] },
  0x4a: { name: 'EmptyParmValue', args: [] },
  0x4b: { name: 'InstanceDelegate', args: ['name'] },
  0x51: { name: 'InterfaceContext', args: ['expr'] },
  0x52: { name: 'InterfaceCast', args: ['obj', 'expr'] },
  0x53: { name: 'EndOfScript', args: [] },
  0x54: { name: 'DynArrayAdd', args: ['expr', 'expr', 'end'] },
  0x55: { name: 'DynArrayAddItem', args: ['expr', 'u16', 'expr', 'end'] },
  0x56: { name: 'DynArrayRemoveItem', args: ['expr', 'u16', 'expr', 'end'] },
  0x57: { name: 'DynArrayInsertItem', args: ['expr', 'u16', 'expr', 'expr', 'end'] },
  0x58: { name: 'DynArrayIterator', args: ['expr', 'expr', 'u8', 'expr', 'u16'] },
  0x59: { name: 'DynArraySort', args: ['expr', 'u16', 'expr', 'end'] },
  0x5a: { name: 'FilterEditorOnly', args: ['u16'] },
}

export const EX_EndFunctionParms = 0x16
export const EX_EndOfScript = 0x53
export const EX_ExtendedNative = 0x60
export const EX_FirstNative = 0x70

export interface NameValue {
  index: number
  number: number
}
export type Value = number | string | NameValue | Node | Node[] | Label[] | null
export interface Label {
  name: NameValue
  offset: number
}

export interface Node {
  /** The token byte (natives: 0x60–0x6f with `native` set, or the index ≥ 0x70). */
  op: number
  /** A native function's index, for native calls. */
  native?: number
  args: Value[]
  /** Where it starts: in the file, and in memory. */
  at: number
  mem: number
}

/** The token's name, for natives "Native(n)". */
export function tokenName(n: Node): string {
  if (n.native !== undefined) return `Native(${n.native})`
  return TOKENS[n.op]?.name ?? `Token(${n.op.toString(16)})`
}

class Decoder {
  private r: Reader
  /** Object references read so far: each is 4 more bytes in memory than in the file. */
  private refs = 0
  constructor(code: Uint8Array) {
    this.r = new Reader(code)
  }
  get at() {
    return this.r.o
  }
  get mem() {
    return this.r.o + 4 * this.refs
  }
  get done() {
    return this.r.left === 0
  }
  expr(): Node {
    const at = this.r.o
    const mem = this.mem
    const op = this.r.u8()
    if (op >= EX_FirstNative) return { op, native: op, args: [this.params()], at, mem }
    if (op >= EX_ExtendedNative) {
      const native = ((op - EX_ExtendedNative) << 8) | this.r.u8()
      return { op, native, args: [this.params()], at, mem }
    }
    const def = TOKENS[op]
    if (!def) throw new Error(`unknown token 0x${op.toString(16)} at ${at}`)
    const args: Value[] = []
    for (const a of def.args) args.push(this.arg(a, op))
    return { op, args, at, mem }
  }
  private arg(a: Arg, op: number): Value {
    const r = this.r
    switch (a) {
      case 'expr':
        return this.expr()
      case 'optexpr':
        return r.b[r.o] === EX_EndFunctionParms ? null : this.expr()
      case 'obj':
        this.refs++
        return r.i32()
      case 'name':
        return { index: r.i32(), number: r.i32() }
      case 'u8':
      case 'end':
        return r.u8()
      case 'u16':
        return r.u16()
      case 'i32':
        return r.i32()
      case 'f32':
        return r.f32()
      case 'astr': {
        const start = r.o
        while (r.b[r.o] !== 0) r.o++
        const s = new TextDecoder('latin1').decode(r.b.subarray(start, r.o))
        r.o++
        return s
      }
      case 'ustr': {
        let s = ''
        for (let c = r.u16(); c !== 0; c = r.u16()) s += String.fromCharCode(c)
        return s
      }
      case 'params':
        return this.params()
      case 'case': {
        const next = r.u16()
        return next === 0xffff ? [next, null] as unknown as Value : ([next, this.expr()] as unknown as Value)
      }
      case 'labels': {
        const labels: Label[] = []
        for (;;) {
          const name = { index: r.i32(), number: r.i32() }
          const offset = r.u32()
          labels.push({ name, offset })
          if (this.isNone(name)) break
        }
        return labels
      }
    }
    throw new Error(`operand ${a} of 0x${op.toString(16)}`)
  }
  /** Set by the caller: whether a name is None (ends a label table). */
  isNone: (n: NameValue) => boolean = () => false
  private params(): Node[] {
    const out: Node[] = []
    while (this.r.b[this.r.o] !== EX_EndFunctionParms) out.push(this.expr())
    this.r.o++
    return out
  }
}

export interface Script {
  /** The statements, in order; the last is EndOfScript. */
  statements: Node[]
  /** The script's size in memory, as we count it. */
  memSize: number
}

/** Decodes a script; `isNone` tells the None name (label tables end with it). */
export function decodeScript(code: Uint8Array, isNone: (n: NameValue) => boolean): Script {
  const d = new Decoder(code)
  d.isNone = isNone
  const statements: Node[] = []
  while (!d.done) statements.push(d.expr())
  return { statements, memSize: d.mem }
}

class Encoder {
  w = new Writer()
  refs = 0
  get mem() {
    return this.w.o + 4 * this.refs
  }
  expr(n: Node) {
    const w = this.w
    if (n.native !== undefined) {
      if (n.op >= EX_FirstNative) w.u8(n.op)
      else w.u8(EX_ExtendedNative + (n.native >> 8)).u8(n.native & 0xff)
      this.params(n.args[0] as Node[])
      return
    }
    w.u8(n.op)
    const def = TOKENS[n.op]
    if (!def) throw new Error(`unknown token 0x${n.op.toString(16)}`)
    def.args.forEach((a, i) => this.arg(a, n.args[i]!))
  }
  private arg(a: Arg, v: Value) {
    const w = this.w
    switch (a) {
      case 'expr':
        return this.expr(v as Node)
      case 'optexpr':
        if (v) this.expr(v as Node)
        return
      case 'obj':
        this.refs++
        w.i32(v as number)
        return
      case 'name': {
        const n = v as NameValue
        w.i32(n.index).i32(n.number)
        return
      }
      case 'u8':
      case 'end':
        w.u8(v as number)
        return
      case 'u16':
        w.u16(v as number)
        return
      case 'i32':
        w.i32(v as number)
        return
      case 'f32':
        w.f32(v as number)
        return
      case 'astr': {
        const s = v as string
        for (let i = 0; i < s.length; i++) w.u8(s.charCodeAt(i))
        w.u8(0)
        return
      }
      case 'ustr': {
        const s = v as string
        for (let i = 0; i < s.length; i++) w.u16(s.charCodeAt(i))
        w.u16(0)
        return
      }
      case 'params':
        return this.params(v as Node[])
      case 'case': {
        const [next, e] = v as unknown as [number, Node | null]
        w.u16(next)
        if (e) this.expr(e)
        return
      }
      case 'labels':
        for (const l of v as Label[]) w.i32(l.name.index).i32(l.name.number).u32(l.offset)
        return
    }
  }
  private params(ps: Node[]) {
    for (const p of ps) this.expr(p)
    this.w.u8(EX_EndFunctionParms)
  }
}

/** Encodes statements back to bytecode; with their memory size. */
export function encodeScript(statements: Node[]): { code: Uint8Array; memSize: number } {
  const e = new Encoder()
  for (const s of statements) e.expr(s)
  return { code: e.w.done(), memSize: e.mem }
}

/** Every node of a tree, depth first (the node before its operands). */
export function* walk(n: Node): Generator<Node> {
  yield n
  for (const v of n.args) {
    if (v && typeof v === 'object') {
      if (Array.isArray(v)) {
        for (const x of v as unknown[])
          if (x && typeof x === 'object' && 'op' in (x as object)) yield* walk(x as Node)
          else if (Array.isArray(x)) for (const y of x) if (y && typeof y === 'object' && 'op' in y) yield* walk(y as Node)
      } else if ('op' in v) yield* walk(v as Node)
    }
  }
}

/** A node's size in memory (its bytes, object references counted as 8). */
export function memSizeOf(n: Node): number {
  const e = new Encoder()
  e.expr(n)
  return e.mem
}
