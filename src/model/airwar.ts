// The air war: one interceptor against one UFO, as the game fights it
// (features/air-war.md). Ships and weapons come from data/airwar.json
// (scripts/upk_airwar.py); the rules below from XGInterceptionEngagement and
// UIInterceptionEngagement in Long War's XComStrategyGame.upk.
//
// The game decides a fight before showing it: GetCombat simulates up to 60
// seconds of shots, each with its hit, crit and damage already rolled; the
// playback then shows them, applies hits 0.3 s after each shot, applies the
// consumables, and ends the fight when the UFO is down, the interceptor is
// down, or the UFO outruns it. `fight` does the same in two steps.

import data from '../../data/airwar.json'

// --- Data -------------------------------------------------------------------

interface Stat {
  base: number
  foundry?: Record<string, number>
  option?: Record<string, number>
  /** Starting or continent bonuses (HQ.HasBonus), LWR. */
  bonus?: Record<string, number>
  per_category?: number
}
type ShipStatsData = Pick<ShipData, 'battle_speed' | 'hp' | 'armor' | 'ap'>
interface ShipData {
  id: number
  name: string
  /** Size class: small, medium, large, very_large (m_strSize…). */
  size: string
  weapons: number[]
  battle_speed: Stat
  hp: Stat
  armor: Stat
  ap: Stat
  /** LWR: the stats per difficulty (UFO hulls scale with it). */
  by_difficulty?: Record<string, ShipStatsData>
}
interface WeaponData {
  id: number
  name: string
  firing_time: Stat
  damage: Stat
  ap: Stat
  to_hit: Stat
}
export interface AirData {
  ships: ShipData[]
  weapons: WeaponData[]
  ufo_changes: {
    above_category: number
    ship: number
    weapons?: number[]
    size?: string
    stats?: Partial<ShipData>
    /** Only at this difficulty (LWR). */
    difficulty?: number
  }[]
  foundry_variants: {
    weapon?: number
    ship?: number
    foundry: number
    stats?: Partial<WeaponData>
    weapons?: number[]
  }[]
  destroy_divisor: Record<string, number>
  always_crash: number[]
  /** UFO types that are always destroyed when downed (LWR). */
  always_destroyed?: number[]
  /** A UFO shot down counts towards its analysis (LWR), not only a crash site won. */
  analysis_on_shootdown?: boolean
  /** Alien research per UFO category, and the highest category. */
  category: { per: number; max: number }
  consumables: Record<'hit' | 'dodge' | 'boost', { item: number; name: string }>
  equipment: { item: number; name: string; weapon: number }[]
}

export const air = data as unknown as AirData

export const INTERCEPTOR = 1
export const FIRESTORM = 3
/** The Wingtip Sparrowhawks' Stingray, a second weapon for every jet. */
export const STINGRAY = 2
export const UFO_TYPES = air.ships.filter((s) => s.id >= 4).map((s) => s.id)
export const SIZES = ['small', 'medium', 'large', 'very_large']
export const SIZE_LABEL: Record<string, string> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
  very_large: 'Very large',
}

/** Whose rules fight: Long War 1.0's one jet at a time, or LWR's squadrons (airwar-lwr.ts). */
export type AirRules = 'lw' | 'lwr'

/** The setting's data: its version's, Long War 1.0's when it names none. */
const dataOf = (set?: AirSetting): AirData => set?.air ?? air

/** UFO types smallest first: by size class, then by hull points (at the given setting). */
export function ufosBySize(set: AirSetting): ShipStats[] {
  return dataOf(set)
    .ships.filter((s) => s.id >= 4)
    .map((s) => ufoStats(s.id, set))
    .sort((a, b) => SIZES.indexOf(a.size) - SIZES.indexOf(b.size) || a.maxHp - b.maxHp)
}

/**
 * A UFO type's upgrades in order: the alien research at which each comes
 * (the category above which UpdateShips re-builds it, times the research per
 * category), new weapons and whether its hull improves.
 */
