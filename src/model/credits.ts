// Research credits: interrogating an alien gives a credit for a field of
// research. Each credit that covers a tech or Foundry project takes (25 % +
// Expertise) off its cost, credits stacking by multiplying (research.ts).
//
// Verified on the person's 1,711 saves (2026-10-18):
// - XGFacility_Labs.m_arrCredits holds a flag per credit; slot ↔ credit matched
//   held interrogations in all 1,651 saves of 33 campaigns: 1 Laser Weapons,
//   2 Plasma Weapons, 3 Weapons, 4 Aerospace, 5 Armor, 6 Cybernetics, 7 Gauss
//   Weapons, 8 Psionics. The Ethereal's "All" credit was never earned, so its
//   slot is unknown (0 and 9 are never set); it is read from the interrogation.
// - Foundry projects: a held credit makes a project start with 75 % of its work
//   (65 % with Brazil's Expertise), the same rule as research.

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

/** Whether a credit covers a tech or project with the given credit category. */
export function covers(credit: string, category: string | null): boolean {
  if (credit === 'All') return true
  if (!category) return false
  return (
    category === credit ||
    (credit === 'Weapons' && category !== 'Weapons' && category.endsWith('Weapons'))
  )
}
