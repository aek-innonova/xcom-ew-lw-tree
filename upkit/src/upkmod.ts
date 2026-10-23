// Mods as source diffs (features/upkit-source-mods.md): a .upkmod file holds,
// per class, unified-diff hunks of the class's source as `upkit class` writes
// it. Applied to the player's own package: the class decompiled, each hunk
// found by its anchor (its context and the lines it takes away) and replaced,
// the class compiled back. Anchors match on a canonical form of the code, not
// on its characters: tokens (spacing, line breaks and comments do not count),
// identifiers and names without case (UnrealScript ignores case), qualifiers
// that name the same object dropped (`class'XComGame.XGUnit'` is
// `class'XGUnit'`, `self.m_iX` is `m_iX`), numbers by their value.
//
// A hunk names the block it is in (a function, a state, defaultproperties,
// or the class itself), by the block's first line, so it is found wherever the
// block is. A hunk's anchor must be there once in its block: otherwise it does
// not fit, and says so.
//
// PatchUPK must never read such a file as its own: the format has no line it
// takes as a command (checked when one is written and when one is read).

import { isUpkmod as isUpkmodText, parseCommands } from '../../src/model/modpatch.ts'
import { decompileClass } from './classdecomp.ts'
import { classesPackage, classPathIn } from './changes.ts'
import { Linker } from './linker.ts'
import { openPackage, type Package } from './package.ts'
import { lex, type Tok } from './parse.ts'

export const UPKMOD_VERSION = 1
const HEADER = /^upkit mod (\d+)\s*$/

/** The class of that name in a package, its path there (inside a package object in a seek-free one); null if it has none. */
function classIn(pkg: Package, name: string): string | null {
  const path = classPathIn(pkg, name)
  const ref = pkg.find(path)
  return ref && pkg.className(ref) === 'Class' ? path : null
}

/** Whether a mod file is one of ours (its first line says so). */
export const isUpkmod = isUpkmodText

export interface Hunk {
  /** The blocks it is in, outermost first ("state Waiting", "function int Foo()"); empty: the class. */
  block: string[]
  /**
   * Declarations added to the class, anchored on nothing ("@@ add @@"): variables and
   * constants after the class's own, functions, states and the like before its defaults,
   * where upkit prints what it compiles.
   */
  add?: boolean
  /** Its lines: ' ' context, '-' taken away, '+' added. */
  lines: { k: ' ' | '-' | '+'; text: string }[]
  /** Its line in the mod file, for messages. */
  line: number
}
export interface ClassDiff {
  /** The package's file name ("XComStrategyGame.upk"). */
  upk: string
  /** The class's name (as `upkit class` takes it). */
  cls: string
  /** A class the package does not have: its whole source is the hunk's added lines. */
  isNew: boolean
  hunks: Hunk[]
  line: number
}
export interface Upkmod {
  version: number
  name: string
  author: string
  description: string
  tested: string[]
  classes: ClassDiff[]
}

export class UpkmodError extends Error {
  line: number
  constructor(message: string, line: number) {
    super(message)
    this.line = line
  }
}

// --- The file ----------------------------------------------------------------------

