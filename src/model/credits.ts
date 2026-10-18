// Research credits: interrogating an alien gives a credit for a field of
// research. Each credit that covers a tech or Foundry project takes its share
// off the cost, credits stacking by multiplying.
//
// From the game's script (XGTechTree, read into data/techtree.json by
// scripts/upk_techtree.py):
// - BuildResearchCredits: every credit is worth 25 %, the Ethereal's "All" 20 %.
// - CreditAppliesToTech / CreditAppliesToFoundryTech: which techs and Foundry
//   projects each credit covers (each item's `credits`); "All" covers everything.
// - GetCreditAdjustedTechHours, per held credit that covers the item, in slot
//   order: saved = (share + Expertise) × hours, at least 24; hours −= saved,
//   cut to a whole number; research never drops below 24. "Hours" are research
//   points (base days × 720) or Foundry engineer-hours. The game applies it
//   when it looks the tech up, so a running project keeps the cost it started
//   with.
//
// Verified on the person's 1,711 saves (2026-10-18):
// - XGFacility_Labs.m_arrCredits holds a flag per credit; slot ↔ credit matched
//   held interrogations in all 1,651 saves of 33 campaigns: 1 Laser Weapons,
//   2 Plasma Weapons, 3 Weapons, 4 Aerospace, 5 Armor, 6 Cybernetics, 7 Gauss
//   Weapons, 8 Psionics. The game's EResearchCredits (data/enums.json) has the
//   same ten slots under vanilla names (Weapons_I, PlasmaWeapons, AllWeapons,
//   Armor_I, AllArmor, UFOTech, Flight, Psionics, AllTech): Long War reuses
//   them for its own fields. Slot 9, AllTech, is the Ethereal's "All" credit.
// - 371 of the 380 credited projects running in those saves cost exactly what
//   the formula gives; the other nine, all in early saves, fit no setting.
//   None had the "All" credit.

import techtree from '../../data/techtree.json'
import type { Tech } from './techs'

export const CREDIT_SLOTS: Record<number, string> = {
  1: 'Laser Weapons',
  2: 'Plasma Weapons',
  3: 'Weapons',
  4: 'Aerospace',
  5: 'Armor',
  6: 'Cybernetics',
  7: 'Gauss Weapons',
  8: 'Psionics',
  9: 'All',
}

/** Credit name → the interrogation that gives it, from tech.json's unlock texts. */
export function creditSources(techs: Tech[]): Map<string, Tech> {
  const out = new Map<string, Tech>()
  for (const t of techs) {
    for (const u of t.unlocks) {
      const m = /^(.+?) research credit/.exec(u)
      if (m) out.set(m[1]!, t)
      else if (/credit for all research/i.test(u)) out.set('All', t)
    }
  }
  return out
}

/** The credit an interrogation gives, if any. */
export function creditGivenBy(tech: Tech): string | undefined {
  for (const u of tech.unlocks) {
    const m = /^(.+?) research credit/.exec(u)
    if (m) return m[1]
    if (/credit for all research/i.test(u)) return 'All'
  }
  return undefined
}

/** Held credit names from the save's slots. */
export function creditsFromSlots(slots: number[]): string[] {
  return Object.entries(CREDIT_SLOTS)
    .filter(([slot]) => (slots[Number(slot)] ?? 0) !== 0)
    .map(([, name]) => name)
}

/** Each credit's share off from a version's BuildResearchCredits (techtree.json `credit_bonus`). */
export function creditShares(bonus: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(bonus).map(([slot, pct]) => [CREDIT_SLOTS[Number(slot)]!, pct / 100]),
  )
}

/** Long War 1.0's: 25 % each, the Ethereal's "All" 20 %. */
export const CREDIT_SHARE: Record<string, number> = creditShares(techtree.credit_bonus)

const SLOT_OF = new Map(Object.entries(CREDIT_SLOTS).map(([slot, name]) => [name, Number(slot)]))

/** Credit names from slot numbers, leaving out "All" (it covers everything anyway). */
export function creditNames(slots: number[]): string[] {
  return slots.flatMap((s) => (s === 9 || !CREDIT_SLOTS[s] ? [] : [CREDIT_SLOTS[s]!]))
}

/** Whether a credit covers a tech or project with the given covering credits. */
export function covers(credit: string, credits: string[]): boolean {
  return credit === 'All' || credits.includes(credit)
}

/** The held credits that cover an item, in the order the game applies them. */
export function coveringCredits(credits: string[], held: Set<string>): string[] {
  return [...held]
    .filter((h) => covers(h, credits))
    .sort((a, b) => (SLOT_OF.get(a) ?? 99) - (SLOT_OF.get(b) ?? 99))
}

/** One credit's share with Expertise added, as the game computes it (in single precision). */
export function creditCut(
  credit: string,
  expertise: number,
  shares: Record<string, number> = CREDIT_SHARE,
): number {
  const share = Math.fround(shares[credit] ?? 0.25)
  return expertise > 0 ? Math.fround(share + Math.fround(expertise)) : share
}

/**
 * GetCreditAdjustedTechHours: what is left of `hours` after each cut, in order.
 * Each credit saves at least 24; research never drops below 24.
 */
export function applyCredits(hours: number, cuts: number[], research: boolean): number {
  if (hours === 0) return 0
  let h = hours
  for (const cut of cuts) {
    const saved = Math.max(24, Math.fround(cut * h))
    h -= Math.trunc(saved)
    if (research && h < 24) h = 24
  }
  return h
}
