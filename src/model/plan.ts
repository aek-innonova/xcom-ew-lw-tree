// The research still needed to reach one or more goal techs.

import type { Tech } from './techs'

export interface AnyChoice {
  /** The tech whose "any one of" group needed a pick. */
  for: number
  /** The member picked: the one adding the fewest base days to the plan. */
  picked: number
  /** The other members, any of which would also do. */
  alternatives: number[]
}

export interface Plan {
  goals: number[]
  /** Unresearched techs to research, in an order that respects prerequisites. */
  steps: number[]
  choices: AnyChoice[]
}

/**
 * Collects every unresearched prerequisite of the goals. For an "any one of"
 * group with no member researched or already in the plan, picks the member
 * whose own missing prerequisites add the fewest base days.
 */
export function planResearch(
  goals: number[],
  techs: Tech[],
  researched: boolean[],
  inProgress?: number,
): Plan {
  const byId = new Map(techs.map((t) => [t.id, t]))
  const needed = new Set<number>()
  const choices: AnyChoice[] = []

  // What adding `id` (and its hard prerequisites) to `into` would add, in base days.
  const closure = (id: number, into: Set<number>): Set<number> => {
    const added = new Set<number>()
    const visit = (x: number) => {
      if (researched[x] || into.has(x) || added.has(x)) return
      added.add(x)
      for (const p of byId.get(x)?.prerequisites ?? []) visit(p.id)
    }
    visit(id)
    return added
  }
  const days = (ids: Set<number>) =>
    [...ids].reduce((sum, id) => sum + (byId.get(id)?.base_days ?? 0), 0)

  // All goals first, so a group one goal opens can be closed by another.
  for (const g of goals) for (const x of closure(g, needed)) needed.add(x)
  // Then close "any one of" groups until none is open; a pick can open more.
  for (let open = true; open;) {
    open = false
    for (const x of needed) {
      const t = byId.get(x)
      if (!t?.any_one_of.length) continue
      if (t.any_one_of.some((a) => researched[a.id] || needed.has(a.id))) continue
      let best: { id: number; cost: number } | undefined
      for (const a of t.any_one_of) {
        const cost = days(closure(a.id, needed))
        if (!best || cost < best.cost || (cost === best.cost && a.id < best.id))
          best = { id: a.id, cost }
      }
      choices.push({
        for: x,
        picked: best!.id,
        alternatives: t.any_one_of.map((a) => a.id).filter((a) => a !== best!.id),
      })
      for (const y of closure(best!.id, needed)) needed.add(y)
      open = true
    }
  }

  return { goals, steps: orderSteps(needed, byId, researched, inProgress), choices }
}

/**
 * Prerequisites first; among techs ready at the same time, the one already
 * being researched, then the quicker one.
 */
function orderSteps(
  needed: Set<number>,
  byId: Map<number, Tech>,
  researched: boolean[],
  inProgress?: number,
): number[] {
  const done = new Set<number>()
  const steps: number[] = []
  const ready = (id: number) => {
    const t = byId.get(id)!
    const hard = t.prerequisites.every((p) => researched[p.id] || done.has(p.id))
    const any = !t.any_one_of.length || t.any_one_of.some((a) => researched[a.id] || done.has(a.id))
    return hard && any
  }
  const left = new Set(needed)
  while (left.size) {
    const candidates = [...left].filter(ready)
    // A cycle or a prerequisite outside the data: emit the rest as they come.
    const next = candidates.length
      ? candidates.sort(
          (a, b) =>
            Number(b === inProgress) - Number(a === inProgress) ||
            byId.get(a)!.base_days - byId.get(b)!.base_days ||
            a - b,
        )[0]!
      : [...left][0]!
    steps.push(next)
    done.add(next)
    left.delete(next)
  }
  return steps
}

export interface PlanTotals {
  baseDays: number
  alloys: number
  elerium: number
  fragments: number
  /** Item costs summed by kind ("25 Sectoid corpses"), in order of first appearance. */
  items: string[]
}

export function planTotals(plan: Plan, techs: Tech[]): PlanTotals {
  const byId = new Map(techs.map((t) => [t.id, t]))
  const totals: PlanTotals = { baseDays: 0, alloys: 0, elerium: 0, fragments: 0, items: [] }
  const counted = new Map<string, number>()
  const uncounted: string[] = []
  for (const id of plan.steps) {
    const t = byId.get(id)
    if (!t) continue
    totals.baseDays += t.base_days
    totals.alloys += t.cost.alloys
    totals.elerium += t.cost.elerium
    totals.fragments += t.cost.weapon_fragments
    const items = t.cost.items
    if (!items) continue
    const m = /^(\d+) (.+)$/.exec(items)
    if (m) counted.set(m[2]!, (counted.get(m[2]!) ?? 0) + Number(m[1]))
    else uncounted.push(items)
  }
  totals.items = [...[...counted].map(([kind, n]) => `${n} ${kind}`), ...uncounted]
  return totals
}
