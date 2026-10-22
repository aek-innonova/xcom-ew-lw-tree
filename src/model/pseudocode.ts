// PatchUPK pseudo-code to bytes (features/game-tools.md): hex bytes, <…>
// references and literals, [#label] / [@label] jumps and [@] ( … ) skip
// sizes. Jumps and skips count memory bytes, where an object reference takes
// 8 (it takes 4 in the file); a hex byte typed out counts 1 whatever it is,
// as in PatchUPK. Labels count from the start of each block of code.

import type { Package } from './upk.ts'

/** Alias name ("Name", or "Full.Object.Name.Name" when defined inside an object) → replacement code. */
export type Aliases = Map<string, string>

export interface CodeContext {
  pkg: Package
  /** The current export's full name (for <.local>, <@member> and local aliases). */
  object?: string
  aliases: Aliases
}

export interface Assembled {
  bytes: Uint8Array
  memSize: number
}

type Item =
  | { kind: 'bytes'; data: Uint8Array; mem: number }
  | { kind: 'ref'; label: string } // [@label]: 2 bytes, the label's memory offset
  | { kind: 'auto'; id: number } // [@]: 2 bytes, the size of its ( … )

/** PatchUPK's GetWord: <…> (to ">", or to "\">" in a text literal), […], ( ), hex runs, other words. */
function words(src: string): string[] {
  const out: string[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]!
    if (/\s/.test(ch)) {
      i++
      continue
    }
    if (ch === '<') {
      let j = i + 1
      const text = /^<\s*%\s*t\s*"/.test(src.slice(i, i + 40))
      for (; j < src.length; j++) {
        if (src[j] !== '>') continue
        if (!text || /"\s*$/.test(src.slice(i, j))) break
      }
      out.push(src.slice(i, j + 1))
      i = j + 1
    } else if (ch === '[') {
      const j = src.indexOf(']', i)
      out.push(src.slice(i, j < 0 ? src.length : j + 1))
      i = j < 0 ? src.length : j + 1
    } else if (ch === '(' || ch === ')') {
      out.push(ch)
      i++
    } else if (/[\da-f]/i.test(ch)) {
      let j = i
      while (j < src.length && /[\da-f]/i.test(src[j]!)) j++
      out.push(src.slice(i, j))
      i = j
    } else {
      let j = i
      while (j < src.length && !/\s/.test(src[j]!)) j++
      out.push(src.slice(i, j))
      i = j
    }
  }
  return out
}

const eatWhite = (s: string) => {
  const q = s.indexOf('"')
  return q < 0 ? s.replace(/\s+/g, '') : s.slice(0, q).replace(/\s+/g, '') + s.slice(q)
}

function i32(v: number): Uint8Array {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setInt32(0, v, true)
  return b
}
function u32(v: number): Uint8Array {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setUint32(0, v >>> 0, true)
  return b
}
function f32(v: number): Uint8Array {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setFloat32(0, v, true)
  return b
}
const number = (s: string) => {
  const t = s.trim()
  const v = /^-?0x/i.test(t) ? parseInt(t, 16) : Number(t)
  if (!Number.isFinite(v)) throw new Error(`not a number: ${s}`)
  return v
}

