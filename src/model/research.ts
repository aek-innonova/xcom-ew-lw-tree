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

export const POINTS_PER_BASE_DAY = 720

export function pointsPerHour(c: Pick<Campaign, 'scientists' | 'labBonus' | 'adjacentLabBonus'>): number | undefined {
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
