import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseSave, SaveFormatError } from '../parse'
import { readCampaign } from '../campaign'
import { projectDaysLeft } from '@/model/research'

const saves = resolve(__dirname, '../../../fixtures/saves')
const saveFiles = readdirSync(saves).filter((f) => /^save\d+$/.test(f))
const load = (f: string) => new Uint8Array(readFileSync(resolve(saves, f)))

describe('sample saves', () => {
  it('are all there', () => {
    expect(saveFiles).toHaveLength(9)
  })

  it.each(saveFiles)('%s parses and yields a campaign', (f) => {
    const save = parseSave(load(f))
    const c = readCampaign(save)
    expect(save.strategy_from_tactical === true).toBe(save.header.tactical_save)
    expect(c.researched).toHaveLength(76)
    expect(c.researched[0]).toBe(true)
    expect(c.progress).toHaveLength(76)
    expect(c.date?.year).toBe(2016)
  })

  it.each(saveFiles)('%s: our time formula reproduces the game ETA', (f) => {
    const c = readCampaign(parseSave(load(f)))
    expect(c.project?.eta).toMatch(/^\d+ days?$/)
    expect(projectDaysLeft(c)).toBe(parseInt(c.project!.eta))
  })

  it('reads campaign 55 mid-mission saves through their embedded strategy state', () => {
    const counts = ['save1719', 'save1739', 'save1752'].map(
      (f) => readCampaign(parseSave(load(f))).researched.filter(Boolean).length,
    )
    expect(counts).toEqual([45, 46, 47])
  })
})

describe('rejecting files that are not saves', () => {
  it('says a tiny file is not a save', () => {
    expect(() => parseSave(new Uint8Array(100))).toThrow(SaveFormatError)
  })

  it('says an unknown version is not an Enemy Within save', () => {
    const bytes = new Uint8Array(2048)
    bytes[0] = 0x42
    expect(() => parseSave(bytes)).toThrow(/does not look like an XCOM: Enemy Within save/)
  })

  it('names Enemy Unknown saves', () => {
    const bytes = new Uint8Array(2048)
    bytes[0] = 0x0f
    expect(() => parseSave(bytes)).toThrow(/Enemy Unknown/)
  })

  it('reports a damaged header', () => {
    const bytes = new Uint8Array(2048)
    bytes[0] = 0x10
    expect(() => parseSave(bytes)).toThrow(SaveFormatError)
  })
})

describe('Long War details', () => {
  it('names the difficulty as Long War does (campaign 56 is Classic per its journal)', async () => {
    const { difficultyName } = await import('../campaign')
    expect(difficultyName(readCampaign(parseSave(load('save1762'))).difficulty)).toBe('Classic')
  })

  it('reads the money in hand (save1762: $87, as XGHeadQuarters.m_iCash)', () => {
    expect(readCampaign(parseSave(load('save1762'))).cash).toBe(87)
  })
})

describe('LWR saves', async () => {
  const { saveVersion } = await import('../campaign')
  const { GAMES } = await import('@/model/game')
  const { campaignSetting, craftStats } = await import('@/model/airwar')

  it('are told apart by the tag LWR writes into the description', () => {
    expect(saveVersion('Classic Game 58 [LWR v2.06.00] - Geoscape')).toEqual({
      game: 'lwr',
      version: '2.06.00',
    })
    expect(saveVersion('Game 56 - Geoscape - 2:22 am   March 25 2016')).toEqual({ game: 'lw' })
    for (const f of saveFiles) expect(readCampaign(parseSave(load(f))).game).toBe('lw')
  })

  it.each(['lwr-save1779', 'lwr-save1740'])('%s reads as an LWR campaign', (f) => {
    const c = readCampaign(parseSave(load(f)))
    expect(c.game).toBe('lwr')
    expect(c.description).toContain('Classic Game 58 [LWR v2.06.00]')
    expect(c.description).not.toContain('<font')
    expect(c.date?.year).toBe(2030)
    expect(c.difficulty).toBe(1)
  })

  it('reproduces the game’s ETA with LWR’s research formula', () => {
    const c = readCampaign(parseSave(load('lwr-save1779')))
    // Xenobiology, 3,600 points left, 10 scientists, no labs: 0.5 × (50 + 10) = 30 an hour.
    expect(c.project).toEqual({ tech: 1, pointsLeft: 3600, eta: '5 days' })
    expect(projectDaysLeft(c, 'lwr')).toBe(5)
  })

  it('gives the air war the campaign’s jets, by LWR’s numbers', () => {
    const c = readCampaign(parseSave(load('lwr-save1779')))
    const set = campaignSetting(c, GAMES.lwr.air)
    expect(c.interceptors.map((j) => [j.callsign, j.type, j.weapons, j.hp])).toEqual([
      ['RAVEN-1', 1, [3], 4000],
      ['RAVEN-2', 1, [3], 4000],
      ['RAVEN-3', 1, [3], 4000],
    ])
    expect(craftStats(1, 3, set).weapons[0]!.damage).toBe(160) // LWR's Avalanche, not Long War 1.0's 340
  })
})
