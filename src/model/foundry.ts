// Foundry projects (longwar_foundry.json: from the game's config and
// localization, items and effects cross-checked with UFOpaedia), the costs the
// player's INI sets for them, their place on the Foundry board, and their state
// in a campaign.

import foundryData from '../../longwar_foundry.json'
import { covers } from './credits'
import type { Layout, Placed } from './layout'
import { COLUMNS } from './layout'

export interface FoundryCost {
  cash: number
  alloys: number
  elerium: number
  weapon_fragments: number
  meld: number
  items: string[]
}

export interface FoundryProject {
  id: number
  enum: string
  config_key: string | number
  name: string
  category: string
  research_credit: string | null
  base_days: number
  engineers: number
  cost: FoundryCost
  requires_tech: { id: number; name: string } | null
  effect: string
}

const data = foundryData as unknown as { categories: string[]; projects: FoundryProject[] }

export const defaultFoundry: FoundryProject[] = data.projects
export const foundryCategories: string[] = data.categories

// --- INI ----------------------------------------------------------------------

export interface FoundryBalance {
  days: number
  engineers: number
  cash: number
  alloys: number
  elerium: number
  fragments: number
  meld: number
  items: number
}

/**
 * Reads FoundryBalance lines. eTech is an enum name, or a number for the slots
 * Long War added (25–46, eFoundry_Placeholder in the enum). iFragments packs Meld
 * as thousands: 40030 is 40 Meld and 30 fragments.
 */
export function parseFoundryBalance(
  text: string,
  projects: FoundryProject[],
): Map<number, FoundryBalance> {
  const byKey = new Map<string, number>()
  for (const p of projects) {
    byKey.set(String(p.config_key), p.id)
    if (!byKey.has(p.enum)) byKey.set(p.enum, p.id)
  }
  const out = new Map<number, FoundryBalance>()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/(;|\/\/).*$/, '').trim()
    const m = /^FoundryBalance\s*=\s*\((.*)\)$/.exec(line)
    if (!m) continue
    const f = new Map(
      m[1]!.split(',').map((part) => {
        const [k, v] = part.split('=').map((x) => x.trim())
        return [k ?? '', v ?? ''] as [string, string]
      }),
    )
    const key = f.get('eTech') ?? ''
    const id = /^\d+$/.test(key) ? Number(key) : byKey.get(key)
    if (id === undefined || !projects.some((p) => p.id === id)) continue
    const n = (k: string) => (/^-?\d+$/.test(f.get(k) ?? '') ? Number(f.get(k)) : 0)
    const packed = n('iFragments')
    out.set(id, {
      days: n('iTime'),
      engineers: n('iEngineers'),
      cash: n('iCash'),
      alloys: n('iAlloys'),
      elerium: n('iElerium'),
      fragments: packed % 1000,
      meld: Math.floor(packed / 1000),
      items: n('iNumItems'),
    })
  }
  return out
}

/** The first item's count follows the INI ("20x Thin Man Corpse"); the rest is hard-coded in the game. */
function withItemCount(items: string[], count: number): string[] {
  if (!items.length) return items
  const [first, ...rest] = items
  return [/^\d+x /.test(first!) ? first!.replace(/^\d+/, String(count)) : first!, ...rest]
}

export function applyFoundryBalance(
  projects: FoundryProject[],
  balance: Map<number, FoundryBalance>,
): { projects: FoundryProject[]; changed: number[] } {
  const changed: number[] = []
  const out = projects.map((p) => {
    const b = balance.get(p.id)
    if (!b) return p
    const next: FoundryProject = {
      ...p,
      base_days: b.days,
      engineers: b.engineers,
      cost: {
        cash: b.cash,
        alloys: b.alloys,
        elerium: b.elerium,
        weapon_fragments: b.fragments,
        meld: b.meld,
        items: withItemCount(p.cost.items, b.items),
      },
    }
    if (JSON.stringify(next) !== JSON.stringify(p)) changed.push(p.id)
    return next
  })
  return { projects: out, changed }
}

