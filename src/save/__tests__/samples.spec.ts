import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseSave, SaveFormatError } from '../parse'
import { readCampaign } from '../campaign'
import { projectDaysLeft } from '@/model/research'

// samples/ is git-ignored (the person's own saves); these tests skip without it.
const samples = resolve(__dirname, '../../../samples')
const saveFiles = existsSync(samples) ? readdirSync(samples).filter((f) => /^save\d+$/.test(f)) : []
const load = (f: string) => new Uint8Array(readFileSync(resolve(samples, f)))

describe.skipIf(saveFiles.length === 0)('sample saves', () => {
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
