// LWR's air war: a squadron of up to five jets against one UFO
// (features/lw-rebalanced.md, "LWR's air war"). Ships and weapons are
// data/lwr/airwar.json through airwar.ts (craftStats, ufoStats with LWR's
// data); the rules below are LWR's XGInterceptionEngagement,
// UIInterceptionEngagement and XGInterception.
//
// As in Long War 1.0 the fight is rolled before it is shown (GetCombat, here
// 120 seconds of shots), but LWR's playback decides more: it sends some of
// the UFO's shots to wingmen and rolls every one of them again against the
// stance of the jet it goes to, rolls the criticals, and lets jets leave.
// `fightSquadron` does the same in two steps.

import lwrAir from '../../data/lwr/airwar.json'
import {
  mitigation,
  seeded,
  type Combatant,
  type Outcome,
  type Rng,
  type Stance,
  type WeaponStats,
} from './airwar'

/** Starting and continent bonuses LWR's air war reads (HQ.HasBonus). */
export const LWR_BONUS = {
  airSuperiority: 2,
  jaiJawan: 11,
  theirFinestHour: 26,
  bornToFly: 40,
  daredevils: 45,
} as const

/** Foundry projects in LWR's air war beyond the ships' and weapons' own stats. */
export const LWR_FOUNDRY = {
  armoredFighters: 12,
  boosters: 26,
  coolingCoils: 28,
  avionics: 31,
  countermeasures: 32,
  afterburners: 33,
  supercapacitors: 34,
  tracking: 35,
  coilguns: 44,
  scanners: 45,
} as const

const FIRESTORM = 3
/** The playback lasts as long as GetCombat rolled: 120 seconds. */
export const COMBAT_SECONDS = 120
/** When the odds use a consumable: as early as the game lets you (not at 0). */
export const USE_AT = 0.05

export interface Jet extends Combatant {
  kills: number
  stance: Stance
}

