import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseSave } from '@/save/parse'
import { readCampaign } from '@/save/campaign'
import { formatCampaignDay, monthTicks, peekGameNumber, snapshotOf, withSnapshot } from '../history'

const bytesOf = (f: string) =>
  new Uint8Array(readFileSync(resolve(__dirname, '../../../fixtures/saves', f)))
const campaignOf = (f: string) => readCampaign(parseSave(bytesOf(f)))

describe('campaign history', () => {
  it('snapshots a save with its campaign day', () => {
    const s = snapshotOf(campaignOf('save1762'), 'save1762')!
    expect(s).toMatchObject({
      game: 56,
      save: 1704,
      researched: 1,
      scientists: 10,
      satellites: 1,
      lost: 1,
    })
    expect(formatCampaignDay(s.day)).toBe('25 Mar 2016')
    expect(s.day).toBeGreaterThan(24)
    expect(s.day).toBeLessThan(25)
  })

  it('keeps one snapshot per save, in campaign order', () => {
    const a = snapshotOf(campaignOf('save1762'), 'save1762')!
    const b = snapshotOf(campaignOf('save1760'), 'save1760')!
    const list = withSnapshot(withSnapshot(withSnapshot([], a), b), { ...a, fileName: 'again' })
    expect(list.map((s) => s.fileName)).toEqual(['save1760', 'again'])
  })

  it('reads the campaign number from the header alone', () => {
    expect(peekGameNumber(bytesOf('save1738').subarray(0, 12))).toBe(55)
    expect(peekGameNumber(new Uint8Array(12))).toBeUndefined()
  })

  it('records when each tech was finished', () => {
    const c = campaignOf('save1738')
    expect(formatCampaignDay(c.researchedOn[9]!)).toBe('21 Mar 2016') // Alien Weaponry
    expect(c.researchedOn[24]).toBeUndefined() // Plasma Weapons, in progress
  })

  it('ticks month starts, the year at January', () => {
    expect(monthTicks(0, 100).map((t) => t.label)).toEqual(['Apr', 'May', 'Jun'])
    expect(monthTicks(280, 340).map((t) => t.label)).toEqual(['2017', 'Feb'])
  })
})
