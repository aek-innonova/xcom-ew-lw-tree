// Long War's starting, country and continent bonuses (longwar_bonuses.json,
// from DefaultGameCore.ini and the game's localization), which of them a
// campaign has, and what they do to research.
//
// What is active, as far as the samples show:
// - the starting bonus the campaign got (stored in the save, see campaign.ts);
// - a country bonus while that country has a satellite, except the starting
//   country's: campaign 55 started in the United States with a US satellite
//   from day one, and its autopsies and interrogations ran at the normal speed
//   and cost, so the US "We Have Ways" was not in force;
// - a continent bonus once every council country on the continent has a
//   satellite (verified: campaign 55's Foundry costs carry Asia's New Warfare).
//
// Research effects:
// - Expertise adds to the research credit reduction. Campaign 55's credits
//   went from 25 % to 35 % once Brazil had a satellite (+10 %), for projects
//   started after that: a project's credited cost is fixed when it starts.
// - We Have Ways shortens autopsies and interrogations. Not yet seen at work
//   in a save, so estimates using it say so.

import bonusData from '../../longwar_bonuses.json'
import type { Campaign } from '@/save/campaign'

export type BonusType = 'starting' | 'country' | 'continent'

export interface Bonus {
  type: BonusType
  bonus_id: number
  name: string
  description: string
  value: number
  enabled: boolean
  country_id?: number
  country?: string
  continent_id?: number
  continent?: string
  /** Starting bonuses: the index the save stores. */
  starter_index?: number
}

interface Country {
  id: number
  name: string
  continent_id: number
  council_member: boolean
}

interface Continent {
  id: number
  name: string
  countries: string[]
}

const data = bonusData as unknown as {
  countries: Country[]
  continents: Continent[]
  starting_bonuses: Bonus[]
  country_bonuses: Bonus[]
  continent_bonuses: Bonus[]
}

export const EXPERTISE = 54
export const WE_HAVE_WAYS = 57

export function countryName(id: number | undefined): string | undefined {
  return data.countries.find((c) => c.id === id)?.name
}

/** Key for a bonus line, as both the JSON and the INI can name it. */
export function bonusKey(
  b: Pick<Bonus, 'type' | 'bonus_id' | 'country_id' | 'continent_id' | 'starter_index'>,
): string {
  if (b.type === 'starting') return `starting:${b.starter_index}`
  if (b.type === 'country') return `country:${b.country_id}:${b.bonus_id}`
  return `continent:${b.continent_id}:${b.bonus_id}`
}

/**
 * Bonus values from a DefaultGameCore.ini's ItemBalance_Classic lines in the
 * bonus block: eItem 0 starting (iCash = index, iElerium = country), 1 country
 * (iElerium = country), 2 continent (iAlloys = continent); iTime is the bonus
 * id, iEng its value.
 */
export function parseBonusValues(text: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, '').trim()
    const m = /^ItemBalance_Classic\s*=\s*\((.*)\)$/.exec(line)
    if (!m) continue
    const f = new Map(
      m[1]!.split(',').map((part) => {
        const [k, v] = part.split('=').map((x) => x.trim())
        return [k ?? '', Number(v)] as [string, number]
      }),
    )
    const item = f.get('eItem')
    const id = f.get('iTime')
    const value = f.get('iEng')
    if (id === undefined || value === undefined || Number.isNaN(value)) continue
    if (item === 0)
      out.set(bonusKey({ type: 'starting', bonus_id: id, starter_index: f.get('iCash') }), value)
    else if (item === 1)
      out.set(bonusKey({ type: 'country', bonus_id: id, country_id: f.get('iElerium') }), value)
    else if (item === 2)
      out.set(bonusKey({ type: 'continent', bonus_id: id, continent_id: f.get('iAlloys') }), value)
  }
  return out
}

/** A bonus with the player's INI value, its description following the value. */
function withValue(b: Bonus, values?: Map<string, number>): Bonus {
  const v = values?.get(bonusKey(b))
  if (v === undefined || v === b.value) return b
  return { ...b, value: v, description: b.description.replace(String(b.value), String(v)) }
}

export interface ActiveBonuses {
  starting?: Bonus
  countries: Bonus[]
  continents: Bonus[]
  all: Bonus[]
}

export function activeBonuses(c: Campaign, values?: Map<string, number>): ActiveBonuses {
  const sats = new Set(c.satelliteCountries)
  const starting = data.starting_bonuses.find(
    (b) => b.enabled && b.starter_index === c.startingBonusIndex,
  )
  const countries = data.country_bonuses.filter(
    (b) =>
      b.enabled &&
      b.country_id !== undefined &&
      sats.has(b.country_id) &&
      b.country_id !== c.startCountry,
  )
  const continents = data.continent_bonuses.filter((b) => {
    if (!b.enabled) return false
    // Only council members can have satellites; the rest of the continent does not count.
    const members = data.countries.filter(
      (k) => k.continent_id === b.continent_id && k.council_member,
    )
    return members.length > 0 && members.every((k) => sats.has(k.id))
  })
  const s = starting && withValue(starting, values)
  const co = countries.map((b) => withValue(b, values))
  const cn = continents.map((b) => withValue(b, values))
  return { starting: s, countries: co, continents: cn, all: [...(s ? [s] : []), ...co, ...cn] }
}

export interface ResearchBonuses {
  /** Added to the research credit reduction (0.10 for +10 %). */
  creditBonus: number
  /** Fraction taken off autopsy and interrogation time. */
  autopsyTimeReduction: number
  /** The bonuses behind those numbers. */
  sources: Bonus[]
}

export function researchBonuses(active: ActiveBonuses): ResearchBonuses {
  const expertise = active.all.filter((b) => b.bonus_id === EXPERTISE)
  const ways = active.all.filter((b) => b.bonus_id === WE_HAVE_WAYS)
  return {
    creditBonus: expertise.reduce((sum, b) => sum + b.value, 0) / 100,
    autopsyTimeReduction: Math.min(0.95, Math.max(0, ...ways.map((b) => b.value)) / 100),
    sources: [...expertise, ...ways],
  }
}
