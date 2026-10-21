// Bytecode to UnrealScript: a function's declaration (its modifiers,
// parameters with their defaults, locals) and its body, the jumps put back
// into if/else, while, do/until, foreach and switch. What fits no pattern is
// written with labels and goto (upkit's dialect; it compiles back the same).
//
// The output is meant to compile back to the same bytecode (compile.ts), so it
// says explicitly what the original compiler did implicitly: casts are
// written out, a skipped optional argument is an empty place.

import { decodeScript, TOKENS, type NameValue, type Node, type Value } from './bytecode.ts'
import type { Linker, Located } from './linker.ts'
import { readStructHead, type FunctionObj, type PropertyObj } from './objects.ts'
import type { Package } from './package.ts'
import { CPF, FUNC, typeOf, typeText } from './types.ts'

/** PrimitiveCast's codes (ECastToken): the type cast to, by code. */
export const CASTS: Record<number, string> = {
  0x36: 'Object', // InterfaceToObject: the compiler adds it (a class cast of an interface); not written
  0x37: 'bool', // InterfaceToBool
  0x39: 'vector', // RotatorToVector
  0x3a: 'int', // ByteToInt
  0x3b: 'bool', // ByteToBool
  0x3c: 'float', // ByteToFloat
  0x3d: 'byte', // IntToByte
  0x3e: 'bool', // IntToBool
  0x3f: 'float', // IntToFloat
  0x40: 'byte', // BoolToByte
  0x41: 'int', // BoolToInt
  0x42: 'float', // BoolToFloat
  0x43: 'byte', // FloatToByte
  0x44: 'int', // FloatToInt
  0x45: 'bool', // FloatToBool
  0x46: 'Interface', // ObjectToInterface
  0x47: 'bool', // ObjectToBool
  0x48: 'bool', // NameToBool
  0x49: 'byte', // StringToByte
  0x4a: 'int', // StringToInt
  0x4b: 'bool', // StringToBool
  0x4c: 'float', // StringToFloat
  0x4d: 'vector', // StringToVector
  0x4e: 'rotator', // StringToRotator
  0x4f: 'bool', // VectorToBool
  0x50: 'rotator', // VectorToRotator
  0x51: 'bool', // RotatorToBool
  0x52: 'string', // ByteToString
  0x53: 'string', // IntToString
  0x54: 'string', // BoolToString
  0x55: 'string', // FloatToString
  0x56: 'string', // ObjectToString
  0x57: 'string', // NameToString
  0x58: 'string', // VectorToString
  0x59: 'string', // RotatorToString
  0x5a: 'string', // DelegateToString
  0x60: 'name', // StringToName
}

/** A float as the shortest text that reads back to the same 32-bit value, with a point. */
export function floatText(v: number): string {
  if (!Number.isFinite(v)) return String(v)
  let s = ''
  for (let p = 1; p <= 9; p++) {
    s = String(Number(v.toPrecision(p)))
    if (Math.fround(Number(s)) === v) break
  }
  if (/e/.test(s)) {
    // Exponents written out: UnrealScript reads plain decimals.
    s = Number(s).toFixed(Math.min(45, Math.max(1, -Math.floor(Math.log10(Math.abs(v))) + 9)))
    s = s.replace(/0+$/, '').replace(/\.$/, '.0')
  }
  return s.includes('.') ? s : s + '.0'
}

export const stringText = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

interface Ex {
  text: string
  /** Binding: 0 for atoms and calls, the operator's precedence for operators. */
  prec: number
}
const atom = (text: string): Ex => ({ text, prec: 0 })

type Stmt =
  | { k: 'expr'; node: Node }
  | { k: 'if'; cond: Node; then: Stmt[]; else?: Stmt[] }
  | { k: 'while'; cond: Node; body: Stmt[] }
  | { k: 'do'; body: Stmt[]; cond: Node }
  | { k: 'foreach'; iter: Node; body: Stmt[] }
  | { k: 'switch'; node: Node; cases: { value: Node | null; body: Stmt[] }[] }
  | { k: 'break' }
  | { k: 'continue' }
  | { k: 'goto'; target: number }
  | { k: 'ifgoto'; cond: Node; target: number }
  | { k: 'label'; mem: number }

