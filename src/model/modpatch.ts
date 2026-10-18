// Running a PatcherGUI (PatchUPK) mod script against packages
// (features/game-tools.md): our own implementation of the format as
// PatchUPK's documentation and behaviour define it, checked byte for byte
// against PatchUPK's output (src/model/__tests__/modpatch.spec.ts).
//
// The same run answers "is it installed?" and installs it: the script is
// carried out on copies of the packages, and every write is first compared
// with what is there. A change already in place is left alone (PatchUPK
// would write, and move a grown function, again), so a mod applied twice
// changes nothing the second time.

import { assemble, type Aliases } from './pseudocode'
import type { Package } from './upk'

export interface Command {
  name: string
  value: string
  /** 1-based line of the key or section, for messages. */
  line: number
}

const KEYS = new Set([
  'MOD_NAME',
  'AUTHOR',
  'DESCRIPTION',
  'UNINSTALL',
  'UPDATE_REL',
  'GUID',
  'UPK_FILE',
  'OFFSET',
  'OBJECT',
  'FUNCTION',
  'NAME_ENTRY',
  'IMPORT_ENTRY',
  'EXPORT_ENTRY',
  'REL_OFFSET',
  'FIND_HEX',
  'FIND_CODE',
  'MODDED_HEX',
  'MODDED_CODE',
  'MODDED_FILE',
  'FUNCTION_FILE',
  'REPLACEMENT_CODE',
  'INSERT_CODE',
  'BYTE',
  'FLOAT',
  'INTEGER',
  'UNSIGNED',
  'NAMEIDX',
  'OBJIDX',
  'RENAME',
  'NAMELIST_NAME',
  'EXPAND_FUNCTION',
  'EXPAND_UNDO',
  'REPLACE_HEX',
  'REPLACE_CODE',
  'BULK_DATA',
  'BULK_FILE',
  'ALIAS',
  'RESIZE',
])
const SECTIONS = new Set([
  'MODDED_HEX',
  'MODDED_CODE',
  'FIND_HEX',
  'FIND_CODE',
  'BEFORE_HEX',
  'AFTER_HEX',
  'BEFORE_CODE',
  'AFTER_CODE',
  'REPLACEMENT_CODE',
  'INSERT_CODE',
  'ADD_NAME_ENTRY',
  'ADD_IMPORT_ENTRY',
  'ADD_EXPORT_ENTRY',
])

/** Removes //, /* *\/ and { } comments the way PatchUPK reads a script: line by line, quotes or not. */
function stripComments(text: string): string[] {
  const lines: string[] = []
  let line = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i++
      i--
    } else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      const stop = end < 0 ? text.length : end + 2
      // Keep the line count, so steps can name the script's own lines.
      for (const _ of text.slice(i, stop).matchAll(/\r\n|\r|\n/g)) {
        lines.push(line)
        line = ''
      }
      i = stop - 1
    } else if (ch === '{') {
      const end = text.indexOf('}', i + 1)
      const stop = end < 0 ? text.length : end + 1
      for (const _ of text.slice(i, stop).matchAll(/\r\n|\r|\n/g)) {
        lines.push(line)
        line = ''
      }
      i = stop - 1
    } else if (ch === '\r' || ch === '\n') {
      lines.push(line)
      line = ''
      if (ch === '\r' && text[i + 1] === '\n') i++
    } else line += ch
  }
  lines.push(line)
  return lines
}

const keyOf = (line: string) => {
  const at = line.indexOf('=')
  if (at < 0) return undefined
  const name = line.slice(0, at).trim()
  return KEYS.has(name) ? name : undefined
}
const sectionOf = (line: string) => {
  const m = /^\s*\[(\/?)([A-Z_]+)\]\s*$/.exec(line)
  return m && SECTIONS.has(m[2]!) ? { end: !!m[1], name: m[2]! } : undefined
}

/** A script as PatchUPK sees it: keys (value to the next key or section) and sections. */
export function parseCommands(text: string): Command[] {
  const lines = stripComments(text)
  const out: Command[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const key = keyOf(line)
    const section = key ? undefined : sectionOf(line)
    if (!key && !section) continue
    const body: string[] = key ? [line.slice(line.indexOf('=') + 1)] : []
    let j = i + 1
    while (j < lines.length && !keyOf(lines[j]!) && !sectionOf(lines[j]!)) body.push(lines[j++]!)
    if (section?.end) continue
    out.push({ name: key ?? section!.name, value: body.join('\n'), line: i + 1 })
    i = j - 1
  }
  return out
}

