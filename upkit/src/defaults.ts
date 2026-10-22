// A class's defaultproperties compiled back into its default object (and the
// subobjects it owns): the tagged properties the engine reads.
//
// Every entry whose text is as the decompiler writes it for the package keeps
// the bytes it came from, exactly; only edited and new entries are written
// from their declaration's type. So whatever the text cannot say (a value the
// decompiler only describes) stays as it was, unless it is edited.

import { Writer } from './bytes.ts'
import { ClassDecompiler } from './classdecomp.ts'
import type { Shared } from './compile.ts'
import type { Linker, Located } from './linker.ts'
import { readStructHead, readTags, tagsStart, type ClassObj, type PropertyObj, type Tag } from './objects.ts'
import type { NameRef, Package } from './package.ts'
import { Reader } from './bytes.ts'
import { typeOf, type Ty } from './types.ts'

export class DefaultsError extends Error {}

/** An object whose data the edit changes. */
export interface ObjectEdit {
  ref: number
  data: Uint8Array
}

/** The defaultproperties block of a class's source (its body), or null. */
export function defaultsBlock(src: string): string | null {
  const span = defaultsSpan(src)
  return span && src.slice(span.body, span.end - 1)
}

/** Where the defaultproperties block is in a class's source: from its keyword to after its closing brace, and where its body starts. */
export function defaultsSpan(src: string): { start: number; body: number; end: number } | null {
  const m = /^\s*defaultproperties\s*\{/im.exec(src)
  if (!m) return null
  let i = m.index + m[0].length
  const body = i
  let depth = 1
  for (; i < src.length; i++) {
    const c = src[i]
    if (c === '"') {
      for (i++; i < src.length && src[i] !== '"'; i++) if (src[i] === '\\') i++
      continue
    }
    if (c === '{') depth++
    if (c === '}' && --depth === 0) return { start: m.index, body, end: i + 1 }
  }
  throw new DefaultsError('defaultproperties: no closing }')
}

interface Entry {
  name: string
  /** The entry's lines, trimmed (a dynamic array's elements are one entry). */
  lines: string[]
}

/** The block's objects: the default object's entries, and each subobject's by its name. */
function parseBlock(block: string): { main: Entry[]; subs: Map<string, Entry[]> } {
  const main: Entry[] = []
  const subs = new Map<string, Entry[]>()
  let cur = main
  // A struct value can run over lines (an array inside it): joined until its brackets close.
  const lines: string[] = []
  let pending = ''
  for (const raw of block.split('\n')) {
    pending = pending ? `${pending}\n${raw.trim()}` : raw
    if (depthOf(pending) > 0) continue
    lines.push(pending)
    pending = ''
  }
  if (pending) lines.push(pending)
  for (const raw of lines) {
    const line = raw.trim().replace(/;$/, '')
    if (!line || line.startsWith('//')) continue
    const begin = /^Begin\s+Object\b.*\bName=(\w+)/i.exec(line)
    if (begin) {
      cur = []
      subs.set(begin[1]!.toLowerCase(), cur)
      continue
    }
    if (/^End\s+Object$/i.test(line)) {
      cur = main
      continue
    }
    const m = /^(\w+)/.exec(line)
    if (!m) throw new DefaultsError(`defaultproperties: cannot read "${line}"`)
    cur.push({ name: m[1]!, lines: [line] })
  }
  return { main, subs }
}

export function defaultsChanges(
  linker: Linker,
  pkg: Package,
  classRef: number,
  block: string,
  names: { shared: Shared; allow: 'none' | 'names' | 'all' },
  /** Keep unedited entries' bytes (false: write every entry from its text, as a test does). */
  reuse = true,
): ObjectEdit[] {
  const cls = linker.object({ pkg, ref: classRef }) as ClassObj
  const dobj = cls.defaultObject
  if (!dobj || dobj < 0) throw new DefaultsError('the class has no default object in this package')
  const cd = new ClassDecompiler(linker, pkg, classRef, false)
  const w = new TagWriter(linker, pkg, cd, names)
  const parsed = parseBlock(block)
  const edits: ObjectEdit[] = []
  const one = (ref: number, scope: Located, entries: Entry[]) => {
    const data = pkg.data(ref)
    const r = new Reader(data)
    const start = tagsStart(linker, pkg, ref)
    r.o = start
    let tags: Tag[]
    try {
      tags = readTags(r, pkg)
    } catch {
      // (An object whose properties are not read: left as it is, unless the source sets some.)
      if (!entries.length) return
      throw new DefaultsError(`defaultproperties: ${pkg.path(ref)}'s properties are not read, so not compiled`)
    }
    const tail = data.subarray(r.o) // after the None that ends the tags
    // The original entries, by their text: the bytes they came from.
    const original = new Map<string, Uint8Array[]>()
    for (const t of tags) {
      const key = norm(cd.tagLine(t, scope))
      const list = original.get(key) ?? []
      list.push(data.subarray(t.at, t.valueAt + t.size))
      original.set(key, list)
    }
    const out = new Writer(data.length + 64)
    out.bytes(data.subarray(0, start))
    for (const e of group(entries, (name) => w.isDynArray(scope, name))) {
      const key = norm(e.lines.join('\n'))
      // (What the text only describes, <n bytes>, is kept in any case.)
      const kept = reuse || /<\d+ bytes>/.test(key) ? original.get(key)?.shift() : undefined
      if (kept) out.bytes(kept)
      else w.entry(out, scope, e)
    }
    w.name(out, 'None')
    out.bytes(tail)
    const next = out.done()
    if (next.length !== data.length || next.some((b, i) => b !== data[i])) edits.push({ ref, data: next })
  }
  one(dobj, { pkg, ref: classRef }, parsed.main)
  for (let sub = 1; sub <= pkg.exports.length; sub++) {
    if (pkg.exports[sub - 1]!.outer !== dobj) continue
    const entries = parsed.subs.get(pkg.objectName(sub).toLowerCase())
    if (!entries) continue
    const scope = linker.resolve(pkg, pkg.exports[sub - 1]!.classIndex)
    if (!scope) continue
    one(sub, scope, entries)
  }
  for (const name of parsed.subs.keys())
    if (![...Array(pkg.exports.length).keys()].some((i) => pkg.exports[i]!.outer === dobj && pkg.objectName(i + 1).toLowerCase() === name))
      throw new DefaultsError(`defaultproperties: no subobject ${name} (new subobjects are not compiled yet)`)
  return edits
}

/** How many brackets are open at the end of the text (outside strings). */
function depthOf(text: string): number {
  let d = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++
      continue
    }
    if (c === '(') d++
    if (c === ')') d--
  }
  return d
}