/** Reads a .upkmod (throws an UpkmodError with the line where it is wrong). */
export function parseUpkmod(text: string): Upkmod {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  const head = HEADER.exec(lines[0]!.trim())
  if (!head) throw new UpkmodError('not a .upkmod (its first line is "upkit mod <version>")', 1)
  const version = Number(head[1])
  if (version > UPKMOD_VERSION) throw new UpkmodError(`made for .upkmod version ${version}; this one reads version ${UPKMOD_VERSION}`, 1)
  // PatchUPK must find nothing in it to do.
  const commands = parseCommands(text)
  if (commands.length) throw new UpkmodError(`line ${commands[0]!.line} is one PatchUPK would act on (${commands[0]!.name}): not in a .upkmod`, commands[0]!.line)
  const mod: Upkmod = { version, name: '', author: '', description: '', tested: [], classes: [] }
  let i = 1
  for (; i < lines.length && !lines[i]!.startsWith('--- '); i++) {
    const m = /^(\w+):\s*(.*)$/.exec(lines[i]!)
    if (!m) {
      if (lines[i]!.trim()) throw new UpkmodError(`"${lines[i]!.trim()}": a header line is "field: value"`, i + 1)
      continue
    }
    const [, field, value] = m as unknown as [string, string, string]
    if (field === 'name') mod.name = value.trim()
    else if (field === 'author') mod.author = value.trim()
    else if (field === 'description') mod.description = value.trim()
    else if (field === 'tested') mod.tested = value.split(',').map((s) => s.trim()).filter(Boolean)
    else if (field !== 'package') throw new UpkmodError(`"${field}": not a header field (name, author, description, package, tested)`, i + 1)
  }
  let cls: ClassDiff | undefined
  let hunk: Hunk | undefined
  for (; i < lines.length; i++) {
    const line = lines[i]!
    const c = /^--- (\S+) (\S+)( \(new\))?\s*$/.exec(line)
    if (c) {
      cls = { upk: c[1]!, cls: c[2]!, isNew: !!c[3], hunks: [], line: i + 1 }
      mod.classes.push(cls)
      hunk = undefined
      continue
    }
    const h = /^@@ (.*) @@\s*$/.exec(line)
    if (h) {
      if (!cls) throw new UpkmodError('a hunk before its class ("--- <package> <class>")', i + 1)
      const where = h[1]!.trim()
      hunk = { block: where === 'class' || where === 'add' ? [] : where.split(' > ').map((s) => s.trim()), add: where === 'add', lines: [], line: i + 1 }
      cls.hunks.push(hunk)
      continue
    }
    const k = line[0]
    if (k === ' ' || k === '-' || k === '+') {
      if (!hunk) throw new UpkmodError('a diff line before its hunk ("@@ <block> @@")', i + 1)
      hunk.lines.push({ k, text: line.slice(1) })
      continue
    }
    // An empty line in a hunk is an empty context line (editors strip the space).
    if (line === '') {
      if (hunk && lines.slice(i + 1).some((l) => /^[ +-]/.test(l)) && !/^(--- |@@ )/.test(lines[i + 1] ?? '')) hunk.lines.push({ k: ' ', text: '' })
      continue
    }
    throw new UpkmodError(`"${line}": not a line of a hunk (' ', '-' or '+' first)`, i + 1)
  }
  for (const c of mod.classes) {
    if (c.isNew && (c.hunks.length !== 1 || c.hunks[0]!.lines.some((l) => l.k !== '+')))
      throw new UpkmodError(`${c.cls}: a new class is one hunk of added lines`, c.line)
    for (const h of c.hunks) {
      if (h.add && h.lines.some((l) => l.k !== '+')) throw new UpkmodError('an "add" hunk only adds lines', h.line)
      if (!c.isNew && !h.add && !h.lines.some((l) => l.k !== '+' && canonical(l.text).length))
        throw new UpkmodError('a hunk needs lines it is anchored on (context or lines it takes away)', h.line)
    }
  }
  return mod
}

/** Writes a .upkmod; refuses one in which PatchUPK would find a command. */
export function formatUpkmod(mod: Omit<Upkmod, 'version'>): string {
  const out = [`upkit mod ${UPKMOD_VERSION}`]
  // (A header field is one line.)
  const line = (s: string) => s.replace(/\s*\r?\n\s*/g, ' ').trim()
  if (mod.name) out.push(`name: ${line(mod.name)}`)
  if (mod.author) out.push(`author: ${line(mod.author)}`)
  if (mod.description) out.push(`description: ${line(mod.description)}`)
  const upks = [...new Set(mod.classes.map((c) => c.upk))]
  if (upks.length) out.push(`package: ${upks.join(', ')}`)
  if (mod.tested.length) out.push(`tested: ${mod.tested.join(', ')}`)
  for (const c of mod.classes) {
    out.push('', `--- ${c.upk} ${c.cls}${c.isNew ? ' (new)' : ''}`)
    for (const h of c.hunks) {
      out.push(`@@ ${h.add ? 'add' : h.block.length ? h.block.join(' > ') : 'class'} @@`)
      for (const l of h.lines) out.push(`${l.k}${l.text}`)
    }
  }
  const text = out.join('\n') + '\n'
  const commands = parseCommands(text)
  if (commands.length)
    throw new Error(`a line of the mod would be a PatchUPK command (${commands[0]!.name}, line ${commands[0]!.line}): not written`)
  return text
}

