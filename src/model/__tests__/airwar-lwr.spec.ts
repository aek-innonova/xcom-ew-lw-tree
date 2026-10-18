import { describe, expect, it } from 'vitest'
import { GAMES } from '../game'
import {
  analysisTech,
  categoryFor,
  craftStats,
  seeded,
  ufoStats,
  type AirSetting,
  type Rng,
  type Stance,
} from '../airwar'
import {
  escapeTime,
  fireRate,
  jetToHit,
  playSquadron,
  squadronOdds,
  squadronSize,
  takeLead,
  ufoToHit,
  type Jet,
  type Rolled,
  type SquadronFight,
} from '../airwar-lwr'

const air = GAMES.lwr.air
const set = (more: Partial<AirSetting> = {}): AirSetting => ({
  foundry: new Set(),
  friendlySkies: false,
  category: 0,
  air,
  difficulty: 1,
  ...more,
})
const jet = (stance: Stance, more: Partial<Jet> = {}, weapon = 1, type = 1): Jet => {
  const c = craftStats(type, weapon, set())
  return { ...c, hp: c.maxHp, kills: 0, stance, ...more }
}
const ufo = (type: number, s = set()) => {
  const u = ufoStats(type, s)
  return { ...u, hp: u.maxHp }
}
const fight = (u: SquadronFight['ufo'], jets: Jet[], more: Partial<SquadronFight> = {}) => ({
  ufo: u,
  jets,
  analysis: false,
  bonuses: [],
  foundry: [],
  ...more,
})
/** Rand from a script: each call takes the next value. */
const scripted = (values: number[]): Rng => ({
  rand: (n) => Math.min(n - 1, values.shift() ?? 0),
})

describe('LWR ships and UFOs (data/lwr/airwar.json)', () => {
  it('grows UFOs per 50 alien research, up to category 14', () => {
    expect(categoryFor(700, air.category)).toBe(14)
    expect(categoryFor(1000, air.category)).toBe(14)
    expect(categoryFor(149, air.category)).toBe(2)
  })

  it('scales UFO hulls by difficulty', () => {
    expect(ufo(4, set({ difficulty: 1 })).maxHp).toBe(420)
    expect(ufo(4, set({ difficulty: 3 })).maxHp).toBe(720)
    expect(ufo(4, set({ difficulty: 1, category: 2 })).maxHp).toBe(420 + 2 * 336)
  })

  it('re-builds the Destroyer above category 9 at the campaign’s difficulty', () => {
    expect(ufo(5, set({ category: 10 })).maxHp).toBe(1470 + 10 * 735)
    expect(ufo(5, set({ category: 10, difficulty: 0 })).maxHp).toBe(840 + 10 * 420)
  })

  it('gives LWR’s jets one weapon, and LWR’s analyses go by size class', () => {
    expect(craftStats(1, 1, set({ foundry: new Set([27]) })).weapons).toHaveLength(1)
    expect([4, 10, 5, 9, 6, 13, 8, 14].map((t) => analysisTech(t, 'lwr'))).toEqual([
      61, 61, 62, 62, 63, 63, 64, 64,
    ])
    expect(analysisTech(4)).toBe(61)
  })

  it('lets UFO weapons aim worse with Their Finest Hour (bonus 26)', () => {
    const w = (bonuses: number[]) =>
      ufoStats(4, set({ bonuses: new Set(bonuses) })).weapons[0]!.toHit
    expect(w([]) - w([26])).toBe(10)
  })
})

describe('LWR squadrons (XGInterception.ToggleInterceptor, XGInterceptionEngagement.Init)', () => {
  it('flies two jets, more as the best pilot’s kills grow', () => {
    expect(squadronSize([0, 0])).toBe(2)
    expect(squadronSize([3, 8])).toBe(3)
    expect(squadronSize([16])).toBe(4)
    expect(squadronSize([40, 0])).toBe(5)
  })

  it('has the UFO go for the most aggressive jet, or a random one when all are alike', () => {
    expect(takeLead([jet('balanced'), jet('aggressive'), jet('defensive')], seeded(1))).toEqual({
      order: [0, 1, 2],
      lead: 1,
    })
    const tie = takeLead([jet('balanced'), jet('balanced'), jet('balanced')], scripted([2]))
    expect(tie).toEqual({ order: [2, 0, 1], lead: 0 })
  })
})

