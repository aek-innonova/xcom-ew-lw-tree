// The tech tree data (tech.json) and the costs that apply to it.

import data from '../../tech.json'

export interface TechRef {
  id: number
  name: string
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
  /** The research credit category that shortens this tech, if any. */
  research_credit: string | null
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

export const techData = data as TechData
export const defaultTechs: Tech[] = techData.techs
export const categories: string[] = techData.categories
