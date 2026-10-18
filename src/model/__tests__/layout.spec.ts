import { describe, expect, it } from 'vitest'
import { COLUMNS, depths, layoutTechs } from '../layout'
import { categories, defaultTechs } from '../techs'

describe('layoutTechs', () => {
  const layout = layoutTechs(defaultTechs, categories)

  it('places every tech exactly once, inside the grid, without overlaps', () => {
    expect(layout.placed.size).toBe(defaultTechs.length)
    const cells = new Set<string>()
    for (const p of layout.placed.values()) {
      expect(p.column).toBeGreaterThanOrEqual(0)
      expect(p.column).toBeLessThan(COLUMNS)
      const lane = layout.lanes[p.lane]!
      expect(p.row).toBeLessThan(lane.rows)
      const key = `${p.lane}:${p.column}:${p.row}`
      expect(cells.has(key)).toBe(false)
      cells.add(key)
    }
  })

  it('puts every prerequisite left of the tech that needs it, across lanes', () => {
    const depth = depths(defaultTechs)
    for (const t of defaultTechs) {
      const p = layout.placed.get(t.id)!
      expect(p.column).toBeGreaterThanOrEqual(depth.get(t.id)!)
      for (const pre of t.prerequisites)
        expect(layout.placed.get(pre.id)!.column).toBeLessThan(p.column)
      const earliest = Math.min(
        Infinity,
        ...t.any_one_of.map((a) => layout.placed.get(a.id)!.column),
      )
      expect(t.any_one_of.length === 0 || earliest < p.column).toBe(true)
    }
  })

  it('fits the tree in 15 rows', () => {
    expect(layout.totalRows).toBe(15)
  })
})
