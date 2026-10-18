import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseSave } from '@/save/parse'
import { readCampaign } from '@/save/campaign'
import {
  AIR_FOUNDRY,
  CRAFT_WEAPONS,
  INTERCEPTOR,
  categoryFor,
  craftStats,
  critFor,
  escapeTime,
  mitigation,
  playBack,
  rollShots,
  seeded,
  sequenceOdds,
  toHitFor,
  ufoStats,
  ufoUpgrades,
  weaponStats,
  type AirSetting,
  type Engagement,
  type Shot,
  type Stance,
} from '../airwar'

const set = (over: Partial<AirSetting> = {}): AirSetting => ({
  foundry: new Set(),
  friendlySkies: false,
  category: 0,
  ...over,
})
const AVALANCHE = 3
const SCOUT = 4
const DESTROYER = 5

function engagement(stance: Stance = 'balanced', s = set(), ufo = SCOUT): Engagement {
  const craft = craftStats(INTERCEPTOR, AVALANCHE, s)
  const u = ufoStats(ufo, s)
  return {
    craft: { ...craft, hp: craft.maxHp, kills: 0 },
    ufo: { ...u, hp: u.maxHp },
    stance,
    analysis: false,
  }
}

describe('ships and weapons from the INI', () => {
  it('builds the interceptor and its Foundry upgrades', () => {
    const base = craftStats(INTERCEPTOR, AVALANCHE, set())
    expect([base.maxHp, base.armor, base.ap, base.battleSpeed]).toEqual([2500, 5, 0, 10])
    expect(base.weapons.map((w) => [w.name, w.damage, w.toHit, w.firingTime])).toEqual([
      ['Avalanche Missiles', 340, 40, 2],
    ])
    const all = new Set(Object.values(AIR_FOUNDRY))
    const up = craftStats(INTERCEPTOR, AVALANCHE, set({ foundry: all, friendlySkies: true }))
    expect([up.maxHp, up.ap, up.battleSpeed]).toEqual([3500, 5, 15])
    expect(up.weapons.map((w) => [w.name, w.toHit])).toEqual([
      ['Avalanche Missiles', 65], // + Improved Avionics 10, Friendly Skies 15
      ['Stingray Missiles', 65], // Wingtip Sparrowhawks
    ])
    expect(craftStats(INTERCEPTOR, 1, set({ foundry: all })).weapons[0]!.damage).toBe(230) // Coilguns
  })

  it('offers every weapon the hangar can mount, Stingray included (item 116)', () => {
    expect(CRAFT_WEAPONS.map((w) => weaponStats(w, set()).name)).toEqual([
      'Phoenix Cannon',
      'Stingray Missiles',
      'Avalanche Missiles',
      'Laser Cannon',
      'Plasma Cannon',
      'EMP Cannon',
      'Fusion Lance',
    ])
  })

  it('grows UFOs with alien research', () => {
    expect(categoryFor(310)).toBe(10)
    expect(categoryFor(5000)).toBe(32)
    const scout = ufoStats(SCOUT, set({ category: 10 }))
    expect(scout.maxHp).toBe(750 + 750)
    expect(scout.weapons.map((w) => [w.damage, w.toHit])).toEqual([[450 + 80, 33 + 20]])
    expect(
      ufoStats(SCOUT, set({ foundry: new Set([AIR_FOUNDRY.countermeasures]) })).weapons[0]!.toHit,
    ).toBe(18)
  })

  it('lists a UFO type’s upgrades by the alien research they come at', () => {
    expect(ufoUpgrades(DESTROYER)).toEqual([
      { at: 270, category: 9, weapons: [9], hull: false },
      { at: 570, category: 19, hull: true },
    ])
  })

  it('re-arms and re-builds UFOs past some categories', () => {
    expect(ufoStats(DESTROYER, set({ category: 8 })).weapons.map((w) => w.id)).toEqual([8])
    expect(ufoStats(DESTROYER, set({ category: 9 })).weapons.map((w) => w.id)).toEqual([9])
    expect(ufoStats(DESTROYER, set({ category: 19 })).armor).toBe(32)
  })
})

describe('the exchange (UpdateWeapons)', () => {
  it('gives both sides +15 aggressive and −15 defensive', () => {
    for (const [stance, add] of [
      ['aggressive', 15],
      ['balanced', 0],
      ['defensive', -15],
    ] as const) {
      const e = engagement(stance)
      expect(toHitFor(e, 1, e.craft.weapons[0]!)).toBe(40 + add)
      expect(toHitFor(e, 0, e.ufo.weapons[0]!)).toBe(33 + add)
    }
  })

  it('adds 3 per kill to the interceptor, at most 30, and clamps to 5–95', () => {
    const e = engagement('aggressive')
    e.craft.kills = 20
    expect(toHitFor(e, 1, e.craft.weapons[0]!)).toBe(85)
    e.craft.weapons[0]!.toHit = 90
    expect(toHitFor(e, 1, e.craft.weapons[0]!)).toBe(95)
  })

  it('cuts damage 5 % per armor point beyond penetration; crits on (AP − armor) / 2', () => {
    const e = engagement('balanced', set(), DESTROYER) // armor 18
    const w = e.craft.weapons[0]! // Avalanche, AP 0
    expect(mitigation(w, e.craft, e.ufo)).toBeCloseTo(0.9)
    expect(critFor(w, e.craft, e.ufo)).toBe(5)
    expect(critFor(e.ufo.weapons[0]!, e.ufo, e.craft)).toBe(5) // (15 − 5) / 2
  })

  it('opens fire at once: the UFO at 0–1.9 s, the interceptor from 0.2 s, then every firing time', () => {
    const shots = rollShots(engagement(), seeded(7))
    const mine = shots.filter((s) => s.source === 1)
    expect(mine[0]!.time).toBeGreaterThanOrEqual(0.2)
    expect(mine[1]!.time - mine[0]!.time).toBeCloseTo(2)
    expect(shots.every((s) => s.time < 62)).toBe(true)
  })
})