export function ufoUpgrades(type: number, set?: AirSetting) {
  const data = dataOf(set)
  const byAt = new Map<
    number,
    { at: number; category: number; weapons?: number[]; hull: boolean }
  >()
  for (const c of data.ufo_changes.filter((x) => x.ship === type)) {
    if (c.difficulty !== undefined && c.difficulty !== difficultyOf(set)) continue
    const at = (c.above_category + 1) * data.category.per
    const u = byAt.get(at) ?? { at, category: c.above_category + 1, hull: false }
    if (c.weapons) u.weapons = c.weapons
    if (c.stats) u.hull = true
    byAt.set(at, u)
  }
  return [...byAt.values()].sort((a, b) => a.at - b.at)
}
export const CRAFT_WEAPONS = air.equipment.map((e) => e.weapon)
export const craftWeapons = (data: AirData) => data.equipment.map((e) => e.weapon)

/** Foundry projects that change the air war (longwar_foundry.json ids). */
export const AIR_FOUNDRY = {
  armoredFighters: 12,
  sparrowhawks: 27,
  penetrator: 28,
  avionics: 31,
  countermeasures: 32,
  afterburners: 33,
  supercapacitors: 34,
  coilguns: 44,
  /** Aircraft Boosters: needed before any consumable can be used. */
  boosters: 26,
} as const

const STAT_WORD: Record<string, string> = {
  battle_speed: 'battle speed',
  hp: 'HP',
  armor: 'armor',
  ap: 'armor penetration',
  to_hit: 'aim',
  damage: 'damage',
  firing_time: 's between shots',
}
const signedNum = (n: number) => `${n > 0 ? '+' : '−'}${Math.abs(n).toLocaleString('en-US')}`
/** "Interceptor, Firestorm", or what they are when it is all of them. */
function whoOf(names: string[], all: string[], allName: string): string {
  return names.length === all.length && all.length > 1 ? allName : names.join(', ')
}

/**
 * What a Foundry project or a second wave option does in the version's air
 * war, in numbers, from its data (am note f6df1): "+1,000 HP: Interceptor,
 * Firestorm"; "+10 aim: the jets' weapons"; a weapon rebuilt ("Phoenix
 * Cannon: damage 230 (was 140)"); a second weapon carried. Rules the data
 * does not hold (LWR's rate of fire and scanners) are not in it.
 */
export function upgradeEffects(data: AirData, by: 'foundry' | 'option', id: number): string[] {
  const out: string[] = []
  const key = String(id)
  const jets = data.ships.filter((s) => s.id === INTERCEPTOR || s.id === FIRESTORM)
  const ours = new Set(craftWeapons(data))
  // Ship and weapon stats changed by it, grouped by the change.
  const groups = new Map<string, string[]>()
  const add = (what: string, name: string) => groups.set(what, [...(groups.get(what) ?? []), name])
  for (const ship of data.ships)
    for (const f of ['battle_speed', 'hp', 'armor', 'ap'] as const) {
      const d = ship[f]?.[by]?.[key]
      if (d) add(`${signedNum(d)} ${STAT_WORD[f]}`, ship.name)
    }
  for (const w of data.weapons)
    for (const f of ['to_hit', 'damage', 'ap', 'firing_time'] as const) {
      const d = w[f]?.[by]?.[key]
      if (d) add(`${signedNum(d)} ${STAT_WORD[f]}`, `${ours.has(w.id) ? '' : 'ufo:'}${w.name}`)
    }
  for (const [what, names] of groups) {
    const ufo = names.filter((n) => n.startsWith('ufo:')).map((n) => n.slice(4))
    const mine = names.filter((n) => !n.startsWith('ufo:'))
    const jetNames = mine.filter((n) => jets.some((j) => j.name === n))
    const weaponNames = mine.filter((n) => !jetNames.includes(n))
    if (jetNames.length)
      out.push(
        `${what}: ${whoOf(
          jetNames,
          jets.map((j) => j.name),
          'the jets',
        )}`,
      )
    if (weaponNames.length)
      out.push(
        `${what}: ${whoOf(
          weaponNames,
          [...ours].map((w) => weaponName(w, data)),
          'the jets’ weapons',
        )}`,
      )
    if (ufo.length) out.push(`${what}: ${ufo.length > 1 ? 'the UFOs’ weapons' : ufo[0]}`)
  }
  const carried = new Map<string, string[]>()
  if (by === 'foundry')
    for (const v of data.foundry_variants) {
      if (v.foundry !== id) continue
      if (v.weapon !== undefined && v.stats) {
        const was = data.weapons.find((w) => w.id === v.weapon)
        const changes = (['damage', 'ap', 'firing_time', 'to_hit'] as const).flatMap((f) => {
          const now = v.stats![f]?.base
          const before = was?.[f]?.base
          if (now === undefined || now === before) return []
          return f === 'firing_time'
            ? [`fires every ${now} s (was ${before} s)`]
            : [`${STAT_WORD[f]} ${now} (was ${before})`]
        })
        if (changes.length) out.push(`${weaponName(v.weapon, data)}: ${changes.join(', ')}`)
      }
      if (v.ship !== undefined && v.weapons) {
        const extra = v.weapons
          .filter((w) => w !== data.ships.find((s) => s.id === v.ship)?.weapons[0])
          .map((w) => weaponName(w, data))
          .join(', ')
        if (extra) carried.set(extra, [...(carried.get(extra) ?? []), shipName(v.ship, data)])
      }
    }
  for (const [extra, ships] of carried)
    out.push(`${ships.join(' and ')} also ${ships.length > 1 ? 'carry' : 'carries'} ${extra}`)
  return out
}

