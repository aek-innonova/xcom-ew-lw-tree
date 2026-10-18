// What can be sold on the grey market, how many the campaign holds, and how
// many it still needs for research and Foundry projects.
//
// Prices are the iCash of the INI's loot ItemBalance_Normal lines
// (DefaultGameCore.ini, "; Loot"). Stock is XGStorage.m_arrItems, indexed by
// Enemy Within's EItemType. No published list of those indices exists for EW,
// so each slot below was found in the person's 1,711 saves (2026-10-18):
// - Foundry projects record the items they were charged by index
//   (kOriginalCost.arrItems), and the INI names the item each needs;
// - starting a research project removes its items from stock, so a count that
//   drops by exactly the tech's item cost names that slot.
// "inferred" slots follow the INI's own item order between confirmed ones.
// Items without a slot are listed, without a stock count.

import type { FoundryProject } from './foundry'
import type { Tech } from './techs'

export type ItemGroup =
  'Corpses and wrecks' | 'Captives' | 'Artifacts' | 'Alien weapons' | 'Resources'

export interface CatalogItem {
  key: string
  name: string
  group: ItemGroup
  /** Index into XGStorage.m_arrItems, where known. */
  slot?: number
  /** How the slot is known. */
  slotFrom?: 'saves' | 'inferred'
  /** Grey market price from the INI (stock Long War 1.0). */
  price: number
  /** Finds this item in tech.json and longwar_foundry.json cost texts. */
  match?: RegExp
  /** Corpse or wreck: Xenological Remedies raises its price. */
  corpse?: boolean
}