// --- Canonical code ----------------------------------------------------------------

/** A token as anchors compare it. */
type Canon = string
const tokensOf = (src: string): Tok[] => {
  try {
    return lex(src).filter((t) => t.t !== 'eof')
  } catch {
    // (A fragment the lexer does not take, an unclosed name: compared as words.)
    return src.split(/\s+/).filter(Boolean).map((v, k) => ({ t: 'id' as const, v, pos: k, space: true }))
  }
}
function canonOf(toks: Tok[]): { canon: Canon[]; at: number[] } {
  const canon: Canon[] = []
  const at: number[] = []
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k]!
    // `self.x` is `x`.
    if (t.t === 'id' && t.v.toLowerCase() === 'self' && toks[k + 1]?.v === '.' && toks[k + 2]?.t === 'id') {
      k++
      continue
    }
    let c: string
    if (t.t === 'id') c = `i:${t.v.toLowerCase()}`
    // A name or an object by name: without case, without the package and outers before it.
    else if (t.t === 'name') c = `n:${t.v.toLowerCase().split('.').pop()}`
    else if (t.t === 'int') c = `#:${Number(t.v)}`
    else if (t.t === 'float') c = `#:${parseFloat(t.v)}`
    else if (t.t === 'str') c = `s:${t.v}`
    else c = t.v
    canon.push(c)
    at.push(k)
  }
  return { canon, at }
}
/** A text's canonical tokens. */
export const canonical = (src: string): Canon[] => canonOf(tokensOf(src)).canon

const findAll = (hay: Canon[], needle: Canon[], from: number, to: number): number[] => {
  const hits: number[] = []
  if (!needle.length) return hits
  outer: for (let i = from; i + needle.length <= to; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    hits.push(i)
  }
  return hits
}

// --- Blocks --------------------------------------------------------------------------

const BLOCK_WORDS = new Set(['function', 'event', 'state', 'defaultproperties', 'structdefaultproperties', 'struct', 'replication', 'cpptext', 'delegate'])

interface Block {
  /** Its first line's text (trimmed), as hunks name it. */
  header: string
  /** Token indexes: its first token, and one past its closing brace. */
  from: number
  to: number
  /** Character offsets: its first line's start, and after its closing brace. */
  start: number
  end: number
  children: Block[]
}

/** The blocks of a class's source: functions, states (with theirs), defaults, structs. */
function blocksOf(text: string, toks: Tok[]): Block[] {
  const top: Block[] = []
  const stack: { block: Block | null; depth: number }[] = []
  let depth = 0
  let pending: { header: string; from: number; start: number } | null = null
  const lineStart = (pos: number) => text.lastIndexOf('\n', pos - 1) + 1
  const lineText = (pos: number) => {
    const s = lineStart(pos)
    const e = text.indexOf('\n', pos)
    return text.slice(s, e < 0 ? text.length : e).trim()
  }
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k]!
    const firstOnLine = k === 0 || text.lastIndexOf('\n', t.pos - 1) >= toks[k - 1]!.pos
    if (firstOnLine && depth === (stack.at(-1)?.depth ?? 0) && !pending) {
      // A line that starts a block: modifiers, then a block word (before any ';').
      for (let j = k; j < toks.length && toks[j]!.v !== ';' && toks[j]!.v !== '{'; j++) {
        if (toks[j]!.t === 'id' && BLOCK_WORDS.has(toks[j]!.v.toLowerCase())) {
          pending = { header: lineText(t.pos), from: k, start: lineStart(t.pos) }
          break
        }
        if (toks[j]!.t !== 'id') break
      }
    }
    if (t.v === ';' && pending && depth === (stack.at(-1)?.depth ?? 0)) pending = null
    if (t.v === '{' && t.t === 'op') {
      depth++
      if (pending) {
        const block: Block = { header: pending.header, from: pending.from, to: -1, start: pending.start, end: -1, children: [] }
        ;(stack.at(-1)?.block?.children ?? top).push(block)
        stack.push({ block, depth })
        pending = null
      } else stack.push({ block: null, depth })
    } else if (t.v === '}' && t.t === 'op') {
      const s = stack.pop()
      depth--
      if (s?.block) {
        s.block.to = k + 1
        s.block.end = t.pos + 1
      }
    }
  }
  return top
}