// --- New Warfare ------------------------------------------------------------------

/** Asia's continent bonus: Foundry cash, alloy and elerium costs reduced (25 % in Long War 1.0). */
export function withCostReduction(p: FoundryProject, reduction: number): FoundryProject {
  if (!reduction) return p
  const r = (v: number) => Math.round(v * (1 - reduction))
  return {
    ...p,
    cost: { ...p.cost, cash: r(p.cost.cash), alloys: r(p.cost.alloys), elerium: r(p.cost.elerium) },
  }
}

// --- Board layout -----------------------------------------------------------------

/**
 * A lane per Foundry category. A project sits right of the tech it needs (one
 * column after the tech's column on the research tree), moving further right
 * into free space where a column is full; each lane gets the fewest rows that
 * fit in COLUMNS columns.
 */
export function layoutFoundry(
  projects: FoundryProject[],
  categories: string[],
  techColumn: (techId: number) => number,
): Layout {
  const placed = new Map<number, Placed>()
  const lanes: Layout['lanes'] = []
  categories.forEach((category, lane) => {
    const members = projects
      .filter((p) => p.category === category)
      .map((p) => ({
        p,
        from: Math.min(COLUMNS - 1, (p.requires_tech ? techColumn(p.requires_tech.id) : -1) + 1),
      }))
      .sort((a, b) => a.from - b.from || a.p.id - b.p.id)
    for (let rows = 1; ; rows++) {
      const used = Array.from({ length: COLUMNS }, () => 0)
      const attempt: Placed[] = []
      let ok = true
      for (const { p, from } of members) {
        let c = from
        while (c < COLUMNS && used[c]! >= rows) c++
        if (c >= COLUMNS) {
          ok = false
          break
        }
        attempt.push({ id: p.id, lane, column: c, row: used[c]! })
        used[c]!++
      }
      if (ok) {
        for (const a of attempt) placed.set(a.id, a)
        lanes.push({ category, rows })
        break
      }
    }
  })
  return { placed, lanes, totalRows: lanes.reduce((n, l) => n + l.rows, 0) }
}

// --- Progress -------------------------------------------------------------------

/**
 * A project's total work is base days × 24 × its required engineers
 * (engineer-hours): several projects show exactly that on their first day in
 * the person's saves. The game's iHoursLeft is what is left of it.
 */
export function foundryWork(p: FoundryProject, creditReduction = 0): number {
  return p.base_days * 24 * p.engineers * (1 - creditReduction)
}

export interface FoundryProgress {
  /** Fraction done, 0–1. */
  done: number
  /** Days left at base speed (the required engineers working at the nominal rate). */
  baseDaysLeft: number
}

/**
 * Speed is not modelled: the person's saves show it near-proportional to the
 * engineers when there are fewer than required, and up to about 1.6× faster
 * with many spare engineers, but not consistently (engineers busy on item
 * builds are probably not free for the Foundry).
 */
export function foundryProgress(
  p: FoundryProject,
  workLeft: number,
  creditReduction = 0,
): FoundryProgress {
  const total = foundryWork(p, creditReduction)
  return {
    done: total > 0 ? Math.min(1, Math.max(0, 1 - workLeft / total)) : 0,
    baseDaysLeft: p.engineers > 0 ? Math.max(1, Math.ceil(workLeft / p.engineers / 24)) : 0,
  }
}

/** The fraction of a project's work its held credits take off (see credits.ts). */
export function foundryCreditReduction(p: FoundryProject, held: Set<string>, each: number): number {
  const n = [...held].filter((c) => covers(c, p.research_credit)).length
  return 1 - (1 - each) ** n
}

// --- State in a campaign ----------------------------------------------------------

export type FoundryState = 'done' | 'building' | 'available' | 'locked'

export function foundryState(
  p: FoundryProject,
  done: number[],
  building: Set<number>,
  researched: boolean[],
): FoundryState {
  if (done[p.id]) return 'done'
  if (building.has(p.id)) return 'building'
  return !p.requires_tech || researched[p.requires_tech.id] ? 'available' : 'locked'
}
