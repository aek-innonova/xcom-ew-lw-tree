import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseSave } from '@/save/parse'
import { readCampaign } from '@/save/campaign'
import { activeBonuses, bonusKey, parseBonusValues, researchBonuses } from '../bonuses'
import { researchContext, POINTS_PER_BASE_DAY } from '../research'
import { defaultTechs } from '../techs'

const saves = resolve(__dirname, '../../../fixtures/saves')
const campaignOf = (f: string) =>
  readCampaign(parseSave(new Uint8Array(readFileSync(resolve(saves, f)))))

describe('campaign bonuses from the fixture saves', () => {
  it('campaign 55: US start with Special Warfare School; Expertise from Brazil makes credits 35 %', () => {
    const c = campaignOf('save1738')
    expect(c.startCountry).toBe(0)
    const active = activeBonuses(c)
    expect(active.starting?.name).toBe('Special Warfare School')
    const names = active.countries.map((b) => b.name)
    expect(names).toContain('Expertise')
    // The starting country's own bonus does not count.
    expect(names).not.toContain('We Have Ways')
    const ctx = researchContext(c, defaultTechs, researchBonuses(active))!
    expect(ctx.creditReduction).toBeCloseTo(0.35)
    // What the current project (Plasma Weapons, credited) actually costs agrees.
    const project = defaultTechs.find((t) => t.id === c.project!.tech)!
    const paid =
      (c.progress[project.id]! + c.project!.pointsLeft) / (project.base_days * POINTS_PER_BASE_DAY)
    expect(1 - paid).toBeCloseTo(ctx.creditReduction)
  })

  it('campaign 56: US start with We Have Ways, which shortens autopsies by 75 %', () => {
    const c = campaignOf('save1762')
    const active = activeBonuses(c)
    expect(active.starting?.name).toBe('We Have Ways')
    expect(researchBonuses(active)).toMatchObject({ creditBonus: 0, autopsyTimeReduction: 0.75 })
  })

  it('North America fully covered in campaign 55 gives its continent bonus', () => {
    expect(activeBonuses(campaignOf('save1738')).continents.map((b) => b.name)).toContain(
      'Air Superiority',
    )
  })
})

describe('bonus values from an INI', () => {
  it('reads starting, country and continent lines', () => {
    const v = parseBonusValues(
      [
        'ItemBalance_Classic=(eItem=0, iCash=38, iElerium=0, iAlloys=0, iTime=57, iEng=60); We Have Ways',
        'ItemBalance_Classic=(eItem=1, iCash=0, iElerium=19, iAlloys=1, iTime=54, iEng=20); Expertise',
        'ItemBalance_Classic=(eItem=2, iCash=0, iElerium=-1, iAlloys=0, iTime=2, iEng=25); Air Superiority',
        '; ItemBalance_Classic=(eItem=1, iCash=0, iElerium=2, iAlloys=3, iTime=38, iEng=15); commented out',
      ].join('\n'),
    )
    expect(v.get(bonusKey({ type: 'starting', bonus_id: 57, starter_index: 38 }))).toBe(60)
    expect(v.get(bonusKey({ type: 'country', bonus_id: 54, country_id: 19 }))).toBe(20)
    expect(v.get(bonusKey({ type: 'continent', bonus_id: 2, continent_id: 0 }))).toBe(25)
    expect(v.size).toBe(3)
  })

  it('an INI value replaces the default and the description follows', () => {
    const c = campaignOf('save1738')
    const values = new Map([[bonusKey({ type: 'country', bonus_id: 54, country_id: 19 }), 20]])
    const expertise = activeBonuses(c, values).countries.find((b) => b.name === 'Expertise')!
    expect(expertise.value).toBe(20)
    expect(expertise.description).toContain('20%')
  })
})

const sampleIni = resolve(__dirname, '../../../samples/DefaultGameCore.ini')
describe.skipIf(!existsSync(sampleIni))('the sample DefaultGameCore.ini', () => {
  it('agrees with longwar_bonuses.json for both campaigns', () => {
    const values = parseBonusValues(readFileSync(sampleIni, 'utf8'))
    for (const f of ['save1738', 'save1762']) {
      const c = campaignOf(f)
      expect(activeBonuses(c, values)).toEqual(activeBonuses(c))
    }
  })
})

describe('lost countries', () => {
  it('campaign 56 lost Australia, which puts Asia\'s New Warfare out of reach', async () => {
    const { blockedContinents } = await import('../bonuses')
    const c = campaignOf('save1762')
    expect(c.lostCountries).toEqual([8])
    expect(blockedContinents(c).map((x) => [x.bonus.name, x.lost])).toEqual([['New Warfare', ['Australia']]])
  })
})
