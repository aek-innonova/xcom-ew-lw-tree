// UnrealScript source to a syntax tree: a function's declaration (for its
// parameters' defaults) and its body. Covers what the decompiler writes and
// the UnrealScript a modder writes in a function: statements, expressions with
// operators, calls, members, casts, literals.

export type Tok = { t: 'id' | 'int' | 'float' | 'str' | 'name' | 'op' | 'eof'; v: string; pos: number; space: boolean }

const OPS = [
  '>>>=', '>>>', '<<=', '>>=', '...',
  '==', '!=', '<=', '>=', '&&', '||', '^^', '++', '--', '+=', '-=', '*=', '/=', '$=', '@=', '<<', '>>', '**', '~=', '::',
  '+', '-', '*', '/', '%', '<', '>', '!', '~', '&', '|', '^', '=', '(', ')', '[', ']', '{', '}', ',', ';', ':', '.', '?', '$', '@', '#',
]

export function lex(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  let space = true
  while (i < src.length) {
    const c = src[i]!
    if (/\s/.test(c)) {
      i++
      space = true
      continue
    }
    if (src.startsWith('//', i)) {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    if (src.startsWith('/*', i)) {
      const e = src.indexOf('*/', i + 2)
      i = e < 0 ? src.length : e + 2
      continue
    }
    const pos = i
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1
      while (j < src.length && /\w/.test(src[j]!)) j++
      out.push({ t: 'id', v: src.slice(i, j), pos, space })
      i = j
    } else if (/\d/.test(c) || (c === '.' && /\d/.test(src[i + 1] ?? ''))) {
      let j = i
      if (src.startsWith('0x', i) || src.startsWith('0X', i)) {
        j = i + 2
        while (j < src.length && /[\da-f]/i.test(src[j]!)) j++
        out.push({ t: 'int', v: src.slice(i, j), pos, space })
      } else {
        while (j < src.length && /\d/.test(src[j]!)) j++
        let float = false
        if (src[j] === '.' && /\d/.test(src[j + 1] ?? '')) {
          float = true
          j++
          while (j < src.length && /\d/.test(src[j]!)) j++
        } else if (src[j] === '.' && !/[A-Za-z_]/.test(src[j + 1] ?? '')) {
          float = true
          j++
        }
        if (/[eE]/.test(src[j] ?? '') && /[-+\d]/.test(src[j + 1] ?? '')) {
          float = true
          j++
          if (/[-+]/.test(src[j]!)) j++
          while (j < src.length && /\d/.test(src[j]!)) j++
        }
        if (/[fF]/.test(src[j] ?? '')) {
          float = true
          j++
        }
        out.push({ t: float ? 'float' : 'int', v: src.slice(i, j).replace(/[fF]$/, ''), pos, space })
      }
      i = j
    } else if (c === '"') {
      let j = i + 1
      let v = ''
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\\' && j + 1 < src.length) {
          const n = src[j + 1]!
          v += n === 'n' ? '\n' : n === 't' ? '\t' : n
          j += 2
        } else v += src[j++]
      }
      out.push({ t: 'str', v, pos, space })
      i = j + 1
    } else if (c === "'") {
      const j = src.indexOf("'", i + 1)
      if (j < 0) throw new Error(`unclosed name at ${i}`)
      out.push({ t: 'name', v: src.slice(i + 1, j), pos, space })
      i = j + 1
    } else {
      const op = OPS.find((o) => src.startsWith(o, i))
      if (!op) throw new Error(`unexpected '${c}' at ${i}`)
      out.push({ t: 'op', v: op, pos, space })
      i += op.length
    }
    space = false
  }
  out.push({ t: 'eof', v: '', pos: src.length, space: true })
  return out
}