interface Ctx {
  breakTo?: number
  continueTo?: number
}

export class FunctionDecompiler {
  readonly linker: Linker
  readonly pkg: Package
  readonly ref: number
  private statements: Node[] = []
  private byMem = new Map<number, number>()
  private memEnd = 0
  private gotos = new Set<number>()
  /** Jump targets that need a label: known after a first pass. */
  private labelled = new Set<number>()
  private noneName: number

  constructor(linker: Linker, pkg: Package, ref: number) {
    this.linker = linker
    this.pkg = pkg
    this.ref = ref
    this.noneName = pkg.findName('None')
  }

  // --- Names and expressions -------------------------------------------------

  private nm(n: NameValue): string {
    return this.pkg.name(n)
  }
  private obj(ref: number): string {
    return ref ? this.pkg.objectName(ref) : 'none'
  }
  /** A function's object (for natives: by index), followed through the linker. */
  private fnAt(ref: number): (Located & { fn: FunctionObj }) | null {
    const at = this.linker.resolve(this.pkg, ref)
    if (!at) return null
    const o = this.linker.object(at)
    return o?.kind === 'function' ? { ...at, fn: o } : null
  }

  private args(ps: Node[]): string {
    const out = ps.map((p) => (p.op === 0x4a ? '' : this.ex(p).text))
    while (out.length && out[out.length - 1] === '') out.pop()
    return out.join(', ')
  }