/** "a:b" → ["a", "b"], at the first colon (PatchUPK's SplitAt), both trimmed. */
function splitAt(s: string): [string, string] {
  const at = s.indexOf(':')
  return at < 0 ? [s.trim(), ''] : [s.slice(0, at).trim(), s.slice(at + 1).trim()]
}
const firstLine = (s: string) =>
  (s.split('\n').find((l) => l.trim()) ?? '').trim().replace(/^"|"$/g, '')
const intValue = (s: string) => {
  const v = firstLine(s)
  return /^0x/i.test(v) ? parseInt(v, 16) : parseInt(v, 10)
}

/** Space-separated hex, as MODDED_HEX and friends take it. */
export function hexBytes(s: string): Uint8Array {
  const words = s.split(/\s+/).filter(Boolean)
  const out = new Uint8Array(words.length)
  words.forEach((w, i) => {
    if (!/^[\da-f]{2}$/i.test(w)) throw new Error(`not a hex byte: ${w}`)
    out[i] = parseInt(w, 16)
  })
  return out
}

export type StepStatus = 'already' | 'change' | 'error'
export interface Step {
  /** The package and object (or name) the step works on. */
  where: string
  /** The command ("REPLACEMENT_CODE", "AFTER_CODE" …). */
  what: string
  status: StepStatus
  note?: string
  line: number
}

export interface RunResult {
  steps: Step[]
  /** The packages as the script leaves them (copies; changed only where a step said "change"). */
  packages: Map<string, Package>
  /** Overall: every change in place, none, some, or something does not fit. */
  status: 'installed' | 'not-installed' | 'partly' | 'does-not-fit'
}

export interface RunOptions {
  /** A writable copy of a package by file name, or undefined if the install has none. */
  open: (upk: string) => Package | undefined
  /** Values for the script's options (ALIAS name → value), replacing the script's own literal. */
  values?: Record<string, string>
}

class StepError extends Error {}