/** The block a hunk names, in the class's source; or why it is not there once. */
function findBlock(text: string, toks: Tok[], path: string[]): Block | { error: string } | null {
  if (!path.length) return null
  let level = blocksOf(text, toks)
  let found: Block | null = null
  for (const header of path) {
    const want = canonical(header).join(' ')
    const hits = level.filter((b) => canonical(b.header).join(' ') === want)
    if (hits.length !== 1) return { error: `${hits.length ? 'more than one' : 'no'} block "${header}"${found ? ` in "${found.header}"` : ''}` }
    found = hits[0]!
    level = found.children
  }
  return found
}

// --- Applying ----------------------------------------------------------------------

export interface HunkResult {
  cls: string
  block: string
  status: 'change' | 'already' | 'error'
  note?: string
  line: number
}

/**
 * One class's hunks on its source: the text they leave, and what each did.
 * A hunk is there already when its anchor is not found and what it adds is.
 */
/** What an "add" hunk adds: its items (a declaration line, or a block with its lines). */
function itemsOf(lines: string[]): { text: string; header: string | null }[] {
  const text = lines.join('\n')
  const toks = tokensOf(text)
  const blocks = blocksOf(text, toks)
  const items: { text: string; header: string | null; start: number }[] = blocks.map((b) => ({ text: text.slice(b.start, b.end), header: b.header, start: b.start }))
  // The lines outside every block: declarations, one a line.
  let pos = 0
  for (const line of lines) {
    const inBlock = blocks.some((b) => pos >= b.start && pos < b.end)
    if (!inBlock && line.trim()) items.push({ text: line, header: null, start: pos })
    pos += line.length + 1
  }
  return items.sort((a, b) => a.start - b.start).map(({ text, header }) => ({ text, header }))
}

function applyAdd(text: string, h: Hunk): { text: string; status: 'change' | 'already' | 'error'; note?: string } {
  const added = h.lines.map((l) => l.text)
  const items = itemsOf(added)
  const toks = tokensOf(text)
  const blocks = blocksOf(text, toks)
  const lineKeys = new Set(text.split('\n').map((l) => canonical(l).join(' ')).filter(Boolean))
  const there = items.map((it) => {
    if (it.header === null) return lineKeys.has(canonical(it.text).join(' ')) ? 'same' : 'no'
    const b = blocks.find((x) => canonical(x.header).join(' ') === canonical(it.header!).join(' '))
    if (!b) return 'no'
    return canonical(text.slice(b.start, b.end)).join(' ') === canonical(it.text).join(' ') ? 'same' : 'other'
  })
  if (there.every((t) => t === 'same')) return { text, status: 'already' }
  const other = items.find((_, k) => there[k] === 'other')
  if (other) return { text, status: 'error', note: `the class has "${other.header}" already, another than the mod's` }
  if (there.some((t) => t === 'same')) return { text, status: 'error', note: 'some of what it adds is there already, some not (another version, or another mod)' }
  // Declarations after the class's last one at its top; blocks before its defaults (or at its end).
  const decls = items.filter((it) => it.header === null).map((it) => it.text)
  const rest = items.filter((it) => it.header !== null).map((it) => it.text)
  const lines = text.split('\n')
  const top = (l: string, k: number) => /^(var|const)\b/i.test(l) && !blocks.some((b) => { const off = lines.slice(0, k).join('\n').length + (k ? 1 : 0); return off > b.start && off < b.end })
  if (decls.length) {
    let at = -1
    lines.forEach((l, k) => { if (top(l, k)) at = k })
    if (at < 0) at = lines.findIndex((l) => /;\s*$/.test(l))
    lines.splice(at + 1, 0, ...decls)
  }
  if (rest.length) {
    let at = lines.findIndex((l) => /^defaultproperties\b/i.test(l.trim()) && !/^\s/.test(l))
    if (at < 0) at = lines.length
    lines.splice(at, 0, ...rest.flatMap((r) => [...r.split('\n'), '']))
  }
  return { text: lines.join('\n'), status: 'change' }
}

