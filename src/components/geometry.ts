// Pixel geometry of the tree, in SVG user units, and edge routing.

import type { Layout } from '@/model/layout'

export const NODE_W = 192
export const NODE_H = 46
export const COL_W = 218
export const ROW_H = 56
export const LABEL_W = 142
export const LANE_PAD = 10
export const LANE_GAP = 10
const GUTTER = COL_W - NODE_W

export interface Box {
  x: number
  y: number
  /** Free space above the box (to the row above, or to the lane's edge). */
  above: number
}

export interface LaneBox {
  category: string
  y: number
  height: number
}

export interface Geometry {
  nodes: Map<number, Box>
  lanes: LaneBox[]
  width: number
  height: number
}

export function geometry(layout: Layout): Geometry {
  const lanes: LaneBox[] = []
  let y = 0
  for (const lane of layout.lanes) {
    const height = lane.rows * ROW_H - (ROW_H - NODE_H) + 2 * LANE_PAD
    lanes.push({ category: lane.category, y, height })
    y += height + LANE_GAP
  }
  const nodes = new Map<number, Box>()
  for (const p of layout.placed.values()) {
    nodes.set(p.id, {
      x: LABEL_W + p.column * COL_W,
      y: lanes[p.lane]!.y + LANE_PAD + p.row * ROW_H,
      above: p.row === 0 ? LANE_PAD : ROW_H - NODE_H,
    })
  }
  return { nodes, lanes, width: LABEL_W + layout.columns * COL_W - GUTTER, height: y - LANE_GAP }
}

/**
 * A prerequisite edge, routed so it never passes behind a box: out of the
 * source's right side into the gutter, along the free strip above the target's
 * row when it has columns to cross, down the gutter before the target, and in
 * at its left side. Corners are rounded.
 */
export function edgePath(from: Box, to: Box): string {
  const sx = from.x + NODE_W
  const sy = from.y + NODE_H / 2
  const tx = to.x
  const ty = to.y + NODE_H / 2
  const g1 = sx + GUTTER / 2
  const g2 = tx - GUTTER / 2
  const points: [number, number][] =
    Math.abs(g1 - g2) < 1
      ? [
          [sx, sy],
          [g1, sy],
          [g1, ty],
          [tx, ty],
        ]
      : [
          [sx, sy],
          [g1, sy],
          [g1, to.y - to.above / 2],
          [g2, to.y - to.above / 2],
          [g2, ty],
          [tx, ty],
        ]
  return roundedPolyline(points, 5)
}

function roundedPolyline(points: [number, number][], radius: number): string {
  const pts = points.filter(
    (p, i) => i === 0 || p[0] !== points[i - 1]![0] || p[1] !== points[i - 1]![1],
  )
  let d = `M${pts[0]![0]},${pts[0]![1]}`
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1]!
    const [cx, cy] = pts[i]!
    const [nx, ny] = pts[i + 1]!
    const lin = Math.hypot(cx - px, cy - py)
    const lout = Math.hypot(nx - cx, ny - cy)
    const r = Math.min(radius, lin / 2, lout / 2)
    if (r < 0.5) {
      d += ` L${cx},${cy}`
      continue
    }
    const ax = cx - ((cx - px) / lin) * r
    const ay = cy - ((cy - py) / lin) * r
    const bx = cx + ((nx - cx) / lout) * r
    const by = cy + ((ny - cy) / lout) * r
    d += ` L${ax},${ay} Q${cx},${cy} ${bx},${by}`
  }
  const last = pts[pts.length - 1]!
  return `${d} L${last[0]},${last[1]}`
}

/** Splits a category into label lines, keeping "&" with the word before it. */
export function labelLines(category: string): string[] {
  const lines: string[] = []
  for (const word of category.split(' ')) {
    if (word === '&' && lines.length) lines[lines.length - 1] += ' &'
    else lines.push(word)
  }
  return lines
}
