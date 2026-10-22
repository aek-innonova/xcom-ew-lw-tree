// A change as a PatcherGUI / PatchUPK mod script: the mod format players
// already install, and the common case (a function rewritten; names and
// imports it needs added to the package's tables, no objects).
//
// The new script goes into [REPLACEMENT_CODE] as PatchUPK pseudo-code:
// token bytes in hex, object references as <Path>, names as <Name>. PatchUPK
// counts memory from the pseudo-code: a hex byte as one byte, a <reference>
// as eight. Writing references as <…> (not as their four hex bytes) is what
// makes the memory size it stores the engine's.

import { TOKENS, type Label, type NameValue, type Node, type Value } from './bytecode.ts'
import type { Import, Package } from './package.ts'

const hex = (n: number, bytes: number) => {
  const out: string[] = []
  for (let i = 0; i < bytes; i++) out.push(((n >>> (8 * i)) & 0xff).toString(16).padStart(2, '0').toUpperCase())
  return out.join(' ')
}

class Emitter {
  out: string[] = []
  pkg: Package
  added: string[]
  imports: Import[]
  constructor(pkg: Package, added: string[] = [], imports: Import[] = []) {
    this.pkg = pkg
    this.added = added
    this.imports = imports
  }
  obj(ref: number) {
    if (ref === 0) return this.out.push('<NullRef>')
    // PatchUPK reads <Word> without a dot as a name: a top-level object (a
    // package) is written <Class.Name>, which it reads as the object.
    const path = this.path(ref)
    this.out.push(path.includes('.') ? `<${path}>` : `<Class.${path}>`)
  }
  /** An object's path, an import the change adds too (PatchUPK finds it by its path once added). */
  path(ref: number): string {
    const extra = -ref - this.pkg.imports.length - 1
    if (extra < 0) return this.pkg.path(ref)
    const imp = this.imports[extra]!
    const name = this.nameText(imp.objectName)
    return imp.outer ? `${this.path(imp.outer)}.${name}` : name
  }
  private nameText(n: NameValue) {
    const extra = n.index - this.pkg.names.length
    const base = extra >= 0 ? this.added[extra]! : this.pkg.names[n.index]!.name
    return n.number ? `${base}_${n.number - 1}` : base
  }
  name(n: NameValue) {
    this.out.push(`<${this.nameText(n)}>`)
  }
  /** An import table entry (PatchUPK's ADD_IMPORT_ENTRY: 28 bytes, names and the outer as pseudo-code). */
  importEntry(imp: Import) {
    this.name(imp.classPackage)
    this.name(imp.className)
    this.obj(imp.outer)
    this.name(imp.objectName)
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

/** A script as PatchUPK pseudo-code, a statement a line (added: names the change adds, past the table's end). */
export function pseudoCode(pkg: Package, statements: Node[], added: string[] = [], imports: Import[] = []): string {
  return statements
    .map((s) => {
      const e = new Emitter(pkg, added, imports)
      e.expr(s)
      return e.out.join(' ')
    })
    .join('\n')
}

/** The paths of the imports a change adds (as the mod script names them). */
export function addedImportPaths(pkg: Package, names: string[], imports: Import[]): string[] {
  const e = new Emitter(pkg, names, imports)
  return imports.map((_, i) => e.path(-(pkg.imports.length + i + 1)))
}

export interface ModInfo {
  name: string
  author?: string
  description?: string
}

/** A mod script that replaces functions' (or states') code. */
export function modScript(
  info: ModInfo,
  changes: {
    upk: string
    pkg: Package
    ref: number
    statements: Node[]
    names?: string[]
    /** Imports the code needs that the package lacks (past the table's end, in order). */
    imports?: Import[]
    /** Bytes to set in the object after its code is replaced (at an offset in it). */
    after?: { at: number; bytes: Uint8Array }
  }[],
  /** Objects whose data changes otherwise (default properties). */
  objects: { upk: string; pkg: Package; ref: number; data: Uint8Array; names?: string[] }[] = [],
): string {
  const added = new Set<string>()
  const addedImports = new Set<number>()
  const lines = [`MOD_NAME=${info.name}`]
  if (info.author) lines.push(`AUTHOR=${info.author}`)
  if (info.description) lines.push(`DESCRIPTION=${info.description}`)
  let upk = ''
  for (const c of changes) {
    if (c.upk !== upk) lines.push('', `UPK_FILE=${(upk = c.upk)}`)
    // Names the code needs that the package lacks: added first (PatchUPK's ADD_NAME_ENTRY),
    // after which <Name> finds them.
    for (const n of c.names ?? []) {
      if (added.has(n)) continue
      added.add(n)
      lines.push('', '[ADD_NAME_ENTRY]', nameEntry(n))
    }
    // Then imports (ADD_IMPORT_ENTRY appends each to the table, at the reference the code has for it).
    // PatchUPK skips one whose path the package has: never the case here, as the compiler looked first.
    for (const [i, imp] of (c.imports ?? []).entries()) {
      if (addedImports.has(i)) continue
      addedImports.add(i)
      const e = new Emitter(c.pkg, c.names, c.imports)
      e.importEntry(imp)
      lines.push('', '[ADD_IMPORT_ENTRY]', e.out.join(' '))
    }
    lines.push('', `OBJECT=${c.pkg.path(c.ref)}:AUTO`, '[REPLACEMENT_CODE]', pseudoCode(c.pkg, c.statements, c.names, c.imports))
    if (c.after)
      lines.push(
        '',
        `OBJECT=${c.pkg.path(c.ref)}`,
        `REL_OFFSET=${c.after.at}`,
        '[MODDED_HEX]',
        hexBytes(c.after.bytes),
      )
  }
  for (const o of objects) {
    if (o.upk !== upk) lines.push('', `UPK_FILE=${(upk = o.upk)}`)
    for (const n of o.names ?? []) {
      if (added.has(n)) continue
      added.add(n)
      lines.push('', '[ADD_NAME_ENTRY]', nameEntry(n))
    }
    lines.push(...objectEditLines(o.pkg, o.ref, o.data))
  }
  return lines.join('\n') + '\n'
}

const hexBytes = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join(' ')

/**
 * An object's data changed (default properties): the same size as hex at
 * offsets in it; another size as the part that changed, found and replaced
 * (BEFORE_HEX / AFTER_HEX), the object resized to fit (AUTO).
 */
export function objectEditLines(pkg: Package, ref: number, data: Uint8Array): string[] {
  const path = pkg.path(ref)
  if (pkg.find(path) !== ref) throw new Error(`${path}: another object has that path, so a mod script cannot name it (--out can)`)
  const orig = pkg.data(ref)
  const lines: string[] = []
  if (data.length === orig.length) {
    lines.push('', `OBJECT=${path}`)
    // Runs of changed bytes (a few unchanged between them join the run).
    for (let i = 0; i < data.length; ) {
      if (data[i] === orig[i]) {
        i++
        continue
      }
      let j = i
      let last = i
      while (j < data.length && j - last < 8) {
        if (data[j] !== orig[j]) last = j
        j++
      }
      lines.push(`REL_OFFSET=${i}`, '[MODDED_HEX]', hexBytes(data.subarray(i, last + 1)))
      i = last + 1
    }
    return lines
  }
  let p = 0
  while (p < orig.length && p < data.length && orig[p] === data[p]) p++
  let q = 0
  while (q < orig.length - p && q < data.length - p && orig[orig.length - 1 - q] === data[data.length - 1 - q]) q++
  // What is replaced must be found once in the object: widened backwards until it is.
  const count = (b: Uint8Array) => {
    let n = 0
    for (let i = 0; i + b.length <= orig.length; i++) if (b.every((x, k) => orig[i + k] === x) && ++n > 1) break
    return n
  }
  while (p > 0 && (p === orig.length - q || count(orig.subarray(p, orig.length - q)) !== 1)) p--
  lines.push('', `OBJECT=${path}:AUTO`, '[BEFORE_HEX]', hexBytes(orig.subarray(p, orig.length - q)), '[AFTER_HEX]', hexBytes(data.subarray(p, data.length - q)))
  return lines
}

/** A name table entry in pseudo-code: its length, its text, its flags (as the game's names have). */
function nameEntry(name: string): string {
  return `<%i ${name.length + 1}> <%t "${name}"> <%u 0x00000000> <%u 0x00070010>`
}