/**
 * One mod's hunks for a class on its source: all found on the text as it is
 * before them (a mod's hunks may leave it unbalanced between them: one opens
 * a block another closes), then replaced from the last to the first; then its
 * additions. The text they leave, and what each did.
 */
export function applyHunks(text: string, cls: string, hunks: Hunk[]): { text: string; results: HunkResult[] } {
  const results: HunkResult[] = hunks.map((h) => ({ cls, block: h.add ? 'add' : h.block.length ? h.block.join(' > ') : 'class', status: 'error', line: h.line }))
  const toks = tokensOf(text)
  const { canon, at } = canonOf(toks)
  const edits: { start: number; end: number; replacement: string; k: number }[] = []
  hunks.forEach((h, k) => {
    if (h.add) return
    const res = results[k]!
    const where = res.block
    const block = findBlock(text, toks, h.block)
    if (block && 'error' in block) {
      res.note = block.error
      return
    }
    // The block's tokens, as canonical positions.
    const from = block ? at.findIndex((x) => x >= block.from) : 0
    const toRaw = block && block.to >= 0 ? at.findIndex((x) => x >= block.to) : -1
    const to = toRaw < 0 ? canon.length : toRaw
    const before = canonical(h.lines.filter((l) => l.k !== '+').map((l) => l.text).join('\n'))
    const after = canonical(h.lines.filter((l) => l.k !== '-').map((l) => l.text).join('\n'))
    const hits = findAll(canon, before, from, to)
    if (hits.length === 1) {
      // Only its changes are made: each run of lines it takes away (from the first token's line
      // to the last's) replaced by the lines it adds; lines it only adds go after the context
      // line before them (or before the one after them). The context only finds the place.
      const lineStart = (pos: number) => text.lastIndexOf('\n', pos - 1) + 1
      const lineEnd = (pos: number) => {
        const e = text.indexOf('\n', pos)
        return e < 0 ? text.length : e
      }
      const tokenEnd = (k: number) => {
        let e = toks[k + 1]?.pos ?? text.length
        while (e > 0 && /\s/.test(text[e - 1]!)) e--
        return e
      }
      let c = hits[0]! // canonical position in the text, as the hunk's anchor lines are walked
      let lastContextEnd = -1 // where the last context line's last token ends
      for (let n = 0; n < h.lines.length; ) {
        const l = h.lines[n]!
        if (l.k === ' ') {
          const len = canonical(l.text).length
          if (len) lastContextEnd = tokenEnd(at[c + len - 1]!)
          c += len
          n++
          continue
        }
        // A run of changes: what it takes away, and what it adds.
        let removed = 0
        const added: string[] = []
        for (; n < h.lines.length && h.lines[n]!.k !== ' '; n++) {
          const x = h.lines[n]!
          if (x.k === '-') removed += canonical(x.text).length
          else added.push(x.text)
        }
        if (removed) {
          const first = toks[at[c]!]!
          const end = tokenEnd(at[c + removed - 1]!)
          const ls = lineStart(first.pos)
          const le = lineEnd(end)
          const prefix = text.slice(ls, first.pos)
          const suffix = text.slice(end, le)
          const whole = !prefix.trim() && !suffix.trim()
          const replacement = whole ? added.join('\n') : `${prefix}${added.map((x) => x.trim()).join(' ')}${suffix}`
          // (Nothing added in place of whole lines: the lines go, their line break too.)
          if (whole && !added.length) edits.push({ start: ls, end: le < text.length ? le + 1 : le, replacement: '', k })
          else edits.push({ start: ls, end: le, replacement, k })
          c += removed
        } else if (added.length) {
          // Only added: after the context line before them, or before the one after them.
          if (lastContextEnd >= 0) {
            const at0 = lineEnd(lastContextEnd)
            edits.push({ start: at0, end: at0, replacement: `\n${added.join('\n')}`, k })
          } else {
            const next = toks[at[c]!]
            const ls = next ? lineStart(next.pos) : text.length
            edits.push({ start: ls, end: ls, replacement: `${added.join('\n')}\n`, k })
          }
        }
      }
      res.status = 'change'
      return
    }
    if (hits.length > 1) {
      res.note = `its lines are there ${hits.length} times in ${where}: it needs more context`
      return
    }
    if (findAll(canon, after, from, to).length === 1 && before.join(' ') !== after.join(' ')) {
      res.status = 'already'
      return
    }
    const shown = h.lines.filter((l) => l.k !== '+').map((l) => l.text.trim()).filter(Boolean)
    res.note = `the lines it changes are not there as it expects in ${where} (another version, or another mod, changed them): ${shown.slice(0, 3).join(' / ')}${shown.length > 3 ? ' …' : ''}`
  })
  // Two of its hunks on the same lines: neither is applied.
  edits.sort((a, b) => a.start - b.start || a.end - b.end)
  for (let n = 1; n < edits.length; n++)
    if (edits[n]!.start < edits[n - 1]!.end || (edits[n]!.start === edits[n - 1]!.start && edits[n]!.end === edits[n - 1]!.end && edits[n]!.k !== edits[n - 1]!.k))
      for (const e of [edits[n - 1]!, edits[n]!]) Object.assign(results[e.k]!, { status: 'error', note: 'two of its hunks change the same lines' })
  // (Its additions are made after the changes: not yet failed.)
  if (results.some((r, k) => !hunks[k]!.add && r.status === 'error')) return { text, results }
  for (const e of [...edits].reverse()) text = text.slice(0, e.start) + e.replacement + text.slice(e.end)
  // Then the additions, on the text the changes leave.
  hunks.forEach((h, k) => {
    if (!h.add) return
    const r = applyAdd(text, h)
    text = r.text
    Object.assign(results[k]!, { status: r.status, note: r.note })
  })
  return { text, results }
}

