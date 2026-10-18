// A campaign's history: a snapshot of a few numbers per save, kept per
// campaign, to chart how the campaign went over in-game time.

import type { Campaign } from '@/save/campaign'
import { campaignStats } from './stats'

export interface Snapshot {
  game: number
  save: number
  fileName: string
  /** Days since the campaign began, with the time of day. */
  day: number
  tactical: boolean
  researched: number
  scientists?: number
  engineers?: number
  satellites: number
  lost: number
  alienResources?: number
  xcomThreat?: number
  alienBonusResearch?: number
  foundryDone: number
  missionsWon?: number
  aliensKilled?: number
  ufosShotDown?: number
}

export function snapshotOf(c: Campaign, fileName: string): Snapshot | undefined {
  if (c.campaignDay === undefined) return undefined
  const s = campaignStats(c)
  return {
    game: c.gameNumber,
    save: c.saveNumber,
    fileName,
    day: c.campaignDay,
    tactical: c.tactical,
    researched: c.researched.filter((r, i) => r && i > 0).length,
    scientists: c.scientists,
    engineers: c.engineers,
    satellites: s.satellites,
    lost: s.lost.length,
    alienResources: s.alienResources,
    xcomThreat: s.xcomThreat,
    alienBonusResearch: s.alienBonusResearch,
    foundryDone: s.foundryDone,
    missionsWon: s.missionsWon,
    aliensKilled: s.aliensKilled,
    ufosShotDown: s.ufosShotDown,
  }
}

/** Adds or replaces (same save number) a snapshot; keeps the list in campaign order. */
export function withSnapshot(list: Snapshot[], s: Snapshot): Snapshot[] {
  return [...list.filter((x) => x.save !== s.save), s].sort(
    (a, b) => a.day - b.day || a.save - b.save,
  )
}

/** The campaign number a save belongs to, from its header alone (bytes 8–11). */
export function peekGameNumber(head: Uint8Array): number | undefined {
  if (head.length < 12) return undefined
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength)
  return view.getInt32(0, true) === 0x10 ? view.getInt32(8, true) : undefined
}

const START = Date.UTC(2016, 2, 1)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "14 Dec 2016" for a campaign day. */
export function formatCampaignDay(day: number): string {
  const d = new Date(START + Math.floor(day) * 86_400_000)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** Month starts between two campaign days, as axis ticks ("Apr", "2017" for January). */
export function monthTicks(from: number, to: number, max = 7): { day: number; label: string }[] {
  const ticks: { day: number; label: string }[] = []
  const start = new Date(START + Math.floor(from) * 86_400_000)
  let y = start.getUTCFullYear()
  let m = start.getUTCMonth() + 1
  for (;;) {
    if (m > 11) {
      m = 0
      y++
    }
    const day = (Date.UTC(y, m, 1) - START) / 86_400_000
    if (day > to) break
    ticks.push({ day, label: m === 0 ? String(y) : MONTHS[m]! })
    m++
  }
  if (ticks.length <= max) return ticks
  const step = Math.ceil(ticks.length / max)
  return ticks.filter((t, i) => i % step === 0 || t.label.length === 4)
}