/** Second wave "Friendly Skies" (m_arrSecondWave index): XCOM aircraft aim. */
export const FRIENDLY_SKIES = 24

export const shipName = (id: number, data: AirData = air) =>
  data.ships.find((s) => s.id === id)?.name ?? `Ship ${id}`
export const weaponName = (id: number, data: AirData = air) =>
  data.weapons.find((w) => w.id === id)?.name ?? `Weapon ${id}`

// --- Settings: what the campaign has, or anything -------------------------------

export interface AirSetting {
  /** Foundry projects done. */
  foundry: Set<number>
  friendlySkies: boolean
  /** Alien research / 30, at most 32 (LWR: / 50, at most 14): how far UFOs have grown. */
  category: number
  /** The version's ships and weapons; Long War 1.0's when left out. */
  air?: AirData
  /** Game difficulty, 0–3 (LWR's UFO hulls depend on it); Classic (1) when left out. */
  difficulty?: number
  /** Starting and continent bonuses in effect (LWR's air war reads several). */
  bonuses?: ReadonlySet<number>
}

const difficultyOf = (set?: AirSetting) => set?.difficulty ?? 1

export function categoryFor(alienResearch: number, cat = air.category): number {
  return Math.max(0, Math.min(cat.max, Math.trunc(alienResearch / cat.per)))
}

function value(s: Stat | undefined, set: AirSetting): number {
  if (!s) return 0
  let v = s.base
  for (const [id, add] of Object.entries(s.foundry ?? {})) if (set.foundry.has(Number(id))) v += add
  for (const [, add] of Object.entries(s.option ?? {})) if (set.friendlySkies) v += add
  for (const [id, add] of Object.entries(s.bonus ?? {})) if (set.bonuses?.has(Number(id))) v += add
  return v + (s.per_category ?? 0) * set.category
}

export interface WeaponStats {
  id: number
  name: string
  firingTime: number
  damage: number
  ap: number
  toHit: number
}

export function weaponStats(id: number, set: AirSetting): WeaponStats {
  const data = dataOf(set)
  let w = data.weapons.find((x) => x.id === id)!
  for (const v of data.foundry_variants)
    if (v.weapon === id && set.foundry.has(v.foundry) && v.stats) w = { ...w, ...v.stats }
  return {
    id,
    name: w.name,
    firingTime: value(w.firing_time, set),
    damage: value(w.damage, set),
    ap: value(w.ap, set),
    toHit: value(w.to_hit, set),
  }
}

export interface ShipStats {
  type: number
  name: string
  size: string
  battleSpeed: number
  maxHp: number
  armor: number
  ap: number
  weapons: WeaponStats[]
}