/** Carries out a script on copies of its packages; see RunResult. */
export function runScript(text: string, opts: RunOptions): RunResult {
  const commands = parseCommands(text)
  const packages = new Map<string, Package>()
  const steps: Step[] = []
  const aliases: Aliases = new Map()

  let pkg: Package | undefined
  let pkgName = ''
  let obj = 0 // current export (1-based), 0 outside object scope
  let behavior = 'KEEP'
  let scopeStart = 0 // absolute offset of the scope
  let rel = 0
  let max = 0 // absolute last byte of the scope
  let updateRel = false
  let before: { found: boolean; data: Uint8Array; memSize: number } | null = null

  const objName = () => (obj ? pkg!.exports[obj - 1]!.fullName : '')
  const where = () => `${pkgName}${obj ? `: ${objName()}` : ''}`
  const resetMax = () => {
    if (obj) max = scopeStart + pkg!.exports[obj - 1]!.size - 1
    else if (pkg) max = pkg.bytes.length - 1
  }
  const ctx = () => ({ pkg: pkg!, object: objName() || undefined, aliases })
  const code = (src: string) => assemble(src, ctx())
  const need = () => {
    if (!pkg) throw new StepError('no package opened (UPK_FILE)')
  }

  const equalAt = (offset: number, data: Uint8Array) => {
    if (offset < 0 || offset + data.length > pkg!.bytes.length) return false
    for (let i = 0; i < data.length; i++) if (pkg!.bytes[offset + i] !== data[i]) return false
    return true
  }

  /** WriteModdedData: grows or moves the object when allowed, then writes. */
  const writeData = (data: Uint8Array, fitScope: boolean) => {
    const scopeSize = max - scopeStart - rel + 1
    if (obj) {
      const e = pkg!.exports[obj - 1]!
      let size = e.size
      let resize = false
      if (fitScope && scopeSize !== data.length) {
        if (behavior === 'KEEP') throw new StepError('the new data does not fit the object (KEEP)')
        resize = true
        size += data.length - scopeSize
      } else if (scopeStart + rel + data.length - 1 > max && behavior !== 'KEEP') {
        resize = true
        size += scopeStart + rel + data.length - 1 - max
      } else if (behavior === 'MOVE') resize = true
      if (resize) {
        if (behavior === 'INPL') throw new StepError('INPL resizing is not supported')
        pkg!.moveResize(obj, size, rel)
        scopeStart = pkg!.exports[obj - 1]!.offset
        max = scopeStart + pkg!.exports[obj - 1]!.size - 1
      }
    } else if (fitScope && scopeSize !== data.length)
      throw new StepError('the new data does not fit (outside an object)')
    if (scopeStart + rel + data.length - 1 > max)
      throw new StepError('the data runs past the scope')
    resetMax()
    before = null
    pkg!.write(scopeStart + rel, data)
    if (updateRel) rel += data.length
  }

  const record = (what: string, status: StepStatus, line: number, note?: string) =>
    steps.push({ where: where(), what, status, note, line })

  for (const c of commands) {
    try {
      switch (c.name) {
        case 'MOD_NAME':
        case 'AUTHOR':
        case 'DESCRIPTION':
        case 'GUID':
        case 'UNINSTALL':
          break
        case 'UPDATE_REL':
          updateRel = firstLine(c.value).toUpperCase() === 'TRUE'
          break
        case 'UPK_FILE': {
          pkgName = firstLine(c.value)
          const key = pkgName.toLowerCase()
          if (!packages.has(key)) {
            const p = opts.open(pkgName)
            if (!p) throw new StepError(`${pkgName} is not in this install`)
            if (p.compressed) throw new StepError(`${pkgName} is compressed`)
            packages.set(key, p)
          }
          pkg = packages.get(key)
          obj = 0
          scopeStart = 0
          rel = 0
          resetMax()
          before = null
          break
        }
        case 'OBJECT':
        case 'FUNCTION': {
          need()
          const [name, spec] = splitAt(firstLine(c.value))
          behavior = (spec || 'KEEP').toUpperCase()
          obj = 0
          const ref = pkg!.findObject(name, true)
          if (ref <= 0) throw new StepError(`no object ${name} in ${pkgName}`)
          obj = ref
          scopeStart = pkg!.exports[ref - 1]!.offset
          rel = 0
          resetMax()
          before = null
          break
        }
        case 'ALIAS': {
          const [name, replacement] = splitAt(c.value)
          const full = obj ? `${objName()}.${name}` : name
          const value = opts.values?.[name]
          aliases.set(full, value !== undefined ? withLiteral(replacement, value) : replacement)
          break
        }
        case 'REL_OFFSET':
          need()
          rel = intValue(c.value)
          break
        case 'FIND_HEX':
        case 'FIND_CODE': {
          need()
          const [src, spec] = splitSpec(c.value)
          const data = c.name === 'FIND_HEX' ? hexBytes(src) : code(src).bytes
          const at = find(pkg!.bytes, data, scopeStart + rel, max)
          if (at < 0) throw new StepError('the code to find is not there')
          rel = at - scopeStart + (spec === 'END' ? data.length : 0)
          break
        }
        case 'MODDED_HEX':
        case 'MODDED_CODE': {
          need()
          const data = c.name === 'MODDED_HEX' ? hexBytes(c.value) : code(c.value).bytes
          if (equalAt(scopeStart + rel, data)) {
            record(c.name, 'already', c.line)
            if (updateRel) rel += data.length
          } else {
            writeData(data, false)
            record(c.name, 'change', c.line)
          }
          break
        }
        case 'REPLACEMENT_CODE': {
          need()
          if (!obj) throw new StepError('REPLACEMENT_CODE outside an object')
          const script = pkg!.scriptOf(obj)
          if (!script) throw new StepError(`${objName()} has no script to replace`)
          const { bytes, memSize } = code(c.value)
          const data = new Uint8Array(8 + bytes.length)
          const v = new DataView(data.buffer)
          v.setInt32(0, memSize, true)
          v.setInt32(4, bytes.length, true)
          data.set(bytes, 8)
          rel = script.relOffset - 8
          max = scopeStart + script.relOffset + script.size - 1
          if (data.length === script.size + 8 && equalAt(scopeStart + rel, data)) {
            record(c.name, 'already', c.line)
            resetMax()
          } else {
            writeData(data, true)
            record(c.name, 'change', c.line)
          }
          break
        }
        case 'BEFORE_HEX':
        case 'BEFORE_CODE': {
          need()
          const { bytes, memSize } =
            c.name === 'BEFORE_HEX' ? { bytes: hexBytes(c.value), memSize: -1 } : code(c.value)
          const at = find(pkg!.bytes, bytes, scopeStart + rel, max)
          before = { found: at >= 0, data: bytes, memSize }
          if (at >= 0) {
            rel = at - scopeStart
            max = at + bytes.length - 1
          }
          break
        }
        case 'AFTER_HEX':
        case 'AFTER_CODE': {
          need()
          if (!before) throw new StepError(`${c.name} without BEFORE`)
          const { bytes, memSize } =
            c.name === 'AFTER_HEX' ? { bytes: hexBytes(c.value), memSize: -1 } : code(c.value)
          if (!before.found) {
            // Not the original: the modded code may be there already.
            const objEnd = obj
              ? scopeStart + pkg!.exports[obj - 1]!.size - 1
              : pkg!.bytes.length - 1
            const there = find(pkg!.bytes, bytes, scopeStart, objEnd) >= 0
            before = null
            if (!there)
              throw new StepError('neither the original code nor the modded code is there')
            record(c.name, 'already', c.line)
            break
          }
          const sizes = adjustedSizes(bytes.length, memSize)
          writeData(bytes, true)
          if (sizes) {
            const saved = rel
            rel = sizes.rel
            writeData(sizes.data, false)
            rel = saved
          }
          record(c.name, 'change', c.line)
          break
        }
        case 'ADD_NAME_ENTRY': {
          need()
          const entry = assemble(c.value, { pkg: pkg!, aliases }).bytes
          const name = nameInEntry(entry)
          if (pkg!.findName(name) >= 0) {
            record(`${c.name} ${name}`, 'already', c.line)
          } else {
            pkg!.addName(entry)
            if (obj) {
              scopeStart = pkg!.exports[obj - 1]!.offset
              resetMax()
            }
            record(`${c.name} ${name}`, 'change', c.line)
          }
          break
        }
        default:
          throw new StepError(`${c.name} is not supported yet`)
      }
    } catch (e) {
      record(c.name, 'error', c.line, (e as Error).message)
      // A failed step leaves the rest of the script without a sound footing.
      break
    }
  }

  // GetAdjustedSizes: the script's serial and memory sizes after a find-and-replace inside it.
  function adjustedSizes(newLength: number, newMem: number) {
    if (!obj) return null
    const script = pkg!.scriptOf(obj)
    if (!script) return null
    const scopeSize = max - scopeStart - rel + 1
    if (!(rel >= script.relOffset && rel + scopeSize <= script.relOffset + script.size)) return null
    const size = script.size + newLength - scopeSize
    const mem = newMem !== -1 ? script.memSize + newMem - (before?.memSize ?? 0) : script.memSize
    if (size === script.size && mem === script.memSize) return null
    const data = new Uint8Array(8)
    const v = new DataView(data.buffer)
    v.setInt32(0, mem, true)
    v.setInt32(4, size, true)
    return { data, rel: script.relOffset - 8 }
  }

  const changes = steps.filter((s) => s.status === 'change').length
  const already = steps.filter((s) => s.status === 'already').length
  const status = steps.some((s) => s.status === 'error')
    ? 'does-not-fit'
    : changes === 0 && already > 0
      ? 'installed'
      : already === 0
        ? 'not-installed'
        : 'partly'
  return { steps, packages, status }
}

/** "<%b 9>" with another value: "<%b 12>"; anything else is replaced whole. */
function withLiteral(replacement: string, value: string): string {
  const m = /^\s*<\s*%([biufst])\s*.*>\s*$/s.exec(replacement)
  if (!m) return value
  return m[1] === 't' ? `<%t "${value}">` : `<%${m[1]} ${value}>`
}

/** "code:END" → ["code", "END"]; only BEG and END count as specifiers. */
function splitSpec(value: string): [string, string] {
  const m = /^([\s\S]*):\s*(BEG|END)\s*$/.exec(value)
  return m ? [m[1]!, m[2]!] : [value, '']
}

function find(hay: Uint8Array, needle: Uint8Array, from: number, last: number): number {
  if (!needle.length) return -1
  const end = Math.min(last, hay.length - 1) - needle.length + 1
  outer: for (let i = Math.max(0, from); i <= end; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}

/** The name in a raw name-table entry (length, text, flags). */
function nameInEntry(entry: Uint8Array): string {
  const n = new DataView(entry.buffer, entry.byteOffset).getInt32(0, true)
  return new TextDecoder('latin1').decode(entry.subarray(4, 4 + n)).replace(/\0+$/, '')
}
