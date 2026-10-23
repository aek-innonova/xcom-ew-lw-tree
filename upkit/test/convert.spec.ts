import { afterAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// PatchUPK mods converted to .upkmod (features/upkmod-convert.md), on the
// packages they were made for, without them: plain Enemy Within's, and Long
// War 1.0's as its installer has them (over plain Enemy Within's).
const SAMPLES = resolve(import.meta.dirname, '../../samples')
const EW = join(SAMPLES, 'ew/CookedPCConsole')
const LW_APP = join(SAMPLES, 'Long War Mod Manager 1.0d-620-1-0d/LongWarFiles/_Long War EW 1.0 for PC-88-1-0.exe/{app}/XComGame/CookedPCConsole')
const MODS = join(SAMPLES, 'additional_mods')
const have = [EW, LW_APP, MODS].every((p) => existsSync(p))

const cli = new URL('../src/cli.ts', import.meta.url).pathname
/** The command's output and whether it succeeded. */
const run = (...args: string[]): { out: string; ok: boolean } => {
  try {
    return { out: execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', stdio: 'pipe', maxBuffer: 1 << 26 }), ok: true }
  } catch (e) {
    const x = e as { stdout: string; stderr: string }
    return { out: `${x.stdout}${x.stderr}`, ok: false }
  }
}

describe.skipIf(!have)('PatchUPK mods converted to .upkmod', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lwtree-upkit-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  const ew = join(dir, 'ew')
  const lw = join(dir, 'lw')
  mkdirSync(ew)
  mkdirSync(lw)
  for (const f of readdirSync(EW)) {
    copyFileSync(join(EW, f), join(ew, f))
    copyFileSync(join(EW, f), join(lw, f))
  }
  for (const f of ['Engine.upk', 'XComGame.upk', 'XComStrategyGame.upk', 'LongWar.upk', 'UICollection_Tactical_SF.upk']) copyFileSync(join(LW_APP, f), join(lw, f))
  const mod = (name: string) => [join(MODS, 'Mods', name), join(MODS, 'mod.files/Sightlines-1.4', name)].find((p) => existsSync(p))!

  it('Lightning Reflexes on Long War 1.0: its class as source diffs, checked; its options as the script has them; there, installed', () => {
    const to = join(dir, 'lr.upkmod')
    const r = run('convert', mod('LightningReflexes.txt'), '--game', lw, '--out', to)
    expect(r.ok).toBe(true)
    expect(r.out).toContain('note: its options are taken as the script has them (a .upkmod has none yet): fLRMissChancefirst=0.00')
    expect(r.out).toContain('converted XComGame.upk: XGAbility_Targeted')
    const text = readFileSync(to, 'utf8')
    expect(text.split('\n').slice(0, 3)).toEqual(['upkit mod 1', 'name: Lightning Reflexes', 'author: The Iron Rose'])
    expect(text).toContain('@@ function RollForHit(XGAction_Fire kFireAction) @@')
    // Applied (checked only: nothing written): the mod's change, there.
    expect(run('apply', to, '--game', lw, '--check').out).toContain('lr.upkmod: applies')
    // On plain Enemy Within, whose RollForHit Long War rewrote: does not fit, and says where.
    expect(run('apply', to, '--game', ew, '--check').out).toMatch(/does not fit: the lines it changes are not there as it expects in function RollForHit/)
  }, 600_000)

  it('Enhanced Tactical Info: its code converts, its Flash movie does not; nothing written, unless --partial', () => {
    const r = run('convert', mod('EnhancedTacticalInfo.txt'), '--game', lw, '--out', join(dir, 'eti.upkmod'))
    expect(r.ok).toBe(false)
    expect(r.out).toContain('not converted: UICollection_Tactical_SF.upk: gfxUnitGermanMode.UnitGermanMode (SwfMovie): not code')
    expect(r.out).toContain('nothing written (--partial writes the code all the same)')
    expect(existsSync(join(dir, 'eti.upkmod'))).toBe(false)
    const p = run('convert', mod('EnhancedTacticalInfo.txt'), '--game', lw, '--out', join(dir, 'eti.upkmod'), '--partial')
    expect(p.out).toContain('converted XComGame.upk: XGUnit')
    expect(existsSync(join(dir, 'eti.upkmod'))).toBe(true)
  }, 900_000)

  it('Sightlines on plain Enemy Within, with the Mutator Enabler it needs applied first (and not in it)', () => {
    const without = run('convert', mod('Sightlines_EW.txt'), '--game', ew, '--out', join(dir, 's.upkmod'))
    expect(without.out).toMatch(/does not fit these packages .*no name Mutate/)
    const r = run('convert', mod('Sightlines_EW.txt'), '--game', ew, '--with', mod('XComMutatorEnabler.txt'), '--out', join(dir, 's.upkmod'))
    expect(r.ok).toBe(true)
    const text = readFileSync(join(dir, 's.upkmod'), 'utf8')
    expect(text).toContain('--- XComGame.upk XGUnit')
    expect(text).not.toContain('XGBattle_SP') // (the Enabler's class)
    expect(text).not.toContain('// upkit:') // (upkit's own notes are no change)
  }, 900_000)

  it('--tidy: without the padding the script added and the constants it only wrote shorter; smaller, still applies', () => {
    const plain = join(dir, 'lr-plain.upkmod')
    const tidy = join(dir, 'lr-tidy.upkmod')
    run('convert', mod('LightningReflexes.txt'), '--game', lw, '--out', plain)
    const r = run('convert', mod('LightningReflexes.txt'), '--game', lw, '--out', tidy, '--tidy')
    expect(r.out).toMatch(/note: XGAbility_Targeted, tidied: \d+ padding statements left out, 3 lines kept as the version has them/)
    const a = readFileSync(plain, 'utf8')
    const b = readFileSync(tidy, 'utf8')
    expect(a).toMatch(/^\+\s*;$/m)
    expect(b).not.toMatch(/^\+\s*;$/m)
    expect(a).toContain('6.28319')
    expect(b).not.toContain('6.28319')
    expect(b.split('\n').length).toBeLessThan(a.split('\n').length * 0.8)
    expect(run('apply', tidy, '--game', lw, '--check').out).toContain('lr-tidy.upkmod: applies')
  }, 900_000)

  it('refused: on packages that have the mod already', () => {
    const lwInstalled = join(SAMPLES, 'CookedPCConsole')
    const r = run('convert', mod('LightningReflexes.txt'), '--game', lwInstalled, '--out', join(dir, 'x.upkmod'))
    expect(r.ok).toBe(false)
    expect(r.out).toContain('the mod is in these packages already: convert it on packages without it')
  }, 300_000)
})