function shipStats(ship: ShipData, weapons: number[], set: AirSetting): ShipStats {
  return {
    type: ship.id,
    name: ship.name,
    size: ship.size,
    battleSpeed: value(ship.battle_speed, set),
    maxHp: value(ship.hp, set),
    armor: value(ship.armor, set),
    ap: value(ship.ap, set),
    weapons: weapons.filter((w) => w > 0).map((w) => weaponStats(w, set)),
  }
}

/**
 * An interceptor or Firestorm; in Long War 1.0, with Wingtip Sparrowhawks it
 * carries a Stingray too (EquipWeapon; the version's data has the Foundry
 * project re-building the jet with a second weapon). LWR's jets carry one.
 */
export function craftStats(
  type: number,
  weapon: number,
  set: AirSetting,
  weapons?: number[],
): ShipStats {
  const data = dataOf(set)
  const ship = data.ships.find((s) => s.id === type)!
  const wingtip = data.foundry_variants.some(
    (v) => v.ship === type && v.weapons && set.foundry.has(v.foundry),
  )
  const list = weapons ?? (wingtip ? [weapon, STINGRAY] : [weapon])
  return shipStats(ship, list, set)
}

/**
 * A UFO as the month makes it: grown per category, re-armed past some
 * categories; in LWR its hull also by difficulty.
 */
export function ufoStats(type: number, set: AirSetting): ShipStats {
  const data = dataOf(set)
  let ship = data.ships.find((s) => s.id === type)!
  const byDifficulty = ship.by_difficulty?.[String(difficultyOf(set))]
  if (byDifficulty) ship = { ...ship, ...byDifficulty }
  let weapons = ship.weapons
  for (const c of data.ufo_changes) {
    if (c.ship !== type || set.category <= c.above_category) continue
    if (c.difficulty !== undefined && c.difficulty !== difficultyOf(set)) continue
    if (c.weapons) weapons = c.weapons
    if (c.size) ship = { ...ship, size: c.size }
    if (c.stats) ship = { ...ship, ...c.stats }
  }
  return shipStats(ship, weapons, set)
}

// --- The fight ----------------------------------------------------------------

export type Stance = 'balanced' | 'aggressive' | 'defensive'
/** From −15 to +15, the order they are shown in. */
export const STANCES: Stance[] = ['defensive', 'balanced', 'aggressive']
/** TShip.iRange of the interceptor, as the launch screen sets it. */
export const STANCE_CODE: Record<Stance, number> = { balanced: 0, aggressive: 1, defensive: 2 }
/** To-hit for both sides (UpdateWeapons). */
export const STANCE_AIM: Record<Stance, number> = { balanced: 0, aggressive: 15, defensive: -15 }

export interface Combatant extends ShipStats {
  hp: number
}

export interface Engagement {
  craft: Combatant & { kills: number }
  ufo: Combatant
  stance: Stance
  /** That UFO type's analysis is researched: XCOM damage × 1.1. */
  analysis: boolean
}

/** A seeded random source; `rand(n)` is UnrealScript's Rand: 0 … n − 1. */
export interface Rng {
  rand(n: number): number
}

export function seeded(seed: number): Rng {
  let a = seed >>> 0
  return {
    rand(n: number) {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296
      return n > 0 ? Math.floor(r * n) : 0
    },
  }
}

