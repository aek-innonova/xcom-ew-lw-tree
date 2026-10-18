import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseSave } from '@/save/parse'
import { readCampaign } from '@/save/campaign'
import { applyCredits, creditCut, creditGivenBy, CREDIT_SLOTS } from '../credits'
import { defaultFoundry, foundryRules } from '../foundry'
import { gateShown, gateText } from '../gates'
import { techState } from '../research'
import { defaultTechs, techRules } from '../techs'

const tech = (id: number) => defaultTechs.find((t) => t.id === id)!
const campaignOf = (f: string) =>
  readCampaign(
    parseSave(new Uint8Array(readFileSync(resolve(__dirname, '../../../fixtures/saves', f)))),
  )

describe('tech.json against the game script (data/techtree.json)', () => {
  it('has the game prerequisites, apart from steps marked as the way to an item', () => {
    for (const r of techRules) {
      const t = tech(r.id)
      const ours = t.prerequisites.filter((p) => !p.via).map((p) => p.id)
      expect([t.name, ours.sort((a, b) => a - b)]).toEqual([t.name, r.requires])
      expect([t.name, t.any_one_of.map((p) => p.id)]).toEqual([t.name, r.any_of ?? []])
    }
  })

  it('marks Alien Operations as the way to the Hyperwave Beacon', () => {
    expect(tech(7).prerequisites).toContainEqual({
      id: 3,
      name: 'Alien Operations',
      via: 'Hyperwave Beacon',
    })
    expect(tech(7).gates.map(gateText)).toEqual(['Hyperwave Beacon'])
  })

  it('has the Foundry prerequisites the INI gives', () => {
    for (const r of foundryRules) {
      const p = defaultFoundry.find((x) => x.id === r.id)!
      expect([p.name, p.requires_tech?.id]).toEqual([p.name, r.requires])
    }
  })

  it('agrees on which interrogation gives which credit', () => {
    for (const r of techRules.filter((x) => 'grants_credit' in x)) {
      const slot = (r as { grants_credit: number }).grants_credit
      expect(creditGivenBy(tech(r.id))).toBe(CREDIT_SLOTS[slot])
    }
  })
})

describe('GetCreditAdjustedTechHours', () => {
  it('takes each share off in turn, whole numbers', () => {
    expect(applyCredits(7200, [creditCut('Laser Weapons', 0)], true)).toBe(5400)
    expect(applyCredits(7200, [creditCut('Laser Weapons', 0.1)], true)).toBe(4680)
    expect(applyCredits(7200, [creditCut('All', 0)], true)).toBe(5760) // the Ethereal's 20 %
  })

  it('saves at least 24 per credit and leaves research at least 24', () => {
    expect(applyCredits(60, [0.25], false)).toBe(36)
    expect(applyCredits(40, [0.25], true)).toBe(24)
    expect(applyCredits(0, [0.25], true)).toBe(0)
  })
})

describe('gates', () => {
  it('reads what the save holds', () => {
    const c = campaignOf('save1762')
    expect(c.everHad.length).toBeGreaterThan(200)
    expect(c.craftEncounters[4]).toBeGreaterThan(0) // a Scout
  })

  it('locks a UFO analysis until that UFO is met', () => {
    const c = campaignOf('save1762')
    const researched = c.researched.slice()
    researched[10] = true // Alien Materials
    expect(techState(tech(61), researched, undefined, c)).toBe('available') // Scout
    expect(techState(tech(65), researched, undefined, c)).toBe('locked') // Battleship
    expect(techState(tech(65), researched)).toBe('available') // without a save's holdings
  })

  it('shows a gate only where the cost does not already say it', () => {
    const shown = (id: number) => tech(id).gates.filter((g) => gateShown(g, tech(id).cost.items))
    expect(shown(44)).toEqual([]) // Sectoid Autopsy: 10 Sectoid corpses
    expect(shown(48)).toEqual([]) // Chryssalid Carcass, costed as corpses
    expect(shown(27).map(gateText)).toEqual(['Alien Rifle']) // kept, not used up
    expect(shown(3).map(gateText)).toEqual(['Outsider Shard in stores'])
    expect(tech(3).gates.map(gateText)).toEqual(['Outsider Shard in stores']) // implies ever held
    expect(shown(65).map(gateText)).toEqual(['Battleship UFO encountered'])
  })
})
