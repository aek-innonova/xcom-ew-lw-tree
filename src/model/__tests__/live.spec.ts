import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseSave } from '@/save/parse'
import { readCampaign } from '@/save/campaign'
import { activeBonuses, researchBonuses } from '../bonuses'
import { changesBetween, checkSave, isSaveName, newestSave } from '../live'
import { researchContext } from '../research'
import { defaultTechs } from '../techs'

const saves = resolve(__dirname, '../../../fixtures/saves')
const campaignOf = (f: string) =>
  readCampaign(parseSave(new Uint8Array(readFileSync(resolve(saves, f)))))

describe('picking the newest save', () => {
  it('ignores other files and tiny ones', () => {
    expect(isSaveName('save1762')).toBe(true)
    expect(isSaveName('save1762.json')).toBe(false)
    expect(isSaveName('profile.bin')).toBe(false)
    const newest = newestSave([
      { name: 'save1761', lastModified: 100, size: 300_000 },
      { name: 'save1762', lastModified: 200, size: 300_000 },
      { name: 'profile.bin', lastModified: 900, size: 300_000 },
      { name: 'save1763', lastModified: 950, size: 10 },
    ])
    expect(newest?.name).toBe('save1762')
  })
})

describe('changes between saves', () => {
  it('lists what was researched and what started', () => {
    // save1760: Alien Weaponry in progress; save1761: it is done and Xenobiology runs.
    const change = changesBetween(campaignOf('save1760'), campaignOf('save1761'))
    expect(change).toEqual({ researched: [9], started: 1 })
  })

  it('says nothing across campaigns', () => {
    expect(changesBetween(campaignOf('save1738'), campaignOf('save1762'))).toBeUndefined()
  })
})

describe('checking our figures against the game', () => {
  it.each(['save1738', 'save1752', 'save1762'])('%s agrees', (f) => {
    const c = campaignOf(f)
    const ctx = researchContext(c, defaultTechs, researchBonuses(activeBonuses(c)))
    const check = checkSave(c, defaultTechs, ctx, f)!
    expect(check.etaMatch).toBe(true)
    expect(check.creditMatch).toBe(true)
  })
})

describe('the game ETA lagging its points', () => {
  it('counts one day more within six hours of a day boundary as agreeing, not further away', async () => {
    const c = campaignOf('save1762')
    const ctx = researchContext(c, defaultTechs, researchBonuses(activeBonuses(c)))!
    // 10 points/hour: 470 points is 47 h (1 h short of 2 days); 400 is 40 h.
    const near = checkSave({ ...c, project: { tech: 1, pointsLeft: 470, eta: '3 days' } }, defaultTechs, ctx, 'x')!
    const far = checkSave({ ...c, project: { tech: 1, pointsLeft: 400, eta: '3 days' } }, defaultTechs, ctx, 'x')!
    expect(near.etaMatch).toBe(true)
    expect(far.etaMatch).toBe(false)
  })
})
