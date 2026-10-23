// PatcherGUI / PatchUPK mod scripts (wghost81's format), read for what the
// Tools page shows: the mod's name and description, what it patches, and its
// options. An option is an ALIAS whose value is a literal (`<%b 9>`,
// `<%f 0.5>`): mods use these for the numbers a player may change, with a
// comment beside or above saying what it does.
//
// Assembling the patch code itself (the [REPLACEMENT_CODE] etc. sections)
// is phase 2 of features/game-tools.md.

import { isUpkmod } from './modpatch.ts'

export type LiteralKind = 'b' | 'i' | 'f' | 'u' | 's' | 't'

export interface ModOption {
  name: string
  kind: LiteralKind
  /** As written in the script. */
  value: string
  /** What the script says about it. */
  help: string
}

export interface ModTarget {
  upk: string
  /** "Class.Function", or a default object; "" for package-wide entries. */
  object: string
  /** OBJECT=…:AUTO lets the patch grow the object. */
  auto: boolean
  /** Section kinds under it: REPLACEMENT_CODE, BEFORE_HEX, ADD_NAME_ENTRY … */
  sections: string[]
}

export interface ModScript {
  name: string
  author: string
  description: string
  targets: ModTarget[]
  options: ModOption[]
}

const LITERAL = /^<\s*%([biufst])\s*("?)(.*?)\2\s*>$/

/** A script's first /* … *\/ block: most authors describe the mod there when there is no DESCRIPTION. */
function leadingComment(text: string): string {
  const m = /^\s*\/\*([\s\S]*?)\*\//.exec(text)
  return m ? m[1]!.trim() : ''
}

export function parseModScript(text: string, fileName = ''): ModScript {
  if (isUpkmod(text)) return upkmodScript(text)
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const meta: Record<string, string> = {}
  const targets: ModTarget[] = []
  const options: ModOption[] = []
  let upk = ''
  let current: ModTarget | undefined
  let comments: string[] = []
  let inBlock = false

  for (const raw of lines) {
    const line = raw.trim()
    if (inBlock) {
      if (line.includes('*/')) inBlock = false
      continue
    }
    if (line.startsWith('/*')) {
      if (!line.includes('*/')) inBlock = true
      comments = []
      continue
    }
    if (line.startsWith('//')) {
      comments.push(line.replace(/^\/\/\s?/, ''))
      continue
    }
    if (!line) {
      comments = []
      continue
    }
    const section = /^\[([A-Z_]+)\]/.exec(line)
    if (section) {
      // A section before any OBJECT belongs to the package (ADD_NAME_ENTRY …).
      if (!current) {
        current = { upk, object: '', auto: false, sections: [] }
        targets.push(current)
      }
      current.sections.push(section[1]!)
      comments = []
      continue
    }
    const kv = /^([A-Z_]+)\s*=\s*(.*)$/.exec(line)
    if (!kv) continue
    const key = kv[1]!
    const value = kv[2]!.replace(/\s*\/\/.*$/, '').trim()
    const trailing = /\/\/\s?(.*)$/.exec(kv[2]!)?.[1]?.trim() ?? ''
    if (key === 'UPK_FILE') {
      upk = value
      current = undefined
    } else if (key === 'OBJECT') {
      const [object, mode] = value.split(':').map((s) => s.trim())
      current = { upk, object: object!, auto: (mode ?? '').toUpperCase() === 'AUTO', sections: [] }
      targets.push(current)
    } else if (key === 'ALIAS') {
      const at = value.indexOf(':')
      const name = value.slice(0, at).trim()
      const literal = LITERAL.exec(value.slice(at + 1).trim())
      if (name && literal)
        options.push({
          name,
          kind: literal[1] as LiteralKind,
          value: literal[3]!.trim(),
          help: [...comments, trailing].filter(Boolean).join(' '),
        })
    } else if (['MOD_NAME', 'AUTHOR', 'DESCRIPTION'].includes(key)) {
      meta[key] = value
    } else if (current && /^(MODDED|FIND|BEFORE|AFTER)_(CODE|HEX)$/.test(key)) {
      current.sections.push(key)
    }
    comments = []
  }

  const base = fileName.replace(/^.*[\\/]/, '').replace(/\.txt$/i, '')
  const intro = leadingComment(text)
  const firstLine = intro.split('\n')[0]?.trim() ?? ''
  return {
    name: meta.MOD_NAME || firstLine.replace(/\s+-\s+\w+$/, '') || base,
    author: meta.AUTHOR || (/\s-\s(\w+)$/.exec(firstLine)?.[1] ?? ''),
    description: meta.DESCRIPTION || intro.split('\n').slice(1).join('\n').trim(),
    targets,
    options,
  }
}

/** Whether a script is written for Long War or plain Enemy Within, going by its file name. */
export function scriptFor(fileName: string): 'lw' | 'ew' | undefined {
  if (/_LW\b|LongWar/i.test(fileName)) return 'lw'
  if (/_EW\b|Enabler/i.test(fileName)) return 'ew'
  return undefined
}

/** Checks an option's new value against its kind; returns the reason it is not valid, or ''. */
export function optionProblem(kind: LiteralKind, value: string): string {
  const v = value.trim()
  if (kind === 'b') return /^\d+$/.test(v) && Number(v) <= 255 ? '' : 'a whole number from 0 to 255'
  if (kind === 'i') return /^-?\d+$/.test(v) ? '' : 'a whole number'
  if (kind === 'u') return /^(0x[\da-f]+|\d+)$/i.test(v) ? '' : 'a whole number'
  if (kind === 'f') return /^-?\d+(\.\d+)?$/.test(v) ? '' : 'a number'
  return ''
}

/**
 * A .upkmod as the mod's card reads it (features/upkit-source-mods.md): its
 * header's name, author and description, and what its hunks change (the
 * classes, and the functions and states they name) as targets. A new class
 * is package-wide: the install does not have it.
 */
function upkmodScript(text: string): ModScript {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const meta: Record<string, string> = {}
  const targets: ModTarget[] = []
  let current: { upk: string; cls: string; isNew: boolean } | undefined
  const add = (object: string) => {
    if (!current) return
    const t = targets.find((x) => x.upk === current!.upk && x.object === object)
    if (!t) targets.push({ upk: current.upk, object, auto: true, sections: ['upkit mod'] })
  }
  for (const line of lines) {
    const m = /^(name|author|description):\s*(.*)$/.exec(line)
    if (m && !current) meta[m[1]!] = m[2]!.trim()
    const c = /^--- (\S+) (\S+)( \(new\))?/.exec(line)
    if (c) {
      current = { upk: c[1]!, cls: c[2]!, isNew: !!c[3] }
      add(current.isNew ? '' : current.cls)
    }
    const h = /^@@ (.*) @@/.exec(line)
    if (h && current && !current.isNew) {
      // The innermost block's name: "function int Foo()" → Foo, in "state S" → S.Foo.
      const names = h[1]!.split(' > ').map((b) => /(\w+)\s*\(/.exec(b)?.[1] ?? /\bstate\s+(\w+)/i.exec(b)?.[1]).filter(Boolean)
      if (names.length && !/^(class|add)$/.test(h[1]!.trim())) add(`${current.cls}.${names.join('.')}`)
    }
  }
  return { name: meta.name ?? '', author: meta.author ?? '', description: meta.description ?? '', targets, options: [] }
}