describe('LWR shooting (UpdateWeapons, the playback)', () => {
  it('adds kills ÷ 4 and the stance to a jet’s aim, then the UFO’s size', () => {
    const f = fight(ufo(5), [])
    const j = jet('aggressive', { kills: 8 })
    // Phoenix Cannon 30, + 2 for kills, + 10 aggressive, × 1.5 against a Destroyer.
    expect(jetToHit(f, j, j.weapons[0]!)).toBe(Math.trunc(42 * 1.5))
    // Born to Fly: five times as much per kill.
    expect(jetToHit({ ...f, bonuses: [40] }, j, j.weapons[0]!)).toBe(Math.trunc(50 * 1.5))
    const hurt = jet('balanced', { hp: 3000 })
    expect(jetToHit(f, hurt, hurt.weapons[0]!)).toBe(Math.trunc(20 * 1.5))
    expect(jetToHit({ ...f, bonuses: [26] }, hurt, hurt.weapons[0]!)).toBe(45)
  })

  it('rolls the UFO’s shots against the stance of the jet they go to', () => {
    const w = ufo(4).weapons[0]!
    expect([ufoToHit(w, 'defensive'), ufoToHit(w, 'balanced'), ufoToHit(w, 'aggressive')]).toEqual([
      Math.trunc((w.toHit * 2) / 3),
      w.toHit,
      Math.trunc((w.toHit * 3) / 2),
    ])
  })

  it('fires faster on a Firestorm, with Jai Jawan, Air Superiority, Cooling Coils, the analysis', () => {
    const f = fight(ufo(4), [])
    expect(fireRate(f, jet('balanced'))).toBe(1)
    expect(fireRate(f, jet('balanced', {}, 1, 3))).toBe(1.5)
    expect(
      fireRate({ ...f, bonuses: [11, 2], foundry: [28], analysis: true }, jet('balanced')),
    ).toBeCloseTo(1.35 * 1.2 * 1.3 * 1.3)
  })

  it('times the escape by the squadron’s average speed', () => {
    const scout = ufo(4)
    expect(escapeTime(fight(scout, [jet('balanced'), jet('balanced')]))).toBeCloseTo(
      (30 * 20) / scout.battleSpeed,
    )
    // A damaged jet counts at 0.8: (20 + 16) / 2 = 18; Boost adds half of it.
    const two = fight(scout, [jet('balanced'), jet('balanced', { hp: 3000 })])
    expect(escapeTime(two)).toBeCloseTo((30 * 18) / scout.battleSpeed)
    expect(escapeTime(two, true)).toBeCloseTo((30 * 27) / scout.battleSpeed)
  })
})

describe('LWR playback (UIInterceptionEngagement)', () => {
  // Two jets; the lead has 1 HP left. The UFO fires twice: the first shot
  // draws a wingman (and hits it), the second stays on the lead and kills it.
  const rolled = (): Rolled => ({
    order: [0, 1],
    lead: 1,
    simHp: [1000, 1, 4000],
    shots: [
      { time: 1, source: 0, target: 1, weapon: 8, slot: 0, hit: true, damage: 300, toHit: 40 },
      { time: 2, source: 0, target: 1, weapon: 8, slot: 0, hit: true, damage: 300, toHit: 40 },
    ],
  })
  // Draw a wingman (99 > 50), pick, hit (0), no crit (99); then stay (0), hit, no crit.
  const rolls = () => [99, 0, 0, 99, 0, 0, 99]
  const lead = jet('aggressive', { hp: 1 })

  it('hands the lead on when the last wingman draw had room for the wingman', () => {
    const f = fight(ufo(4), [lead, jet('aggressive')])
    const r = playSquadron(f, rolled(), {}, scripted(rolls()))
    expect(r.events.some((e) => e.kind === 'lead' && e.from === 1)).toBe(true)
    expect(r.lost).toEqual([true, false])
  })

  it('lets the UFO go when the last draw left the wingman out (the game’s quirk)', () => {
    // A balanced wingman fills the draw twice: [2, 2]; AnyInterceptorsChasing
    // reads entry 2, past the end, as shot down.
    const f = fight(ufo(4), [lead, jet('balanced')])
    const r = playSquadron(f, rolled(), {}, scripted(rolls()))
    expect(r.outcome).toBe('escaped')
    expect(r.time).toBeCloseTo(2.3)
    expect(r.events.some((e) => e.kind === 'lead')).toBe(false)
  })

  it('destroys a Fighter it downs, and crashes a Scout', () => {
    const shot = {
      time: 1,
      source: 1,
      target: 0,
      weapon: 1,
      slot: 0,
      hit: true,
      damage: 500,
      toHit: 50,
    }
    for (const [type, outcome] of [
      [10, 'destroyed'],
      [4, 'crashed'],
    ] as const) {
      const u = { ...ufo(type), hp: 100 }
      const r = playSquadron(
        fight(u, [jet('balanced')]),
        { order: [0], lead: 1, simHp: [100, 4000], shots: [shot] },
        {},
        scripted([99]),
      )
      expect(r.outcome).toBe(outcome)
      expect(r.dealt).toEqual([500])
    }
  })

  it('lets Aim turn only the lead’s misses into hits, and only when the first jet is aggressive', () => {
    const miss = {
      time: 1,
      source: 1,
      target: 0,
      weapon: 1,
      slot: 0,
      hit: false,
      damage: 150,
      toHit: 30,
    }
    const play = (stance: Stance) =>
      playSquadron(
        fight(ufo(4), [jet(stance)]),
        { order: [0], lead: 1, simHp: [400, 4000], shots: [miss] },
        { aim: 0.5 },
        scripted([99]),
      )
    expect(play('aggressive').dealt).toEqual([150])
    expect(play('balanced').dealt).toEqual([0])
  })
})

describe('LWR odds', () => {
  it('gives two Phoenix interceptors a fair chance at a young Scout, none at a large UFO', () => {
    const two = [jet('balanced'), jet('balanced')]
    const scout = squadronOdds(fight(ufo(4), two), {}, 600, 3)
    expect(scout.down).toBeGreaterThan(0.5)
    expect(scout.down + scout.escaped + scout.disengaged).toBeCloseTo(1)
    const abductor = squadronOdds(fight(ufo(6), two), {}, 300, 3)
    expect(abductor.down).toBe(0)
    expect(abductor.lost[0]).toBeGreaterThan(0)
  })

  it('leaves Long War 1.0’s air war alone', () => {
    expect(GAMES.lw.airRules).toBe('lw')
    expect(ufoStats(4, { foundry: new Set(), friendlySkies: false, category: 0 }).maxHp).toBe(750)
  })
})
