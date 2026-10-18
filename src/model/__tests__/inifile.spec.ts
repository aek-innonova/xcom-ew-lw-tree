import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { iniBytes, iniEntries, iniText, mergeIni, setIniValues } from '../inifile'

const INI = [
  '[XComGame.XGTacticalGameCore]',
  '; How many soldiers XCOM starts with',
  'NUM_STARTING_SOLDIERS=60',
  'PSI_GIFT_CHANCE=0.65\t\t; the chance a tested soldier has the gift',
  'HQ_BASE_POWER = 16\t\t\t; Sniper Color',
  'HQ_BASE_POWER = -1\t\t\t; Sniper Headgear',
  'Characters=(iType=eChar_Soldier, HP=5, Mobility=14) ; the soldier',
  '',
  '[XComGame.XGStrategy]',
  'NUM_STARTING_SOLDIERS=12',
].join('\r\n')

describe('INI settings (model/inifile.ts)', () => {
  it('lists settings with their help, counting repeated keys', () => {
    const e = iniEntries(INI)
    expect(e.map((x) => [x.key, x.value, x.occurrence, x.help])).toEqual([
      ['NUM_STARTING_SOLDIERS', '60', 0, 'How many soldiers XCOM starts with'],
      ['PSI_GIFT_CHANCE', '0.65', 0, 'the chance a tested soldier has the gift'],
      ['HQ_BASE_POWER', '16', 0, 'Sniper Color'],
      ['HQ_BASE_POWER', '-1', 1, 'Sniper Headgear'],
      ['Characters', '(iType=eChar_Soldier, HP=5, Mobility=14)', 0, 'the soldier'],
      ['NUM_STARTING_SOLDIERS', '12', 0, ''],
    ])
    expect(e[5]!.section).toBe('XComGame.XGStrategy')
  })

  it('changes only the values asked for, keeping spacing, comments and line ends', () => {
    const { text, missing } = setIniValues(INI, [
      { section: 'XComGame.XGTacticalGameCore', key: 'HQ_BASE_POWER', occurrence: 1, value: '4' },
      { section: 'XComGame.XGStrategy', key: 'NUM_STARTING_SOLDIERS', occurrence: 0, value: '30' },
      { section: 'XComGame.XGStrategy', key: 'NOPE', occurrence: 0, value: '1' },
    ])
    expect(missing.map((m) => m.key)).toEqual(['NOPE'])
    const lines = text.split('\r\n')
    expect(lines[5]).toBe('HQ_BASE_POWER = 4\t\t\t; Sniper Headgear')
    expect(lines[9]).toBe('NUM_STARTING_SOLDIERS=30')
    expect(text.replace('= 4\t', '= -1\t').replace('=30', '=12')).toBe(INI)
  })

  it('adds a mod’s lines under their section once', () => {
    const loader =
      '[XComMutator.XComMutatorLoader]\narrTacticalMutators="XComLZMutator.XComLZMutator"\n'
    const mod =
      '[XComMutator.XComMutatorLoader]\narrTacticalMutators="Sightlines.SightlineMutator"\n'
    const once = mergeIni(loader, mod)
    expect(once.split('\n')).toEqual([
      '[XComMutator.XComMutatorLoader]',
      'arrTacticalMutators="XComLZMutator.XComLZMutator"',
      'arrTacticalMutators="Sightlines.SightlineMutator"',
      '',
    ])
    expect(mergeIni(once, mod)).toBe(once)
  })

  const sample = resolve(import.meta.dirname, '../../../samples/Config/DefaultGameCore.ini')
  it.skipIf(!existsSync(sample))('round-trips the real DefaultGameCore.ini byte for byte', () => {
    const bytes = new Uint8Array(readFileSync(sample))
    expect(iniBytes(setIniValues(iniText(bytes), []).text)).toEqual(bytes)
    expect(iniEntries(iniText(bytes)).find((e) => e.key === 'NUM_STARTING_SOLDIERS')).toBeTruthy()
  })
})
