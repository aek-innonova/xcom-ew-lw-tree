import { describe, expect, it } from 'vitest'
import { foundryLink, itemLink, techLink } from '../ufopaedia'
import { categories, defaultTechs } from '../techs'
import { defaultFoundry, foundryCategories } from '../foundry'

describe('UFOpaedia links', () => {
  it('every research category has a section on the wiki page', () => {
    for (const c of categories) {
      const t = defaultTechs.find((x) => x.category === c)!
      expect(techLink(t)).toMatch(/Research_\(Long_War\)#\S+$/)
    }
  })

  it('Foundry projects link to their category section', () => {
    expect(foundryCategories).toHaveLength(8)
    expect(foundryLink(defaultFoundry.find((p) => p.id === 1)!)).toBe(
      'https://www.ufopaedia.org/Foundry_(Long_War)#General_Weapon_Upgrades',
    )
  })

  it('unlocks link where the wiki links them; descriptions do not', () => {
    expect(itemLink('Combat Stims')).toBe(
      'https://www.ufopaedia.org/Equipment_(Long_War)#Utility_devices',
    )
    expect(itemLink('+20% salvage')).toBeUndefined()
  })
})