export interface Shot {
  time: number
  /** 0: the UFO, 1: the interceptor. */
  source: 0 | 1
  weapon: number
  /** Index in the source's weapons: the interceptor's second weapon does half. */
  slot: number
  hit: boolean
  crit: boolean
  damage: number
  toHit: number
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const f32 = Math.fround

/** Chance to hit before the roll, as UpdateWeapons computes it (5–95). */
export function toHitFor(e: Engagement, source: 0 | 1, w: WeaponStats): number {
  const kills = source === 1 ? clamp(3 * e.craft.kills, 0, 30) : 0
  return clamp(w.toHit + kills + STANCE_AIM[e.stance], 5, 95)
}

/** GetDamageMitigation: 5 % per point of armor beyond the attacker's penetration, 0–95 %. */
export function mitigation(w: WeaponStats, attacker: ShipStats, target: ShipStats): number {
  return clamp(f32(0.05 * (target.armor - (w.ap + attacker.ap))), 0, 0.95)
}

/** The critical chance before the roll: (penetration − armor) / 2, 5–25. */
export function critFor(w: WeaponStats, attacker: ShipStats, target: ShipStats): number {
  return clamp(Math.trunc((w.ap + attacker.ap - target.armor) / 2), 5, 25)
}

/** GetCombat: every shot of the first 60 seconds, rolled. */
export function rollShots(e: Engagement, rng: Rng): Shot[] {
  const ships = [e.ufo, e.craft] as const
  // Every XCOM weapon reaches 100 and every UFO weapon 101; the fight opens at
  // the longest range and closes at 5 a second, each ship stopping at its own
  // shortest range (GetPosition). Each ship fires once all its weapons reach.
  const start = Math.max(...ships.flatMap((s) => s.weapons.map(() => (s === e.ufo ? 101 : 100))))
  const shortest = [101, 100]
  const distance = [start, start]
  const cooldown = ships.map((s) => s.weapons.map(() => rng.rand(20) / 10))
  const shots: Shot[] = []
  let t = 0
  while (t < 60) {
    let next = 9999
    for (let i = 0; i < 2; i++) {
      if (ships[i]!.weapons.length === 0 || distance[i]! > shortest[i]!) continue
      for (const c of cooldown[i]!) next = Math.min(next, c)
    }
    t += next
    for (let i = 0; i < 2; i++) distance[i] = Math.max(shortest[i]!, start + f32(t * -5))
    for (let i = 0; i < 2; i++) {
      const cd = cooldown[i]!
      for (let k = 0; k < cd.length; k++) if (cd[k]! > 0) cd[k] = Math.max(0, cd[k]! - next)
      if (distance[i]! > shortest[i]!) continue
      const source = i as 0 | 1
      const me = ships[i]!
      const them = ships[1 - i]!
      me.weapons.forEach((w, k) => {
        if (cd[k]! > 0) return
        cd[k] = cd[k]! + w.firingTime
        const toHit = toHitFor(e, source, w)
        let damage = w.damage === 0 ? 0 : Math.trunc(w.damage * (1 - mitigation(w, me, them)))
        const crit = rng.rand(100) <= critFor(w, me, them)
        if (crit) damage *= 2
        damage += rng.rand(Math.trunc(damage / 2))
        if (source === 1) {
          if (e.analysis) damage = Math.trunc(damage * f32(1.1))
          damage = Math.trunc(damage * (1 + e.craft.kills / 100))
          if (k !== 0) damage = Math.trunc(damage / 2)
        }
        const hit = rng.rand(100) <= toHit
        // A miss keeps its damage only for the interceptor's own weapon, which Aim can convert.
        if (!hit && (source === 0 || k !== 0)) damage = 0
        shots.push({ time: t, source, weapon: w.id, slot: k, hit, crit, damage, toHit })
      })
    }
  }
  return shots
}

/** GetTimeUntilOutrun: seconds the interceptor keeps up; each Boost adds half its battle speed. */
export function escapeTime(e: Engagement, boosts = 0): number {
  const speed = e.craft.battleSpeed + Math.trunc(e.craft.battleSpeed * 0.5) * boosts
  return e.ufo.battleSpeed > 0 ? 30 * (speed / e.ufo.battleSpeed) : 9999
}

export type Outcome = 'crashed' | 'destroyed' | 'escaped' | 'disengaged'

export interface Actions {
  /** When each consumable is used (seconds), if it is. */
  aim?: number
  dodge?: number
  boost?: number
  /** Break off (seconds): the interceptor stops firing. */
  abort?: number
}

/** What the stance lets you use (CanUseConsumable). */
export function consumableAllowed(kind: 'aim' | 'dodge' | 'boost', stance: Stance): boolean {
  if (kind === 'aim') return stance !== 'defensive'
  if (kind === 'dodge') return stance !== 'aggressive'
  return true
}

export interface FightEvent {
  time: number
  kind: 'shot' | 'hit' | 'dodged' | 'aim' | 'dodge' | 'boost' | 'abort' | 'end'
  shot?: Shot
  /** For hits: the target and its HP after. */
  target?: 0 | 1
  hp?: number
  /** Set on "shot" events Aim turned into a hit. */
  aimed?: boolean
}

export interface FightResult {
  outcome: Outcome
  /** The interceptor went down. */
  craftLost: boolean
  ufoHp: number
  craftHp: number
  time: number
  events: FightEvent[]
}

/**
 * The playback (UIInterceptionEngagement.Playback and Tick): shots in time
 * order, skipped once either ship is down; Aim turns the next two missed shots
 * of the interceptor's own weapon into hits; a hit lands 0.3 s later, unless
 * Dodge cancels it (the next two hits on the interceptor); the UFO is gone once
 * the escape time passes. A downed UFO is destroyed rather than crashed with
 * chance overkill / k % (UpdateEngagementResult).
 */
export function playBack(e: Engagement, shots: Shot[], act: Actions, rng: Rng): FightResult {
  const hp = [e.ufo.hp, e.craft.hp]
  let aim = 0
  let dodge = 0
  let boosts = 0
  let end = escapeTime(e)
  const events: FightEvent[] = []
  type Pending = { time: number; target: 0 | 1; damage: number; shot: Shot }
  const pending: Pending[] = []
  const uses = (
    [
      ['aim', act.aim],
      ['dodge', act.dodge],
      ['boost', act.boost],
      ['abort', act.abort],
    ] as const
  )
    .filter((u): u is readonly ['aim' | 'dodge' | 'boost' | 'abort', number] => u[1] !== undefined)
    .sort((a, b) => a[1] - b[1])
  let aborted = false

  const finish = (time: number, outcome: Outcome): FightResult => {
    events.push({ time, kind: 'end' })
    return { outcome, craftLost: hp[1]! <= 0, ufoHp: hp[0]!, craftHp: hp[1]!, time, events }
  }
  const ufoDown = (time: number) => {
    const overkill = -hp[0]!
    const k = air.destroy_divisor[String(e.ufo.type)]
    const destroyed =
      !air.always_crash.includes(e.ufo.type) &&
      k !== undefined &&
      rng.rand(100) < Math.trunc(overkill / k)
    return finish(time, destroyed ? 'destroyed' : 'crashed')
  }

  // Merge shots, landing hits and the player's actions in time order.
  let si = 0
  let ui = 0
  for (;;) {
    pending.sort((a, b) => a.time - b.time)
    const tShot = shots[si]?.time ?? Infinity
    const tHit = pending[0]?.time ?? Infinity
    const tUse = uses[ui]?.[1] ?? Infinity
    const now = Math.min(tShot, tHit, tUse)
    if (now > end) return finish(end, aborted ? 'disengaged' : 'escaped')
    if (now === Infinity) return finish(end, aborted ? 'disengaged' : 'escaped')
    if (tUse === now) {
      const [kind] = uses[ui++]!
      if (kind === 'abort') {
        aborted = true
        // The break-off completes once what is in flight has landed.
        end = Math.min(end, now + 0.3)
      } else if (consumableAllowed(kind, e.stance)) {
        if (kind === 'aim') aim += 2
        if (kind === 'dodge') dodge += 2
        if (kind === 'boost') {
          boosts++
          end = Math.max(end, escapeTime(e, boosts))
        }
      } else continue
      events.push({ time: now, kind })
      continue
    }
    if (tShot === now) {
      const s = shots[si++]!
      if (hp[0]! <= 0 || hp[1]! <= 0) continue
      if (aborted && s.source === 1) continue
      let hit = s.hit
      let aimed = false
      if (aim > 0 && s.source === 1 && s.damage > 0 && !hit) {
        aim--
        hit = true
        aimed = true
      }
      events.push({ time: now, kind: 'shot', shot: s, aimed })
      if (hit)
        pending.push({ time: now + 0.3, target: s.source === 0 ? 1 : 0, damage: s.damage, shot: s })
      continue
    }
    const p = pending.shift()!
    if (p.target === 1 && dodge > 0) {
      dodge--
      events.push({ time: now, kind: 'dodged', shot: p.shot, target: 1, hp: hp[1] })
      continue
    }
    hp[p.target] = hp[p.target]! - p.damage
    events.push({ time: now, kind: 'hit', shot: p.shot, target: p.target, hp: hp[p.target] })
    if (hp[0]! <= 0) return ufoDown(now)
    if (hp[1]! <= 0) return finish(now, 'escaped')
  }
}

export function fight(e: Engagement, act: Actions, rng: Rng): FightResult {
  return playBack(e, rollShots(e, rng), act, rng)
}

// --- Odds -----------------------------------------------------------------------

export interface Odds {
  runs: number
  crashed: number
  destroyed: number
  escaped: number
  disengaged: number
  craftLost: number
  /** Mean damage done to the UFO and taken by the interceptor. */
  ufoDamage: number
  craftDamage: number
}

export interface Leg {
  craft: Combatant & { kills: number }
  stance: Stance
  /** Consumables used at the start (the best time, since each acts on what comes next). */
  use: { aim: boolean; dodge: boolean; boost: boolean }
}

export interface SequenceOdds {
  /** Per engagement: odds given it happens (the UFO still flying). */
  legs: (Odds & { reached: number })[]
  /** The UFO down by the end, crashed or destroyed. */
  down: number
  crashed: number
  destroyed: number
}

/**
 * Engagements one after another against the same UFO, which keeps its damage;
 * each leg flies only if the UFO is still up.
 */
export function sequenceOdds(
  ufo: ShipStats & { hp?: number },
  legs: Leg[],
  analysis: boolean,
  runs = 3000,
  seed = 1,
): SequenceOdds {
  const rng = seeded(seed)
  const stats = legs.map(() => ({
    reached: 0,
    crashed: 0,
    destroyed: 0,
    escaped: 0,
    disengaged: 0,
    craftLost: 0,
    ufoDamage: 0,
    craftDamage: 0,
  }))
  let crashed = 0
  let destroyed = 0
  for (let r = 0; r < runs; r++) {
    let ufoHp = ufo.hp ?? ufo.maxHp
    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i]!
      const st = stats[i]!
      st.reached++
      const e: Engagement = {
        craft: { ...leg.craft },
        ufo: { ...ufo, hp: ufoHp },
        stance: leg.stance,
        analysis,
      }
      const res = fight(
        e,
        {
          aim: leg.use.aim ? 0 : undefined,
          dodge: leg.use.dodge ? 0 : undefined,
          boost: leg.use.boost ? 0 : undefined,
        },
        rng,
      )
      st[res.outcome]++
      if (res.craftLost) st.craftLost++
      st.ufoDamage += ufoHp - Math.max(0, res.ufoHp)
      st.craftDamage += leg.craft.hp - Math.max(0, res.craftHp)
      ufoHp = res.ufoHp
      if (res.outcome === 'crashed') crashed++
      if (res.outcome === 'destroyed') destroyed++
      if (res.outcome === 'crashed' || res.outcome === 'destroyed') break
    }
  }
  return {
    legs: stats.map((s) => ({
      runs: s.reached,
      reached: s.reached / runs,
      crashed: s.crashed / Math.max(1, s.reached),
      destroyed: s.destroyed / Math.max(1, s.reached),
      escaped: s.escaped / Math.max(1, s.reached),
      disengaged: s.disengaged / Math.max(1, s.reached),
      craftLost: s.craftLost / Math.max(1, s.reached),
      ufoDamage: s.ufoDamage / Math.max(1, s.reached),
      craftDamage: s.craftDamage / Math.max(1, s.reached),
    })),
    down: (crashed + destroyed) / runs,
    crashed: crashed / runs,
    destroyed: destroyed / runs,
  }
}

