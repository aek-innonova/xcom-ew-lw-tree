import { describe, expect, it } from 'vitest'
import { freeName, modsIn, orderOf, safeName } from '../library'

const f = (path: string) => ({ path, size: 1, modified: 0 })

describe('the library folder', () => {
  it('finds mods: each folder in Mods, and each script on its own there', () => {
    const mods = modsIn([
      f('Mods/Sightlines-1.4/Sightlines_LW.txt'),
      f('Mods/Sightlines-1.4/CookedPCConsole/Sightlines.u'),
      f('Mods/LightningReflexes.txt'),
      f('Mods/notes.pdf'),
      f('Long War EW 1.0 for PC-88-1-0.exe'),
      f('settings.json'),
    ])
    expect(mods.map((m) => [m.id, m.folder, m.files.map((x) => x.rel)])).toEqual([
      ['Sightlines-1.4', true, ['Sightlines_LW.txt', 'CookedPCConsole/Sightlines.u']],
      ['LightningReflexes.txt', false, ['LightningReflexes.txt']],
    ])
  })

  it('names new mods so Windows takes them and nothing is overwritten', () => {
    expect(safeName('Mod: "new" / better?. ')).toBe('Mod_ _new_ _ better_')
    expect(freeName('Mod', new Set(['mod']))).toBe('Mod (2)')
    expect(freeName('Fast.txt', new Set(['Fast.txt', 'Fast (2).txt']))).toBe('Fast (3).txt')
    expect(freeName('Other', new Set(['Mod']))).toBe('Other')
  })

  it('keeps the player order; mods new to it go last, by name', () => {
    expect(orderOf(['b', 'a', 'c', 'z'], ['c', 'gone', 'a'])).toEqual(['c', 'a', 'b', 'z'])
  })
})