export const CATALOG: CatalogItem[] = [
  // Corpses and wrecks (all slots confirmed from research starts and Foundry costs)
  {
    key: 'eItem_SectoidCorpse',
    name: 'Sectoid corpse',
    group: 'Corpses and wrecks',
    slot: 134,
    slotFrom: 'saves',
    price: 2,
    match: /\bSectoid corpse/i,
    corpse: true,
  },
  {
    key: 'eItem_SectoidCommanderCorpse',
    name: 'Sectoid Commander corpse',
    group: 'Corpses and wrecks',
    slot: 135,
    slotFrom: 'saves',
    price: 10,
    match: /Sectoid Commander corpse/i,
    corpse: true,
  },
  {
    key: 'eItem_FloaterCorpse',
    name: 'Floater corpse',
    group: 'Corpses and wrecks',
    slot: 136,
    slotFrom: 'saves',
    price: 3,
    match: /(?<!Heavy )Floater corpse/i,
    corpse: true,
  },
  {
    key: 'eItem_FloaterHeavyCorpse',
    name: 'Heavy Floater corpse',
    group: 'Corpses and wrecks',
    slot: 137,
    slotFrom: 'saves',
    price: 5,
    match: /Heavy Floater corpse/i,
    corpse: true,
  },
  {
    key: 'eItem_ThinManCorpse',
    name: 'Thin Man corpse',
    group: 'Corpses and wrecks',
    slot: 138,
    slotFrom: 'saves',
    price: 3,
    match: /Thin Man corpse/i,
    corpse: true,
  },
  {
    key: 'eItem_MutonCorpse',
    name: 'Muton corpse',
    group: 'Corpses and wrecks',
    slot: 139,
    slotFrom: 'saves',
    price: 4,
    match: /\bMuton corpse/i,
    corpse: true,
  },
  {
    key: 'eItem_MutonEliteCorpse',
    name: 'Muton Elite corpse',
    group: 'Corpses and wrecks',
    slot: 140,
    slotFrom: 'saves',
    price: 8,
    match: /Muton Elite corpse/i,
    corpse: true,
  },
  {
    key: 'eItem_BerserkerCorpse',
    name: 'Berserker corpse',
    group: 'Corpses and wrecks',
    slot: 141,
    slotFrom: 'saves',
    price: 5,
    match: /Berserker corpse/i,
    corpse: true,
  },
  {
    key: 'eItem_CyberdiscCorpse',
    name: 'Cyberdisc wreck',
    group: 'Corpses and wrecks',
    slot: 142,
    slotFrom: 'saves',
    price: 10,
    match: /Cyberdisc wreck/i,
    corpse: true,
  },
  {
    key: 'eItem_EtherealCorpse',
    name: 'Ethereal corpse',
    group: 'Corpses and wrecks',
    slot: 143,
    slotFrom: 'saves',
    price: 20,
    match: /Ethereal corpse/i,
    corpse: true,
  },
  {
    key: 'eItem_CryssalidCorpse',
    name: 'Chryssalid corpse',
    group: 'Corpses and wrecks',
    slot: 144,
    slotFrom: 'saves',
    price: 7,
    match: /Chryssalid corpse/i,
    corpse: true,
  },
  {
    key: 'eItem_SectopodCorpse',
    name: 'Sectopod wreck',
    group: 'Corpses and wrecks',
    slot: 146,
    slotFrom: 'saves',
    price: 15,
    match: /Sectopod wreck/i,
    corpse: true,
  },
  {
    key: 'eItem_DroneCorpse',
    name: 'Drone wreck',
    group: 'Corpses and wrecks',
    slot: 147,
    slotFrom: 'saves',
    price: 2,
    match: /Drone wreck/i,
    corpse: true,
  },
  {
    key: 'eItem_MechtoidCore',
    name: 'Mechtoid core',
    group: 'Corpses and wrecks',
    slot: 187,
    slotFrom: 'saves',
    price: 10,
    match: /Mechtoid (wreck|core)/i,
    corpse: true,
  },
  {
    key: 'eItem_SeekerCorpse',
    name: 'Seeker wreck',
    group: 'Corpses and wrecks',
    slot: 188,
    slotFrom: 'saves',
    price: 3,
    match: /Seeker wreck/i,
    corpse: true,
  },
  // Captives (interrogations need one; the council buys them too)
  {
    key: 'eItem_SectoidCaptive',
    name: 'Sectoid captive',
    group: 'Captives',
    slot: 150,
    slotFrom: 'saves',
    price: 10,
    match: /\bSectoid captive/i,
  },
  {
    key: 'eItem_SectoidCommanderCaptive',
    name: 'Sectoid Commander captive',
    group: 'Captives',
    slot: 151,
    slotFrom: 'saves',
    price: 40,
    match: /Sectoid Commander captive/i,
  },
  {
    key: 'eItem_FloaterCaptive',
    name: 'Floater captive',
    group: 'Captives',
    slot: 152,
    slotFrom: 'saves',
    price: 10,
    match: /(?<!Heavy )Floater captive/i,
  },
  {
    key: 'eItem_FloaterHeavyCaptive',
    name: 'Heavy Floater captive',
    group: 'Captives',
    slot: 153,
    slotFrom: 'inferred',
    price: 20,
    match: /Heavy Floater captive/i,
  },
  {
    key: 'eItem_ThinManCaptive',
    name: 'Thin Man captive',
    group: 'Captives',
    slot: 154,
    slotFrom: 'saves',
    price: 10,
    match: /Thin Man captive/i,
  },
  {
    key: 'eItem_MutonCaptive',
    name: 'Muton captive',
    group: 'Captives',
    slot: 155,
    slotFrom: 'saves',
    price: 10,
    match: /\bMuton captive/i,
  },
  {
    key: 'eItem_MutonEliteCaptive',
    name: 'Muton Elite captive',
    group: 'Captives',
    slot: 156,
    slotFrom: 'inferred',
    price: 30,
    match: /Muton Elite captive/i,
  },
  {
    key: 'eItem_BerserkerCaptive',
    name: 'Berserker captive',
    group: 'Captives',
    slot: 157,
    slotFrom: 'saves',
    price: 20,
    match: /Berserker captive/i,
  },
  {
    key: 'eItem_EtherealCaptive',
    name: 'Ethereal captive',
    group: 'Captives',
    slot: 158,
    slotFrom: 'inferred',
    price: 50,
    match: /Ethereal captive/i,
  },
  // Artifacts
  {
    key: 'eItem_UFOPowerSource',
    name: 'UFO Power Source',
    group: 'Artifacts',
    slot: 170,
    slotFrom: 'saves',
    price: 60,
    match: /(?<!Damaged )UFO Power Source/i,
  },
  {
    key: 'eItem_UFONavigation',
    name: 'UFO Flight Computer',
    group: 'Artifacts',
    slot: 168,
    slotFrom: 'saves',
    price: 30,
    match: /(?<!Damaged )UFO Flight Computer/i,
  },
  {
    key: 'eItem_AlienSurgery',
    name: 'Alien Surgery',
    group: 'Artifacts',
    slot: 169,
    slotFrom: 'saves',
    price: 45,
    match: /(?<!Damaged )Alien Surgery/i,
  },
  {
    key: 'eItem_AlienStasisTank',
    name: 'Alien Stasis Tank',
    group: 'Artifacts',
    slot: 167,
    slotFrom: 'saves',
    price: 15,
    match: /(?<!Damaged )Stasis Tank/i,
  },
  { key: 'eItem_AlienEntertainment', name: 'Alien Entertainment', group: 'Artifacts', price: 250 },
  { key: 'eItem_AlienFood', name: 'Alien Food', group: 'Artifacts', price: 10 },
  { key: 'eItem_UFOFusionLauncher', name: 'Fusion Core', group: 'Artifacts', price: 200 },
  {
    key: 'eItem_DamagedUFOPowerSource',
    name: 'Damaged UFO Power Source',
    group: 'Artifacts',
    price: 30,
  },
  {
    key: 'eItem_DamagedUFONavigation',
    name: 'Damaged UFO Flight Computer',
    group: 'Artifacts',
    price: 15,
  },
  { key: 'eItem_DamagedAlienFood', name: 'Damaged Alien Food', group: 'Artifacts', price: 5 },
  {
    key: 'eItem_DamagedAlienEntertainment',
    name: 'Damaged Alien Entertainment',
    group: 'Artifacts',
    price: 5,
  },
  {
    key: 'eItem_DamagedAlienStasisTank',
    name: 'Damaged Alien Stasis Tank',
    group: 'Artifacts',
    price: 5,
  },
  {
    key: 'eItem_DamagedAlienSurgery',
    name: 'Damaged Alien Surgery',
    group: 'Artifacts',
    price: 15,
  },
  // Alien weapons (research needs some for plasma)
  {
    key: 'eItem_SectoidPlasmaPistol',
    name: 'Alien pistol',
    group: 'Alien weapons',
    slot: 41,
    slotFrom: 'saves',
    price: 20,
    match: /Alien Pistol/i,
  },
  {
    key: 'eItem_PlasmaLightRifle_ThinMan',
    name: 'Alien carbine',
    group: 'Alien weapons',
    slot: 42,
    slotFrom: 'saves',
    price: 30,
    match: /Alien Carbine/i,
  },
  {
    key: 'eItem_PlasmaAssaultRifle_Muton',
    name: 'Alien rifle',
    group: 'Alien weapons',
    slot: 45,
    slotFrom: 'saves',
    price: 40,
    match: /Alien Rifle/i,
  },
  {
    key: 'eItem_HeavyPlasma_Muton',
    name: 'Alien heavy weapon',
    group: 'Alien weapons',
    price: 50,
    match: /Alien Heavy Weapon/i,
  },
  // Resources (sellable too; research and the Foundry use them)
  {
    key: 'eItem_Elerium115',
    name: 'Elerium',
    group: 'Resources',
    slot: 161,
    slotFrom: 'saves',
    price: 3,
  },
  {
    key: 'eItem_AlienAlloys',
    name: 'Alien alloys',
    group: 'Resources',
    slot: 162,
    slotFrom: 'saves',
    price: 3,
  },
  {
    key: 'eItem_WeaponFragment',
    name: 'Weapon fragments',
    group: 'Resources',
    slot: 163,
    slotFrom: 'saves',
    price: 1,
  },
  {
    key: 'eItem_Meld',
    name: 'Meld',
    group: 'Resources',
    slot: 164,
    slotFrom: 'saves',
    price: 4,
    match: /\bMeld\b/i,
  },
]