describe('the playback', () => {
  const miss = (time: number, damage = 400): Shot => ({
    time,
    source: 1,
    weapon: AVALANCHE,
    slot: 0,
    hit: false,
    crit: false,
    damage,
    toHit: 40,
  })
  const ufoHit = (time: number): Shot => ({
    time,
    source: 0,
    weapon: 8,
    slot: 0,
    hit: true,
    crit: false,
    damage: 300,
    toHit: 33,
  })

  it('lets the scout escape after 30 × 10 / 42 seconds', () => {
    expect(escapeTime(engagement())).toBeCloseTo(7.14, 2)
    expect(escapeTime(engagement(), 1)).toBeCloseTo(10.71, 2) // Boost: + half the speed
    const r = playBack(engagement(), [], {}, seeded(1))
    expect(r.outcome).toBe('escaped')
  })

  it('Aim turns the next two misses into hits; not in defensive stance', () => {
    const shots = [miss(1), miss(2), miss(3)]
    const aimed = playBack(engagement(), shots, { aim: 0 }, seeded(1))
    expect(aimed.ufoHp).toBe(750 - 800)
    expect(aimed.outcome).toMatch(/crashed|destroyed/)
    const defensive = playBack(engagement('defensive'), shots, { aim: 0 }, seeded(1))
    expect(defensive.ufoHp).toBe(750)
  })

  it('Dodge cancels the next two hits on the interceptor; not in aggressive stance', () => {
    const shots = [ufoHit(1), ufoHit(2), ufoHit(3)]
    expect(playBack(engagement(), shots, { dodge: 0 }, seeded(1)).craftHp).toBe(2500 - 300)
    expect(playBack(engagement('aggressive'), shots, { dodge: 0 }, seeded(1)).craftHp).toBe(1600)
  })

  it('skips shots from a ship already down', () => {
    const e = engagement()
    e.craft.hp = 300
    const r = playBack(e, [ufoHit(1), miss(1.5), ufoHit(2)], { aim: 0 }, seeded(1))
    expect(r.craftLost).toBe(true)
    expect(r.ufoHp).toBe(750)
  })
})

describe('odds', () => {
  it('aggressive brings a scout down more often than defensive, and costs more damage', () => {
    const ufo = ufoStats(SCOUT, set())
    const craft = craftStats(INTERCEPTOR, AVALANCHE, set())
    const leg = (stance: Stance) => ({
      craft: { ...craft, hp: craft.maxHp, kills: 0 },
      stance,
      use: { aim: false, dodge: false, boost: false },
    })
    const odds = (stance: Stance) => sequenceOdds(ufo, [leg(stance)], false, 2000)
    const [a, b, d] = [odds('aggressive'), odds('balanced'), odds('defensive')]
    expect(a.down).toBeGreaterThan(b.down)
    expect(b.down).toBeGreaterThan(d.down)
    expect(a.legs[0]!.craftDamage).toBeGreaterThan(d.legs[0]!.craftDamage)
  })

  it('carries the UFO damage into the next engagement', () => {
    const ufo = ufoStats(6, set()) // Abductor, 4000 HP, armor 30
    const craft = craftStats(INTERCEPTOR, 5, set()) // Plasma Cannon
    const leg = { craft: { ...craft, hp: craft.maxHp, kills: 0 }, stance: 'aggressive' as const }
    const one = sequenceOdds(
      ufo,
      [{ ...leg, use: { aim: false, dodge: false, boost: false } }],
      false,
      1000,
    )
    const two = sequenceOdds(
      ufo,
      [1, 2].map(() => ({ ...leg, use: { aim: false, dodge: false, boost: false } })),
      false,
      1000,
    )
    expect(two.down).toBeGreaterThan(one.down)
  })
})

describe('the hangar from a save', () => {
  it('reads the interceptors, their weapons, kills and stance (save1762)', () => {
    const c = readCampaign(
      parseSave(
        new Uint8Array(readFileSync(resolve(__dirname, '../../../fixtures/saves/save1762'))),
      ),
    )
    expect(c.interceptors).toHaveLength(4)
    const jet = c.interceptors.find((i) => i.callsign.includes('Mongoose'))!
    expect(jet).toMatchObject({ type: 1, weapons: [3], hp: 1486, maxHp: 2500, kills: 1, stance: 1 })
  })
})
