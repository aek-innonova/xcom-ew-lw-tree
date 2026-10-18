import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseSave } from '@/save/parse'
import { readCampaign } from '@/save/campaign'
import { activeBonuses } from '../bonuses'
import {
  applyFoundryBalance,
  defaultFoundry,
  foundryCategories,
  foundryState,
  layoutFoundry,
  parseFoundryBalance,
  withCostReduction,
} from '../foundry'
import { COLUMNS, layoutTechs } from '../layout'
import { categories, defaultTechs } from '../techs'

const saves = resolve(__dirname, '../../../fixtures/saves')
const campaignOf = (f: string) =>
  readCampaign(parseSave(new Uint8Array(readFileSync(resolve(saves, f)))))
const project = (id: number) => defaultFoundry.find((p) => p.id === id)!

describe('the Foundry board', () => {
  const techLayout = layoutTechs(defaultTechs, categories)
  const techColumn = (id: number) => techLayout.placed.get(id)!.column
  const layout = layoutFoundry(defaultFoundry, foundryCategories, techColumn)

  it('places all 46 projects once, without overlaps, right of the tech each needs', () => {
    expect(layout.placed.size).toBe(46)
    const cells = new Set<string>()
    for (const p of defaultFoundry) {
      const at = layout.placed.get(p.id)!
      const key = `${at.lane}:${at.column}:${at.row}`
      expect(cells.has(key)).toBe(false)
      cells.add(key)
      expect(at.row).toBeLessThan(layout.lanes[at.lane]!.rows)
      expect(at.column).toBeGreaterThanOrEqual(
        Math.min(COLUMNS - 1, techColumn(p.requires_tech!.id) + 1),
      )
    }
  })

  it('needs no more rows than the research tree', () => {
    expect(layout.totalRows).toBeLessThanOrEqual(15)
  })
})

describe('Foundry state from the saves', () => {
  it('campaign 55 has done what the game counts (27 projects)', () => {
    const c = campaignOf('save1738')
    const done = defaultFoundry.filter(
      (p) => foundryState(p, c.foundryHistory, new Set(), c.researched) === 'done',
    )
    expect(done).toHaveLength(27)
  })

  it('reads a project being built (save1719: Improved Arc Thrower, 30 engineers)', () => {
    const c = campaignOf('save1719')
    expect(c.foundryInProgress).toEqual([
      { id: 4, engineers: 30, maxEngineers: 30, workLeft: 1547 },
    ])
    expect(foundryState(project(4), c.foundryHistory, new Set([4]), c.researched)).toBe('building')
  })

  it('New Warfare: campaign 55 covers Asia, and the game charged 25 % less', () => {
    const c = campaignOf('save1719')
    const nw = activeBonuses(c).continents.find((b) => b.name === 'New Warfare')!
    expect(nw.value).toBe(25)
    // The save's kOriginalCost for Improved Arc Thrower: 75 cash, 30 alloys, 30 elerium (base 100/40/40).
    expect(withCostReduction(project(4), nw.value / 100).cost).toMatchObject({
      cash: 75,
      alloys: 30,
      elerium: 30,
    })
  })
})

describe('FoundryBalance lines', () => {
  it('unpack Meld from the fragments field and resolve numbered slots', () => {
    const b = parseFoundryBalance(
      [
        'FoundryBalance=(eTech=eFoundry_MedikitII, iTime=9, iEngineers=12, iCash=180, iElerium=0, iAlloys=0, iFragments=20005, iNumItems=25, eReqTech=eTech_AutopsyThinMan, eReqItem=eItem_ThinManCorpse) // Improved Medikit',
        'FoundryBalance=(eTech=30, iTime=5, iEngineers=1, iCash=1, iElerium=0, iAlloys=0, iFragments=0, iNumItems=0, eReqTech=0, eReqItem=0);',
      ].join('\n'),
      defaultFoundry,
    )
    expect(b.get(3)).toEqual({
      days: 9,
      engineers: 12,
      cash: 180,
      alloys: 0,
      elerium: 0,
      fragments: 5,
      meld: 20,
      items: 25,
    })
    expect(b.get(30)?.days).toBe(5)
    const applied = applyFoundryBalance(defaultFoundry, b)
    expect(applied.projects.find((p) => p.id === 3)!.cost.items[0]).toBe('25x Thin Man Corpse')
    expect(applied.changed).toContain(3)
  })
})

const sampleIni = resolve(__dirname, '../../../samples/DefaultGameCore.ini')
describe.skipIf(!existsSync(sampleIni))('the sample DefaultGameCore.ini', () => {
  it('has all 46 Foundry projects and agrees with longwar_foundry.json', () => {
    const b = parseFoundryBalance(readFileSync(sampleIni, 'utf8'), defaultFoundry)
    expect(b.size).toBe(46)
    expect(applyFoundryBalance(defaultFoundry, b).changed).toEqual([])
  })
})

describe('Foundry progress', () => {
  it('total work is base days × 24 × engineers; save1719 has Improved Arc Thrower 85 % done', async () => {
    const { foundryProgress, foundryWork } = await import('../foundry')
    expect(foundryWork(project(4))).toBe(14 * 24 * 30)
    const c = campaignOf('save1719')
    const p = foundryProgress(project(4), c.foundryInProgress[0]!.workLeft)
    expect(p.done).toBeCloseTo(1 - 1547 / 10080)
    expect(p.baseDaysLeft).toBe(3)
  })
})
