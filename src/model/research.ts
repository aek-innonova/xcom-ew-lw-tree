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

// --- Research credits -------------------------------------------------------
//
// Seen in the samples' finished techs: a credit takes 25 % off the cost; in
// one campaign it later took 35 % (likely Long War's "Expertise" continent
// bonus, +10 % to credit bonuses). A credit is held once its interrogation is
// researched; tech.json's unlock texts say which credit each one gives.

export const DEFAULT_CREDIT_REDUCTION = 0.25

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

export interface ResearchContext {
  perHour: number
  held: Set<string>
  /** Fraction a held credit takes off, observed from the save where possible. */
  creditReduction: number
  /** True when creditReduction was measured from the save rather than assumed. */
  creditMeasured: boolean
}

export function researchContext(c: Campaign, techs: Tech[]): ResearchContext | undefined {
  const perHour = pointsPerHour(c)
  if (!perHour) return undefined
  const held = heldCredits(techs, c.researched)
  let creditReduction = DEFAULT_CREDIT_REDUCTION
  let creditMeasured = false
  const project = c.project && techs.find((t) => t.id === c.project!.tech)
  if (c.project && project && creditApplies(project, held) && project.base_days > 0) {
    const effective = (c.progress[project.id] ?? 0) + c.project.pointsLeft
    const observed = 1 - effective / (project.base_days * POINTS_PER_BASE_DAY)
    if (observed > 0 && observed < 1) {
      creditReduction = Math.round(observed * 100) / 100
      creditMeasured = true
    }
  }
  return { perHour, held, creditReduction, creditMeasured }
}

export interface Estimate {
  /** Research points still to go. */
  pointsLeft: number
  days: number
  credited: boolean
  /** The game's own figure (current project) rather than our estimate. */
  exact: boolean
}

export function estimate(tech: Tech, c: Campaign, ctx: ResearchContext): Estimate | undefined {
  if (c.researched[tech.id]) return undefined
  if (c.project?.tech === tech.id) {
    return {
      pointsLeft: c.project.pointsLeft,
      days: daysFor(c.project.pointsLeft, ctx.perHour),
      credited: creditApplies(tech, ctx.held),
      exact: true,
    }
  }
  const credited = creditApplies(tech, ctx.held)
  const cost = tech.base_days * POINTS_PER_BASE_DAY * (credited ? 1 - ctx.creditReduction : 1)
  const pointsLeft = Math.max(0, Math.round(cost - (c.progress[tech.id] ?? 0)))
  return { pointsLeft, days: daysFor(pointsLeft, ctx.perHour), credited, exact: false }
}

export type TechState = 'researched' | 'researching' | 'available' | 'locked'

export function techState(tech: Tech, researched: boolean[], projectTech?: number): TechState {
  if (researched[tech.id]) return 'researched'
  if (projectTech === tech.id) return 'researching'
  const all = tech.prerequisites.every((p) => researched[p.id])
  const any = tech.any_one_of.length === 0 || tech.any_one_of.some((p) => researched[p.id])
  return all && any ? 'available' : 'locked'
}
