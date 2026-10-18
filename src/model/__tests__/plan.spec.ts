import { describe, expect, it } from 'vitest'
import { planResearch, planTotals } from '../plan'
import { defaultTechs } from '../techs'

const name = (id: number) => defaultTechs.find((t) => t.id === id)!.name
const none: boolean[] = [true]

describe('planResearch', () => {
  it('collects every missing prerequisite, prerequisites first', () => {
    // Advanced Plasma Weapons ← Plasma Weapons ← Alien Weaponry, Alien Power Systems, Alien Biocybernetics…
    const plan = planResearch([25], defaultTechs, none)
    const pos = (id: number) => plan.steps.indexOf(id)
    expect(plan.steps[plan.steps.length - 1]).toBe(25)
    for (const id of [24, 9, 33, 60, 12, 10, 13, 32, 1]) expect(pos(id)).toBeGreaterThanOrEqual(0)
    for (const t of defaultTechs.filter((t) => plan.steps.includes(t.id))) {
      for (const p of t.prerequisites) expect(pos(p.id)).toBeLessThan(pos(t.id))
    }
    expect(plan.choices).toEqual([])
  })

  it('leaves out what is already researched', () => {
    const researched: boolean[] = []
    for (const id of [0, 1, 9, 10, 12, 13, 32, 33, 60]) researched[id] = true
    expect(planResearch([25], defaultTechs, researched).steps.map(name)).toEqual([
      'Plasma Weapons',
      'Advanced Plasma Weapons',
    ])
  })

  it('picks the cheapest member of an "any one of" group and says so', () => {
    // Alien Operations needs Xenopsionics and any one interrogation.
    const plan = planResearch([3], defaultTechs, none)
    expect(plan.choices).toHaveLength(1)
    const choice = plan.choices[0]!
    expect(choice.for).toBe(3)
    // Interrogate Sectoid (9 days) needs only Sectoid Autopsy, which Xenopsionics already needs.
    expect(name(choice.picked)).toBe('Interrogate Sectoid')
    expect(choice.alternatives).toHaveLength(8)
    expect(plan.steps).toContain(35)
  })

  it('needs no pick when one of the group is already in the plan', () => {
    const plan = planResearch([3, 37], defaultTechs, none) // Interrogate Muton is a goal too
    expect(plan.choices).toEqual([])
  })

  it('puts the tech already being researched first among those ready', () => {
    const researched: boolean[] = []
    for (const id of [0, 1, 9, 10, 12, 13, 32, 33, 60, 2, 44]) researched[id] = true
    // Ready together: Plasma Weapons (75 days, in progress) and Xenopsionics (14 days).
    const plan = planResearch([25, 4], defaultTechs, researched, 24)
    expect(plan.steps.map(name).slice(0, 2)).toEqual(['Plasma Weapons', 'Xenopsionics'])
  })

  it('sums item costs by kind', () => {
    const totals = planTotals(planResearch([4], defaultTechs, none), defaultTechs)
    // Xenobiology 5 + Sectoid Autopsy 10 + Xenoneurology 10 Sectoid corpses; 20 + 15 Meld.
    expect(totals.items).toEqual(['25 Sectoid corpses', '35 Meld'])
  })

  it('totals the costs of the steps', () => {
    const researched: boolean[] = []
    for (const id of [0, 1, 9, 10, 12, 13, 32, 33, 60]) researched[id] = true
    const totals = planTotals(planResearch([25], defaultTechs, researched), defaultTechs)
    expect(totals).toEqual({
      baseDays: 75 + 90,
      alloys: 40,
      elerium: 140,
      fragments: 375,
      items: ['5 Alien Carbines', '3 Alien Rifles'],
    })
  })
})