// --- What each number does ---------------------------------------------------------

export interface Exchange {
  weapon: WeaponStats
  /** Chance to hit as the roll makes it (to-hit + 1 %). */
  hitChance: number
  critChance: number
  /** Damage per hit after armor, before the crit and the +0–50 % roll. */
  damage: number
  /** The armor cut. */
  mitigation: number
  /** Mean damage per hit, crits and the random part included. */
  meanDamage: number
  /** Shots before the UFO escapes (first shot 0–1.9 s in, then one per firing time). */
  shots: number
}

/** The sums behind the odds, for one side's weapons against the other. */
export function exchanges(e: Engagement, source: 0 | 1): Exchange[] {
  const me = source === 0 ? e.ufo : e.craft
  const them = source === 0 ? e.craft : e.ufo
  const window = escapeTime(e)
  return me.weapons.map((w, k) => {
    const mit = mitigation(w, me, them)
    let damage = w.damage === 0 ? 0 : Math.trunc(w.damage * (1 - mit))
    let factor = 1
    if (source === 1) {
      if (e.analysis) factor *= 1.1
      factor *= 1 + e.craft.kills / 100
      if (k !== 0) factor /= 2
    }
    damage = Math.trunc(damage * factor)
    const crit = (critFor(w, me, them) + 1) / 100
    return {
      weapon: w,
      hitChance: Math.min(1, (toHitFor(e, source, w) + 1) / 100),
      critChance: crit,
      damage,
      mitigation: mit,
      meanDamage: damage * (1 + crit) * 1.25,
      shots: Math.max(0, Math.floor((window - 0.95) / w.firingTime) + 1),
    }
  })
}

