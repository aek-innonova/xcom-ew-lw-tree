// How a game setting is edited and described (features/game-settings-ux.md):
// the player works in the setting's own terms (two point costs, a
// percentage, a multiplier, on or off, one of a few meanings) and the file
// gets the value back in its own form: Long War's "xxyy" as one number,
// a fraction for a percentage, LWR's "4f" and "1.0f" with their suffix and
// decimal point kept.

export type Format =
  /** A plain number, with a unit if it has one. */
  | { kind: 'number'; unit?: string; min?: number; max?: number }
  /** Hours, with days beside them. */
  | { kind: 'hours'; min?: number; max?: number }
  /** A percentage; "fraction": the file keeps it as 0..1. */
  | { kind: 'percent'; fraction?: boolean; min?: number; max?: number }
  /** A multiplier: 1 is the game's own. */
  | { kind: 'times'; min?: number; max?: number }
  /** Two numbers in one, "xxyy": the first × 100 plus the second. */
  | { kind: 'pair'; parts: [string, string] }
  /** On or off, by the numbers the file uses for each. */
  | { kind: 'switch'; on: number; off: number }
  /** One of a few meanings, by the number the file uses for each. */
  | { kind: 'choice'; options: [number, string][] }

export const PLAIN: Format = { kind: 'number' }

/** A number out of the file's form ("4f", "1.0f", " 104"); NaN if it is not one. */
export function numberOf(v: string): number {
  const s = v.trim().replace(/f$/i, '')
  return s === '' || !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s) ? NaN : Number(s)
}

/** A number in the form of another value from the same line: its "f", its decimal point. */
export function styled(n: number, like: string): string {
  const l = like.trim()
  const f = /f$/i.test(l) ? l.slice(-1) : ''
  // Rounded to what a person could have meant (0.1 + 0.2 is 0.3).
  let s = String(Number(n.toPrecision(10)))
  if (l.includes('.') && !s.includes('.') && !/e/i.test(s)) s += '.0'
  return s + f
}

const trim = (n: number) => String(Number(n.toPrecision(10)))

/** The fields a player edits for a value: one, or two for a pair. */
export function fieldsOf(f: Format, value: string): string[] {
  const n = numberOf(value)
  if (f.kind === 'pair') {
    if (Number.isNaN(n)) return ['', '']
    return [String(Math.trunc(n / 100)), String(Math.abs(n) % 100)]
  }
  if (Number.isNaN(n)) return [value.trim()]
  if (f.kind === 'percent' && f.fraction) return [trim(n * 100)]
  if (f.kind === 'switch') return [n === f.on ? 'on' : 'off']
  return [trim(n)]
}

/** The range a field allows, as the format says. */
export function limitsOf(f: Format): { min?: number; max?: number } {
  if (f.kind === 'pair') return { min: 0, max: 99 }
  if (f.kind === 'switch' || f.kind === 'choice') return {}
  if (f.kind === 'percent') return { min: f.min ?? 0, max: f.max ?? 100 }
  return { min: f.min, max: f.max }
}

/**
 * The file's value for what the player entered, in the form of `like` (the
 * version's own value); an error when it cannot be one.
 */
export function valueOf(
  f: Format,
  fields: string[],
  like: string,
): { value: string } | { error: string } {
  const nums = fields.map((x) => numberOf(x))
  if (f.kind === 'switch') return { value: styled(fields[0] === 'on' ? f.on : f.off, like) }
  if (nums.some((n) => Number.isNaN(n))) return { error: 'Not a number' }
  const { min, max } = limitsOf(f)
  const out = (n: number) => {
    if (min !== undefined && n < min) return { error: `At least ${min}` }
    if (max !== undefined && n > max) return { error: `At most ${max}` }
    return null
  }
  if (f.kind === 'pair') {
    const [a, b] = nums as [number, number]
    for (const n of nums)
      if (!Number.isInteger(n) || n < 0 || n > 99) return { error: 'Whole numbers, 0 to 99' }
    return { value: styled(a * 100 + b, like) }
  }
  const n = nums[0]!
  const bad = out(n)
  if (bad) return bad
  if (f.kind === 'choice' && !f.options.some(([k]) => k === n))
    return { error: 'Not one of the choices' }
  return { value: styled(f.kind === 'percent' && f.fraction ? n / 100 : n, like) }
}

/** A value in words: "1 and 4", "45 %", "× 0.61", "1320 hours (55 days)", "on". */
export function describe(f: Format, value: string): string {
  const n = numberOf(value)
  if (Number.isNaN(n)) return value
  switch (f.kind) {
    case 'pair': {
      const [a, b] = fieldsOf(f, value)
      const p1 = f.parts[1] === f.parts[1].toUpperCase() ? f.parts[1] : f.parts[1].toLowerCase()
      return `${f.parts[0]} ${a}, ${p1} ${b}`
    }
    case 'percent':
      return `${trim(f.fraction ? n * 100 : n)} %`
    case 'times':
      return `× ${trim(n)}`
    case 'hours':
      return n >= 48
        ? `${trim(n)} hours (${trim(Math.round((n / 24) * 10) / 10)} days)`
        : `${trim(n)} hours`
    case 'switch':
      return n === f.on ? 'on' : 'off'
    case 'choice':
      return f.options.find(([k]) => k === n)?.[1] ?? trim(n)
    default:
      // "1 mission", "2 missions".
      return f.unit ? `${trim(n)} ${n === 1 ? f.unit.replace(/s$/, '') : f.unit}` : trim(n)
  }
}