  /** An expression, with its binding for parentheses. */
  ex(n: Node): Ex {
    const a = n.args
    if (n.native !== undefined) return this.nativeCall(n)
    switch (n.op) {
      case 0x00:
      case 0x01:
      case 0x03:
      case 0x48:
        return atom(this.obj(a[0] as number))
      case 0x02:
        return atom(`default.${this.obj(a[0] as number)}`)
      case 0x29:
        return atom(this.obj(a[0] as number))
      case 0x2d:
      case 0x18:
      case 0x0e:
      case 0x51:
        return this.ex(a[a.length - 1] as Node)
      case 0x0b:
        return atom('')
      case 0x0f:
      case 0x14:
      case 0x44:
        return { text: `${this.ex(a[0] as Node).text} = ${this.ex(a[1] as Node).text}`, prec: 100 }
      case 0x10:
      case 0x1a:
        return atom(`${this.paren(a[1] as Node, 0)}[${this.ex(a[0] as Node).text}]`)
      case 0x11: {
        const [outer, name, flags, cls, template] = a as Node[]
        const ps = [outer, name, flags].map((x) => (x!.op === 0x0b ? '' : this.ex(x!).text))
        while (ps.length && ps[ps.length - 1] === '') ps.pop()
        const head = ps.length ? `new (${ps.join(', ')}) ` : 'new '
        const tail = template && template.op !== 0x0b ? `(${this.ex(template).text})` : ''
        return atom(`${head}${this.paren(cls!, 0)}${tail}`)
      }
      case 0x12: {
        const inner = a[4] as Node
        const sep = inner.op === 0x02 ? '' : 'static.'
        return atom(`${this.paren(a[0] as Node, 0)}.${sep}${this.ex(inner).text}`)
      }
      case 0x19: {
        // A literal through an object (a patch's constant in place of a member): obj.(5), upkit's dialect.
        const m = a[4] as Node
        if ([0x1d, 0x2c, 0x25, 0x26, 0x24, 0x1e, 0x27, 0x28, 0x1f, 0x21, 0x2a].includes(m.op))
          return atom(`${this.paren(a[0] as Node, 0)}.(${this.ex(m).text})`)
        return atom(`${this.paren(a[0] as Node, 0)}.${this.ex(m).text}`)
      }
      case 0x13:
        return atom(`class<${this.obj(a[0] as number)}>(${this.ex(a[1] as Node).text})`)
      case 0x2e:
        return atom(`${this.obj(a[0] as number)}(${this.ex(a[1] as Node).text})`)
      // An interface from none or self: written as a cast (the compiler makes it an InterfaceCast).
      case 0x52:
        return atom(`${this.obj(a[0] as number)}(${this.ex(a[1] as Node).text})`)
      case 0x38: {
        // An interface made an object: the compiler's own step, not written.
        if (a[0] === 0x36) return this.ex(a[1] as Node)
        // A cast of a literal: byte(5) is a byte constant, so the cast is written byte(int(5)).
        const inner = a[1] as Node
        const lit = [0x1d, 0x2c, 0x25, 0x26].includes(inner.op) ? `int(${this.ex(inner).text})` : this.ex(inner).text
        return atom(`${CASTS[a[0] as number] ?? `cast${a[0]}`}(${lit})`)
      }
      case 0x17:
        return atom('self')
      case 0x1b:
        return atom(`${this.nm(a[0] as NameValue)}(${this.args(a[1] as Node[])})`)
      case 0x37:
        return atom(`global.${this.nm(a[0] as NameValue)}(${this.args(a[1] as Node[])})`)
      case 0x1c:
        return atom(`${this.finalName(a[0] as number)}(${this.args(a[1] as Node[])})`)
      // A delegate called: through its variable (the name is the delegate's signature).
      case 0x42:
        return atom(`${a[1] ? this.obj(a[1] as number) : this.nm(a[2] as NameValue)}(${this.args(a[3] as Node[])})`)
      case 0x43:
        return atom(this.nm(a[0] as NameValue))
      case 0x4b:
        return atom(this.nm(a[0] as NameValue))
      case 0x3f:
      case 0x2a:
        return atom('none')
      // Literals as the compiler writes them read back the same (0 IntZero, 1
      // IntOne, 2–255 IntConstByte, else IntConst); another form is written
      // in hex, which the compiler keeps (upkit's dialect).
      case 0x1d: {
        const v = a[0] as number
        return atom(v >= 0 && v <= 255 ? `0x${(v >>> 0).toString(16).padStart(8, '0')}` : String(v))
      }
      case 0x2c: {
        const v = a[0] as number
        return atom(v <= 1 ? `0x${v.toString(16).padStart(2, '0')}` : String(v))
      }
      case 0x24:
        return atom(`byte(${a[0]})`)
      case 0x25:
        return atom('0')
      case 0x26:
        return atom('1')
      case 0x27:
        return atom('true')
      case 0x28:
        return atom('false')
      case 0x1e:
        return atom(floatText(a[0] as number))
      case 0x1f:
      case 0x34:
        return atom(stringText(a[0] as string))
      case 0x21:
        return atom(`'${this.nm(a[0] as NameValue)}'`)
      case 0x20: {
        const ref = a[0] as number
        if (!ref) return atom('none')
        const cls = this.pkg.className(ref)
        const path = this.pkg.path(ref)
        return atom(cls === 'Class' ? `class'${path}'` : `${cls}'${path}'`)
      }
      case 0x22:
        return atom(`rot(${a[0]}, ${a[1]}, ${a[2]})`)
      case 0x23:
        return atom(`vect(${floatText(a[0] as number)}, ${floatText(a[1] as number)}, ${floatText(a[2] as number)})`)
      case 0x32:
      case 0x33:
        return {
          text: `${this.paren(a[1] as Node, 24)} ${n.op === 0x32 ? '==' : '!='} ${this.paren(a[2] as Node, 23)}`,
          prec: 24,
        }
      case 0x3b:
      case 0x3c:
      case 0x3d:
      case 0x3e: {
        const ps = a[0] as Node[]
        const op = n.op === 0x3b || n.op === 0x3d ? '==' : '!='
        return { text: `${this.paren(ps[0]!, 24)} ${op} ${this.paren(ps[1]!, 23)}`, prec: 24 }
      }
      case 0x35:
        return atom(`${this.paren(a[4] as Node, 0)}.${this.obj(a[0] as number)}`)
      case 0x36:
        return atom(`${this.paren(a[0] as Node, 0)}.Length`)
      case 0x45:
        return {
          text: `${this.paren(a[0] as Node, 50)} ? ${this.paren(a[2] as Node, 50)} : ${this.paren(a[4] as Node, 50)}`,
          prec: 51,
        }
      case 0x40:
        return atom(`${this.paren(a[0] as Node, 0)}.Remove(${this.ex(a[1] as Node).text}, ${this.ex(a[2] as Node).text})`)
      case 0x39:
        return atom(`${this.paren(a[0] as Node, 0)}.Insert(${this.ex(a[1] as Node).text}, ${this.ex(a[2] as Node).text})`)
      case 0x54:
        return atom(`${this.paren(a[0] as Node, 0)}.Add(${this.ex(a[1] as Node).text})`)
      case 0x55:
        return atom(`${this.paren(a[0] as Node, 0)}.AddItem(${this.ex(a[2] as Node).text})`)
      case 0x56:
        return atom(`${this.paren(a[0] as Node, 0)}.RemoveItem(${this.ex(a[2] as Node).text})`)
      case 0x57:
        return atom(`${this.paren(a[0] as Node, 0)}.InsertItem(${this.ex(a[2] as Node).text}, ${this.ex(a[3] as Node).text})`)
      case 0x46:
        return atom(`${this.paren(a[0] as Node, 0)}.Find(${this.ex(a[2] as Node).text})`)
      case 0x47:
        return atom(`${this.paren(a[0] as Node, 0)}.Find(${this.ex(a[2] as Node).text}, ${this.ex(a[3] as Node).text})`)
      case 0x59:
        return atom(`${this.paren(a[0] as Node, 0)}.Sort(${this.ex(a[2] as Node).text})`)
      case 0x2f:
        return this.ex(a[0] as Node)
      case 0x58: {
        const idx = a[2] ? `, ${this.ex(a[3] as Node).text}` : ''
        return atom(`${this.paren(a[0] as Node, 0)}(${this.ex(a[1] as Node).text}${idx})`)
      }
    }
    return atom(`__${TOKENS[n.op]?.name ?? n.op}`)
  }

