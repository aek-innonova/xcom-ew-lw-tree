import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseSave } from '@/save/parse'
import { readCampaign } from '@/save/campaign'
import { CATALOG, needs, parsePrices } from '../inventory'
import { defaultFoundry } from '../foundry'
import { defaultTechs } from '../techs'

const campaignOf = (f: string) =>
  readCampaign(parseSave(new Uint8Array(readFileSync(resolve(__dirname, '../../../fixtures/saves', f)))))
const item = (key: string) => CATALOG.find((c) => c.key === key)!

describe('grey market inventory', () => {
  it('tells similar items apart in cost texts', () => {
    expect(item('eItem_FloaterCorpse').match!.test('10 Floater corpses')).toBe(true)
    expect(item('eItem_FloaterCorpse').match!.test('4x Heavy Floater Corpse')).toBe(false)
    expect(item('eItem_SectoidCorpse').match!.test('5 Sectoid Commander corpses')).toBe(false)
    expect(item('eItem_UFOPowerSource').match!.test('6 UFO Power Sources')).toBe(true)
  })

  it('from scratch, research and the Foundry need every Sectoid corpse cost', () => {
    const n = needs(defaultTechs, defaultFoundry, null).get('eItem_SectoidCorpse')!
    // Xenobiology 5, Xenoneurology 10, Sectoid Autopsy 10, plus Foundry projects using them.
    expect(n.filter((x) => x.for.kind === 'tech').reduce((s, x) => s + x.count, 0)).toBe(25)
  })

  it('a campaign needs only what is not researched, started or built (save1738)', () => {
    const c = campaignOf('save1738')
    const n = needs(defaultTechs, defaultFoundry, {
      researched: c.researched,
      progress: c.progress,
      foundryDone: c.foundryHistory,
      foundryBuilding: new Set(c.foundryInProgress.map((b) => b.id)),
    })
    // Sectoid corpses: every tech that uses them is researched.
    expect((n.get('eItem_SectoidCorpse') ?? []).filter((x) => x.for.kind === 'tech')).toEqual([])
    // Plasma Weapons is in progress, so its alien carbines are paid.
    expect((n.get('eItem_PlasmaLightRifle_ThinMan') ?? []).map((x) => x.for.name)).not.toContain('Plasma Weapons')
  })

  it('reads the stores from the save', () => {
    const c = campaignOf('save1738')
    expect(c.stock[item('eItem_Elerium115').slot!]).toBeGreaterThan(100)
    expect(c.stock[item('eItem_Meld').slot!]).toBeGreaterThan(0)
  })
})

const sampleIni = resolve(__dirname, '../../../samples/DefaultGameCore.ini')
describe.skipIf(!existsSync(sampleIni))('the sample DefaultGameCore.ini', () => {
  it('prices every catalog item as the catalog does', () => {
    const prices = parsePrices(readFileSync(sampleIni, 'utf8'))
    for (const c of CATALOG) expect([c.key, prices.get(c.key)]).toEqual([c.key, c.price])
  })
})