export type Expr =
  | { k: 'int'; v: number; hex?: number }
  | { k: 'float'; v: number }
  | { k: 'str'; v: string }
  | { k: 'name'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'none' }
  | { k: 'self' }
  | { k: 'id'; name: string }
  | { k: 'objlit'; cls: string; path: string }
  | { k: 'call'; fn: Expr; args: (Expr | null)[] }
  | { k: 'member'; obj: Expr; name: string }
  | { k: 'ctxlit'; obj: Expr; e: Expr }
  | { k: 'static'; obj: Expr; name: string }
  | { k: 'defmember'; obj: Expr; name: string }
  | { k: 'default'; name: string }
  | { k: 'super'; cls: string | null; name: string }
  | { k: 'global'; name: string }
  | { k: 'index'; arr: Expr; idx: Expr }
  | { k: 'pre'; op: string; e: Expr }
  | { k: 'post'; op: string; e: Expr }
  | { k: 'bin'; op: string; l: Expr; r: Expr }
  | { k: 'assign'; l: Expr; r: Expr }
  | { k: 'cond'; c: Expr; a: Expr; b: Expr }
  | { k: 'metacast'; cls: string; e: Expr }
  | { k: 'new'; args: (Expr | null)[]; cls: Expr; template: Expr | null }
  | { k: 'rot'; v: [Expr, Expr, Expr] }
  | { k: 'vect'; v: [Expr, Expr, Expr] }

export type Stmt =
  | { k: 'expr'; e: Expr }
  | { k: 'nothing' }
  | { k: 'block'; body: Stmt[] }
  | { k: 'if'; c: Expr; then: Stmt[]; else: Stmt[] | null }
  | { k: 'while'; c: Expr; body: Stmt[] }
  | { k: 'do'; body: Stmt[]; c: Expr }
  | { k: 'for'; init: Expr | null; c: Expr; step: Expr | null; body: Stmt[] }
  | { k: 'foreach'; e: Expr; body: Stmt[] }
  | { k: 'switch'; e: Expr; cases: { v: Expr | null; body: Stmt[] }[] }
  | { k: 'break' }
  | { k: 'continue' }
  | { k: 'return'; e: Expr | null }
  | { k: 'goto'; label: string }
  | { k: 'ifgoto'; c: Expr; label: string }
  | { k: 'label'; name: string }
  | { k: 'assert'; e: Expr }
  | { k: 'stop' }

export interface FunctionSource {
  name: string
  /** Parameters' default values, by parameter name (lower case). */
  defaults: Map<string, Expr>
  body: Stmt[] | null
}

/** Binary operators' binding (UnrealScript's precedences; lower binds tighter). */
export const BINARY: Record<string, number> = {
  '**': 12,
  '*': 16,
  '/': 16,
  '%': 18,
  dot: 16,
  cross: 16,
  '+': 20,
  '-': 20,
  '<<': 22,
  '>>': 22,
  '>>>': 22,
  '<': 24,
  '>': 24,
  '<=': 24,
  '>=': 24,
  '==': 24,
  '~=': 24,
  '!=': 26,
  '&': 28,
  '^': 28,
  '|': 28,
  '&&': 30,
  '^^': 30,
  '||': 32,
  '$': 40,
  '@': 40,
  '*=': 34,
  '/=': 34,
  '+=': 34,
  '-=': 34,
  '$=': 44,
  '@=': 44,
  ClockwiseFrom: 24,
}

export class Parser {
  private toks: Tok[]
  private i = 0
  /** Word operators the package knows (dot, cross, ClockwiseFrom …), with their binding. */
  binary: Record<string, number>
  constructor(src: string, binary: Record<string, number> = BINARY) {
    this.toks = lex(src)
    this.binary = binary
  }
  private get t(): Tok {
    return this.toks[this.i]!
  }
  private peek(k = 1): Tok {
    return this.toks[Math.min(this.i + k, this.toks.length - 1)]!
  }
  private is(v: string): boolean {
    return (this.t.t === 'op' || this.t.t === 'id') && this.t.v.toLowerCase() === v.toLowerCase()
  }
  private eat(v: string): boolean {
    if (this.is(v)) {
      this.i++
      return true
    }
    return false
  }
  private want(v: string) {
    if (!this.eat(v)) throw new Error(`expected '${v}' at ${this.t.pos}, found '${this.t.v}'`)
  }
  private id(): string {
    if (this.t.t !== 'id') throw new Error(`expected a name at ${this.t.pos}, found '${this.t.v}'`)
    return this.toks[this.i++]!.v
  }