/**
 * A mod applied to a package: its classes decompiled, their hunks applied, the
 * edited classes compiled back (the keep layout: the rest stays as it was).
 * The package's new bytes, or null when nothing changed or something does not fit.
 */
export function applyUpkmodTo(
  linker: Linker,
  pkg: Package,
  pkgName: string,
  classes: ClassDiff[],
): { bytes: Uint8Array | null; results: HunkResult[]; compiled: string[] } {
  const results: HunkResult[] = []
  const texts: string[] = []
  for (const c of classes) {
    const path = classIn(pkg, c.cls)
    const has = !!path
    if (c.isNew) {
      const src = c.hunks[0]!.lines.map((l) => l.text).join('\n') + '\n'
      if (has) {
        const now = canonical(decompileClass(linker, pkg, path!))
        const same = now.join(' ') === canonical(src).join(' ')
        results.push({ cls: c.cls, block: 'class', status: same ? 'already' : 'error', note: same ? undefined : `the package has a class ${c.cls} already, another than the mod's`, line: c.line })
      } else {
        texts.push(src)
        results.push({ cls: c.cls, block: 'class', status: 'change', line: c.line })
      }
      continue
    }
    if (!has) {
      results.push({ cls: c.cls, block: 'class', status: 'error', note: `no class ${c.cls} in ${pkgName}`, line: c.line })
      continue
    }
    const before = decompileClass(linker, pkg, path!)
    const r = applyHunks(before, c.cls, c.hunks)
    results.push(...r.results)
    if (r.results.some((x) => x.status === 'change')) texts.push(r.text)
  }
  if (results.some((r) => r.status === 'error') || !texts.length) return { bytes: null, results, compiled: [] }
  const whole = classesPackage(linker, pkg, pkgName, texts, 'keep')
  return { bytes: whole.bytes, results, compiled: [...new Set([...whole.declared, ...whole.compiled, ...whole.objects.map((o) => `${o} (default properties)`)])] }
}

