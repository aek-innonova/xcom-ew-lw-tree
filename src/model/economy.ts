// What a month brings in and costs, by Long War 1.0's own rules (its
// XComStrategyGame script, read with scripts/upk_script.py):
// - XGWorld.GetIncome: the funding of every council member still paying
//   (XGCountry.m_iFunding > 0), plus Wealth of Nations' percentage
//   (HasBonus(6)), as whole credits;
// - XGHeadQuarters.GetMaintenanceTotal: each facility's upkeep times how many
//   the base has (GetFacilityMaintenanceCost; XGItemTree.GetFacility takes
//   Architects of the Future's percentage off a Laboratory's and a Workshop's,
//   Power to the People's off the generators', as whole credits), and each craft's
//   (XGFacility_Hangar.GetCraftMaintenanceCost: §40 an Interceptor, §50 a
//   Firestorm, the Skyranger's from the INI), less Air Superiority's
//   percentage (HasBonus(2)), each craft's as whole credits.
// XGWorld.PayDay pays both at once. LWR pays daily by rules partly in its own
// mutator code, which this does not follow: null for LWR.

import economy from '../../data/economy.json'
import type { Campaign } from '@/save/campaign'

export const WEALTH_OF_NATIONS = 6
export const AIR_SUPERIORITY = 2
export const POWER_TO_THE_PEOPLE = 3
export const ARCHITECTS_OF_THE_FUTURE = 5

/** Facilities a bonus makes cheaper to keep, by EFacilityType (XGItemTree.GetFacility). */
const FACILITY_BONUS: Record<number, number> = {
  7: ARCHITECTS_OF_THE_FUTURE, // Laboratory
  8: ARCHITECTS_OF_THE_FUTURE, // Workshop
  10: POWER_TO_THE_PEOPLE, // Fission Generator
  15: POWER_TO_THE_PEOPLE, // Thermo Generator
  16: POWER_TO_THE_PEOPLE, // Elerium Generator
}

export interface UpkeepLine {
  name: string
  count: number
  each: number
  total: number
}

export interface MonthlyEconomy {
  /** Council countries paying, and what they pay before bonuses. */
  paying: number
  funding: number
  /** Wealth of Nations: its percentage and what it adds. */
  wealth?: { percent: number; adds: number }
  income: number
  facilities: UpkeepLine[]
  craft: UpkeepLine[]
  /** Air Superiority's percentage off each craft's upkeep. */
  craftDiscount?: number
  upkeep: number
  net: number
}

/** Craft upkeep by EShipType (1 Interceptor, 2 Skyranger, 3 Firestorm). */
const CRAFT: Record<number, [name: string, plural: string, upkeep: number]> = {
  1: ['Interceptor', 'Interceptors', 40],
  3: ['Firestorm', 'Firestorms', 50],
}

/**
 * The month's funding and upkeep for a Long War 1.0 campaign; `bonus(id)` is
 * the value of a starting, country or continent bonus in effect (0 if none).
 */
export function monthlyEconomy(
  c: Campaign,
  game: 'lw' | 'lwr',
  bonus: (id: number) => number,
): MonthlyEconomy | null {
  // A campaign stored by an older site has no countries or facilities: nothing to say.
  if (game !== 'lw' || !c.countries?.length || !c.baseFacilities) return null
  const data = economy.lw
  const paying = c.countries.filter((x) => x.council && x.funding > 0)
  const funding = paying.reduce((n, x) => n + x.funding, 0)
  const percent = bonus(WEALTH_OF_NATIONS)
  const income = percent > 0 ? Math.trunc(funding + funding * (percent / 100)) : funding

  const facilities = data.facilities.flatMap((f) => {
    const count = c.baseFacilities[f.id] ?? 0
    const off = FACILITY_BONUS[f.id] ? bonus(FACILITY_BONUS[f.id]!) : 0
    const each = off > 0 ? Math.trunc(f.upkeep * (1 - off / 100)) : f.upkeep
    return count > 0 ? [{ name: f.name, count, each, total: each * count }] : []
  })

  const discount = bonus(AIR_SUPERIORITY)
  const cost = (base: number) => (discount > 0 ? Math.trunc(base * (1 - discount / 100)) : base)
  const craft: UpkeepLine[] = []
  for (const [type, [name, plural, base]] of Object.entries(CRAFT)) {
    const count = c.interceptors.filter((i) => i.type === Number(type)).length
    if (count)
      craft.push({
        name: count === 1 ? name : plural,
        count,
        each: cost(base),
        total: cost(base) * count,
      })
  }
  // The Skyranger is always counted (GetShipMaintenanceCost).
  if (data.skyranger > 0)
    craft.push({
      name: 'Skyranger',
      count: 1,
      each: cost(data.skyranger),
      total: cost(data.skyranger),
    })

  const upkeep =
    facilities.reduce((n, f) => n + f.total, 0) + craft.reduce((n, f) => n + f.total, 0)
  return {
    paying: paying.length,
    funding,
    wealth: percent > 0 ? { percent, adds: income - funding } : undefined,
    income,
    facilities,
    craft,
    craftDiscount: discount > 0 ? discount : undefined,
    upkeep,
    net: income - upkeep,
  }
}