  /** A whole function: declaration and body (null for a declaration without one). */
  function(): FunctionSource {
    // Modifiers and the kind, up to the name before the parameter list.
    // Modifiers with an argument (native(129), operator(16)) are skipped; the
    // name is the token before the parameter list: a word, or an operator's symbol.
    let name = ''
    for (;;) {
      if (this.t.t === 'eof') throw new Error('no function declaration')
      if (this.t.t === 'id' && /^(native|operator)$/i.test(this.t.v) && this.peek().v === '(') {
        while (!this.eat(')')) this.i++
        continue
      }
      if (this.peek().v === '(' && (this.t.t === 'id' || this.t.t === 'op')) break
      this.i++
    }
    name = this.toks[this.i++]!.v
    this.want('(')
    const defaults = new Map<string, Expr>()
    while (!this.eat(')')) {
      let last = ''
      while (!this.is(',') && !this.is(')') && !this.is('=')) {
        if (this.t.t === 'id') last = this.t.v
        if (this.is('<')) {
          // array<…>, class<…>, delegate<…>
          let d = 0
          do {
            if (this.is('<')) d++
            if (this.is('>')) d--
            this.i++
          } while (d > 0)
          continue
        }
        if (this.is('[')) {
          while (!this.eat(']')) this.i++
          continue
        }
        this.i++
      }
      if (this.eat('=')) defaults.set(last.toLowerCase(), this.expr())
      this.eat(',')
    }
    this.eat('const')
    if (this.eat(';')) return { name, defaults, body: null }
    return { name, defaults, body: this.block() }
  }

  block(): Stmt[] {
    this.want('{')
    const out: Stmt[] = []
    while (!this.eat('}')) {
      const s = this.statement()
      if (s) out.push(s)
    }
    return out
  }
  private body(): Stmt[] {
    if (this.is('{')) return this.block()
    const s = this.statement()
    return s ? [s] : []
  }

