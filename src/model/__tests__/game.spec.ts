import { describe, expect, it } from 'vitest'
import { GAMES } from '../game'
import { gateText } from '../gates'
import { layoutTechs } from '../layout'
import { defaultTechs } from '../techs'
import { applyTechBalance } from '../ini'

const lwr = GAMES.lwr
const tech = (id: number) => lwr.techs.find((t) => t.id === id)!

describe('game versions', () => {
  it('keeps Long War 1.0 as it was', () => {
    expect(GAMES.lw.techs).toEqual(defaultTechs)
    expect(GAMES.lw.iniPointsPerDay).toBe(720)
    expect(GAMES.lw.creditShares.Weapons).toBeCloseTo(0.25)
  })

  it('reads LWR’s tree from its own files', () => {
    expect(lwr.techs).toHaveLength(68)
    expect(lwr.iniPointsPerDay).toBe(240) // XGTechTree.TechCost: iTime × 240
    expect(lwr.creditShares.Weapons).toBeCloseTo(0.2)
    expect(tech(24).name).toBe('Light Plasma Weapons')
    expect(tech(24).prerequisites.map((p) => p.name)).toEqual([
      'EMP Weapons',
      'Interrogate Muton Elite',
      'Advanced Pulse Lasers',
    ])
    // Alien Materials: iTime 20 in LWR's INI is 4,800 points, 6⅔ of Long War 1.0's days.
    expect(tech(10).base_days).toBeCloseTo(6.67, 2)
    expect(lwr.techs.some((t) => t.id === 65)).toBe(false)
  })

  it('groups LWR’s UFO analyses by size: any one of the types captured', () => {
    expect(tech(61).name).toBe('UFO Analysis: Small UFOs')
    expect(tech(61).gates.map(gateText)).toEqual(['a Scout or Fighter captured'])
  })

  it('works out LWR’s Foundry by its formula (days × engineers² / 3)', () => {
    const p = lwr.foundry.find((x) => x.id === 1)!
    expect([p.base_days, p.engineers, p.hours]).toEqual([70, 10, Math.trunc((70 * 10 * 10) / 3)])
  })

  it('lays out a tree deeper than nine columns', () => {
    const layout = layoutTechs(lwr.techs, lwr.categories)
    expect(layout.columns).toBeGreaterThan(9)
    expect(layout.placed.size).toBe(68)
  })

  it('reads an INI’s days in the version’s own points', () => {
    const applied = applyTechBalance(
      lwr.techs,
      {
        balance: new Map([[10, { days: 30, alloys: 4, elerium: 4, fragments: 10, items: 4 }]]),
        unmatched: [],
      },
      lwr.iniPointsPerDay,
    )
    expect(applied.techs.find((t) => t.id === 10)!.base_days).toBe(10)
  })
})
