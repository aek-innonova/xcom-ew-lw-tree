// The tech tree data and the rules that go with it: Long War 1.0's tech.json
// (with data/techtree.json) by default, and a builder for any version's
// (model/game.ts).

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
 * (XGStorage.m_arrItemArchives), one in stores now, or a UFO of a type captured
 * (a crash-site or landed-UFO mission won).
 */
export type Gate =
  | { kind: 'ever_had'; items: number[]; name: string }
  | { kind: 'in_stores'; items: number[]; name: string }
  /** LWR also counts a UFO shot down (`shotDown`), not only one captured. */
  | { kind: 'captured'; ships: number[]; name: string; shotDown?: boolean }
  /** LWR: a Foundry project that needs another built first. */
  | { kind: 'foundry'; projects: number[]; name: string }

interface RuleItem {
  id: number
  name: string
}
export interface TechRule {
  id: number
  requires: number[]
  any_of?: number[]
  ever_had?: RuleItem
  in_stores?: { any_of: RuleItem[]; name: string }
  /** Long War 1.0: one type; LWR: any of several (`any_of`). */
  captured?: RuleItem | { any_of: RuleItem[] }
  credits: number[]
  grants_credit?: number
}

export const techRules = techtree.techs as TechRule[]

function gatesOf(r: TechRule | undefined, shotDown = false): Gate[] {
  if (!r) return []
  const gates: Gate[] = []
  if (r.ever_had) gates.push({ kind: 'ever_had', items: [r.ever_had.id], name: r.ever_had.name })
  if (r.in_stores)
    gates.push({
      kind: 'in_stores',
      items: r.in_stores.any_of.map((i) => i.id),
      name: r.in_stores.name,
    })
  if (r.captured) {
    const ships = 'any_of' in r.captured ? r.captured.any_of : [r.captured]
    gates.push({
      kind: 'captured',
      ships: ships.map((s) => s.id),
      name: ships.map((s) => s.name).join(' or '),
      ...(shotDown ? { shotDown } : {}),
    })
  }
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

/** A version's techs with its rules attached: covering credits and gates. */
/** `shotDown`: the version counts a UFO shot down towards its analysis (LWR). */
export function buildTechs(raw: TechData, techRules: TechRule[], shotDown = false): Tech[] {
  const rules = new Map(techRules.map((r) => [r.id, r]))
  return raw.techs.map((t) => ({
    ...t,
    credits: creditNames(rules.get(t.id)?.credits ?? []),
    gates: gatesOf(rules.get(t.id), shotDown),
  }))
}

export const techData = data as unknown as TechData
export const defaultTechs: Tech[] = buildTechs(techData, techRules)
export const categories: string[] = techData.categories