  statement(): Stmt | null {
    const t = this.t
    if (this.eat(';')) return { k: 'nothing' }
    if (this.is('{')) return { k: 'block', body: this.block() }
    if (t.t === 'id') {
      const w = t.v.toLowerCase()
      // A label: "Name:" (not "default:" or a case).
      if (this.peek().v === ':' && w !== 'default' && this.peek().t === 'op') {
        this.i += 2
        return { k: 'label', name: t.v }
      }
      switch (w) {
        case 'local': {
          while (!this.eat(';')) this.i++
          return null
        }
        case 'if': {
          this.i++
          this.want('(')
          const c = this.expr()
          this.want(')')
          // upkit's dialect: "if (!(c)) goto L;" is a conditional jump on c.
          if (this.is('goto') && c.k === 'pre' && c.op === '!' ) {
            this.i++
            const label = this.id()
            this.want(';')
            return { k: 'ifgoto', c: c.e, label }
          }
          const then = this.body()
          const els = this.eat('else') ? this.body() : null
          return { k: 'if', c, then, else: els }
        }
        case 'while': {
          this.i++
          this.want('(')
          const c = this.expr()
          this.want(')')
          return { k: 'while', c, body: this.body() }
        }
        case 'do': {
          this.i++
          const body = this.body()
          this.want('until')
          this.want('(')
          const c = this.expr()
          this.want(')')
          this.eat(';')
          return { k: 'do', body, c }
        }
        case 'for': {
          this.i++
          this.want('(')
          const init = this.is(';') ? null : this.expr()
          this.want(';')
          const c = this.expr()
          this.want(';')
          const step = this.is(')') ? null : this.expr()
          this.want(')')
          return { k: 'for', init, c, step, body: this.body() }
        }
        case 'foreach': {
          this.i++
          const e = this.expr()
          return { k: 'foreach', e, body: this.body() }
        }
        case 'switch': {
          this.i++
          this.want('(')
          const e = this.expr()
          this.want(')')
          this.want('{')
          const cases: { v: Expr | null; body: Stmt[] }[] = []
          while (!this.eat('}')) {
            let v: Expr | null = null
            if (this.eat('case')) v = this.expr()
            else this.want('default')
            this.want(':')
            const body: Stmt[] = []
            while (!this.is('case') && !this.is('default') && !this.is('}')) {
              const s = this.statement()
              if (s) body.push(s)
            }
            cases.push({ v, body })
          }
          return { k: 'switch', e, cases }
        }
        case 'break':
          this.i++
          this.want(';')
          return { k: 'break' }
        case 'continue':
          this.i++
          this.want(';')
          return { k: 'continue' }
        case 'return': {
          this.i++
          const e = this.is(';') ? null : this.expr()
          this.want(';')
          return { k: 'return', e }
        }
        case 'goto': {
          this.i++
          const label = this.t.t === 'name' ? this.toks[this.i++]!.v : this.id()
          this.want(';')
          return { k: 'goto', label }
        }
        case 'assert': {
          this.i++
          this.want('(')
          const e = this.expr()
          this.want(')')
          this.want(';')
          return { k: 'assert', e }
        }
        case 'stop':
          this.i++
          this.want(';')
          return { k: 'stop' }
      }
    }
    const e = this.expr()
    this.want(';')
    return { k: 'expr', e }
  }