  /** A child in parentheses when it binds looser than its place allows. */
  private paren(n: Node, max: number): string {
    const e = this.ex(n)
    return e.prec > max || (max === 0 && e.prec > 0) ? `(${e.text})` : e.text
  }

  /** A final function's name as called: itself, or super.Name / super(Class).Name for a parent's. */
  private finalName(ref: number): string {
    const name = this.obj(ref)
    const f = this.fnAt(ref)
    if (!f) return name
    // A final call to a function that is not final is a super call.
    if (!(f.fn.flags & FUNC.Final)) {
      const outer = f.pkg.outerOf(f.ref)
      // A state's function: its path (Class.State), upkit's dialect; a class's: its name.
      const owner = f.pkg.className(outer) === 'State' ? f.pkg.path(outer) : f.pkg.objectName(outer)
      return `super(${owner}).${name}`
    }
    return name
  }

  private nativeCall(n: Node): Ex {
    const ps = n.args[0] as Node[]
    const f = this.linker.native(n.native!)
    if (!f) return atom(`__native${n.native}(${this.args(ps)})`)
    const name = f.fn.friendlyName
    const flags = f.fn.flags
    if (flags & FUNC.Operator) {
      const prec = f.fn.precedence
      if (flags & FUNC.PreOperator) {
        // -5 is a negative literal; the operator on a literal is written -(5).
        const lit = [0x1d, 0x1e, 0x2c, 0x25, 0x26].includes(ps[0]!.op)
        return { text: lit ? `${name}(${this.ex(ps[0]!).text})` : `${name}${this.paren(ps[0]!, 0)}`, prec: 1 }
      }
      if (ps.length === 1) return { text: `${this.paren(ps[0]!, 0)}${name}`, prec: 1 }
      const word = /^[A-Za-z]/.test(name)
      // Left-associative: the right side needs parentheses at the same binding.
      return {
        text: `${this.paren(ps[0]!, prec)}${word ? ` ${name} ` : ` ${name} `}${this.paren(ps[1]!, prec - 1)}`,
        prec,
      }
    }
    return atom(`${name}(${this.args(ps)})`)
  }