// --- From a save -------------------------------------------------------------------

export interface AirCampaign {
  difficulty?: number
  foundryHistory: number[]
  secondWave: number[]
  researched: boolean[]
  recap: Record<string, number>
  stock: number[]
}

/**
 * What a campaign has: its Foundry projects, Friendly Skies, the UFOs'
 * category (recap "Days"), its difficulty; bonuses come from the caller (the
 * store works out which are in effect).
 */
export function campaignSetting(
  c: AirCampaign,
  data: AirData = air,
  bonuses?: ReadonlySet<number>,
): AirSetting {
  return {
    foundry: new Set(c.foundryHistory.flatMap((v, id) => (v && id > 0 ? [id] : []))),
    friendlySkies: (c.secondWave[FRIENDLY_SKIES] ?? 0) !== 0,
    category: categoryFor(c.recap.Days ?? 0, data.category),
    air: data,
    difficulty: c.difficulty,
    bonuses,
  }
}

/** LWR's analyses are by size class (XGInterceptionEngagement.UpdateWeapons). */
const LWR_ANALYSIS: Record<number, number> = Object.fromEntries(
  (
    [
      [61, [4, 10]],
      [62, [5, 11, 9]],
      [63, [6, 12, 7, 13]],
      [64, [8, 14]],
    ] as const
  ).flatMap(([tech, types]) => types.map((t) => [t, tech])),
)
/**
 * The UFO analysis tech for a UFO type: Long War 1.0's 61–71 are one per type
 * (type + 57); LWR's 61–64 one per size class.
 */
