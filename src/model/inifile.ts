// The game's INI files as settings (features/game-tools.md): every key=value
// line with the comment that explains it, changed in place without touching
// anything else in the file (its other lines, comments, spacing, line ends).

export interface IniEntry {
  /** 0-based line. */
  line: number
  section: string
  key: string
  value: string
  /** The n-th line with this section and key (0-based): Long War repeats keys (HQ_BASE_POWER …). */
  occurrence: number
  /** The comment beside it, or the comment lines just above. */
  help: string
}

export interface IniChange {
  section: string
  key: string
  occurrence: number
  value: string
}

const lineEnd = (text: string) => (text.includes('\r\n') ? '\r\n' : '\n')

/** Where a line's value ends: at a ";" outside quotes and parentheses. */
function valueEnd(s: string, from: number): number {
  let depth = 0
  let quoted = false
  for (let i = from; i < s.length; i++) {
    const ch = s[i]
    if (ch === '"') quoted = !quoted
    else if (!quoted && ch === '(') depth++
    else if (!quoted && ch === ')') depth = Math.max(0, depth - 1)
    else if (!quoted && depth === 0 && ch === ';') return i
  }
  return s.length
}

export function iniEntries(text: string): IniEntry[] {
  const lines = text.split(/\r?\n/)
  const out: IniEntry[] = []
  const seen = new Map<string, number>()
  let section = ''
  let comments: string[] = []
  lines.forEach((raw, line) => {
    const s = raw.trim()
    if (!s) {
      comments = []
      return
    }
    if (s.startsWith(';')) {
      comments.push(s.replace(/^;+\s?/, ''))
      return
    }
    const sec = /^\[(.+)\]$/.exec(s)
    if (sec) {
      section = sec[1]!
      comments = []
      return
    }
    const eq = raw.indexOf('=')
    if (eq <= 0) {
      comments = []
      return
    }
    const key = raw.slice(0, eq).trim()
    const end = valueEnd(raw, eq + 1)
    const value = raw.slice(eq + 1, end).trim()
    const trailing = raw
      .slice(end)
      .replace(/^;+\s?/, '')
      .trim()
    const id = `${section}\n${key}`
    const occurrence = seen.get(id) ?? 0
    seen.set(id, occurrence + 1)
    out.push({ line, section, key, value, occurrence, help: trailing || comments.join(' ') })
    comments = []
  })
  return out
}

/** Sets values; a change whose line is not there is reported, not added. */
export function setIniValues(
  text: string,
  changes: IniChange[],
): { text: string; missing: IniChange[] } {
  const eol = lineEnd(text)
  const lines = text.split(/\r?\n/)
  const entries = iniEntries(text)
  const missing: IniChange[] = []
  for (const c of changes) {
    const e = entries.find(
      (x) => x.section === c.section && x.key === c.key && x.occurrence === c.occurrence,
    )
    if (!e) {
      missing.push(c)
      continue
    }
    const raw = lines[e.line]!
    const eq = raw.indexOf('=')
    const end = valueEnd(raw, eq + 1)
    const before = raw.slice(eq + 1, end)
    // Keep the spacing around the old value.
    const lead = /^\s*/.exec(before)![0]
    const trail = /\s*$/.exec(before)![0]
    lines[e.line] = raw.slice(0, eq + 1) + lead + c.value + trail + raw.slice(end)
  }
  return { text: lines.join(eol), missing }
}

/**
 * Adds a mod's INI lines that the file lacks, under their sections (a
 * section the file lacks goes at the end): how a mutator mod's
 * DefaultMutatorLoader.ini line joins the game's.
 */
export function mergeIni(text: string, add: string): string {
  const eol = lineEnd(text)
  const lines = text.split(/\r?\n/)
  const have = new Set(lines.map((l) => l.trim()))
  let section = ''
  const wanted: { section: string; line: string }[] = []
  for (const raw of add.split(/\r?\n/)) {
    const s = raw.trim()
    if (!s || s.startsWith(';')) continue
    const sec = /^\[(.+)\]$/.exec(s)
    if (sec) section = sec[1]!
    else if (!have.has(s)) wanted.push({ section, line: s })
  }
  for (const w of wanted) {
    const start = lines.findIndex((l) => l.trim() === `[${w.section}]`)
    if (start < 0) {
      if (lines[lines.length - 1]?.trim()) lines.push('')
      lines.push(`[${w.section}]`, w.line)
      continue
    }
    // After the section's last non-blank line.
    let end = start
    for (let i = start + 1; i < lines.length && !/^\s*\[.+\]\s*$/.test(lines[i]!); i++)
      if (lines[i]!.trim()) end = i
    lines.splice(end + 1, 0, w.line)
  }
  return lines.join(eol)
}

/** INI text as bytes and back, byte for byte (the game's INIs are single-byte text). */
export const iniText = (b: Uint8Array) => new TextDecoder('latin1').decode(b)
export function iniBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff
  return out
}
