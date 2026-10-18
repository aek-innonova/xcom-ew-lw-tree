// Reads the [TechBalance] lines of a Long War DefaultGameCore.ini.

import type { Tech } from './techs'

export interface TechBalance {
  days: number
  alloys: number
  elerium: number
  fragments: number
  items: number
}

export interface IniTechBalance {
  /** By tech id. */
  balance: Map<number, TechBalance>
  /** TechBalance lines whose eTech matched no tech. */
  unmatched: string[]
}

const FIELDS: Record<string, keyof TechBalance> = {
  iTime: 'days',
  iAlloys: 'alloys',
  iElerium: 'elerium',
  iNumFragments: 'fragments',
  iNumItems: 'items',
}

/**
 * The INI names a tech by enum name (eTech_Xenobiology) or by number (eTech=72).
 * Long War's extra techs share the enum name eTech_Placeholder (60 + n), and
 * the INI uses that name alone for Alien Biocybernetics (60).
 */
function techResolver(techs: Tech[]): (key: string) => number | undefined {
  const byName = new Map<string, number>()
  for (const t of techs) {
    if (typeof t.config_key === 'string' && !byName.has(t.config_key))
      byName.set(t.config_key, t.id)
    if (!byName.has(t.enum)) byName.set(t.enum, t.id)
  }
  const ids = new Set(techs.map((t) => t.id))
  return (key) => {
    if (/^\d+$/.test(key)) {
      const id = Number(key)
      return ids.has(id) ? id : undefined
    }
    return byName.get(key)
  }
}

export function parseTechBalance(text: string, techs: Tech[]): IniTechBalance {
  const resolve = techResolver(techs)
  const balance = new Map<number, TechBalance>()
  const unmatched: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, '').trim()
    const m = /^TechBalance\s*=\s*\((.*)\)\s*$/.exec(line)
    if (!m) continue
    const fields = new Map<string, string>()
    for (const part of m[1]!.split(',')) {
      const [k, v] = part.split('=').map((s) => s.trim())
      if (k && v !== undefined) fields.set(k, v)
    }
    const key = fields.get('eTech')
    const id = key === undefined ? undefined : resolve(key)
    if (id === undefined) {
      unmatched.push(raw.trim())
      continue
    }
    const b: TechBalance = { days: 0, alloys: 0, elerium: 0, fragments: 0, items: 0 }
    for (const [field, prop] of Object.entries(FIELDS)) {
      const v = fields.get(field)
      if (v !== undefined && /^-?\d+$/.test(v)) b[prop] = Number(v)
    }
    balance.set(id, b)
  }
  return { balance, unmatched }
}

/** Replaces the leading count in an item text: ("5 Sectoid corpses", 10) → "10 Sectoid corpses". */
function withCount(items: string | null, count: number): string | null {
  if (items === null) return null
  return /^\d+ /.test(items) ? items.replace(/^\d+/, String(count)) : items
}

export interface AppliedIni {
  techs: Tech[]
  /** Ids of techs whose cost or time differs from tech.json. */
  changed: number[]
  /** Techs the INI had no line for. */
  missing: number[]
}

/**
 * `perDay`: the research points one INI day is worth in this version
 * (XGTechTree.TechCost: Long War 1.0 720, LWR 240); base days are kept in
 * Long War 1.0's 720-point days so both versions share one scale.
 */
export function applyTechBalance(techs: Tech[], ini: IniTechBalance, perDay = 720): AppliedIni {
  const changed: number[] = []
  const missing: number[] = []
  const out = techs.map((t) => {
    const b = ini.balance.get(t.id)
    if (!b) {
      missing.push(t.id)
      return t
    }
    const next: Tech = {
      ...t,
      base_days: Math.round(((b.days * perDay) / 720) * 100) / 100,
      cost: {
        alloys: b.alloys,
        elerium: b.elerium,
        weapon_fragments: b.fragments,
        items: withCount(t.cost.items, b.items),
      },
    }
    if (
      next.base_days !== t.base_days ||
      next.cost.alloys !== t.cost.alloys ||
      next.cost.elerium !== t.cost.elerium ||
      next.cost.weapon_fragments !== t.cost.weapon_fragments ||
      next.cost.items !== t.cost.items
    ) {
      changed.push(t.id)
    }
    return next
  })
  return { techs: out, changed, missing }
}