export interface SquadronFight {
  ufo: Combatant
  /** In the order the squadron was put together. */
  jets: Jet[]
  /** The UFO's size-class analysis is researched: the jets fire 30 % faster. */
  analysis: boolean
  bonuses: number[]
  foundry: number[]
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const f32 = Math.fround
const has = (f: SquadronFight, bonus: number) => f.bonuses.includes(bonus)

/**
 * How many jets may fly together (XGInterception.ToggleInterceptor): two, three
 * once one of them has 8 kills, four at 16, five at 32.
 */
export function squadronSize(kills: number[]): number {
  const best = Math.max(0, ...kills)
  return best >= 32 ? 5 : best >= 16 ? 4 : best >= 8 ? 3 : 2
}

/** A jet under half its hull points cannot launch (ToggleInterceptor). */
export const canLaunch = (j: { hp: number; maxHp: number }) => j.hp / j.maxHp >= 0.5

const damaged = (j: Combatant) => j.hp !== j.maxHp

/** Medium UFOs are 1.5 times as easy to hit, large and very large twice (UpdateWeapons). */
export function sizeFactor(ufoType: number): number {
  if ([5, 9, 11, 15].includes(ufoType)) return 1.5
  if ([6, 7, 8, 12, 13, 14].includes(ufoType)) return 2
  return 1
}

/** A jet's chance to hit before the roll (hit when Rand(100) is below it). */
export function jetToHit(f: SquadronFight, jet: Jet, w: WeaponStats): number {
  const perKill = has(f, LWR_BONUS.bornToFly) ? 5 : 1
  let i = w.toHit + clamp(Math.trunc((perKill * jet.kills) / 4), 0, 100)
  if (jet.stance === 'aggressive') i += 10
  if (jet.stance === 'defensive') i -= 10
  if (damaged(jet) && !has(f, LWR_BONUS.theirFinestHour)) i -= 10
  i = Math.trunc(i * sizeFactor(f.ufo.type))
  return clamp(i, 0, 100)
}

/** The UFO's chance to hit a jet, by that jet's stance (the playback's roll). */
export function ufoToHit(w: WeaponStats, stance: Stance): number {
  if (stance === 'defensive') return Math.trunc((w.toHit * 2) / 3)
  if (stance === 'aggressive') return Math.trunc((w.toHit * 3) / 2)
  return w.toHit
}

/** What a jet's firing time is divided by (UpdateWeapons). */
export function fireRate(f: SquadronFight, jet: Combatant): number {
  let r = 1
  if (has(f, LWR_BONUS.jaiJawan)) r *= 1.35
  if (jet.type === FIRESTORM) r *= 1.5
  if (has(f, LWR_BONUS.airSuperiority)) r *= 1.2
  if (f.foundry.includes(LWR_FOUNDRY.coolingCoils)) r *= 1.3
  if (f.analysis) r *= 1.3
  return r
}

/** The critical chance: (penetration − armor) × 2, + 25 for the jets with Born to Fly or Daredevils; 1–100. */
export function critChance(
  f: SquadronFight,
  w: WeaponStats,
  attacker: Combatant,
  target: Combatant,
  targetIsUfo: boolean,
): number {
  const pilots =
    targetIsUfo && (has(f, LWR_BONUS.bornToFly) || has(f, LWR_BONUS.daredevils)) ? 25 : 0
  return clamp(pilots + (w.ap + attacker.ap - target.armor) * 2, 1, 100)
}

/** GetShipDamage: the weapon's damage less the armor's share. */
const baseDamage = (w: WeaponStats, attacker: Combatant, target: Combatant) =>
  w.damage === 0 ? 0 : w.damage * (1 - mitigation(w, attacker, target))

/**
 * GetTimeUntilOutrun: 30 × the squadron's average battle speed ÷ the UFO's.
 * A jet launched damaged counts at 0.8 (not with Their Finest Hour); Boost
 * adds half; UFO Scanners, Their Finest Hour and UFO Tracking multiply.
 */
export function escapeTime(f: SquadronFight, boost = false): number {
  let sum = 0
  for (const j of f.jets)
    sum = Math.trunc(
      sum + j.battleSpeed * (damaged(j) && !has(f, LWR_BONUS.theirFinestHour) ? 0.8 : 1),
    )
  const average = Math.trunc(sum / Math.max(1, f.jets.length))
  let speed = average + (boost ? Math.trunc(average * 0.5) : 0)
  if (f.foundry.includes(LWR_FOUNDRY.scanners)) speed *= 1.1
  if (has(f, LWR_BONUS.theirFinestHour)) speed *= 1.3
  if (f.foundry.includes(LWR_FOUNDRY.tracking)) speed *= 1.1
  return f.ufo.battleSpeed !== 0 ? 30 * (speed / f.ufo.battleSpeed) : speed
}

/**
 * Which jet the UFO goes for (XGInterceptionEngagement.Init): each scores 2,
 * plus one per weapon when aggressive, minus one when defensive; the first
 * with the highest score. If all score the same a random one is moved to the
 * front and leads.
 *
 * Returns the fight order (indices into `jets`) and the lead's position in it.
 */
export function takeLead(jets: Jet[], rng: Rng): { order: number[]; lead: number } {
  const score = jets.map(
    (j) =>
      2 + j.weapons.length * (j.stance === 'aggressive' ? 1 : j.stance === 'defensive' ? -1 : 0),
  )
  const order = jets.map((_, i) => i)
  if (Math.min(...score) === Math.max(...score)) {
    const r = rng.rand(jets.length)
    order.splice(r, 1)
    order.unshift(r)
    return { order, lead: 0 }
  }
  return { order, lead: score.indexOf(Math.max(...score)) }
}

export interface SquadronShot {
  time: number
  /** Ship in the fight: 0 the UFO, 1 … the jets in fight order. */
  source: number
  /** The ship it was rolled against. */
  target: number
  weapon: number
  slot: number
  /** The roll; for the UFO's shots the playback rolls again. */
  hit: boolean
  /** After armor and the ± 20 %, before a critical. */
  damage: number
  toHit: number
}

export interface Rolled {
  /** Fight order: ship i (1 …) is jets[order[i − 1]]. */
  order: number[]
  /** The UFO's target, as a ship number (1 …). */
  lead: number
  shots: SquadronShot[]
  /** Hull points as the roll left them (the playback still reads these). */
  simHp: number[]
}

/** GetCombat: 120 seconds of shots, rolled. */
export function rollSquadron(f: SquadronFight, rng: Rng): Rolled {
  const { order, lead: leadAt } = takeLead(f.jets, rng)
  const lead = leadAt + 1
  const ships: Combatant[] = [f.ufo, ...order.map((i) => f.jets[i]!)]
  const jetOf = (i: number) => f.jets[order[i - 1]!]!
  // Every XCOM weapon reaches 100 and every UFO weapon 101; the fight opens at
  // the longest and closes at 5 a second, each ship stopping at its shortest.
  const reach = (i: number) => (i === 0 ? 101 : 100)
  const start = Math.max(0, ...ships.flatMap((s, i) => s.weapons.map(() => reach(i))))
  const distance = ships.map(() => start)
  const cooldown = ships.map((s) => s.weapons.map(() => rng.rand(20) / 10))
  const simHp = ships.map((s) => s.hp)
  const rates = ships.map((s, i) => (i === 0 ? 1 : fireRate(f, s)))
  const shots: SquadronShot[] = []
  // No playback outlasts the escape with a Boost. After it only the UFO's
  // shots still count, for the hull points they leave (the playback reads
  // them); the jets' are not rolled.
  const horizon = escapeTime(f, true) + 1
  let t = 0
  while (t < COMBAT_SECONDS) {
    const late = t > horizon
    let next = 9999
    ships.forEach((s, i) => {
      if (late && i > 0) return
      if (s.weapons.length && distance[i]! <= reach(i))
        for (const c of cooldown[i]!) next = Math.min(next, c)
    })
    t += next
    const fired: SquadronShot[] = []
    ships.forEach((me, i) => {
      distance[i] = Math.max(reach(i), start + f32(t * -5))
      const cd = cooldown[i]!
      for (let k = 0; k < cd.length; k++) if (cd[k]! > 0) cd[k] = Math.max(0, cd[k]! - next)
      if (distance[i]! > reach(i) || (late && i > 0)) return
      me.weapons.forEach((w, k) => {
        if (cd[k]! > 0) return
        cd[k] = (cd[k]! + w.firingTime) / rates[i]!
        const target = i > 0 ? 0 : simHp[lead]! <= 0 || ships[lead]!.hp <= 0 ? 1 : lead
        const toHit = i === 0 ? clamp(w.toHit, 0, 100) : jetToHit(f, jetOf(i), w)
        const base = Math.trunc(baseDamage(w, me, ships[target]!))
        const damage = Math.trunc((4 * base) / 5) + rng.rand(Math.trunc((2 * base) / 5))
        const hit = rng.rand(100) < toHit
        fired.push({ time: t, source: i, target, weapon: w.id, slot: k, hit, damage, toHit })
      })
    })
    for (const x of fired) if (x.hit) simHp[x.target] = simHp[x.target]! - x.damage
    if (!late) shots.push(...fired)
  }
  return { order, lead, shots, simHp }
}

export type Use = 'aim' | 'dodge' | 'boost'

/**
 * What the first jet's stance lets the squadron use (CanUseConsumable): Aim
 * only aggressive, Boost only balanced, Dodge only defensive.
 */
export function consumableAllowed(kind: Use, firstStance: Stance): boolean {
  if (kind === 'aim') return firstStance === 'aggressive'
  if (kind === 'boost') return firstStance === 'balanced'
  return firstStance === 'defensive'
}
export const CONSUMABLE_STANCE: Record<Use, Stance> = {
  aim: 'aggressive',
  boost: 'balanced',
  dodge: 'defensive',
}

export interface SquadronActions {
  aim?: number
  dodge?: number
  boost?: number
  /** Each time the player breaks off, the lead leaves (TryAbort). */
  aborts?: number[]
}

export interface SquadronEvent {
  time: number
  kind:
    | 'shot'
    | 'hit'
    | 'dodged'
    | 'aim'
    | 'dodge'
    | 'boost'
    | 'leaves'
    | 'lead'
    | 'breaking-off'
    | 'end'
  /** −1 the UFO, else the jet (index in SquadronFight.jets). */
  from?: number
  to?: number
  weapon?: number
  hit?: boolean
  /** Aim turned the miss into a hit. */
  aimed?: boolean
  crit?: boolean
  damage?: number
  toHit?: number
  /** Hull points left after a hit. */
  hp?: number
  /** For "leaves": why. */
  why?: 'damaged' | 'down' | 'ordered'
}

export interface SquadronResult {
  outcome: Outcome
  ufoHp: number
  /** Per jet, in SquadronFight.jets order. */
  hp: number[]
  lost: boolean[]
  /** Damage each jet did to the UFO. */
  dealt: number[]
  time: number
  /** The UFO's first target (index in SquadronFight.jets). */
  firstLead: number
  events: SquadronEvent[]
}

/**
 * The playback (UIInterceptionEngagement.Playback and Tick, TryAbort,
 * XGInterceptionEngagement.UpdateEngagementResult), shot by shot:
 *
 * - The UFO shoots at its target, the lead; each shot has a 49 % chance to go
 *   to a wingman behind the lead instead, drawn by stance (defensive 1,
 *   balanced 2, aggressive 3). Wherever it goes it is rolled again against
 *   that jet's stance (ufoToHit).
 * - Aim turns the lead's next two misses into hits; Dodge cancels the next
 *   two hits on any jet. A hit lands 0.3 s after the shot; a critical (× 1.5)
 *   is rolled for it here.
 * - A wingman under a quarter of its hull leaves. When the lead goes down or
 *   leaves, the next jet still flying leads, if the game sees one still
 *   chasing (AnyInterceptorsChasing); otherwise the UFO has escaped. With
 *   none left the squadron breaks off.
 * - The UFO is gone once the escape time passes; down, it is destroyed if it
 *   is a Fighter or a Destroyer and crashes otherwise.
 *
 * One quirk is kept as the game has it: the wingman draw stores its list in
 * the array that held the rolled hull points, which AnyInterceptorsChasing
 * reads afterwards; so whether a wingman "is still chasing" when the lead
 * goes depends on the last draw (UnrealScript reads past an array's end as 0,
 * which counts as shot down).
 */
export function playSquadron(
  f: SquadronFight,
  rolled: Rolled,
  act: SquadronActions,
  rng: Rng,
): SquadronResult {
  const { order, shots } = rolled
  const n = order.length
  const ships: Combatant[] = [f.ufo, ...order.map((i) => f.jets[i]!)]
  const stance = (ship: number) => f.jets[order[ship - 1]!]!.stance
  const jet = (ship: number) => (ship === 0 ? -1 : order[ship - 1]!)
  const hp = ships.map((s) => s.hp)
  const out = ships.map(() => false)
  const dealt = ships.map(() => 0)
  let lead = rolled.lead
  /** m_aiShipHP: the rolled hull points, then the last wingman draw. */
  let shipList: number[] = [...rolled.simHp]
  let aim = 0
  let dodge = 0
  let boost = false
  let breakingOff = -1
  const used = new Set<Use>()
  const events: SquadronEvent[] = []
  type Landing = { time: number; ship: number; damage: number; from: number; crit: boolean }
  const landing: Landing[] = []
  const firstStance = stance(1)

  const isDead = (i: number) => (shipList[i] ?? 0) <= 0 || hp[i]! <= 0
  const anyChasing = () => {
    for (let i = 1; i <= n; i++) if (!isDead(i) && !out[i]) return true
    return false
  }
  const tryAbort = (time: number, why: 'down' | 'damaged' | 'ordered') => {
    if (breakingOff >= 0) return
    if (!out[lead]) events.push({ time, kind: 'leaves', from: jet(lead), why })
    out[lead] = true
    while (lead < n) {
      lead++
      if (out[lead]) continue
      aim = 0
      dodge = 0
      events.push({ time, kind: 'lead', from: jet(lead) })
      return
    }
    breakingOff = time
    events.push({ time, kind: 'breaking-off' })
  }
  const finish = (time: number, outcome: Outcome): SquadronResult => {
    events.push({ time, kind: 'end' })
    const byJet = <T>(xs: T[]) => {
      const r: T[] = []
      for (let i = 1; i <= n; i++) r[order[i - 1]!] = xs[i]!
      return r
    }
    return {
      outcome,
      ufoHp: hp[0]!,
      hp: byJet(hp),
      lost: byJet(hp.map((h) => h <= 0)),
      dealt: byJet(dealt),
      time,
      firstLead: jet(rolled.lead),
      events,
    }
  }
  const ufoDown = (time: number) =>
    finish(
      time,
      (lwrAir.always_destroyed as number[]).includes(f.ufo.type) ? 'destroyed' : 'crashed',
    )

  const uses = (
    [
      ['aim', act.aim],
      ['dodge', act.dodge],
      ['boost', act.boost],
      ...(act.aborts ?? []).map((t) => ['abort', t] as const),
    ] as const
  )
    .filter((u): u is readonly [Use | 'abort', number] => u[1] !== undefined)
    .sort((a, b) => a[1] - b[1])
  // The jets' shots are played before the UFO's at the same moment.
  const queue = [...shots].sort(
    (a, b) => a.time - b.time || (a.source === 0 ? 1 : 0) - (b.source === 0 ? 1 : 0),
  )

  let si = 0
  let ui = 0
  for (;;) {
    landing.sort((a, b) => a.time - b.time)
    // The UFO's escape is checked before a break-off completes (Tick).
    const escape = escapeTime(f, boost)
    const disengage = breakingOff >= 0 ? breakingOff + 0.3 : Infinity
    const end = Math.min(escape, disengage)
    const tUse = uses[ui]?.[1] ?? Infinity
    const tLand = landing[0]?.time ?? Infinity
    const tShot = queue[si]?.time ?? Infinity
    const now = Math.min(tUse, tLand, tShot)
    if (now > end || now === Infinity)
      return finish(end, disengage < escape ? 'disengaged' : 'escaped')

    if (tUse === now) {
      const [kind] = uses[ui++]!
      if (kind === 'abort') {
        tryAbort(now, 'ordered')
        continue
      }
      if (now <= 0 || breakingOff >= 0 || used.has(kind)) continue
      if (!consumableAllowed(kind, firstStance)) continue
      used.add(kind)
      if (kind === 'aim') aim += 2
      if (kind === 'dodge') dodge += 2
      // Aim and Dodge each bring a Boost with them (ActivateAimAbility, ActivateDodgeAbility).
      boost = true
      events.push({ time: now, kind })
      continue
    }

    if (tLand === now) {
      const l = landing.shift()!
      if (l.ship > 0 && dodge > 0) {
        dodge--
        events.push({
          time: now,
          kind: 'dodged',
          from: jet(l.from),
          to: jet(l.ship),
          damage: l.damage,
        })
        continue
      }
      if (l.ship === 0) {
        if (hp[0]! <= 0) continue
        hp[0] = hp[0]! - l.damage
        dealt[l.from] = dealt[l.from]! + l.damage
        events.push({
          time: now,
          kind: 'hit',
          from: jet(l.from),
          to: -1,
          damage: l.damage,
          crit: l.crit,
          hp: hp[0],
        })
        if (hp[0]! <= 0) return ufoDown(now)
        continue
      }
      const s = l.ship
      if (out[s]) continue
      hp[s] = hp[s]! - l.damage
      events.push({
        time: now,
        kind: 'hit',
        from: -1,
        to: jet(s),
        damage: l.damage,
        crit: l.crit,
        hp: hp[s],
      })
      if (hp[s]! <= 0) {
        out[s] = true
        events.push({ time: now, kind: 'leaves', from: jet(s), why: 'down' })
      } else if (hp[s]! / ships[s]!.maxHp < 0.25 && s > lead) {
        // A wingman this badly hit turns for home; the lead flies on.
        out[s] = true
        events.push({ time: now, kind: 'leaves', from: jet(s), why: 'damaged' })
      }
      if (s === lead && out[s]) {
        if (!anyChasing()) return finish(now, 'escaped')
        tryAbort(now, 'down')
      }
      // Every jet down: nobody chases (UpdateEngagementResult).
      if (hp.slice(1).every((h) => h <= 0)) return finish(now, 'escaped')
      continue
    }

    const x = queue[si++]!
    const src = x.source
    if (src > 0 && out[src]) continue
    let target = src === 0 ? lead : 0
    if (target > 0 && out[target]) continue
    if (hp[src]! <= 0 || hp[target]! <= 0) continue
    if (src > 0 && breakingOff >= 0) continue
    const w = ships[src]!.weapons[x.slot]!
    let hit = x.hit
    let aimed = false
    let damage = x.damage
    if (src > 0 && aim > 0 && src === lead && damage > 0 && !hit) {
      aim--
      hit = aimed = true
    }
    if (src === 0) {
      if (rng.rand(100) > 50) {
        const list: number[] = []
        for (let k = lead + 1; k <= n; k++) {
          if (out[k]) continue
          const weight = { defensive: 1, balanced: 2, aggressive: 3 }[stance(k)]
          for (let m = 0; m < weight; m++) list.push(k)
        }
        shipList = list
        if (list.length) target = list[rng.rand(list.length)]!
      }
      hit = rng.rand(100) < ufoToHit(w, stance(target))
    }
    const toHit = src === 0 ? ufoToHit(w, stance(target)) : x.toHit
    let crit = false
    if (hit) {
      if (ships[target]!.type !== ships[x.target]!.type) {
        const before = Math.trunc(baseDamage(w, ships[src]!, ships[x.target]!))
        damage = Math.trunc(damage * (baseDamage(w, ships[src]!, ships[target]!) / before))
      }
      if (rng.rand(100) < critChance(f, w, ships[src]!, ships[target]!, target === 0)) {
        crit = true
        damage = Math.trunc(damage * 1.5)
      }
      landing.push({ time: now + 0.3, ship: target, damage, from: src, crit })
    }
    events.push({
      time: now,
      kind: 'shot',
      from: jet(src),
      to: jet(target),
      weapon: x.weapon,
      hit,
      aimed,
      crit,
      damage: hit ? damage : 0,
      toHit,
    })
  }
}

export function fightSquadron(f: SquadronFight, act: SquadronActions, rng: Rng): SquadronResult {
  return playSquadron(f, rollSquadron(f, rng), act, rng)
}

// --- Odds -----------------------------------------------------------------------

export interface SquadronOdds {
  runs: number
  down: number
  crashed: number
  destroyed: number
  escaped: number
  disengaged: number
  /** Per jet: shot down, mean damage taken, mean damage done. */
  lost: number[]
  taken: number[]
  dealt: number[]
  /** How often each jet was the UFO's first target. */
  firstLead: number[]
}

export function squadronOdds(
  f: SquadronFight,
  use: Partial<Record<Use, boolean>>,
  runs = 3000,
  seed = 1,
): SquadronOdds {
  const rng = seeded(seed)
  const n = f.jets.length
  const o: SquadronOdds = {
    runs,
    down: 0,
    crashed: 0,
    destroyed: 0,
    escaped: 0,
    disengaged: 0,
    lost: Array(n).fill(0),
    taken: Array(n).fill(0),
    dealt: Array(n).fill(0),
    firstLead: Array(n).fill(0),
  }
  const act: SquadronActions = {
    aim: use.aim ? USE_AT : undefined,
    dodge: use.dodge ? USE_AT : undefined,
    boost: use.boost ? USE_AT : undefined,
  }
  for (let r = 0; r < runs; r++) {
    const res = fightSquadron(f, act, rng)
    o[res.outcome]++
    o.firstLead[res.firstLead] = o.firstLead[res.firstLead]! + 1
    res.hp.forEach((h, i) => {
      if (h <= 0) o.lost[i] = o.lost[i]! + 1
      o.taken[i] = o.taken[i]! + f.jets[i]!.hp - Math.max(0, h)
      o.dealt[i] = o.dealt[i]! + res.dealt[i]!
    })
  }
  const per = (x: number) => x / runs
  return {
    runs,
    down: per(o.crashed + o.destroyed),
    crashed: per(o.crashed),
    destroyed: per(o.destroyed),
    escaped: per(o.escaped),
    disengaged: per(o.disengaged),
    lost: o.lost.map(per),
    taken: o.taken.map(per),
    dealt: o.dealt.map(per),
    firstLead: o.firstLead.map(per),
  }
}

// --- Odds in bulk (for the worker, airwar.worker.ts) -------------------------------

export interface SquadJob {
  fight: SquadronFight
  use: Partial<Record<Use, boolean>>
  runs: number
  seed: number
}
export interface SquadRequest {
  id: number
  squads: SquadJob[]
}
export interface SquadReply {
  id: number
  squads: SquadronOdds[]
}

export function runSquadJobs(req: SquadRequest): SquadReply {
  return {
    id: req.id,
    squads: req.squads.map((j) => squadronOdds(j.fight, j.use, j.runs, j.seed)),
  }
}