const norm = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .join('\n')

/** Consecutive lines of one dynamic array: one entry (one tag holds the whole array). */
function group(entries: Entry[], isDynArray: (name: string) => boolean): Entry[] {
  const out: Entry[] = []
  for (const e of entries) {
    const last = out.at(-1)
    if (last && last.name.toLowerCase() === e.name.toLowerCase() && isDynArray(e.name)) last.lines.push(...e.lines)
    else out.push({ name: e.name, lines: [...e.lines] })
  }
  return out
}

/** Atomic structs: stored as their fields, in this order (Color's bytes are B, G, R, A). */
const ATOMIC: Record<string, [string, 'f' | 'i' | 'b' | 'v'][]> = {
  vector: [['X', 'f'], ['Y', 'f'], ['Z', 'f']],
  rotator: [['Pitch', 'i'], ['Yaw', 'i'], ['Roll', 'i']],
  vector2d: [['X', 'f'], ['Y', 'f']],
  color: [['B', 'b'], ['G', 'b'], ['R', 'b'], ['A', 'b']],
  linearcolor: [['R', 'f'], ['G', 'f'], ['B', 'f'], ['A', 'f']],
  guid: [['A', 'i'], ['B', 'i'], ['C', 'i'], ['D', 'i']],
  plane: [['X', 'f'], ['Y', 'f'], ['Z', 'f'], ['W', 'f']],
  quat: [['X', 'f'], ['Y', 'f'], ['Z', 'f'], ['W', 'f']],
  intpoint: [['X', 'i'], ['Y', 'i']],
  box: [['Min', 'v'], ['Max', 'v'], ['IsValid', 'b']],
}