/** One <…> token: its bytes and memory size. */
function token(raw: string, ctx: CodeContext): { data: Uint8Array; mem: number } {
  const code = eatWhite(raw.slice(1, -1))
  const { pkg } = ctx
  if (code.startsWith('!')) {
    const name = code.slice(1)
    const local = ctx.object ? `${ctx.object}.${name}` : undefined
    const replacement =
      (local !== undefined ? ctx.aliases.get(local) : undefined) ?? ctx.aliases.get(name)
    if (replacement === undefined) throw new Error(`no alias ${name}`)
    const a = assemble(replacement, ctx)
    return { data: a.bytes, mem: a.memSize }
  }
  if (code.startsWith('%')) {
    const kind = code[1]
    const value = code.slice(2)
    switch (kind) {
      case 'f':
        return { data: f32(Number(value)), mem: 4 }
      case 'i':
        return { data: i32(number(value)), mem: 4 }
      case 'u':
        return { data: u32(number(value)), mem: 4 }
      case 's': {
        const v = number(value)
        if (v < 0 || v > 0xffff) throw new Error(`not a short: ${value}`)
        return { data: new Uint8Array([v & 0xff, v >> 8]), mem: 2 }
      }
      case 'b': {
        const v = number(value)
        if (v < 0 || v > 0xff) throw new Error(`not a byte: ${value}`)
        return { data: new Uint8Array([v]), mem: 1 }
      }
      case 't': {
        const first = code.indexOf('"')
        const last = code.lastIndexOf('"')
        const text = first >= 0 && last > first ? code.slice(first + 1, last) : ''
        const data = new Uint8Array(text.length + 1)
        for (let i = 0; i < text.length; i++) data[i] = text.charCodeAt(i) & 0xff
        return { data, mem: data.length }
      }
      default:
        throw new Error(`unknown literal ${raw}`)
    }
  }
  const objectRef = (name: string, exportsOnly: boolean) => {
    const ref = pkg.findObject(name, exportsOnly)
    if (ref === 0) throw new Error(`no object ${name}`)
    return { data: i32(ref), mem: 8 }
  }
  if (code.startsWith('@')) {
    if (!ctx.object) throw new Error(`${raw} outside an object`)
    return objectRef(`${ctx.object.split('.')[0]}.${code.slice(1)}`, true)
  }
  if (code.includes('.')) {
    if (code.startsWith('.')) {
      if (!ctx.object) throw new Error(`${raw} outside an object`)
      return objectRef(ctx.object + code, false)
    }
    return objectRef(code.startsWith('Class.') ? code.slice(6) : code, false)
  }
  if (code === 'NullRef') return { data: new Uint8Array(4), mem: 8 }
  // A name: "Foo", or "Foo_2" for Foo with number 3.
  let name = code
  let num = 0
  const us = code.lastIndexOf('_')
  if (us >= 0 && /\d/.test(code[us + 1] ?? '')) {
    name = code.slice(0, us)
    num = 1 + parseInt(code.slice(us + 1), 10)
  }
  const idx = pkg.findName(name)
  if (idx < 0) throw new Error(`no name ${name}`)
  const data = new Uint8Array(8)
  const v = new DataView(data.buffer)
  v.setInt32(0, idx, true)
  v.setInt32(4, num, true)
  return { data, mem: 8 }
}

/** Pseudo-code to bytes, with its memory size. Throws with the reason when something cannot be resolved. */
export function assemble(src: string, ctx: CodeContext): Assembled {
  const items: Item[] = []
  const labels = new Map<string, number>()
  const autos: { start: number; size: number }[] = []
  const open: number[] = [] // [@] markers whose ( … ) is not closed yet
  let mem = 0

  for (const w of words(src)) {
    if (/^[\da-f]{2}$/i.test(w)) {
      items.push({ kind: 'bytes', data: new Uint8Array([parseInt(w, 16)]), mem: 1 })
      mem += 1
    } else if (w.length >= 3 && w.startsWith('<') && w.endsWith('>')) {
      const t = token(w, ctx)
      items.push({ kind: 'bytes', data: t.data, mem: t.mem })
      mem += t.mem
    } else if (w.length >= 3 && w.startsWith('[') && w.endsWith(']')) {
      const cmd = w.slice(1, -1).replace(/\s+/g, '')
      if (cmd === '@') {
        autos.push({ start: -1, size: -1 })
        open.push(autos.length - 1)
        items.push({ kind: 'auto', id: autos.length - 1 })
        mem += 2
      } else if (cmd.startsWith('@')) {
        items.push({ kind: 'ref', label: cmd.slice(1) })
        mem += 2
      } else if (cmd.startsWith('#')) {
        const name = cmd.slice(1)
        if (labels.has(name)) throw new Error(`label ${name} twice`)
        labels.set(name, mem)
      } else throw new Error(`unknown command ${w}`)
    } else if (w === '(') {
      const top = open[open.length - 1]
      if (top === undefined || autos[top]!.start >= 0) throw new Error('( without [@]')
      autos[top]!.start = mem
    } else if (w === ')') {
      const top = open.pop()
      if (top === undefined || autos[top]!.start < 0) throw new Error(') without (')
      autos[top]!.size = mem - autos[top]!.start
    } else throw new Error(`cannot read ${w}`)
  }
  if (open.length) throw new Error('[@] without a closing )')

  const out: number[] = []
  const u16 = (v: number) => out.push(v & 0xff, (v >> 8) & 0xff)
  for (const it of items) {
    if (it.kind === 'bytes') for (const b of it.data) out.push(b)
    else if (it.kind === 'auto') u16(autos[it.id]!.size)
    else {
      const at = labels.get(it.label)
      if (at === undefined) throw new Error(`no label ${it.label}`)
      u16(at)
    }
  }
  return { bytes: new Uint8Array(out), memSize: mem }
}
