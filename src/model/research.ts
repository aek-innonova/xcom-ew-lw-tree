// Research speed and time, from what a save tells us.
//
// Verified 2026-10-18 against all nine sample saves:
// - a tech costs base days × 720 research points before research credits;
// - labs produce scientists × (1 + m_fLabBonus + m_fAdjLabBonus) points/hour;
// - for the current project the save holds the points still needed after
//   credits (TResearchProject.iActualHoursLeft, despite the name), and the
//   game's ETA is ceil(points left / points per hour / 24) days.
// Research credits and We Have Ways are applied the way the game's GetTech
// does (credits.ts).

import type { Campaign } from '@/save/campaign'
import type { ResearchBonuses } from './bonuses'
import { applyCredits, coveringCredits, creditCut, creditsFromSlots } from './credits'
import type { Gate, Tech } from './techs'

export const POINTS_PER_BASE_DAY = 720

/**
 * Base days as shown: whole days, at least one. LWR's are its INI days
 * converted to Long War 1.0's 720-point days, so they come out fractional.
 */
export function baseDays(n: number): number {
  return n > 0 ? Math.max(1, Math.round(n)) : 0
}

/**
 * XGFacility_Labs.GetResearchPerHour. Long War 1.0: scientists × (1 + lab
 * bonus + adjacency bonus). LWR: 0.5 × (50 + scientists) × lab factor ×
 * adjacency factor, × 1.1 with Jai Vidwan (bonus 46) and again with Architects
 * of the Future (5); its save keeps the factors themselves (LAB_BONUS to the
 * power of the labs, LAB_ADJACENCY_BONUS to the power of the adjacencies).
 */
export type ResearchFormula = 'lw' | 'lwr'
export const JAI_VIDWAN = 46
export const ARCHITECTS = 5

export function pointsPerHour(
  c: Pick<Campaign, 'scientists' | 'labBonus' | 'adjacentLabBonus'>,
  formula: ResearchFormula = 'lw',
  bonusIds: ReadonlySet<number> = new Set(),
): number | undefined {
  if (!c.scientists) return undefined
  if (formula === 'lwr') {
    const f32 = Math.fround
    const jai = bonusIds.has(JAI_VIDWAN) ? f32(1.1) : 1
    const arch = bonusIds.has(ARCHITECTS) ? f32(1.1) : 1
    return f32(
      f32(f32(f32(0.5 * jai) * arch) * (50 + c.scientists)) *
        (c.labBonus ?? 1) *
        (c.adjacentLabBonus ?? 1),
    )
  }
  return c.scientists * (1 + (c.labBonus ?? 0) + (c.adjacentLabBonus ?? 0))
}

/** Days as the game rounds them: any part of a day counts as a day. */
export function daysFor(points: number, perHour: number): number {
  return Math.max(1, Math.ceil(points / perHour / 24))
}

/** The current project's remaining days, as the game shows them. */
export function projectDaysLeft(
  c: Campaign,
  formula: ResearchFormula = 'lw',
  bonusIds?: ReadonlySet<number>,
): number | undefined {
  const rate = pointsPerHour(c, formula, bonusIds)
  if (!c.project || !rate) return undefined
  return daysFor(c.project.pointsLeft, rate)
}

/** The current project's days left as the game shows them (its ETA text), else our formula. */
export function projectEtaDays(
  c: Campaign,
  formula: ResearchFormula = 'lw',
  bonusIds?: ReadonlySet<number>,
): number | undefined {
  const eta = c.project && /^(\d+) days?$/.exec(c.project.eta)
  return eta ? Number(eta[1]) : projectDaysLeft(c, formula, bonusIds)
}

// --- Research credits and bonuses -------------------------------------------
//
// Verified on 1,225 credited projects across 46 campaigns (2026-10-18), then
// read from the game's script (credits.ts): each credit that covers a tech
// takes 25 % plus Expertise off its cost (the Ethereal's "All" credit 20 %),
// and credits stack by multiplying: a plasma tech with the Plasma and the
// Weapons (Muton Elite) credits costs 0.75 × 0.75 = 56 % of base, or
// 0.65 × 0.65 = 42 % with Brazil's Expertise. A project's cost is fixed when it
// starts. A credit is held once its interrogation is researched; tech.json's
// unlock texts say which credit each one gives. We Have Ways takes its share
// off the cost of autopsies and interrogations after the credits (see
// bonuses.ts).

/** The share a field's credit takes off before Expertise. */
export const BASE_CREDIT_REDUCTION = 0.25

/**
 * Credit names held: from the save's credit slots where it has them, plus any
 * whose interrogation is researched. "All" covers every tech.
 */