class TagWriter {
  private paths: Map<string, number> | null = null
  private linker: Linker
  private pkg: Package
  private cd: ClassDecompiler
  private names: { shared: Shared; allow: 'none' | 'names' | 'all' }
  constructor(linker: Linker, pkg: Package, cd: ClassDecompiler, names: { shared: Shared; allow: 'none' | 'names' | 'all' }) {
    this.linker = linker
    this.pkg = pkg
    this.cd = cd
    this.names = names
  }

  private prop(scope: Located, name: string): { at: Located; p: PropertyObj; ty: Ty } {
    const at = this.cd.propFor(scope, name)
    if (!at) throw new DefaultsError(`defaultproperties: no ${name} in ${scope.pkg.objectName(scope.ref)}`)
    const p = this.linker.object(at) as PropertyObj
    return { at, p, ty: typeOf(this.linker, at, p) }
  }
  isDynArray(scope: Located, name: string): boolean {
    const at = this.cd.propFor(scope, name)
    return !!at && (this.linker.object(at) as PropertyObj).type === 'ArrayProperty'
  }

  /** An edited or new entry: its tag (or, for a static array's element, the element's). */
  entry(w: Writer, scope: Located, e: Entry) {
    const { p, ty } = this.prop(scope, e.name)
    if (ty.k === 'array') {
      const items: string[] = []
      for (const l of e.lines) {
        if (/^\w+\.Empty$/i.test(l)) continue
        const m = /^\w+\s*[([]\s*(\d+)\s*[)\]]\s*=\s*([\s\S]*)$/.exec(l)
        if (!m) throw new DefaultsError(`defaultproperties: "${l}" (an array's element is Name(index)=value)`)
        items[Number(m[1])] = m[2]!
      }
      if (items.some((x) => x === undefined) || items.length !== [...items].filter((x) => x !== undefined).length)
        throw new DefaultsError(`defaultproperties: ${e.name}'s elements must run 0, 1, 2 …`)
      this.tag(w, e.name, p, 0, (v) => {
        v.i32(items.length)
        for (const x of items) this.value(v, ty.inner, x)
      })
      return
    }
    const m = /^\w+\s*(?:[([]\s*(\d+)\s*[)\]])?\s*=\s*([\s\S]*)$/.exec(e.lines[0]!)
    if (!m) throw new DefaultsError(`defaultproperties: cannot read "${e.lines[0]}"`)
    this.tagged(w, e.name, p, ty, Number(m[1] ?? 0), m[2]!)
  }

  private tagged(w: Writer, name: string, p: PropertyObj, ty: Ty, index: number, text: string) {
    if (ty.k === 'bool') {
      const v = text.trim().toLowerCase()
      if (v !== 'true' && v !== 'false') throw new DefaultsError(`defaultproperties: ${name} is true or false`)
      this.name(w, name)
      this.name(w, 'BoolProperty')
      w.i32(0).i32(index).u8(v === 'true' ? 1 : 0)
      return
    }
    this.tag(w, name, p, index, (v) => this.value(v, ty, text), ty)
  }

  /** A tag's header, then its value (written to learn its size). */
  private tag(w: Writer, name: string, p: PropertyObj, index: number, value: (v: Writer) => void, ty?: Ty) {
    const v = new Writer(64)
    value(v)
    const bytes = v.done()
    this.name(w, name)
    // (Class and component properties are tagged as object properties.)
    this.name(w, p.type === 'ClassProperty' || p.type === 'ComponentProperty' ? 'ObjectProperty' : p.type)
    w.i32(bytes.length).i32(index)
    if (p.type === 'StructProperty') this.name(w, ty?.k === 'struct' && ty.struct ? ty.struct.pkg.objectName(ty.struct.ref) : 'None')
    else if (p.type === 'ByteProperty') this.name(w, ty?.k === 'byte' && ty.enumOf ? ty.enumOf.pkg.objectName(ty.enumOf.ref) : 'None')
    w.bytes(bytes)
  }

