import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseSave } from '@/save/parse'
import { readCampaign } from '@/save/campaign'
import { campaignStats } from '../stats'

const campaignOf = (f: string) =>
  readCampaign(
    parseSave(new Uint8Array(readFileSync(resolve(__dirname, '../../../fixtures/saves', f)))),
  )

describe('campaign statistics', () => {
  it('reads the hidden alien counters and the usual figures (save1738)', () => {
    expect(campaignStats(campaignOf('save1738'))).toMatchObject({
      days: 296,
      alienResources: 50,
      xcomThreat: 10,
      alienBonusResearch: 8,
      missions: 133,
      missionsWon: 133,
      aliensKilled: 1805,
      ufosShotDown: 49,
      satellites: 15,
      foundryDone: 27,
    })
  })

  it('bonus research starts at the INI deficit (save1760, day 15)', () => {
    expect(campaignStats(campaignOf('save1760')).alienBonusResearch).toBe(-84)
  })
})
