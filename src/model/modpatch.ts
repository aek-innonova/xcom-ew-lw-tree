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

import { assemble, type Aliases } from './pseudocode.ts'
import type { Package } from './upk.ts'

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

/** The packages a script works on, by their names, each once. */
export function scriptPackages(text: string): string[] {
  return [...new Set(parseCommands(text).filter((c) => c.name === 'UPK_FILE').map((c) => firstLine(c.value)))]
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
  /** A file the script names (MODDED_FILE, BULK_FILE), beside the script; undefined if there is none. */
  readFile?: (name: string) => Uint8Array | undefined
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
  let entry = '' // a table entry's scope ("name GetAltWeapon"), '' otherwise
  const guids = new Map<string, Set<string>>() // GUID: the package GUIDs a script allows, by package
  let behavior = 'KEEP'
  let scopeStart = 0 // absolute offset of the scope
  let rel = 0
  let max = 0 // absolute last byte of the scope
  let updateRel = false
  let before: { found: boolean; data: Uint8Array; memSize: number } | null = null

  const objName = () => (obj ? pkg!.exports[obj - 1]!.fullName : '')
  const where = () => `${pkgName}${obj ? `: ${objName()}` : entry ? `: ${entry}` : ''}`
  let entrySize = 0
  const resetMax = () => {
    if (obj) max = scopeStart + pkg!.exports[obj - 1]!.size - 1
    else if (entry) max = scopeStart + entrySize - 1
    else if (pkg) max = pkg.bytes.length - 1
  }
  const setObject = (ref: number) => {
    obj = ref
    entry = ''
    scopeStart = pkg!.exports[ref - 1]!.offset
    rel = 0
    resetMax()
    before = null
  }
  /** A table entry as the scope (NAME_ENTRY, IMPORT_ENTRY, EXPORT_ENTRY): written in place, never resized. */
  const setEntry = (label: string, start: number, size: number) => {
    obj = 0
    entry = label
    scopeStart = start
    entrySize = size
    rel = 0
    resetMax()
    before = null
  }
  const findExport = (name: string) => {
    const ref = pkg!.findObject(name, true)
    if (ref <= 0) throw new StepError(`no object ${name} in ${pkgName}`)
    return ref
  }
  /** A value key's bytes written at the offset, as MODDED_HEX writes them. */
  const writeValue = (what: string, data: Uint8Array, line: number) => {
    if (equalAt(scopeStart + rel, data)) {
      record(what, 'already', line)
      if (updateRel) rel += data.length
    } else {
      writeData(data, false)
      record(what, 'change', line)
    }
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

  /** Grows or shrinks the object at the offset: moved to the end of the file, or in place (INPL). */
  const resize = (size: number, at: number) => {
    if (behavior === 'INPL') pkg!.resizeInPlace(obj, size, at)
    else pkg!.moveResize(obj, size, at)
    scopeStart = pkg!.exports[obj - 1]!.offset
    max = scopeStart + pkg!.exports[obj - 1]!.size - 1
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
        // INPL needs a size change to do anything; MOVE moves the object even at its size.
        if (behavior !== 'INPL' || size !== e.size) {
          if (behavior === 'INPL') pkg!.resizeInPlace(obj, size, rel)
          else pkg!.moveResize(obj, size, rel)
        }
        scopeStart = pkg!.exports[obj - 1]!.offset
        max = scopeStart + pkg!.exports[obj - 1]!.size - 1
      }
    } else if (fitScope && scopeSize !== data.length)
      throw new StepError(`the new data does not fit (${entry || 'outside an object'})`)
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
        case 'UNINSTALL':
          break
        case 'GUID': {
          // Packages the script was made for, by their GUID; declared before the package is opened.
          const [guid, upk] = splitAt(firstLine(c.value))
          const key = upk.toLowerCase()
          if (!guids.has(key)) guids.set(key, new Set())
          guids.get(key)!.add(guid.toUpperCase())
          break
        }
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
            const allowed = guids.get(key)
            if (allowed && !allowed.has(p.guid()))
              throw new StepError(`${pkgName} is another version than the mod was made for (GUID ${p.guid()})`)
            packages.set(key, p)
          }
          pkg = packages.get(key)
          obj = 0
          entry = ''
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
          setObject(findExport(name))
          break
        }
        case 'OFFSET':
          // The whole package, at an absolute offset (the first 8 bytes are not written).
          need()
          obj = 0
          entry = ''
          scopeStart = 0
          resetMax()
          rel = intValue(c.value)
          before = null
          break
        case 'NAME_ENTRY': {
          need()
          const name = firstLine(c.value)
          const i = pkg!.findName(name)
          if (i < 0) throw new StepError(`no name ${name} in ${pkgName}`)
          const e = pkg!.nameEntries[i]!
          setEntry(`name ${name}`, e.offset, e.size)
          break
        }
        case 'IMPORT_ENTRY':
        case 'EXPORT_ENTRY': {
          need()
          const name = firstLine(c.value)
          if (c.name === 'IMPORT_ENTRY') {
            const ref = pkg!.findObject(name)
            if (ref >= 0) throw new StepError(`no import ${name} in ${pkgName}`)
            setEntry(`import ${name}`, pkg!.imports[-ref - 1]!.entryOffset, 28)
          } else {
            const e = pkg!.exports[findExport(name) - 1]!
            setEntry(`export entry ${name}`, e.entryOffset, e.entrySize)
          }
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
        case 'BYTE':
        case 'FLOAT':
        case 'INTEGER':
        case 'UNSIGNED':
        case 'NAMEIDX':
        case 'OBJIDX': {
          need()
          const v = firstLine(c.value)
          const fmt = { BYTE: '%b', FLOAT: '%f', INTEGER: '%i', UNSIGNED: '%u' }[c.name as 'BYTE']
          let data: Uint8Array
          if (fmt) data = code(`<${fmt} ${v}>`).bytes
          else if (c.name === 'NAMEIDX') data = code(`<${v}>`).bytes
          else {
            const ref = pkg!.findObject(v)
            if (!ref) throw new StepError(`no object ${v} in ${pkgName}`)
            data = new Uint8Array(4)
            new DataView(data.buffer).setInt32(0, ref, true)
          }
          if (c.name === 'NAMEIDX' && data.length !== 8) throw new StepError(`${v} is not a name`)
          writeValue(c.name, data, c.line)
          break
        }
        case 'INSERT_CODE': {
          // As PatchUPK does it: the object grows by one byte less than the
          // code, and the code is written at the offset, over the byte that
          // was there. (Its readme says "insert"; mods were made against what
          // it does.) The script's sizes stay as they are.
          need()
          if (!obj) throw new StepError('INSERT_CODE outside an object')
          if (behavior === 'KEEP') throw new StepError('INSERT_CODE needs the object to grow (AUTO, MOVE or INPL)')
          const data = code(c.value).bytes
          if (!data.length) break
          // (One byte grows nothing: it is written where the object is.)
          if (data.length > 1) resize(pkg!.exports[obj - 1]!.size + data.length - 1, rel)
          pkg!.write(scopeStart + rel, data)
          if (updateRel) rel += data.length
          record(c.name, 'change', c.line)
          break
        }
        case 'REPLACE_HEX':
        case 'REPLACE_CODE': {
          // Every place the first is found, from the offset on, replaced by the second.
          need()
          const [a, b] = splitAt(c.value)
          const asm = (src: string) => (c.name === 'REPLACE_HEX' ? { bytes: hexBytes(src), memSize: -1 } : code(src))
          const from = asm(a)
          const to = asm(b)
          if (!from.bytes.length) throw new StepError('nothing to find')
          let found = 0
          const end = () => (obj ? scopeStart + pkg!.exports[obj - 1]!.size - 1 : max)
          for (let at = find(pkg!.bytes, from.bytes, scopeStart + rel, end()); at >= 0; at = find(pkg!.bytes, from.bytes, scopeStart + rel, end())) {
            found++
            before = { found: true, data: from.bytes, memSize: from.memSize }
            const relAt = at - scopeStart
            rel = relAt
            max = at + from.bytes.length - 1
            const sizes = adjustedSizes(to.bytes.length, to.memSize)
            writeData(to.bytes, true)
            if (sizes) {
              const saved = rel
              rel = sizes.rel
              writeData(sizes.data, false)
              rel = saved
            }
            // (Relative: the object may have moved.)
            rel = relAt + to.bytes.length
          }
          before = null
          resetMax()
          if (found) record(c.name, 'change', c.line, `${found} replaced`)
          else if (find(pkg!.bytes, to.bytes, scopeStart, end()) >= 0) record(c.name, 'already', c.line)
          else throw new StepError('the code to replace is not there')
          break
        }
        case 'MODDED_FILE':
        case 'FUNCTION_FILE': {
          // A file holding a whole object's data (or a table entry), named after it: Full.Object.Name.Type.
          need()
          const [file, spec] = splitAt(firstLine(c.value))
          const data = opts.readFile?.(file)
          if (!data) throw new StepError(`the file ${file} is not there`)
          const base = file.replace(/^.*[\\/]/, '')
          const dot = base.lastIndexOf('.')
          const name = base.slice(0, dot)
          const kind = base.slice(dot + 1)
          if (kind === 'NameEntry') {
            const i = pkg!.findName(name)
            if (i < 0) throw new StepError(`no name ${name} in ${pkgName}`)
            setEntry(`name ${name}`, pkg!.nameEntries[i]!.offset, pkg!.nameEntries[i]!.size)
          } else if (kind === 'ImportEntry') {
            const ref = pkg!.findObject(name)
            if (ref >= 0) throw new StepError(`no import ${name} in ${pkgName}`)
            setEntry(`import ${name}`, pkg!.imports[-ref - 1]!.entryOffset, 28)
          } else if (kind === 'ExportEntry') {
            const e = pkg!.exports[findExport(name) - 1]!
            setEntry(`export entry ${name}`, e.entryOffset, e.entrySize)
          } else {
            behavior = (spec || 'KEEP').toUpperCase()
            setObject(findExport(name))
          }
          const size = max - scopeStart + 1
          if (size === data.length && equalAt(scopeStart, data)) record(c.name, 'already', c.line)
          else {
            writeData(data, true)
            record(c.name, 'change', c.line)
          }
          break
        }
        case 'BULK_DATA':
        case 'BULK_FILE': {
          // A bulk data mirror: flags, element count, size on disk, where the data is in the file; then the data.
          need()
          let raw: Uint8Array | undefined
          if (c.name === 'BULK_DATA') raw = hexBytes(c.value)
          else {
            const file = firstLine(c.value)
            raw = opts.readFile?.(file)
            if (!raw) throw new StepError(`the file ${file} is not there`)
          }
          const data = new Uint8Array(16 + raw.length)
          const v = new DataView(data.buffer)
          v.setInt32(4, raw.length, true)
          v.setInt32(8, raw.length, true)
          v.setInt32(12, scopeStart + rel + 16, true)
          data.set(raw, 16)
          // Written as KEEP: in the space the object has.
          const saved = behavior
          behavior = 'KEEP'
          try {
            writeValue(c.name, data, c.line)
          } finally {
            behavior = saved
          }
          break
        }
        case 'RENAME':
        case 'NAMELIST_NAME': {
          need()
          const [from, to] = splitAt(firstLine(c.value))
          let i = pkg!.findName(to)
          if (i >= 0) record(c.name, 'already', c.line)
          else {
            i = pkg!.findName(from)
            if (i < 0) throw new StepError(`no name ${from} in ${pkgName}`)
            try {
              pkg!.rename(i, to)
            } catch (e) {
              throw new StepError((e as Error).message)
            }
            record(c.name, 'change', c.line)
          }
          setEntry(`name ${to}`, pkg!.nameEntries[i]!.offset, pkg!.nameEntries[i]!.size)
          break
        }
        case 'EXPAND_FUNCTION': {
          // To the size given: a function's script padded with nop tokens before its end, its sizes
          // grown with it; any other object padded with zeros at its end. Moved to the end of the file.
          need()
          const [name, sizeText] = splitAt(firstLine(c.value))
          const ref = findExport(name)
          const size = intValue(sizeText)
          const e = pkg!.exports[ref - 1]!
          if (e.size === size) record(c.name, 'already', c.line)
          else if (e.size > size) throw new StepError(`${name} is larger than ${size} bytes already`)
          else {
            const grow = size - e.size
            const script = pkg!.scriptOf(ref)
            if (script) {
              // Before the script's last token (its end), as many nops as it grows.
              const at = script.relOffset + script.size - 1
              pkg!.moveResize(ref, size, at)
              const moved = pkg!.exports[ref - 1]!
              pkg!.write(moved.offset + at, new Uint8Array(grow).fill(0x0b))
              const sizes = new Uint8Array(8)
              const v = new DataView(sizes.buffer)
              v.setInt32(0, script.memSize + grow, true)
              v.setInt32(4, script.size + grow, true)
              pkg!.write(moved.offset + script.relOffset - 8, sizes)
            } else pkg!.moveResize(ref, size, e.size)
            record(c.name, 'change', c.line)
          }
          behavior = 'KEEP'
          setObject(ref)
          break
        }
        case 'EXPAND_UNDO': {
          need()
          const ref = findExport(firstLine(c.value))
          record(c.name, pkg!.undoMove(ref) ? 'change' : 'already', c.line)
          setObject(ref)
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
            rescope()
            record(`${c.name} ${name}`, 'change', c.line)
          }
          break
        }
        case 'ADD_IMPORT_ENTRY': {
          // An import: class package, class, outer, name (28 bytes). Already there if one has that
          // class, outer and name.
          need()
          const bytes = assemble(c.value, { pkg: pkg!, aliases }).bytes
          if (bytes.length !== 28) throw new StepError(`an import entry is 28 bytes, not ${bytes.length}`)
          const v = new DataView(bytes.buffer)
          const name = nameAt(pkg!, v, 20)
          const cls = nameAt(pkg!, v, 8)
          const outer = v.getInt32(16, true)
          const fullName = `${outer ? `${pkg!.fullNameOf(outer)}.` : ''}${name}`
          const there = pkg!.imports.some((x, i) => x.name === name && x.outer === outer && x.className === cls && pkg!.fullNameOf(-(i + 1)) === fullName)
          if (there) record(`${c.name} ${fullName}`, 'already', c.line)
          else {
            pkg!.addImport(bytes)
            rescope()
            record(`${c.name} ${fullName}`, 'change', c.line)
          }
          break
        }
        case 'ADD_EXPORT_ENTRY': {
          // An export entry (without net objects: 68 bytes); its data and link as Package.addExport
          // makes them. Already there if one has that class, outer and name.
          need()
          const bytes = assemble(c.value, { pkg: pkg!, aliases }).bytes
          if (bytes.length !== 68) throw new StepError(`an export entry is 68 bytes here, not ${bytes.length}`)
          const v = new DataView(bytes.buffer)
          const name = nameAt(pkg!, v, 12)
          const outer = v.getInt32(8, true)
          const cls = v.getInt32(0, true)
          const fullName = `${outer ? `${pkg!.fullNameOf(outer)}.` : ''}${name}`
          const there = pkg!.exports.some((x) => x.name === name && x.outer === outer && x.classIndex === cls)
          if (there) record(`${c.name} ${fullName}`, 'already', c.line)
          else {
            try {
              pkg!.addExport(bytes)
            } catch (e) {
              throw new StepError((e as Error).message)
            }
            rescope()
            record(`${c.name} ${fullName}`, 'change', c.line)
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

  /** After the header grew: the scope found again where it now is. */
  function rescope() {
    if (obj) {
      scopeStart = pkg!.exports[obj - 1]!.offset
      resetMax()
    } else if (entry) {
      // A table entry's scope does not follow the table's growth: it is left.
      entry = ''
      scopeStart = 0
      rel = 0
      resetMax()
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

/** The name an 8-byte name reference in an entry stands for ("Foo", "Foo_2"). */
function nameAt(pkg: Package, v: DataView, at: number): string {
  const n = pkg.names[v.getInt32(at, true)] ?? ''
  const num = v.getInt32(at + 4, true)
  return num && n !== 'None' ? `${n}_${num - 1}` : n
}

/** The name in a raw name-table entry (length, text, flags). */
function nameInEntry(entry: Uint8Array): string {
  const n = new DataView(entry.buffer, entry.byteOffset).getInt32(0, true)
  return new TextDecoder('latin1').decode(entry.subarray(4, 4 + n)).replace(/\0+$/, '')
}
