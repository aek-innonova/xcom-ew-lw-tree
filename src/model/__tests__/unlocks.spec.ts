import { describe, expect, it } from 'vitest'
import { foundryFor, itemUnlocks, search, searchIndex } from '../unlocks'
import { defaultTechs } from '../techs'

const tech = (id: number) => defaultTechs.find((t) => t.id === id)!

describe('unlocks', () => {
  it('splits packed item texts and leaves Foundry projects out', () => {
    // Thin Man Autopsy: "Improved Medikit, Chem Grenade, Restorative Mist"; Improved Medikit is a Foundry project.
    expect(itemUnlocks(tech(46))).toEqual([
      'Chem Grenade',
      'Restorative Mist',
      'Muscle Fiber Density',
    ])
    expect(foundryFor(46).map((p) => p.name)).toEqual(['Improved Medikit'])
  })

  it('takes Foundry names from the game data, not the older names in tech.json', () => {
    expect(itemUnlocks(tech(20)).some((u) => /Base Security/.test(u))).toBe(false)
    expect(foundryFor(20).map((p) => p.name)).toContain('Security Training: Weapons')
  })

  it('every Foundry project needs a tech that exists', () => {
    const ids = new Set(defaultTechs.map((t) => t.id))
    const all = defaultTechs.flatMap((t) => foundryFor(t.id))
    expect(all).toHaveLength(46)
    for (const p of all) expect(ids.has(p.requires_tech!.id)).toBe(true)
  })
})

describe('search', () => {
  const index = searchIndex(defaultTechs)

  it('finds the tech behind an item', () => {
    const hit = search(index, 'arc thrower')[0]!
    expect(hit).toMatchObject({ label: 'Arc Thrower', kind: 'unlock', techName: 'Xenoneurology' })
  })

  it('finds the tech behind a Foundry project', () => {
    const hit = search(index, 'enhanced ballistics')[0]!
    expect(hit).toMatchObject({ kind: 'foundry', techName: 'Alien Materials' })
  })

  it('ranks names starting with the query first, techs before unlocks', () => {
    const labels = search(index, 'plasma').map((e) => e.label)
    expect(labels[0]).toBe('Plasma Weapons')
    expect(labels.indexOf('Plasma Weapons')).toBeLessThan(labels.indexOf('Plasma Carbine'))
  })
})