  value(w: Writer, ty: Ty, raw: string) {
    const text = raw.trim()
    const num = (kind: string) => {
      const n = Number(text)
      if (!Number.isFinite(n)) throw new DefaultsError(`defaultproperties: "${text}" is not ${kind}`)
      return n
    }
    switch (ty.k) {
      case 'int':
        w.i32(num('a number'))
        return
      case 'float':
        w.f32(num('a number'))
        return
      case 'bool':
        w.u8(text.toLowerCase() === 'true' ? 1 : 0)
        return
      case 'name':
        this.name(w, text.replace(/^'(.*)'$/, '$1'))
        return
      case 'string':
        w.fstr(unquote(text))
        return
      case 'byte':
        if (ty.enumOf) this.name(w, text)
        else w.u8(num('a byte'))
        return
      case 'object':
      case 'class':
      case 'interface':
      case 'component':
        w.i32(this.objectRef(text))
        return
      case 'delegate': {
        const dot = text.lastIndexOf('.')
        w.i32(dot > 0 ? this.objectRef(text.slice(0, dot)) : 0)
        this.name(w, dot > 0 ? text.slice(dot + 1) : text)
        return
      }
      case 'struct': {
        if (!ty.struct) throw new DefaultsError('defaultproperties: a struct of unknown type')
        const fields = structFields(text)
        const atomic = ATOMIC[ty.struct.pkg.objectName(ty.struct.ref).toLowerCase()]
        if (atomic) {
          for (const [f, k] of atomic) {
            const v = fields.find((x) => x.name.toLowerCase() === f.toLowerCase())?.value ?? '0'
            if (k === 'f') w.f32(Number(v))
            else if (k === 'i') w.i32(Number(v))
            else if (k === 'b') w.u8(Number(v))
            else for (const [, c] of structFields(v).map((x) => [x.name, x.value] as const)) w.f32(Number(c))
          }
          return
        }
        for (let i = 0; i < fields.length; i++) {
          const f = fields[i]!
          const { p, ty: fty } = this.prop(ty.struct, f.name)
          if (fty.k === 'array') {
            // Its elements, Name(0)=… Name(1)=…, or Name.Empty: one tag.
            const items: string[] = []
            for (; i < fields.length && fields[i]!.name.toLowerCase() === f.name.toLowerCase(); i++)
              if (!fields[i]!.empty) items.push(fields[i]!.value)
            i--
            this.tag(w, f.name, p, 0, (v) => {
              v.i32(items.length)
              for (const x of items) this.value(v, fty.inner, x)
            })
            continue
          }
          this.tagged(w, f.name, p, fty, f.index, f.value)
        }
        this.name(w, 'None')
        return
      }
    }
    throw new DefaultsError(`defaultproperties: a value of type ${ty.k} is not compiled yet`)
  }

  /** Class'Path' (or None): the package's reference to it (by class and path: two objects can share a path). */
  private objectRef(text: string): number {
    if (/^none$/i.test(text)) return 0
    const m = /^(\w+)'(.*)'$/.exec(text)
    const path = (m ? m[2]! : text).toLowerCase()
    if (!this.paths) {
      this.paths = new Map()
      const add = (ref: number) => {
        const p = this.pkg.path(ref).toLowerCase()
        for (const key of [`${this.pkg.className(ref).toLowerCase()}'${p}`, p]) if (!this.paths!.has(key)) this.paths!.set(key, ref)
      }
      for (let i = 1; i <= this.pkg.exports.length; i++) add(i)
      for (let i = 1; i <= this.pkg.imports.length; i++) add(-i)
    }
    const r = (m && this.paths.get(`${m[1]!.toLowerCase()}'${path}`)) ?? this.paths.get(path)
    if (r === undefined) throw new DefaultsError(`defaultproperties: no object ${m ? m[2] : text} in this package (new imports are not compiled here yet)`)
    return r
  }