  // --- Statements --------------------------------------------------------------

  private idx(mem: number): number {
    return this.byMem.get(mem) ?? -1
  }

  private block(lo: number, hi: number, ctx: Ctx): Stmt[] {
    const S = this.statements
    const out: Stmt[] = []
    const hiMem = hi < S.length ? S[hi]!.mem : this.memEnd
    for (let i = lo; i < hi; ) {
      const s = S[i]!
      if (this.labelled.has(s.mem) && out.at(-1)?.k !== 'label') out.push({ k: 'label', mem: s.mem })
      // A loop that starts here and ends with a jump back (do … until).
      const back = this.backJump(i, hi)
      if (back >= 0 && S[back]!.op === 0x07 && s.op !== 0x07) {
        out.push({
          k: 'do',
          body: this.block(i, back, { breakTo: back + 1 < S.length ? S[back + 1]!.mem : this.memEnd, continueTo: S[back]!.mem }),
          cond: S[back]!.args[1] as Node,
        })
        i = back + 1
        continue
      }
      switch (s.op) {
        case 0x07: {
          const T = s.args[0] as number
          const cond = s.args[1] as Node
          const t = T === hiMem ? hi : this.idx(T)
          if (t > i && t <= hi) {
            const last = S[t - 1]!
            if (last.op === 0x06 && (last.args[0] as number) === s.mem) {
              out.push({ k: 'while', cond, body: this.block(i + 1, t - 1, { breakTo: T, continueTo: s.mem }) })
              i = t
              continue
            }
            if (last.op === 0x06 && t - 1 > i) {
              const J = last.args[0] as number
              const isBreak = J === ctx.breakTo || J === ctx.continueTo
              const e = J === hiMem ? hi : this.idx(J)
              if (!isBreak && J > T && e > t - 1 && e <= hi) {
                out.push({ k: 'if', cond, then: this.block(i + 1, t - 1, ctx), else: this.block(t, e, ctx) })
                i = e
                continue
              }
            }
            out.push({ k: 'if', cond, then: this.block(i + 1, t, ctx) })
            i = t
            continue
          }
          this.gotos.add(T)
          out.push({ k: 'ifgoto', cond, target: T })
          i++
          continue
        }
        case 0x06: {
          const J = s.args[0] as number
          if (J === ctx.breakTo) out.push({ k: 'break' })
          else if (J === ctx.continueTo) out.push({ k: 'continue' })
          else {
            this.gotos.add(J)
            out.push({ k: 'goto', target: J })
          }
          i++
          continue
        }
        case 0x2f:
        case 0x58: {
          const E = s.args[s.op === 0x2f ? 1 : 4] as number
          const pop = this.idx(E)
          if (pop > i && pop <= hi && S[pop]!.op === 0x30 && S[pop - 1]!.op === 0x31) {
            out.push({
              k: 'foreach',
              iter: s,
              body: this.block(i + 1, pop - 1, { breakTo: E, continueTo: S[pop - 1]!.mem }),
            })
            i = pop + 1
            continue
          }
          break
        }
        case 0x05: {
          const sw = this.switchAt(i, hi, ctx)
          if (sw) {
            out.push(sw.stmt)
            i = sw.end
            continue
          }
          break
        }
      }
      out.push({ k: 'expr', node: s })
      i++
    }
    return out
  }

