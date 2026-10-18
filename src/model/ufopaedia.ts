// Links to UFOpaedia. The wiki has no page per Long War tech, Foundry project or
// item, only category pages with a section each (see scripts/ufopaedia_links.py),
// so a tech links to its category's section of "Research (Long War)", a Foundry
// project to its category's section of "Foundry (Long War)", and an unlock to
// wherever the wiki's own Research table links it (ufopaedia.json).

import data from '../../ufopaedia.json'
import type { FoundryProject } from './foundry'
import type { Tech } from './techs'

const BASE = 'https://www.ufopaedia.org'

/** Our research categories to the sections of the wiki's Research (Long War) page. */
const RESEARCH_SECTIONS: Record<string, string> = {
  Xenology: 'Xenology',
  'Materials & Aerospace': 'Materials_and_Aerospace',
  'Armor & MECs': 'Armor,_MECs,_and_SHIVs',
  'Laser & Gauss': 'Laser_and_Gauss_Weapons',
  Plasma: 'Plasma_Weapons',
  Autopsies: 'Alien_Autopsies',
  Interrogations: 'Alien_Interrogations',
  'UFO Analysis': 'UFO_Analysis',
}

const items = new Map(
  Object.entries((data as { items: Record<string, string> }).items).map(([k, v]) => [
    k.toLowerCase(),
    v,
  ]),
)

export function techLink(tech: Tech): string {
  const section = RESEARCH_SECTIONS[tech.category]
  return `${BASE}/Research_(Long_War)${section ? `#${section}` : ''}`
}

export function foundryLink(p: FoundryProject): string {
  return `${BASE}/Foundry_(Long_War)#${p.category.replace(/ /g, '_')}`
}

/** The wiki section an unlock is linked to, if the wiki links it. */
export function itemLink(name: string): string | undefined {
  const href = items.get(name.toLowerCase())
  return href ? BASE + href : undefined
}
