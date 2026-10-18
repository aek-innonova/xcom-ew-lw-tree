// Foundry projects (longwar_foundry.json: from the game's config and
// localization, items and effects cross-checked with UFOpaedia), the costs the
// player's INI sets for them, their place on the Foundry board, and their state
// in a campaign.

import foundryData from '../../longwar_foundry.json'
import techtree from '../../data/techtree.json'
import { applyCredits, coveringCredits, creditCut, creditNames } from './credits'
import type { Layout, Placed } from './layout'
import { COLUMNS } from './layout'
import { unmetGates, type Holdings } from './research'
import type { Gate } from './techs'
import { withoutImplied } from './gates'

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
  /** The credits that cover it, from the game (besides the Ethereal's "All"). */
  credits: string[]
  /**
   * What else the game checks (HasFoundryPrereqs): the INI's eReqItem in stores
   * now, and for Alien Grenades one ever held.
   */
  gates: Gate[]
  base_days: number
  engineers: number
  /** Total work in engineer-hours, by the version's FoundryDaysToHours. */
  hours: number
  cost: FoundryCost
  requires_tech: { id: number; name: string } | null
  effect: string
}

/** XGTechTree.FoundryDaysToHours: Long War 1.0 days × 24 × engineers; LWR days × engineers² / 3. */
export type FoundryWorkFormula = 'days*24*engineers' | 'days*engineers*engineers/3'

export function workHours(formula: FoundryWorkFormula, days: number, engineers: number): number {
  return formula === 'days*engineers*engineers/3'
    ? Math.trunc((days * engineers * engineers) / 3)
    : days * 24 * engineers
}

export interface FoundryData {
  categories: string[]
  work?: FoundryWorkFormula
  projects: Omit<FoundryProject, 'credits' | 'gates' | 'hours'>[]
}

const data = foundryData as unknown as FoundryData

export interface FoundryRule {
  id: number
  requires: number
  in_stores?: { id: number; name: string }
  ever_had?: { id: number; name: string }
  credits: number[]
}
export const foundryRules = techtree.foundry as FoundryRule[]

function gatesOf(r: FoundryRule | undefined): Gate[] {
  const gates: Gate[] = []
  if (r?.in_stores)
    gates.push({ kind: 'in_stores', items: [r.in_stores.id], name: r.in_stores.name })
  if (r?.ever_had) gates.push({ kind: 'ever_had', items: [r.ever_had.id], name: r.ever_had.name })
  return withoutImplied(gates)
}

/** A version's Foundry projects with its rules attached: credits, gates and total work. */
export function buildFoundry(raw: FoundryData, foundryRules: FoundryRule[]): FoundryProject[] {
  const byId = new Map(foundryRules.map((r) => [r.id, r]))
  const work = raw.work ?? 'days*24*engineers'
  return raw.projects.map((p) => ({
    ...p,
    credits: creditNames(byId.get(p.id)?.credits ?? []),
    gates: gatesOf(byId.get(p.id)),
    hours: workHours(work, p.base_days, p.engineers),
  }))
}

export const defaultFoundry: FoundryProject[] = buildFoundry(data, foundryRules)
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
  work: FoundryWorkFormula = 'days*24*engineers',
): { projects: FoundryProject[]; changed: number[] } {
  const changed: number[] = []
  const out = projects.map((p) => {
    const b = balance.get(p.id)
    if (!b) return p
    const next: FoundryProject = {
      ...p,
      base_days: b.days,
      engineers: b.engineers,
      hours: workHours(work, b.days, b.engineers),
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
 * fit in the research tree's columns.
 */
export function layoutFoundry(
  projects: FoundryProject[],
  categories: string[],
  techColumn: (techId: number) => number,
  columns = COLUMNS,
): Layout {
  const placed = new Map<number, Placed>()
  const lanes: Layout['lanes'] = []
  categories.forEach((category, lane) => {
    const members = projects
      .filter((p) => p.category === category)
      .map((p) => ({
        p,
        from: Math.min(columns - 1, (p.requires_tech ? techColumn(p.requires_tech.id) : -1) + 1),
      }))
      .sort((a, b) => a.from - b.from || a.p.id - b.p.id)
    for (let rows = 1; ; rows++) {
      const used = Array.from({ length: columns }, () => 0)
      const attempt: Placed[] = []
      let ok = true
      for (const { p, from } of members) {
        let c = from
        while (c < columns && used[c]! >= rows) c++
        if (c >= columns) {
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
  return { placed, lanes, totalRows: lanes.reduce((n, l) => n + l.rows, 0), columns }
}

// --- Progress -------------------------------------------------------------------

/**
 * A project's total work in engineer-hours (`hours`; in Long War 1.0 base days
 * × 24 × its required engineers: several projects show exactly that on their
 * first day in the person's saves). The game's iHoursLeft is what is left of it.
 */
export function foundryWork(p: FoundryProject, creditReduction = 0): number {
  return Math.round(p.hours * (1 - creditReduction))
}

/** Days at the required engineers' pace, one engineer-hour per engineer an hour. */
export function foundryBaseDays(p: FoundryProject): number {
  return p.engineers > 0 ? p.hours / 24 / p.engineers : 0
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
export function foundryCreditReduction(
  p: FoundryProject,
  held: Set<string>,
  expertise: number,
  shares?: Record<string, number>,
): number {
  const base = p.hours
  const cuts = coveringCredits(p.credits, held).map((c) => creditCut(c, expertise, shares))
  return base > 0 ? 1 - applyCredits(base, cuts, false) / base : 0
}

// --- State in a campaign ----------------------------------------------------------

export type FoundryState = 'done' | 'building' | 'available' | 'locked'

export function foundryState(
  p: FoundryProject,
  done: number[],
  building: Set<number>,
  researched: boolean[],
  holdings?: Holdings,
): FoundryState {
  if (done[p.id]) return 'done'
  if (building.has(p.id)) return 'building'
  const tech = !p.requires_tech || researched[p.requires_tech.id]
  return tech && !unmetGates(p.gates, holdings).length ? 'available' : 'locked'
}