// --- Writing a mod from an edited class ----------------------------------------------

type Op = { k: ' ' | '-' | '+'; text: string; i: number }

/** The edit from one text to another, line by line, lines compared by their canonical tokens. */
function lineOps(a: string[], b: string[]): Op[] {
  const ka = a.map((l) => canonical(l).join(' '))
  const kb = b.map((l) => canonical(l).join(' '))
  const n = a.length
  const m = b.length
  const lcs = Array.from({ length: n + 1 }, () => new Int32Array(m + 1))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) lcs[i]![j] = ka[i] === kb[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
  const ops: Op[] = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && ka[i] === kb[j]) {
      ops.push({ k: ' ', text: b[j]!, i })
      i++
      j++
    } else if (i < n && (j === m || lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) ops.push({ k: '-', text: a[i]!, i: i++ })
    else ops.push({ k: '+', text: b[j++]!, i })
  }
  return ops
}

/** The hunks that make a class's source (as `upkit class` writes it) into the edited one. */
export function classHunks(before: string, edited: string, context = 3): Hunk[] {
  // (upkit's own notes in what it decompiles, "// upkit: …", are no part of a change.)
  const notes = (t: string) => t.replace(/^[ \t]*\/\/ upkit:.*\n/gm, '')
  before = notes(before)
  edited = notes(edited)
  const a = before.replace(/\n$/, '').split('\n')
  const b = edited.replace(/\n$/, '').split('\n')
  const ops = lineOps(a, b)
  // Each line of the original: the innermost block it is in (its path of headers).
  const toks = tokensOf(before)
  const blocks = blocksOf(before, toks)
  const lineOf = (pos: number) => before.slice(0, pos).split('\n').length - 1
  const pathAt: string[][] = a.map(() => [])
  const spanAt: [number, number][] = a.map(() => [0, a.length - 1])
  const walk = (list: Block[], path: string[]) => {
    for (const bl of list) {
      const p = [...path, bl.header]
      const l0 = lineOf(bl.start)
      const l1 = lineOf(bl.end - 1)
      for (let l = l0; l <= l1; l++) {
        pathAt[l] = p
        spanAt[l] = [l0, l1]
      }
      walk(bl.children, p)
    }
  }
  walk(blocks, [])
  // A change's block: of the original line it is at (an added line: the line after it,
  // unless that one starts a block of its own: then the one before).
  const blockOf = (o: Op) => {
    let l = Math.min(o.i, a.length - 1)
    if (o.k === '+' && l > 0 && (pathAt[l]!.length > pathAt[l - 1]!.length || spanAt[l]![0] === l)) l--
    return { path: pathAt[l] ?? [], span: spanAt[l] ?? [0, a.length - 1] }
  }
  const hunks: Hunk[] = []
  const changes = ops.map((o, k) => (o.k === ' ' ? -1 : k)).filter((k) => k >= 0)
  for (let c = 0; c < changes.length; ) {
    const blk = blockOf(ops[changes[c]!]!)
    const key = blk.path.join(' > ')
    let last = c
    while (
      last + 1 < changes.length &&
      changes[last + 1]! - changes[last]! <= context * 2 + 1 &&
      blockOf(ops[changes[last + 1]!]!).path.join(' > ') === key
    )
      last++
    // Context: within the block (a block's own lines; the class: anything).
    const inBlock = (o: Op) => !blk.path.length || (o.i >= blk.span[0] && o.i <= blk.span[1] + (o.k === '+' ? 1 : 0))
    let from = changes[c]!
    for (let n = 0; n < context && from > 0 && inBlock(ops[from - 1]!) && ops[from - 1]!.k === ' '; n++) from--
    let to = changes[last]! + 1
    for (let n = 0; n < context && to < ops.length && inBlock(ops[to]!) && ops[to]!.k === ' '; n++) to++
    hunks.push({ block: blk.path, lines: ops.slice(from, to).map((o) => ({ k: o.k, text: o.text })), line: 0 })
    c = last + 1
  }
  return hunks
}