  /** A later jump in [i, hi) back to statement i: the index of the last such, or −1. */
  private backJump(i: number, hi: number): number {
    const S = this.statements
    const m = S[i]!.mem
    let found = -1
    for (let j = i + 1; j < hi; j++) {
      const s = S[j]!
      if ((s.op === 0x07 || s.op === 0x06) && (s.args[0] as number) === m) found = j
    }
    return found
  }

  private switchAt(i: number, hi: number, ctx: Ctx): { stmt: Stmt; end: number } | null {
    const S = this.statements
    const cases: number[] = []
    let c = i + 1
    while (c < hi && S[c]!.op === 0x0a) {
      cases.push(c)
      const [next] = S[c]!.args[0] as unknown as [number]
      if (next === 0xffff) break
      const n = this.idx(next)
      if (n <= c) {
        // The last case's next is the end of the switch.
        if (next === (hi < S.length ? S[hi]!.mem : this.memEnd)) c = hi
        break
      }
      c = n
    }
    if (!cases.length) return null
    // The end: where the cases' breaks go, beyond the last case; else the range's end.
    const lastCase = cases[cases.length - 1]!
    let endMem = -1
    for (let j = i + 1; j < hi; j++) {
      const s = S[j]!
      if (s.op === 0x06 && (s.args[0] as number) > S[lastCase]!.mem && (s.args[0] as number) !== ctx.breakTo && (s.args[0] as number) !== ctx.continueTo)
        endMem = Math.max(endMem, s.args[0] as number)
    }
    const [lastNext] = S[lastCase]!.args[0] as unknown as [number]
    if (lastNext !== 0xffff && endMem < 0) endMem = lastNext
    const end = endMem < 0 ? hi : endMem === (hi < S.length ? S[hi]!.mem : this.memEnd) ? hi : this.idx(endMem)
    if (end <= i || end > hi) return null
    const breakTo = end < S.length ? S[end]!.mem : this.memEnd
    const out: { value: Node | null; body: Stmt[] }[] = []
    for (let k = 0; k < cases.length; k++) {
      const at = cases[k]!
      const bodyEnd = k + 1 < cases.length ? cases[k + 1]! : end
      const [, value] = S[at]!.args[0] as unknown as [number, Node | null]
      out.push({ value, body: this.block(at + 1, bodyEnd, { ...ctx, breakTo }) })
    }
    return { stmt: { k: 'switch', node: S[i]!, cases: out }, end }
  }

  // --- Output ------------------------------------------------------------------

  private lines(stmts: Stmt[], depth: number, out: string[]) {
    const pad = '    '.repeat(depth)
    for (const s of stmts) {
      switch (s.k) {
        case 'expr':
          out.push(pad + this.stmtText(s.node))
          break
        case 'if': {
          out.push(`${pad}if (${this.ex(s.cond).text})`, `${pad}{`)
          this.lines(s.then, depth + 1, out)
          out.push(`${pad}}`)
          if (s.else) {
            out.push(`${pad}else`, `${pad}{`)
            this.lines(s.else, depth + 1, out)
            out.push(`${pad}}`)
          }
          break
        }
        case 'while':
          out.push(`${pad}while (${this.ex(s.cond).text})`, `${pad}{`)
          this.lines(s.body, depth + 1, out)
          out.push(`${pad}}`)
          break
        case 'do':
          out.push(`${pad}do`, `${pad}{`)
          this.lines(s.body, depth + 1, out)
          out.push(`${pad}} until (${this.ex(s.cond).text});`)
          break
        case 'foreach':
          out.push(`${pad}foreach ${this.ex(s.iter).text}`, `${pad}{`)
          this.lines(s.body, depth + 1, out)
          out.push(`${pad}}`)
          break
        case 'switch':
          out.push(`${pad}switch (${this.ex(s.node.args[2] as Node).text})`, `${pad}{`)
          for (const c of s.cases) {
            out.push(c.value ? `${pad}    case ${this.ex(c.value).text}:` : `${pad}    default:`)
            this.lines(c.body, depth + 2, out)
          }
          out.push(`${pad}}`)
          break
        case 'break':
          out.push(`${pad}break;`)
          break
        case 'continue':
          out.push(`${pad}continue;`)
          break
        case 'goto':
          out.push(`${pad}goto L${s.target};`)
          break
        case 'ifgoto':
          out.push(`${pad}if (!(${this.ex(s.cond).text})) goto L${s.target};`)
          break
        case 'label':
          out.push(`${'    '.repeat(Math.max(0, depth - 1))}L${s.mem}:`)
          break
      }
    }
  }

