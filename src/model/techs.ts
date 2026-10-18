// The tech tree data (tech.json) and the costs that apply to it.

import data from '../../tech.json'
import techtree from '../../data/techtree.json'
import { creditNames } from './credits'
import { withoutImplied } from './gates'

export interface TechRef {
  id: number
  name: string
  /**
   * Not a research requirement in the game's rules but the way to an item that
   * is: Alien Operations leads to the alien base and its Hyperwave Beacon.
   */
  via?: string
}

/**
 * Something other than research the game checks before a tech or Foundry
 * project can start (data/techtree.json): an item ever held
 * (XGStorage.m_arrItemArchives), one in stores now, or a UFO type encountered.
 */
export type Gate =
  | { kind: 'ever_had'; items: number[]; name: string }
  | { kind: 'in_stores'; items: number[]; name: string }
  | { kind: 'encountered'; ship: number; name: string }

interface RuleItem {
  id: number
  name: string
}
interface TechRule {
  id: number
  requires: number[]
  any_of?: number[]
  ever_had?: RuleItem
  in_stores?: { any_of: RuleItem[]; name: string }
  encountered?: RuleItem
  credits: number[]
}

export const techRules = techtree.techs as TechRule[]

function gatesOf(r: TechRule | undefined): Gate[] {
  if (!r) return []
  const gates: Gate[] = []
  if (r.ever_had) gates.push({ kind: 'ever_had', items: [r.ever_had.id], name: r.ever_had.name })
  if (r.in_stores)
    gates.push({
      kind: 'in_stores',
      items: r.in_stores.any_of.map((i) => i.id),
      name: r.in_stores.name,
    })
  if (r.encountered)
    gates.push({ kind: 'encountered', ship: r.encountered.id, name: r.encountered.name })
  return withoutImplied(gates)
}

export interface TechCost {
  alloys: number
  elerium: number
  weapon_fragments: number
  /** Item text from tech.json, e.g. "5 Sectoid corpses"; null when none. */
  items: string | null
}

export interface Tech {
  id: number
  enum: string
  /** How DefaultGameCore.ini's TechBalance names this tech: an enum name or a bare number. */
  config_key: string | number
  name: string
  category: string
  base_days: number
  cost: TechCost
  /** The credits that cover it, from the game (besides the Ethereal's "All"). */
  credits: string[]
  /** What else the game checks before it can be researched. */
  gates: Gate[]
  /** All of these must be researched. */
  prerequisites: TechRef[]
  /** At least one of these must be researched (in addition to `prerequisites`). */
  any_one_of: TechRef[]
  leads_to: TechRef[]
  unlocks: string[]
}

export interface TechData {
  game: string
  mod: string
  categories: string[]
  research_points_per_base_day: number
  techs: Tech[]
}

const rules = new Map(techRules.map((r) => [r.id, r]))

export const techData = data as unknown as TechData
export const defaultTechs: Tech[] = techData.techs.map((t) => ({
  ...t,
  credits: creditNames(rules.get(t.id)?.credits ?? []),
  gates: gatesOf(rules.get(t.id)),
}))
export const categories: string[] = techData.categories
