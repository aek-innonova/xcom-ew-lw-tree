// The browser-independent half of following a save folder: which file is the
// newest save, what changed between two saves, and checking our numbers
// against the game's.

import type { Campaign } from '@/save/campaign'
import {
  creditReductionFor,
  daysFor,
  isAutopsyOrInterrogation,
  POINTS_PER_BASE_DAY,
  type ResearchContext,
} from './research'
import type { Tech } from './techs'

export interface FileInfo {
  name: string
  lastModified: number
  size: number
}

/** XCOM names saves "save<number>" with no extension; the folder also holds other files. */
export function isSaveName(name: string): boolean {
  return /^save[\w-]*$/i.test(name)
}

export function newestSave(files: FileInfo[]): FileInfo | undefined {
  return files
    .filter((f) => isSaveName(f.name) && f.size > 1024)
    .reduce<FileInfo | undefined>(
      (best, f) => (!best || f.lastModified > best.lastModified ? f : best),
      undefined,
    )
}

/** Identifies one version of one file, so the same save is not parsed twice. */
export function fileKey(f: FileInfo): string {
  return `${f.name}:${f.lastModified}:${f.size}`
}

export interface CampaignChange {
  researched: number[]
  /** The project now running, if it changed. */
  started?: number
}

/** What happened between two saves of the same campaign; undefined for different campaigns. */
export function changesBetween(prev: Campaign, next: Campaign): CampaignChange | undefined {
  if (prev.gameNumber !== next.gameNumber) return undefined
  const researched = next.researched.flatMap((r, id) =>
    r && !prev.researched[id] && id > 0 ? [id] : [],
  )
  const started =
    next.project && next.project.tech !== prev.project?.tech ? next.project.tech : undefined
  return { researched, started }
}

export interface SaveCheck {
  at: number
  fileName: string
  saveNumber: number
  date?: string
  project: string
  /** The game's ETA in days, from its own text. */
  gameDays?: number
  /** Ours: points left over research speed. */
  formulaDays?: number
  /**
   * The game's ETA text can lag its points by a few hours (seen in 28 of 1,637
   * saves), so a game figure one day higher within six hours of a day boundary
   * counts as agreeing.
   */
  etaMatch?: boolean
  /** Credit reduction we expect for the project, if it is credited. */
  expectedCredit?: number
  /** What the project actually costs, as a reduction from base. */
  actualReduction?: number
  creditMatch?: boolean
  /** Bonuses that shape this project's figures (We Have Ways…). */
  notes: string[]
  /** What changed since the save loaded before it, e.g. "researched Xenobiology". */
  changes?: string
}

/**
 * Compares the current project's figures with ours. A credited project's cost
 * is fixed when it starts, so a credit mismatch can also mean a bonus changed
 * since then.
 */
export function checkSave(
  c: Campaign,
  techs: Tech[],
  ctx: ResearchContext | undefined,
  fileName: string,
): SaveCheck | undefined {
  const p = c.project
  const tech = p && techs.find((t) => t.id === p.tech)
  if (!p || !tech || !ctx) return undefined
  const eta = /^(\d+) days?$/.exec(p.eta)
  const gameDays = eta ? Number(eta[1]) : undefined
  const formulaDays = p.pointsLeft > 0 ? daysFor(p.pointsLeft, ctx.perHour) : 0
  const hours = p.pointsLeft / ctx.perHour
  const nearBoundary = formulaDays * 24 - hours < 6
  const base = tech.base_days * POINTS_PER_BASE_DAY
  const actualReduction =
    base > 0
      ? Math.round((1 - ((c.progress[tech.id] ?? 0) + p.pointsLeft) / base) * 100) / 100
      : undefined
  const notes: string[] = []
  let expectedCredit = creditReductionFor(tech, ctx)
  if (isAutopsyOrInterrogation(tech) && ctx.autopsyTimeReduction > 0) {
    expectedCredit = 1 - (1 - expectedCredit) * (1 - ctx.autopsyTimeReduction)
    notes.push(`We Have Ways ${Math.round(ctx.autopsyTimeReduction * 100)}% off`)
  }
  return {
    at: Date.now(),
    fileName,
    saveNumber: c.saveNumber,
    date: c.date
      ? `${c.date.year}-${String(c.date.month).padStart(2, '0')}-${String(c.date.day).padStart(2, '0')}`
      : undefined,
    project: tech.name,
    gameDays,
    formulaDays,
    etaMatch:
      gameDays === undefined
        ? undefined
        : gameDays === formulaDays || (gameDays === formulaDays + 1 && nearBoundary),
    expectedCredit,
    actualReduction,
    creditMatch:
      actualReduction === undefined
        ? undefined
        : Math.abs(actualReduction - expectedCredit) < 0.015,
    notes,
  }
}
