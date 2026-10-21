// A change as a PatcherGUI / PatchUPK mod script: the mod format players
// already install, and the common case (a function rewritten, nothing added
// to the package's tables).
//
// The new script goes into [REPLACEMENT_CODE] as PatchUPK pseudo-code:
// token bytes in hex, object references as <Path>, names as <Name>. PatchUPK
// counts memory from the pseudo-code: a hex byte as one byte, a <reference>
// as eight. Writing references as <…> (not as their four hex bytes) is what
// makes the memory size it stores the engine's.

import { TOKENS, type Label, type NameValue, type Node, type Value } from './bytecode.ts'
import type { Package } from './package.ts'

const hex = (n: number, bytes: number) => {
  const out: string[] = []
  for (let i = 0; i < bytes; i++) out.push(((n >>> (8 * i)) & 0xff).toString(16).padStart(2, '0').toUpperCase())
  return out.join(' ')
}

class Emitter {
  out: string[] = []
  pkg: Package
  constructor(pkg: Package) {
    this.pkg = pkg
  }
  obj(ref: number) {
    if (ref === 0) return this.out.push('<NullRef>')
    // PatchUPK reads <Word> without a dot as a name: a top-level object (a
    // class) is written <Class.Name>, which it reads as the object.
    const path = this.pkg.path(ref)
    this.out.push(path.includes('.') ? `<${path}>` : `<Class.${path}>`)
  }
  name(n: NameValue) {
    this.out.push(`<${this.pkg.name(n)}>`)
  }
  expr(n: Node) {
    if (n.native !== undefined) {
      if (n.op >= 0x70) this.out.push(hex(n.op, 1))
      else this.out.push(hex(0x60 + (n.native >> 8), 1), hex(n.native & 0xff, 1))
      for (const p of n.args[0] as Node[]) this.expr(p)
      this.out.push('16')
      return
    }
    this.out.push(hex(n.op, 1))
    TOKENS[n.op]!.args.forEach((a, i) => this.arg(a, n.args[i]!))
  }
  private arg(a: string, v: Value) {
    switch (a) {
      case 'expr':
        return this.expr(v as Node)
      case 'optexpr':
        if (v) this.expr(v as Node)
        return
      case 'obj':
        return this.obj(v as number)
      case 'name':
        return this.name(v as NameValue)
      case 'u8':
      case 'end':
        return this.out.push(hex(v as number, 1))
      case 'u16':
        return this.out.push(hex(v as number, 2))
      case 'i32':
        return this.out.push(hex(v as number, 4))
      case 'f32': {
        const b = new Uint8Array(new Float32Array([v as number]).buffer)
        return this.out.push([...b].map((x) => hex(x, 1)).join(' '))
      }
      case 'astr': {
        const s = v as string
        return this.out.push([...s, '\0'].map((c) => hex(c.charCodeAt(0), 1)).join(' '))
      }
      case 'ustr': {
        const s = v as string
        return this.out.push([...s, '\0'].map((c) => hex(c.charCodeAt(0), 2)).join(' '))
      }
      case 'params':
        for (const p of v as Node[]) this.expr(p)
        this.out.push('16')
        return
      case 'case': {
        const [next, e] = v as unknown as [number, Node | null]
        this.out.push(hex(next, 2))
        if (e) this.expr(e)
        return
      }
      case 'labels':
        for (const l of v as Label[]) {
          this.name(l.name)
          this.out.push(hex(l.offset, 4))
        }
        return
    }
  }
}

/** A script as PatchUPK pseudo-code, a statement a line. */
export function pseudoCode(pkg: Package, statements: Node[]): string {
  return statements
    .map((s) => {
      const e = new Emitter(pkg)
      e.expr(s)
      return e.out.join(' ')
    })
    .join('\n')
}

export interface ModInfo {
  name: string
  author?: string
  description?: string
}

/** A mod script that replaces functions' (or states') code. */
export function modScript(
  info: ModInfo,
  changes: { upk: string; pkg: Package; ref: number; statements: Node[] }[],
): string {
  const lines = [`MOD_NAME=${info.name}`]
  if (info.author) lines.push(`AUTHOR=${info.author}`)
  if (info.description) lines.push(`DESCRIPTION=${info.description}`)
  let upk = ''
  for (const c of changes) {
    if (c.upk !== upk) lines.push('', `UPK_FILE=${(upk = c.upk)}`)
    lines.push('', `OBJECT=${c.pkg.path(c.ref)}:AUTO`, '[REPLACEMENT_CODE]', pseudoCode(c.pkg, c.statements))
  }
  return lines.join('\n') + '\n'
}