  expr(): Expr {
    const l = this.ternary()
    if (this.eat('=')) return { k: 'assign', l, r: this.expr() }
    return l
  }
  private ternary(): Expr {
    const c = this.binaryExpr(100)
    if (this.eat('?')) {
      const a = this.ternary()
      this.want(':')
      const b = this.ternary()
      return { k: 'cond', c, a, b }
    }
    return c
  }
  private binOp(): { op: string; prec: number } | null {
    const t = this.t
    if (t.t === 'op' && t.v in this.binary) return { op: t.v, prec: this.binary[t.v]! }
    if (t.t === 'id') {
      const k = Object.keys(this.binary).find((x) => x.toLowerCase() === t.v.toLowerCase() && /^[A-Za-z]/.test(x))
      if (k) return { op: k, prec: this.binary[k]! }
    }
    return null
  }
  private binaryExpr(max: number): Expr {
    let l = this.unary()
    for (;;) {
      const o = this.binOp()
      if (!o || o.prec > max) return l
      this.i++
      // Left-associative: the right side binds tighter.
      const r = this.binaryExpr(o.prec - 1)
      l = { k: 'bin', op: o.op, l, r }
    }
  }
  private unary(): Expr {
    // -5: a negative literal (the operator on a literal is written -(5)).
    if (this.t.t === 'op' && this.t.v === '-' && (this.peek().t === 'int' || this.peek().t === 'float') && !this.peek().space) {
      this.i++
      const e = this.primary() as { k: 'int' | 'float'; v: number }
      return { ...e, v: -e.v } as Expr
    }
    for (const op of ['!', '-', '~', '++', '--']) if (this.t.t === 'op' && this.t.v === op) {
      this.i++
      return { k: 'pre', op, e: this.unary() }
    }
    return this.postfix()
  }
  private args(): (Expr | null)[] {
    const out: (Expr | null)[] = []
    if (this.eat(')')) return out
    for (;;) {
      if (this.is(',') || this.is(')')) out.push(null)
      else out.push(this.expr())
      if (this.eat(')')) return out
      this.want(',')
    }
  }
  private postfix(): Expr {
    let e = this.primary()
    for (;;) {
      if (this.eat('(')) e = { k: 'call', fn: e, args: this.args() }
      else if (this.eat('[')) {
        const idx = this.expr()
        this.want(']')
        e = { k: 'index', arr: e, idx }
      } else if (this.is('.')) {
        this.i++
        if (this.eat('(')) {
          const lit = this.expr()
          this.want(')')
          e = { k: 'ctxlit', obj: e, e: lit }
          continue
        }
        const name = this.id()
        if (name.toLowerCase() === 'static') e = { k: 'static', obj: e, name: (this.want('.'), this.id()) }
        else if (name.toLowerCase() === 'default') e = { k: 'defmember', obj: e, name: (this.want('.'), this.id()) }
        else e = { k: 'member', obj: e, name }
      } else if (this.t.t === 'op' && (this.t.v === '++' || this.t.v === '--')) {
        e = { k: 'post', op: this.toks[this.i++]!.v, e }
      } else return e
    }
  }
  private primary(): Expr {
    const t = this.t
    switch (t.t) {
      case 'int': {
        this.i++
        // 0x… keeps its width: two digits IntConstByte, eight IntConst (upkit's dialect).
        if (/^0x/i.test(t.v)) return { k: 'int', v: parseInt(t.v.slice(2), 16), hex: t.v.length - 2 }
        return { k: 'int', v: Number(t.v) }
      }
      case 'float':
        this.i++
        return { k: 'float', v: Number(t.v) }
      case 'str':
        this.i++
        return { k: 'str', v: t.v }
      case 'name':
        this.i++
        return { k: 'name', v: t.v }
    }
    if (this.eat('(')) {
      const e = this.expr()
      this.want(')')
      return e
    }
    if (t.t !== 'id') throw new Error(`unexpected '${t.v}' at ${t.pos}`)
    const w = t.v.toLowerCase()
    this.i++
    // Cls'Path' (no space between): an object literal.
    if (this.t.t === 'name' && !this.t.space) return { k: 'objlit', cls: t.v, path: this.toks[this.i++]!.v }
    switch (w) {
      case 'true':
        return { k: 'bool', v: true }
      case 'false':
        return { k: 'bool', v: false }
      case 'none':
        return { k: 'none' }
      case 'self':
        return { k: 'self' }
      case 'default':
        if (this.eat('.')) return { k: 'default', name: this.id() }
        break
      case 'global':
        this.want('.')
        return { k: 'global', name: this.id() }
      case 'super': {
        let cls: string | null = null
        if (this.eat('(')) {
          cls = this.id()
          while (this.eat('.')) cls += '.' + this.id()
          this.want(')')
        }
        this.want('.')
        return { k: 'super', cls, name: this.id() }
      }
      case 'class':
        if (this.is('<')) {
          this.i++
          const cls = this.id()
          this.want('>')
          this.want('(')
          const e = this.expr()
          this.want(')')
          return { k: 'metacast', cls, e }
        }
        break
      case 'new': {
        let args: (Expr | null)[] = []
        if (this.eat('(')) args = this.args()
        const cls = this.postfixNoCall()
        let template: Expr | null = null
        if (this.eat('(')) {
          template = this.expr()
          this.want(')')
        }
        return { k: 'new', args, cls, template }
      }
      case 'rot':
      case 'vect': {
        if (!this.is('(')) break
        this.i++
        const a = this.expr()
        this.want(',')
        const b = this.expr()
        this.want(',')
        const c = this.expr()
        this.want(')')
        return w === 'rot' ? { k: 'rot', v: [a, b, c] } : { k: 'vect', v: [a, b, c] }
      }
    }
    return { k: 'id', name: t.v }
  }
  /** An expression without a call (the class after new). */
  private postfixNoCall(): Expr {
    let e = this.primary()
    while (this.is('.')) {
      this.i++
      e = { k: 'member', obj: e, name: this.id() }
    }
    return e
  }
}