export function heldCredits(
  techs: Tech[],
  researched: boolean[],
  slots: number[] = [],
): Set<string> {
  const held = new Set<string>(creditsFromSlots(slots))
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

/** The held credits that cover a tech, in the order the game applies them. */
export function applicableCredits(tech: Tech, held: Set<string>): string[] {
  return coveringCredits(tech.credits, held)
}

export function creditApplies(tech: Tech, held: Set<string>): boolean {
  return applicableCredits(tech, held).length > 0
}

/** A tech's cost in research points after its held credits, as the game computes it. */
export function creditedPoints(
  tech: Tech,
  ctx: Pick<ResearchContext, 'held' | 'expertise'> & { shares?: Record<string, number> },
): number {
  const cuts = applicableCredits(tech, ctx.held).map((c) => creditCut(c, ctx.expertise, ctx.shares))
  return applyCredits(tech.base_days * POINTS_PER_BASE_DAY, cuts, true)
}

/** The fraction of base cost a tech's held credits take off together. */
export function creditReductionFor(
  tech: Tech,
  ctx: Pick<ResearchContext, 'held' | 'expertise'> & { shares?: Record<string, number> },
): number {
  const base = tech.base_days * POINTS_PER_BASE_DAY
  return base > 0 ? 1 - creditedPoints(tech, ctx) / base : 0
}

/** Autopsies and interrogations, which We Have Ways shortens. */
export function isAutopsyOrInterrogation(tech: Tech): boolean {
  return tech.category === 'Autopsies' || tech.category === 'Interrogations'
}

export interface ResearchContext {
  perHour: number
  held: Set<string>
  /** What Expertise adds to each credit's share. */
  expertise: number
  /** Each credit's share in this game version (credits.ts creditShares). */
  shares?: Record<string, number>
  /** Fraction a field's credit takes off: 25 % plus Expertise. */
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
  shares?: Record<string, number>,
  formula: ResearchFormula = 'lw',
  bonusIds?: ReadonlySet<number>,
): ResearchContext | undefined {
  const perHour = pointsPerHour(c, formula, bonusIds)
  if (!perHour) return undefined
  return {
    perHour,
    held: heldCredits(techs, c.researched, c.credits),
    expertise: bonuses.creditBonus,
    shares,
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
  let cost = creditedPoints(tech, ctx)
  // GetTech: hours *= 1 − bonus / 100, kept whole.
  if (shortened) cost = Math.trunc(cost * Math.fround(1 - Math.fround(ctx.autopsyTimeReduction)))
  const pointsLeft = Math.max(0, cost - (c.progress[tech.id] ?? 0))
  return { pointsLeft, days: daysFor(pointsLeft, ctx.perHour), credited, shortened, exact: false }
}

export type TechState = 'researched' | 'researching' | 'available' | 'locked'

/** What a save says the campaign holds, for the game's non-research checks. */
export interface Holdings {
  /** XGStorage.m_arrItemArchives: non-zero for every item ever held. */
  everHad?: number[]
  stock?: number[]
  /** XGFacility_Engineering.m_arrFoundryHistory: non-zero for projects done. */
  foundryHistory?: number[]
  /**
   * XGGeoscape.m_arrCraftEncounters, by ship type: despite the name, a count of
   * crash-site and landed-UFO missions won (XGStrategy.PostCombat).
   */
  craftEncounters?: number[]
}

/** Whether a gate is met; true when the save does not say. */
export function gateMet(g: Gate, h: Holdings): boolean {
  const any = (list: number[] | undefined, ids: number[]) =>
    !list?.length || ids.some((i) => (list[i] ?? 0) > 0)
  if (g.kind === 'ever_had') return any(h.everHad, g.items)
  if (g.kind === 'in_stores') return any(h.stock, g.items)
  if (g.kind === 'foundry') return any(h.foundryHistory, g.projects)
  return any(h.craftEncounters, g.ships)
}

export function unmetGates(gates: Gate[], h: Holdings | undefined): Gate[] {
  return h ? gates.filter((g) => !gateMet(g, h)) : []
}

export function techState(
  tech: Tech,
  researched: boolean[],
  projectTech?: number,
  holdings?: Holdings,
): TechState {
  if (researched[tech.id]) return 'researched'
  if (projectTech === tech.id) return 'researching'
  const all = tech.prerequisites.every((p) => researched[p.id])
  const any = tech.any_one_of.length === 0 || tech.any_one_of.some((p) => researched[p.id])
  return all && any && !unmetGates(tech.gates, holdings).length ? 'available' : 'locked'
}
