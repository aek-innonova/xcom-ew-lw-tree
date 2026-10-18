// How the game's non-research checks (techs.ts Gate) read in the UI.

import type { Gate } from './techs'

/** Leaves out an item ever held when the same item is also needed in stores. */
export function withoutImplied(gates: Gate[]): Gate[] {
  const inStores = new Set(gates.flatMap((g) => (g.kind === 'in_stores' ? g.items : [])))
  return gates.filter((g) => g.kind !== 'ever_had' || !g.items.every((i) => inStores.has(i)))
}

export function gateText(g: Gate): string {
  if (g.kind === 'in_stores') return `${g.name} in stores`
  if (g.kind === 'captured') return `${/^[AEIOU]/.test(g.name) ? 'an' : 'a'} ${g.name} captured`
  return g.name
}

/**
 * Whether a gate says more than the cost already does: an item the tech uses up
 * ("10 Sectoid corpses") has to have been held anyway.
 */
export function gateShown(g: Gate, costItems: string | string[] | null): boolean {
  if (g.kind !== 'ever_had') return true
  const items = (Array.isArray(costItems) ? costItems.join(' ') : (costItems ?? '')).toLowerCase()
  // "Chryssalid Carcass" is costed as "5 Chryssalid corpses": the alien's name is enough.
  const alien = g.name.split(' ')[0]!.toLowerCase()
  return !items.includes(g.name.toLowerCase()) && !(alien !== 'alien' && items.includes(alien))
}