/** The leading count of a cost text: "10 Sectoid corpses" → 10, "20x Thin Man Corpse" → 20, "Outsider Shard" → 1. */
function countOf(text: string): number {
  const m = /^(\d+)x?\s/.exec(text.trim())
  return m ? Number(m[1]) : 1
}

export interface Need {
  /** Where it is needed: a tech or a Foundry project. */
  for: { kind: 'tech' | 'foundry'; id: number; name: string }
  count: number
}

/**
 * What remaining research and Foundry projects still need, per catalog item.
 * Techs already started (any progress) and Foundry projects being built have
 * paid their items. Resources count tech and Foundry costs; their item builds
 * are not included.
 */
export function needs(
  techs: Tech[],
  foundry: FoundryProject[],
  state: {
    researched: boolean[]
    progress: number[]
    foundryDone: number[]
    foundryBuilding: Set<number>
  } | null,
): Map<string, Need[]> {
  const out = new Map<string, Need[]>()
  const add = (key: string, n: Need) => out.set(key, [...(out.get(key) ?? []), n])
  for (const t of techs) {
    if (state && (state.researched[t.id] || (state.progress[t.id] ?? 0) > 0)) continue
    const f = { kind: 'tech' as const, id: t.id, name: t.name }
    if (t.cost.items) {
      for (const item of CATALOG)
        if (item.match?.test(t.cost.items)) add(item.key, { for: f, count: countOf(t.cost.items) })
    }
    if (t.cost.elerium) add('eItem_Elerium115', { for: f, count: t.cost.elerium })
    if (t.cost.alloys) add('eItem_AlienAlloys', { for: f, count: t.cost.alloys })
    if (t.cost.weapon_fragments)
      add('eItem_WeaponFragment', { for: f, count: t.cost.weapon_fragments })
  }
  for (const p of foundry) {
    if (state && (state.foundryDone[p.id] || state.foundryBuilding.has(p.id))) continue
    const f = { kind: 'foundry' as const, id: p.id, name: p.name }
    for (const text of p.cost.items) {
      for (const item of CATALOG)
        if (item.match?.test(text)) add(item.key, { for: f, count: countOf(text) })
    }
    if (p.cost.elerium) add('eItem_Elerium115', { for: f, count: p.cost.elerium })
    if (p.cost.alloys) add('eItem_AlienAlloys', { for: f, count: p.cost.alloys })
    if (p.cost.weapon_fragments)
      add('eItem_WeaponFragment', { for: f, count: p.cost.weapon_fragments })
    if (p.cost.meld) add('eItem_Meld', { for: f, count: p.cost.meld })
  }
  return out
}

/** Grey market prices from a DefaultGameCore.ini's loot lines (Itembalance_Normal, any case). */
export function parsePrices(text: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/(;|\/\/).*$/, '').trim()
    const m =
      /^ItemBalance_Normal\s*=\s*\(\s*eItem\s*=\s*(eItem_\w+)\s*,\s*iCash\s*=\s*(-?\d+)/i.exec(line)
    if (m && CATALOG.some((c) => c.key === m[1])) out.set(m[1]!, Number(m[2]))
  }
  return out
}
