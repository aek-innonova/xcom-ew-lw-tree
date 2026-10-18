// Places the techs on a grid: one lane per category, columns left to right.
//
// Every prerequisite sits strictly left of the tech that needs it, across all
// lanes, so the tree always reads left to right (for an "any one of" group, the
// earliest member). Within that rule a tech may sit further right than its
// depth to share space: UFO Analysis has eleven techs one step from the start
// and would otherwise be eleven rows tall. Each lane starts with rows enough
// for every tech at its depth, then gives rows back while the whole layout
// still fits in COLUMNS columns.

import type { Tech } from './techs'

export const COLUMNS = 9

export interface Placed {
  id: number
  lane: number
  column: number
  row: number
}

export interface Lane {
  category: string
  rows: number
}

export interface Layout {
  placed: Map<number, Placed>
  lanes: Lane[]
  totalRows: number
}

/** Steps from the start: all prerequisites, plus the cheapest of an "any one of" group. */
export function depths(techs: Tech[]): Map<number, number> {
  const byId = new Map(techs.map((t) => [t.id, t]))
  const memo = new Map<number, number>()
  const visit = (id: number, stack: Set<number>): number => {
    const known = memo.get(id)
    if (known !== undefined) return known
    const t = byId.get(id)
    if (!t || stack.has(id)) return 0
    stack.add(id)
    const ds = t.prerequisites.map((p) => visit(p.id, stack))
    if (t.any_one_of.length) ds.push(Math.min(...t.any_one_of.map((p) => visit(p.id, stack))))
    stack.delete(id)
    const d = ds.length ? Math.max(...ds) + 1 : 0
    memo.set(id, d)
    return d
  }
  for (const t of techs) visit(t.id, new Set())
  return memo
}

/** Columns for every tech given rows per lane, or undefined if they do not fit. */
function assignColumns(
  order: Tech[],
  laneOf: Map<string, number>,
  rows: number[],
): Map<number, number> | undefined {
  const column = new Map<number, number>()
  const used = new Map<string, number>()
  for (const t of order) {
    let c = 0
    for (const p of t.prerequisites) c = Math.max(c, (column.get(p.id) ?? -1) + 1)
    const placedAny = t.any_one_of
      .map((p) => column.get(p.id))
      .filter((v): v is number => v !== undefined)
    if (placedAny.length) c = Math.max(c, Math.min(...placedAny) + 1)
    const lane = laneOf.get(t.category)!
    while (c < COLUMNS && (used.get(`${lane}:${c}`) ?? 0) >= rows[lane]!) c++
    if (c >= COLUMNS) return undefined
    used.set(`${lane}:${c}`, (used.get(`${lane}:${c}`) ?? 0) + 1)
    column.set(t.id, c)
  }
  return column
}

export function layoutTechs(techs: Tech[], categories: string[]): Layout {
  const depth = depths(techs)
  const order = [...techs].sort((a, b) => depth.get(a.id)! - depth.get(b.id)! || a.id - b.id)
  const laneOf = new Map(categories.map((c, i) => [c, i]))

  // Start with rows enough to hold every tech at its own depth...
  const rows = categories.map((c) => {
    const perDepth = new Map<number, number>()
    for (const t of techs)
      if (t.category === c)
        perDepth.set(depth.get(t.id)!, (perDepth.get(depth.get(t.id)!) ?? 0) + 1)
    return Math.max(1, ...perDepth.values())
  })
  let column = assignColumns(order, laneOf, rows)
  if (!column) throw new Error('tech tree is deeper than the layout has columns')

  // ...then give rows back, tallest lanes first, while everything still fits.
  for (let changed = true; changed;) {
    changed = false
    const tallestFirst = categories.map((_, i) => i).sort((a, b) => rows[b]! - rows[a]! || a - b)
    for (const lane of tallestFirst) {
      if (rows[lane]! <= 1) continue
      rows[lane]!--
      const attempt = assignColumns(order, laneOf, rows)
      if (attempt) {
        column = attempt
        changed = true
      } else {
        rows[lane]!++
      }
    }
  }

  // Rows within a lane: keep a tech on the row of a same-lane prerequisite where
  // that row is free, so chains run along one track.
  const placed = new Map<number, Placed>()
  const taken = new Set<string>()
  const byColumn = [...order].sort((a, b) => column!.get(a.id)! - column!.get(b.id)! || a.id - b.id)
  for (const t of byColumn) {
    const lane = laneOf.get(t.category)!
    const c = column.get(t.id)!
    const preferred =
      t.prerequisites.map((p) => placed.get(p.id)).find((p) => p?.lane === lane)?.row ?? 0
    const free = (r: number) => !taken.has(`${lane}:${c}:${r}`)
    let row = preferred
    if (!free(row)) {
      const candidates = Array.from({ length: rows[lane]! }, (_, r) => r).filter(free)
      row = candidates.sort(
        (a, b) => Math.abs(a - preferred) - Math.abs(b - preferred) || a - b,
      )[0]!
    }
    taken.add(`${lane}:${c}:${row}`)
    placed.set(t.id, { id: t.id, lane, column: c, row })
  }

  const lanes = categories.map((category, i) => ({ category, rows: rows[i]! }))
  return { placed, lanes, totalRows: rows.reduce((a, b) => a + b, 0) }
}
