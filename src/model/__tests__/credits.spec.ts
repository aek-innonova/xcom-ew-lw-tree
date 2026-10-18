import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseSave } from '@/save/parse'
import { readCampaign } from '@/save/campaign'
import { covers, creditGivenBy, creditsFromSlots, creditSources } from '../credits'
import { defaultFoundry, foundryCreditReduction } from '../foundry'
import { heldCredits } from '../research'
import { defaultTechs } from '../techs'

const campaignOf = (f: string) =>
  readCampaign(
    parseSave(new Uint8Array(readFileSync(resolve(__dirname, '../../../fixtures/saves', f)))),
  )
const tech = (id: number) => defaultTechs.find((t) => t.id === id)!

describe('research credits', () => {
  it('reads held credits from the save, agreeing with the interrogations done (save1738)', () => {
    const c = campaignOf('save1738')
    expect(creditsFromSlots(c.credits).sort()).toEqual(
      [
        'Aerospace',
        'Armor',
        'Cybernetics',
        'Gauss Weapons',
        'Laser Weapons',
        'Plasma Weapons',
      ].sort(),
    )
    expect([...heldCredits(defaultTechs, c.researched, c.credits)].sort()).toEqual(
      [...heldCredits(defaultTechs, c.researched)].sort(),
    )
  })

  it('knows which interrogation gives which credit', () => {
    expect(creditGivenBy(tech(41))).toBe('Plasma Weapons') // Interrogate Heavy Floater
    expect(creditSources(defaultTechs).get('Weapons')?.name).toBe('Interrogate Muton Elite')
    expect(creditGivenBy(tech(24))).toBeUndefined()
  })

  it('covers what the game lists; All covers everything', () => {
    expect(tech(24).credits).toEqual(['Plasma Weapons', 'Weapons'])
    expect(covers('Weapons', tech(24).credits)).toBe(true)
    expect(covers('Weapons', tech(15).credits)).toBe(false) // Carapace Armor
    expect(covers('All', [])).toBe(true)
    expect(covers('Armor', [])).toBe(false)
  })

  it('takes 25 % (+ Expertise) off Foundry work, per held credit', () => {
    const surgery = defaultFoundry.find((p) => p.name === 'Advanced Surgery')!
    expect(surgery.credits).toEqual(['Cybernetics'])
    expect(foundryCreditReduction(surgery, new Set(['Cybernetics']), 0)).toBeCloseTo(0.25)
    expect(foundryCreditReduction(surgery, new Set(['Cybernetics']), 0.1)).toBeCloseTo(0.35)
    expect(foundryCreditReduction(surgery, new Set(['Armor']), 0)).toBe(0)
    // Armored Fighters: two credits, as the game lists them.
    const fighters = defaultFoundry.find((p) => p.name === 'Armored Fighters')!
    expect(fighters.credits).toEqual(['Aerospace', 'Armor'])
    expect(foundryCreditReduction(fighters, new Set(['Aerospace', 'Armor']), 0)).toBeCloseTo(
      0.4375,
      3,
    )
  })
})

describe('the credit slots against the game enum', () => {
  it('slot 9 is the all-research credit (EResearchCredits.AllTech)', () => {
    expect(creditsFromSlots([0, 0, 0, 0, 0, 0, 0, 0, 0, 1])).toEqual(['All'])
  })
})