/** A class-level hunk that only adds whole declarations or blocks: as an "add" hunk, without its context. */
export function asAdd(h: Hunk): Hunk | null {
  if (h.block.length || h.lines.some((l) => l.k === '-')) return null
  const added = h.lines.filter((l) => l.k === '+').map((l) => l.text)
  while (added.length && !added[0]!.trim()) added.shift()
  while (added.length && !added.at(-1)!.trim()) added.pop()
  if (!added.length) return null
  // Every line in a block or a declaration of its own.
  const text = added.join('\n')
  const blocks = blocksOf(text, tokensOf(text))
  let pos = 0
  for (const line of added) {
    const inBlock = blocks.some((b) => pos >= b.start && pos < b.end)
    if (!inBlock && line.trim() && !/^(var|const)\b.*;\s*$/i.test(line.trim())) return null
    pos += line.length + 1
  }
  return { block: [], add: true, lines: added.map((t) => ({ k: '+' as const, text: t })), line: 0 }
}

/**
 * A .upkmod from edited class sources. Made from the round trip: the edits
 * compiled, the classes decompiled from the result, and each diffed against
 * how `upkit class` writes it now. So a mod adds exactly what the package
 * shows once it is applied (where upkit prints a new variable, how it prints
 * code), and reads as installed there. Added declarations are "add" hunks,
 * anchored on nothing. Checked by applying it to the package as it is: it
 * must make the very package the edits compile to; more context where a hunk
 * is not found once.
 */
export function writeUpkmod(
  linker: Linker,
  pkg: Package,
  upk: string,
  edits: { cls: string; text: string }[],
  info: { name?: string; author?: string; description?: string; tested?: string[] },
): { text: string; mod: Upkmod } {
  const pkgName = upk.replace(/\.(upk|u)$/i, '')
  const target = classesPackage(linker, pkg, pkgName, edits.map((e) => e.text), 'keep')
  const after = openPackage(target.bytes)
  const afterLinker = new Linker([], (n) => linker.package(n)?.bytes)
  afterLinker.add(pkgName, after)
  for (let context = 3; context <= 24; context *= 2) {
    const classes: ClassDiff[] = edits.map((e) => {
      const path = classIn(pkg, e.cls)
      const now = classIn(after, e.cls)
      if (!now) throw new Error(`${e.cls}: not in what the edits compile to`)
      const result = decompileClass(afterLinker, after, now)
      if (!path)
        return { upk, cls: e.cls, isNew: true, hunks: [{ block: [], lines: result.replace(/\n$/, '').split('\n').map((t) => ({ k: '+' as const, text: t })), line: 0 }], line: 0 }
      const hunks = classHunks(decompileClass(linker, pkg, path), result, context).map((h) => asAdd(h) ?? h)
      return { upk, cls: e.cls, isNew: false, hunks, line: 0 }
    })
    const text = formatUpkmod({ name: info.name ?? '', author: info.author ?? '', description: info.description ?? '', tested: info.tested ?? [], classes })
    const mod = parseUpkmod(text)
    const r = applyUpkmodTo(linker, pkg, pkgName, mod.classes)
    const ambiguous = r.results.some((x) => x.status === 'error' && /times in/.test(x.note ?? ''))
    if (ambiguous && context < 24) continue
    const err = r.results.find((x) => x.status === 'error')
    if (err) throw new Error(`${err.cls} (${err.block}): ${err.note}`)
    if (!r.bytes || r.bytes.length !== target.bytes.length || r.bytes.some((b, k) => b !== target.bytes[k]))
      throw new Error('the mod, applied to the package, does not make what the edits compile to (a bug in upkit: please report it)')
    return { text, mod }
  }
  throw new Error('no context makes every hunk found once')
}
