import { describe, expect, it } from 'vitest'
import { freeName, fromShared, gameOf, modsIn, orderOf, safeName } from '../library'

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

  it('keeps game settings by version; 0.3.1’s one set becomes Long War’s', () => {
    expect(gameOf({ 'soldier.hp': '5', 'x.y': 3 })).toEqual({ lw: { 'soldier.hp': '5' } })
    expect(gameOf({ lwr: { 'soldier.hp': '7' }, ew: {}, zz: { a: '1' } })).toEqual({
      lwr: { 'soldier.hp': '7' },
      ew: {},
    })
    expect(gameOf(null)).toEqual({})
  })

  it('moves a 0.3 file over: shared choices to the version chosen, each setup to its own', () => {
    const tick = { wanted: { 'a.txt': true } }
    const old = {
      order: ['a', 'b'],
      mods: { a: tick },
      ini: [{ section: 'S', key: 'K', occurrence: 0, value: '1' }],
      base: 'lwr',
      game: { lw: { 'soldier.hp': '5' }, lwr: { 'soldier.hp': '7' } },
      setups: {
        Hard: {
          saved: '1',
          base: 'lw',
          mods: {},
          ini: [],
          game: { lw: { x: '1' }, lwr: { y: '2' } },
        },
        Mine: { saved: '2', base: 'lwr', mods: { a: tick }, ini: [], game: { lwr: { y: '3' } } },
      },
      setupFrom: 'Mine',
    }
    const s = fromShared(old, 'lwr')
    expect(s.base).toBe('lwr')
    expect(s.versions.lwr).toMatchObject({
      order: ['a', 'b'],
      mods: { a: tick },
      game: { 'soldier.hp': '7' },
      setupFrom: 'Mine',
    })
    expect(s.versions.lwr!.ini).toHaveLength(1)
    expect(Object.keys(s.versions.lwr!.setups)).toEqual(['Mine'])
    expect(s.versions.lwr!.setups.Mine!.game).toEqual({ y: '3' })
    // Long War keeps its own game settings and its setup; nothing ticked carries over.
    expect(s.versions.lw).toMatchObject({
      order: [],
      mods: {},
      ini: [],
      game: { 'soldier.hp': '5' },
    })
    expect(s.versions.lw!.setups.Hard!.game).toEqual({ x: '1' })
    expect(s.versions.lw!.setupFrom).toBeUndefined()
    expect(s.versions.ew).toBeUndefined()
  })

  it('moves "as installed" to the version installed', () => {
    const s = fromShared({ base: 'keep', mods: { a: {} }, setups: { X: { base: 'keep' } } }, 'lw')
    expect(s.base).toBeUndefined()
    expect(s.versions.lw!.mods).toEqual({ a: {} })
    expect(Object.keys(s.versions.lw!.setups)).toEqual(['X'])
  })
})
