// What a tech unlocks: items and abilities from tech.json, and Foundry projects
// from longwar_foundry.json (taken from the game's files, so it is the
// authority on project names and which tech each needs; tech.json lists some
// of them as plain unlocks, and two under older names).

import { defaultFoundry, type FoundryProject } from './foundry'
import type { Tech } from './techs'

export const foundryProjects = defaultFoundry

const FOUNDRY_SUFFIX = /\s*\(Foundry\)$/

/** Foundry projects that need this tech. */
export function foundryFor(techId: number): FoundryProject[] {
  return foundryProjects.filter((p) => p.requires_tech?.id === techId)
}

/**
 * The tech's unlocks other than Foundry projects, one entry per item (tech.json
 * packs several into one text: "Improved Medikit, Chem Grenade, Restorative Mist").
 */
export function itemUnlocks(tech: Tech): string[] {
  const foundryNames = new Set(foundryFor(tech.id).map((p) => p.name.toLowerCase()))
  return tech.unlocks
    .filter((u) => !FOUNDRY_SUFFIX.test(u))
    .flatMap((u) => u.split(/,\s+/))
    .map((u) => u.trim())
    .filter((u) => u && !foundryNames.has(u.toLowerCase()))
}

export type SearchKind = 'tech' | 'unlock' | 'foundry'

export interface SearchEntry {
  label: string
  kind: SearchKind
  techId: number
  techName: string
  /** For Foundry hits: the project. */
  foundryId?: number
}

export function searchIndex(techs: Tech[]): SearchEntry[] {
  const out: SearchEntry[] = []
  for (const t of techs) {
    out.push({ label: t.name, kind: 'tech', techId: t.id, techName: t.name })
    for (const u of itemUnlocks(t))
      out.push({ label: u, kind: 'unlock', techId: t.id, techName: t.name })
    for (const p of foundryFor(t.id))
      out.push({ label: p.name, kind: 'foundry', techId: t.id, techName: t.name, foundryId: p.id })
  }
  return out
}

const KIND_ORDER: Record<SearchKind, number> = { tech: 0, unlock: 1, foundry: 2 }

/** Matches by substring; names that start with the query first, techs before unlocks before Foundry. */
export function search(index: SearchEntry[], query: string, limit = 10): SearchEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return index
    .filter((e) => e.label.toLowerCase().includes(q))
    .sort(
      (a, b) =>
        Number(!a.label.toLowerCase().startsWith(q)) -
          Number(!b.label.toLowerCase().startsWith(q)) ||
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        a.label.localeCompare(b.label),
    )
    .slice(0, limit)
}
