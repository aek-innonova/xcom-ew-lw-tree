import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseSave } from '@/save/parse'
import { readCampaign } from '@/save/campaign'
import { AIR_SUPERIORITY, monthlyEconomy, WEALTH_OF_NATIONS } from '../economy'

const save = (name: string) =>
  readCampaign(
    parseSave(
      new Uint8Array(readFileSync(resolve(import.meta.dirname, '../../../fixtures/saves', name))),
    ),
  )

describe('a month’s funding and upkeep, by Long War 1.0’s rules (model/economy.ts)', () => {
  it('funding from the council countries paying; upkeep for facilities and craft', () => {
    // March 2016: 15 of 16 council countries paying; a lift, a satellite
    // uplink, four Interceptors and the Skyranger.
    const e = monthlyEconomy(save('save1762'), 'lw', () => 0)!
    expect(e).toMatchObject({ paying: 15, funding: 728, income: 728, upkeep: 205, net: 523 })
    expect(e.facilities).toEqual([
      { name: 'Access Lift', count: 1, each: 5, total: 5 },
      { name: 'Satellite Uplink', count: 1, each: 20, total: 20 },
    ])
    expect(e.craft).toEqual([
      { name: 'Interceptors', count: 4, each: 40, total: 160 },
      { name: 'Skyranger', count: 1, each: 20, total: 20 },
    ])
  })

  it('Wealth of Nations adds to funding; Air Superiority takes off each craft’s, as whole credits', () => {
    const bonus = (id: number) => ({ [WEALTH_OF_NATIONS]: 20, [AIR_SUPERIORITY]: 25 })[id] ?? 0
    const e = monthlyEconomy(save('save1762'), 'lw', bonus)!
    // 728 + 20% = 873.6, kept whole as the game's int does.
    expect(e.income).toBe(873)
    expect(e.wealth).toEqual({ percent: 20, adds: 145 })
    expect(e.craft.map((c) => c.each)).toEqual([30, 15])
    expect(e.net).toBe(873 - 25 - 135)
  })

  it('LWR pays daily by its own code: not worked out', () => {
    expect(monthlyEconomy(save('lwr-save1779'), 'lwr', () => 0)).toBeNull()
  })
})