export const analysisTech = (ufoType: number, rules: AirRules = 'lw') =>
  rules === 'lwr' ? (LWR_ANALYSIS[ufoType] ?? 0) : ufoType + 57

/** Consumables the campaign can use: Aircraft Boosters done, and how many in stores. */
export function consumablesHeld(
  c: AirCampaign,
  data: AirData = air,
): Record<'aim' | 'dodge' | 'boost', number> {
  const boosters = (c.foundryHistory[AIR_FOUNDRY.boosters] ?? 0) !== 0
  const n = (item: number) => (boosters ? (c.stock[item] ?? 0) : 0)
  return {
    aim: n(data.consumables.hit.item),
    dodge: n(data.consumables.dodge.item),
    boost: n(data.consumables.boost.item),
  }
}

// --- Odds in bulk (for the worker, airwar.worker.ts) -------------------------------

export interface OddsJob {
  legs: Leg[]
  runs: number
  seed: number
}
export interface OddsRequest {
  id: number
  ufo: ShipStats & { hp: number }
  analysis: boolean
  jobs: OddsJob[]
}
export interface OddsReply {
  id: number
  results: SequenceOdds[]
}

export function runJobs(req: OddsRequest): OddsReply {
  return {
    id: req.id,
    results: req.jobs.map((j) => sequenceOdds(req.ufo, j.legs, req.analysis, j.runs, j.seed)),
  }
}