  private stmtText(n: Node): string {
    switch (n.op) {
      case 0x04: {
        const v = n.args[0] as Node
        return v.op === 0x0b || v.op === 0x3a ? 'return;' : `return ${this.ex(v).text};`
      }
      case 0x0b:
        return ';'
      case 0x08:
        return 'stop;'
      case 0x09:
        return `assert(${this.ex(n.args[2] as Node).text});`
      case 0x0d:
        return `goto ${this.ex(n.args[0] as Node).text};`
      case 0x31:
        return '__IteratorNext;'
      case 0x30:
        return '__IteratorPop;'
      case 0x41:
        return '// debug info'
    }
    return `${this.ex(n).text};`
  }

  // --- The function ------------------------------------------------------------

  /** The function's UnrealScript: declaration and body. */
  decompile(): string {
    const pkg = this.pkg
    const at: Located = { pkg, ref: this.ref }
    const fn = this.linker.object(at) as FunctionObj
    const head = fn.head
    // Parameters, return value and locals, in declaration order.
    const params: { p: PropertyObj; ref: number }[] = []
    const locals: { p: PropertyObj; ref: number }[] = []
    let ret: PropertyObj | null = null
    let retRef = 0
    for (let c = head.children; c; ) {
      const o = this.linker.object({ pkg, ref: c })
      if (!o || o.kind !== 'property') break
      if (o.flags & CPF.ReturnParm) {
        ret = o
        retRef = c
      } else if (o.flags & CPF.Parm) params.push({ p: o, ref: c })
      else locals.push({ p: o, ref: c })
      c = o.next
    }
    const code = pkg.data(this.ref).subarray(head.scriptAt, head.end)
    const script = head.size ? decodeScript(code, (n) => n.index === this.noneName) : { statements: [], memSize: 0 }
    let S = script.statements
    // Optional parameters' defaults open the script, one per optional parameter.
    const defaults = new Map<number, Node | null>()
    const optional = params.filter((x) => x.p.flags & CPF.OptionalParm)
    // A slot per optional parameter: DefaultParmValue, or Nothing without a default.
    let k = 0
    for (const o of optional) {
      const s = S[k]
      if (s && s.op === 0x49) {
        defaults.set(o.ref, s.args[1] as Node)
        k++
      } else if (s && s.op === 0x0b) k++
      else break
    }
    S = S.slice(k)
    // The epilogue the compiler adds: return (with the return value) and the end.
    let n = S.length
    if (n && S[n - 1]!.op === 0x53) n--
    // (A function with a value: return with ReturnNothing; without: return nothing.)
    let epilogue = false
    if (n && S[n - 1]!.op === 0x04 && [0x3a, 0x0b].includes((S[n - 1]!.args[0] as Node).op)) {
      n--
      epilogue = true
    }
    this.statements = S.slice(0, n)
    this.memEnd = n < S.length ? S[n]!.mem : script.memSize
    this.byMem = new Map(this.statements.map((s, i) => [s.mem, i]))
    // Structured twice: the first pass finds the jumps that stay gotos, the second labels their targets.
    this.gotos = new Set()
    this.labelled = new Set()
    this.block(0, this.statements.length, {})
    this.labelled = new Set(this.gotos)
    this.gotos = new Set()
    const body = this.block(0, this.statements.length, {})

    const lines: string[] = []
    lines.push(this.signature(fn, params, ret, defaults))
    // A native function declared in script: no body, or the stub the compiler
    // writes for it (each parameter as NativeParm, then nothing).
    const stub =
      S.length === params.length + 2 &&
      params.every((p, i) => S[i]?.op === 0x29 && (S[i]!.args[0] as number) === p.ref) &&
      S[params.length]?.op === 0x0b &&
      S[params.length + 1]?.op === 0x53
    const nativeBody = !!(fn.flags & FUNC.Native) && (!head.size || stub)
    if (nativeBody) return lines[0] + ';\n'
    lines.push('{')
    for (const l of locals) lines.push(`    local ${this.typeOf(l)} ${pkg.objectName(l.ref)}${this.dims(l.p)};`)
    if (locals.length) lines.push('')
    this.lines(body, 1, lines)
    // A jump to the very end (past the last statement).
    if (this.labelled.has(this.memEnd) || this.gotos.has(this.memEnd)) lines.push(`L${this.memEnd}:`)
    // A script without the compiler's closing return (a hand patch): said, so it compiles back the same.
    if (!epilogue && head.size) lines.push('    __NoEpilogue;')
    lines.push('}')
    void retRef
    return lines.join('\n') + '\n'
  }

