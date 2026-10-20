import { describe, expect, it } from 'vitest'
import type { Campaign } from '@/save/campaign'
import { creditApplies, estimate, heldCredits, researchContext, techState } from '../research'
import { defaultTechs } from '../techs'

const tech = (id: number) => defaultTechs.find((t) => t.id === id)!

function campaign(over: Partial<Campaign>): Campaign {
  return {
    description: '',
    game: 'lw',
    gameNumber: 1,
    saveNumber: 1,
    tactical: false,
    ironman: false,
    researched: Array.from({ length: 76 }, (_, i) => i === 0),
    progress: Array.from({ length: 76 }, () => 0),
    hoursSpent: Array.from({ length: 76 }, () => 0),
    credits: [],
    foundryHistory: [],
    foundryInProgress: [],
    secondWave: [],
    satelliteCountries: [],
    lostCountries: [],
    countries: [],
    baseFacilities: [],
    researchedOn: [],
    recap: {},
    stock: [],
    everHad: [],
    craftEncounters: [],
    interceptors: [],
    scientists: 100,
    labBonus: 0.2,
    adjacentLabBonus: 0.3,
    ...over,
  }
}

describe('research credits', () => {
  it('are held once the interrogation is researched', () => {
    const researched: boolean[] = []
    researched[40] = true // Interrogate Thin Man → Laser Weapons
    researched[42] = true // Interrogate Muton Elite → Weapons
    expect([...heldCredits(defaultTechs, researched)].sort()).toEqual(['Laser Weapons', 'Weapons'])
  })

  it('apply by category, with Weapons covering all weapon research', () => {
    expect(creditApplies(tech(20), new Set(['Laser Weapons']))).toBe(true)
    expect(creditApplies(tech(24), new Set(['Laser Weapons']))).toBe(false)
    expect(creditApplies(tech(24), new Set(['Weapons']))).toBe(true)
    expect(creditApplies(tech(15), new Set(['Weapons']))).toBe(false)
    expect(creditApplies(tech(1), new Set(['All']))).toBe(true)
  })
})

describe('estimates', () => {
  it('take credits plus Expertise off, and use the game ETA for the current project', () => {
    // Plasma Weapons (75 days, 54000 points) with the Plasma credit at 35 %.
    const researched = Array.from({ length: 76 }, (_, i) => i === 0)
    researched[41] = true // Interrogate Heavy Floater → Plasma Weapons credit
    const progress = Array.from({ length: 76 }, () => 0)
    progress[24] = 27300
    const c = campaign({
      researched,
      progress,
      project: { tech: 24, pointsLeft: 7800, eta: '2 days' },
    })
    const ctx = researchContext(c, defaultTechs, {
      creditBonus: 0.1,
      autopsyTimeReduction: 0,
      sources: [],
    })!
    expect(ctx.perHour).toBe(150)
    expect(ctx.creditReduction).toBeCloseTo(0.35)
    expect(estimate(tech(24), c, ctx)).toEqual({
      pointsLeft: 7800,
      days: 2,
      shortened: false,
      credited: true,
      exact: true,
    })
    // Advanced Plasma Weapons: 90 days × 720 × 0.65 = 42120 points at 150/h → 11.7 days.
    expect(estimate(tech(25), c, ctx)).toMatchObject({
      pointsLeft: 42120,
      days: 12,
      credited: true,
      exact: false,
    })
    // Beam Lasers: no credit, 8 days × 720 = 5760 points → 1.6 days.
    expect(estimate(tech(20), c, ctx)).toMatchObject({ pointsLeft: 5760, days: 2, credited: false })
  })
})

describe('We Have Ways', () => {
  it('shortens autopsies and interrogations only', () => {
    const c = campaign({})
    const ctx = researchContext(c, defaultTechs, {
      creditBonus: 0,
      autopsyTimeReduction: 0.75,
      sources: [],
    })!
    // Sectoid Autopsy: 4 days × 720 × 0.25 = 720 points at 150/h → 4.8 h → 1 day.
    expect(estimate(tech(44), c, ctx)).toMatchObject({ pointsLeft: 720, shortened: true })
    expect(estimate(tech(9), c, ctx)).toMatchObject({ pointsLeft: 4320, shortened: false })
  })
})

describe('techState', () => {
  it('distinguishes researched, researching, available and locked', () => {
    const researched: boolean[] = [true, true] // Xenobiology done
    expect(techState(tech(1), researched)).toBe('researched')
    expect(techState(tech(2), researched, 2)).toBe('researching')
    expect(techState(tech(13), researched)).toBe('available')
    expect(techState(tech(4), researched)).toBe('locked')
  })

  it('needs one of an "any one of" group', () => {
    const researched: boolean[] = []
    researched[4] = true // Xenopsionics, the hard prerequisite of Alien Operations
    expect(techState(tech(3), researched)).toBe('locked')
    researched[35] = true // Interrogate Sectoid
    expect(techState(tech(3), researched)).toBe('available')
  })
})

describe('credit stacking (verified on 1,225 projects in the save history)', () => {
  it('multiplies: a plasma tech with the Plasma and Weapons credits costs 0.65 × 0.65 with Expertise', async () => {
    const { creditReductionFor, applicableCredits } = await import('../research')
    const held = new Set(['Plasma Weapons', 'Weapons'])
    expect(applicableCredits(tech(24), held)).toEqual(['Plasma Weapons', 'Weapons'])
    expect(creditReductionFor(tech(24), { held, expertise: 0.1 })).toBeCloseTo(0.5775, 3)
    expect(creditReductionFor(tech(24), { held, expertise: 0 })).toBeCloseTo(0.4375, 3)
    // Armor research is not weapon research: only its own credit.
    expect(applicableCredits(tech(15), new Set(['Armor', 'Weapons']))).toEqual(['Armor'])
  })
})
