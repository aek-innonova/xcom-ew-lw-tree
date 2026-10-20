// How a game setting is edited and described (features/game-settings-ux.md):
// the player works in the setting's own terms (two point costs, a
// percentage, a multiplier, on or off, one of a few meanings) and the file
// gets the value back in its own form: Long War's "xxyy" as one number,
// a fraction for a percentage, LWR's "4f" and "1.0f" with their suffix and
// decimal point kept.

export type Format =
  /**
   * A plain number, with a unit if it has one. "scale": shown as the file's
   * value times it (damage reduction: 5 is 0.5). "unset": the file's value
   * for "not set here" (Long War's −1 costs), shown as an empty field.
   */
  | { kind: 'number'; unit?: string; min?: number; max?: number; scale?: number; unset?: number }
  /** Hours, with days beside them. */
  | { kind: 'hours'; min?: number; max?: number }
  /** A percentage; "fraction": the file keeps it as 0..1. */
  | { kind: 'percent'; fraction?: boolean; min?: number; max?: number }
  /** A multiplier: 1 is the game's own. */
  | { kind: 'times'; min?: number; max?: number }
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

/** What the player edits for a value. */
export function fieldsOf(f: Format, value: string): string[] {
  const n = numberOf(value)
  if (Number.isNaN(n)) return [value.trim()]
  if (f.kind === 'number' && f.unset !== undefined && n === f.unset) return ['']
  if (f.kind === 'number' && f.scale) return [trim(n * f.scale)]
  if (f.kind === 'percent' && f.fraction) return [trim(n * 100)]
  if (f.kind === 'switch') return [n === f.on ? 'on' : 'off']
  return [trim(n)]
}

/** The range a field allows, as the format says. */
export function limitsOf(f: Format): { min?: number; max?: number } {
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
  const n = nums[0]!
  const bad = out(n)
  if (bad) return bad
  if (f.kind === 'choice' && !f.options.some(([k]) => k === n))
    return { error: 'Not one of the choices' }
  if (f.kind === 'number' && f.scale) return { value: styled(Math.round(n / f.scale), like) }
  return { value: styled(f.kind === 'percent' && f.fraction ? n / 100 : n, like) }
}

/** A value in words: "1 and 4", "45 %", "× 0.61", "1320 hours (55 days)", "on". */
export function describe(f: Format, value: string): string {
  const n = numberOf(value)
  if (Number.isNaN(n)) return value
  switch (f.kind) {
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
      if (f.unset !== undefined && n === f.unset) return 'not set here'
      if (f.scale) return f.unit ? `${trim(n * f.scale)} ${f.unit}` : trim(n * f.scale)
      // "1 mission", "2 missions".
      return f.unit ? `${trim(n)} ${n === 1 ? f.unit.replace(/s$/, '') : f.unit}` : trim(n)
  }
}
