import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyTechBalance, parseTechBalance } from '../ini'
import { defaultTechs } from '../techs'

describe('parseTechBalance', () => {
  it('resolves enum names, bare numbers and eTech_Placeholder, ignoring comments', () => {
    const ini = [
      '[XComGame.XGTacticalGameCore]',
      'TechBalance=(eTech=eTech_Xenobiology,\t\tiTime=7,  iAlloys=1,  iElerium=2,  iNumFragments=3, iNumItems=6)\t; Xenobiology',
      'TechBalance=(eTech=72, iTime=9, iAlloys=8, iElerium=0, iNumFragments=0, iNumItems=0) ; Improved Body Armor',
      'TechBalance=(eTech=eTech_Placeholder, iTime=25, iAlloys=5, iElerium=30, iNumFragments=50, iNumItems=20)',
      ';TechBalance=(eTech=eTech_ArcThrower, iTime=99)',
      'TechBalance=(eTech=eTech_Nonsense, iTime=1)',
    ].join('\r\n')
    const { balance, unmatched } = parseTechBalance(ini, defaultTechs)
    expect(balance.get(1)).toEqual({ days: 7, alloys: 1, elerium: 2, fragments: 3, items: 6 })
    expect(balance.get(72)?.days).toBe(9)
    expect(balance.get(60)).toEqual({ days: 25, alloys: 5, elerium: 30, fragments: 50, items: 20 })
    expect(balance.has(2)).toBe(false)
    expect(unmatched).toEqual(['TechBalance=(eTech=eTech_Nonsense, iTime=1)'])
  })

  it('applies costs, keeps the item kind with the new count, and reports what changed', () => {
    const { balance } = parseTechBalance(
      'TechBalance=(eTech=eTech_Xenobiology, iTime=7, iAlloys=0, iElerium=0, iNumFragments=0, iNumItems=8)',
      defaultTechs,
    )
    const applied = applyTechBalance(defaultTechs, { balance, unmatched: [] })
    const xeno = applied.techs.find((t) => t.id === 1)!
    expect(xeno.base_days).toBe(7)
    expect(xeno.cost.items).toBe('8 Sectoid corpses')
    expect(applied.changed).toEqual([1])
    expect(applied.missing).toHaveLength(74)
  })
})

const sampleIni = resolve(__dirname, '../../../samples/DefaultGameCore.ini')
describe.skipIf(!existsSync(sampleIni))('the sample DefaultGameCore.ini', () => {
  it('covers all 75 techs and agrees with tech.json', () => {
    const ini = parseTechBalance(readFileSync(sampleIni, 'utf8'), defaultTechs)
    expect(ini.unmatched).toEqual([])
    expect(ini.balance.size).toBe(75)
    const applied = applyTechBalance(defaultTechs, ini)
    expect(applied.missing).toEqual([])
    expect(applied.changed).toEqual([])
  })
})