  /** A name: the package's, or added (Name_3 is Name, number 4). */
  name(w: Writer, name: string) {
    const ref = nameRef(this.pkg, this.names, name)
    w.i32(ref.index).i32(ref.number)
  }
}

function nameRef(pkg: Package, names: { shared: Shared; allow: 'none' | 'names' | 'all' }, name: string): NameRef {
  const us = name.lastIndexOf('_')
  let base = name
  let number = 0
  if (us > 0 && /^\d+$/.test(name.slice(us + 1)) && pkg.findName(name) < 0) {
    base = name.slice(0, us)
    number = Number(name.slice(us + 1)) + 1
  }
  let index = pkg.findName(base)
  if (index < 0) {
    if (names.allow === 'none') throw new DefaultsError(`the name '${name}' is not in this package`)
    let k = names.shared.names.findIndex((n) => n.toLowerCase() === base.toLowerCase())
    if (k < 0) k = names.shared.names.push(base) - 1
    index = pkg.names.length + k
  }
  return { index, number }
}

/** "(A=1,B=(X=2),C="x,y")": its fields, split at the top level. */
function structFields(text: string): { name: string; index: number; value: string; empty?: boolean }[] {
  const t = text.trim()
  if (!t.startsWith('(') || !t.endsWith(')')) throw new DefaultsError(`defaultproperties: "${text}" is not a struct value (A=…,B=…)`)
  const body = t.slice(1, -1)
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!
    if (c === '"') {
      let j = i + 1
      for (; j < body.length && body[j] !== '"'; j++) if (body[j] === '\\') j++
      cur += body.slice(i, j + 1)
      i = j
      continue
    }
    if (c === '(') depth++
    if (c === ')') depth--
    // (An array's elements inside a struct are on lines of their own.)
    if ((c === ',' || c === '\n') && depth === 0) {
      parts.push(cur)
      cur = ''
      continue
    }
    cur += c
  }
  if (cur.trim()) parts.push(cur)
  return parts.filter((p) => p.trim()).map((p) => {
    const e = /^\s*(\w+)\.Empty\s*$/i.exec(p)
    if (e) return { name: e[1]!, index: 0, value: '', empty: true }
    const m = /^\s*(\w+)\s*(?:[([]\s*(\d+)\s*[)\]])?\s*=\s*([\s\S]*)$/.exec(p)
    if (!m) throw new DefaultsError(`defaultproperties: cannot read "${p}" in a struct value`)
    return { name: m[1]!, index: Number(m[2] ?? 0), value: m[3]! }
  })
}

/** A string as the decompiler writes it: in quotes, with \\ \" \n \t. */
function unquote(text: string): string {
  if (!text.startsWith('"') || !text.endsWith('"')) throw new DefaultsError(`defaultproperties: ${text} is not a string ("…")`)
  let out = ''
  for (let i = 1; i < text.length - 1; i++) {
    const c = text[i]!
    if (c === '\\' && i + 1 < text.length - 1) {
      const n = text[++i]!
      out += n === 'n' ? '\n' : n === 't' ? '\t' : n
    } else out += c
  }
  return out
}

export type { Tag }

/**
 * A struct's data with its structdefaultproperties compiled (written from the
 * text: a new struct has no bytes to keep).
 */
export function structDefaults(
  linker: Linker,
  pkg: Package,
  classRef: number,
  structRef: number,
  block: string,
  names: { shared: Shared; allow: 'none' | 'names' | 'all' },
): Uint8Array {
  const cd = new ClassDecompiler(linker, pkg, classRef, false)
  const w = new TagWriter(linker, pkg, cd, names)
  const scope = { pkg, ref: structRef }
  const data = pkg.data(structRef)
  const r = new Reader(data)
  const h = readStructHead(pkg, structRef)
  r.o = h.end + 4 // the struct flags, then the defaults
  readTags(r, pkg)
  const out = new Writer(data.length + 64)
  out.bytes(data.subarray(0, h.end + 4))
  for (const e of group(parseBlock(block).main, (n) => w.isDynArray(scope, n))) w.entry(out, scope, e)
  w.name(out, 'None')
  out.bytes(data.subarray(r.o))
  return out.done()
}