  private typeOf(x: { p: PropertyObj; ref: number }): string {
    return typeText(typeOf(this.linker, { pkg: this.pkg, ref: x.ref }, x.p))
  }
  private dims(p: PropertyObj): string {
    return p.arrayDim > 1 ? `[${p.arrayDim}]` : ''
  }

  private signature(
    fn: FunctionObj,
    params: { p: PropertyObj; ref: number }[],
    ret: PropertyObj | null,
    defaults: Map<number, Node | null>,
  ): string {
    const f = fn.flags
    const mods: string[] = []
    if (f & FUNC.Private) mods.push('private')
    if (f & FUNC.Protected) mods.push('protected')
    if (f & FUNC.Native) mods.push(fn.native ? `native(${fn.native})` : 'native')
    if (f & FUNC.Static) mods.push('static')
    if (f & FUNC.Final) mods.push('final')
    if (f & FUNC.Simulated) mods.push('simulated')
    if (f & FUNC.Singular) mods.push('singular')
    if (f & FUNC.Exec) mods.push('exec')
    if (f & FUNC.Latent) mods.push('latent')
    if (f & FUNC.Iterator) mods.push('iterator')
    if (f & FUNC.Net) {
      mods.push(f & FUNC.NetReliable ? 'reliable' : 'unreliable')
      mods.push(f & FUNC.NetServer ? 'server' : 'client')
    }
    let kind = f & FUNC.Delegate ? 'delegate' : f & FUNC.Event ? 'event' : 'function'
    if (f & FUNC.Operator) kind = f & FUNC.PreOperator ? 'preoperator' : `operator(${fn.precedence})`
    const name = fn.friendlyName
    const ps = params.map((x) => {
      const pm: string[] = []
      if (x.p.flags & CPF.OptionalParm) pm.push('optional')
      if (x.p.flags & CPF.OutParm) pm.push('out')
      if (x.p.flags & CPF.CoerceParm) pm.push('coerce')
      if (x.p.flags & CPF.Const) pm.push('const')
      pm.push(this.typeOf(x), this.pkg.objectName(x.ref) + this.dims(x.p))
      const d = defaults.get(x.ref)
      if (d) pm.push('=', this.ex(d).text)
      return pm.join(' ')
    })
    const retText = ret ? `${typeText(typeOf(this.linker, { pkg: this.pkg, ref: 0 } as Located, ret))} ` : ''
    const cst = f & FUNC.Const ? ' const' : ''
    return `${[...mods, kind].join(' ')} ${retText}${name}(${ps.join(', ')})${cst}`
  }
}

/** A function's UnrealScript (by its path in the package). */
export function decompileFunction(linker: Linker, pkg: Package, path: string): string {
  const ref = pkg.find(path)
  if (!ref) throw new Error(`no ${path}`)
  return new FunctionDecompiler(linker, pkg, ref).decompile()
}

void readStructHead
void (null as unknown as Value)
