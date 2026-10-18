// Research speed and time, from what a save tells us.
//
// Verified 2026-10-18 against all nine sample saves:
// - a tech costs base days × 720 research points before research credits;
// - labs produce scientists × (1 + m_fLabBonus + m_fAdjLabBonus) points/hour;
// - for the current project the save holds the points still needed after
//   credits (TResearchProject.iActualHoursLeft, despite the name), and the
//   game's ETA is ceil(points left / points per hour / 24) days.
// How much each research credit takes off is not known yet (25 % and 35 %
// have been seen), so estimates for other techs are before credits.

import type { Campaign } from '@/save/campaign'
import type { ResearchBonuses } from './bonuses'
import type { Tech } from './techs'

export const POINTS_PER_BASE_DAY = 720

export function pointsPerHour(
  c: Pick<Campaign, 'scientists' | 'labBonus' | 'adjacentLabBonus'>,
): number | undefined {
  if (!c.scientists) return undefined
  return c.scientists * (1 + (c.labBonus ?? 0) + (c.adjacentLabBonus ?? 0))
}

/** Days as the game rounds them: any part of a day counts as a day. */
export function daysFor(points: number, perHour: number): number {
  return Math.max(1, Math.ceil(points / perHour / 24))
}

/** The current project's remaining days, as the game shows them. */
export function projectDaysLeft(c: Campaign): number | undefined {
  const rate = pointsPerHour(c)
  if (!c.project || !rate) return undefined
  return daysFor(c.project.pointsLeft, rate)
}

/** The current project's days left as the game shows them (its ETA text), else our formula. */
export function projectEtaDays(c: Campaign): number | undefined {
  const eta = c.project && /^(\d+) days?$/.exec(c.project.eta)
  return eta ? Number(eta[1]) : projectDaysLeft(c)
}

// --- Research credits and bonuses -------------------------------------------
//
// Seen in the samples' finished techs: a credit takes 25 % off the cost, and
// Long War's Expertise bonus adds to that (campaign 55: 35 % once Brazil had a
// satellite). A credit is held once its interrogation is researched; tech.json's
// unlock texts say which credit each one gives. We Have Ways shortens autopsies
// and interrogations (see bonuses.ts).

export const BASE_CREDIT_REDUCTION = 0.25

/** Credit names held, from researched interrogations. "All" covers every tech. */
export function heldCredits(techs: Tech[], researched: boolean[]): Set<string> {
  const held = new Set<string>()
  for (const t of techs) {
    if (!researched[t.id]) continue
    for (const u of t.unlocks) {
      const m = /^(.+?) research credit/.exec(u)
      if (m) held.add(m[1]!)
      else if (/credit for all research/i.test(u)) held.add('All')
    }
  }
  return held
}

export function creditApplies(tech: Tech, held: Set<string>): boolean {
  const credit = tech.research_credit
  if (!credit) return held.has('All')
  if (held.has(credit) || held.has('All')) return true
  // The Muton Elite's "Weapons" credit covers all weapon research.
  return held.has('Weapons') && credit.endsWith('Weapons')
}

/** Autopsies and interrogations, which We Have Ways shortens. */
export function isAutopsyOrInterrogation(tech: Tech): boolean {
  return tech.category === 'Autopsies' || tech.category === 'Interrogations'
}

export interface ResearchContext {
  perHour: number
  held: Set<string>
  /** Fraction a held credit takes off: 25 % plus Expertise. */
  creditReduction: number
  /** Fraction We Have Ways takes off autopsies and interrogations. */
  autopsyTimeReduction: number
  bonuses: ResearchBonuses
}

const NO_BONUSES: ResearchBonuses = { creditBonus: 0, autopsyTimeReduction: 0, sources: [] }

export function researchContext(
  c: Campaign,
  techs: Tech[],
  bonuses: ResearchBonuses = NO_BONUSES,
): ResearchContext | undefined {
  const perHour = pointsPerHour(c)
  if (!perHour) return undefined
  return {
    perHour,
    held: heldCredits(techs, c.researched),
    creditReduction: BASE_CREDIT_REDUCTION + bonuses.creditBonus,
    autopsyTimeReduction: bonuses.autopsyTimeReduction,
    bonuses,
  }
}

export interface Estimate {
  /** Research points still to go (at full speed, after reductions). */
  pointsLeft: number
  days: number
  credited: boolean
  /** We Have Ways shortened it. */
  shortened: boolean
  /** The game's own figure (current project) rather than our estimate. */
  exact: boolean
}

export function estimate(tech: Tech, c: Campaign, ctx: ResearchContext): Estimate | undefined {
  if (c.researched[tech.id]) return undefined
  const credited = creditApplies(tech, ctx.held)
  const shortened = isAutopsyOrInterrogation(tech) && ctx.autopsyTimeReduction > 0
  if (c.project?.tech === tech.id) {
    // The game's own ETA, whatever bonuses are behind it.
    const eta = /^(\d+) days?$/.exec(c.project.eta)
    return {
      pointsLeft: c.project.pointsLeft,
      days: eta ? Number(eta[1]) : daysFor(c.project.pointsLeft, ctx.perHour),
      credited,
      shortened,
      exact: true,
    }
  }
  let cost = tech.base_days * POINTS_PER_BASE_DAY * (credited ? 1 - ctx.creditReduction : 1)
  if (shortened) cost *= 1 - ctx.autopsyTimeReduction
  const pointsLeft = Math.max(0, Math.round(cost - (c.progress[tech.id] ?? 0)))
  return { pointsLeft, days: daysFor(pointsLeft, ctx.perHour), credited, shortened, exact: false }
}

export type TechState = 'researched' | 'researching' | 'available' | 'locked'

export function techState(tech: Tech, researched: boolean[], projectTech?: number): TechState {
  if (researched[tech.id]) return 'researched'
  if (projectTech === tech.id) return 'researching'
  const all = tech.prerequisites.every((p) => researched[p.id])
  const any = tech.any_one_of.length === 0 || tech.any_one_of.some((p) => researched[p.id])
  return all && any ? 'available' : 'locked'
}
