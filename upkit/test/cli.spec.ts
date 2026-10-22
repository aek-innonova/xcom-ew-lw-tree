import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { CORPUS, haveCorpus } from './corpus.ts'
import { openPackage, type Package } from '../src/package.ts'

// The command line as a modder runs it: the common case end to end, in a scratch folder.
const cli = new URL('../src/cli.ts', import.meta.url).pathname
const run = (...args: string[]) => execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' })

/** A mod script applied by `upkit apply` to a copy of the package (in a game folder of its own, under dir): the package it leaves. */
function applied(pkg: string, mod: string, dir: string): Package {
  const game = join(dir, 'applied', 'CookedPCConsole')
  rmSync(join(dir, 'applied'), { recursive: true, force: true })
  mkdirSync(game, { recursive: true })
  copyFileSync(pkg, join(game, basename(pkg)))
  expect(run('apply', mod, '--game', game)).toMatch(/^changed /m)
  return openPackage(new Uint8Array(readFileSync(join(game, basename(pkg)))))
}

/** The same package as far as the game reads it: names, imports, exports (but where their data is) and every object's data. */
function expectSame(a: Package, b: Package) {
  expect(b.names).toEqual(a.names)
  expect(b.imports).toEqual(a.imports)
  const entries = (p: Package) => p.exports.map((e) => ({ ...e, serialOffset: 0 }))
  expect(entries(b)).toEqual(entries(a))
  for (let i = 1; i <= a.exports.length; i++) if (Buffer.compare(a.data(i), b.data(i))) throw new Error(`${a.path(i)} differs`)
}

describe.skipIf(!haveCorpus)('the command line', () => {
  it('class, edit, compile to a mod script and to a package; usage; errors said in a line', () => {
    const game = dirname(CORPUS[0]!)
    const pkg = CORPUS[3]!
    const dir = mkdtempSync(join(tmpdir(), 'lwtree-upkit-'))
    try {
      expect(run('info', pkg)).toContain('XComStrategyGame: version 845')
      const src = run('class', pkg, 'XGFacility_Labs')
      expect(src).toContain('class XGFacility_Labs')
      writeFileSync(join(dir, 'Labs.uc'), src)
      expect(run('compile', pkg, 'XGFacility_Labs', join(dir, 'Labs.uc'), '--patch', join(dir, 'none.txt'))).toContain('nothing edited')
      writeFileSync(join(dir, 'Labs.uc'), src.replace('(1 + m_fLabBonus', '(3 + m_fLabBonus'))
      expect(run('compile', pkg, 'XGFacility_Labs', join(dir, 'Labs.uc'), '--patch', join(dir, 'labs.txt'))).toContain('XGFacility_Labs.GetResearchPerHour as a PatchUPK mod script')
      expect(readFileSync(join(dir, 'labs.txt'), 'utf8')).toContain('OBJECT=XGFacility_Labs.GetResearchPerHour:AUTO')
      run('compile', pkg, 'XGFacility_Labs', join(dir, 'Labs.uc'), '--out', join(dir, 'new.upk'), '--game', game)
      expect(run('decompile', join(dir, 'new.upk'), 'XGFacility_Labs.GetResearchPerHour', '--game', game)).toContain('(3 + m_fLabBonus')
      // Against the original, kept elsewhere (no --game: the first one's folder serves): the one function.
      expect(run('diff', pkg, join(dir, 'new.upk'), 'XGFacility_Labs').match(/^--- a\//gm)).toEqual(['--- a/'])
      run('export', pkg, join(dir, 'src'))
      expect(existsSync(join(dir, 'src', 'XGFacility_Labs.uc'))).toBe(true)
      // No command: the usage; a bad one: one line, no stack.
      let err = ''
      try {
        execFileSync(process.execPath, [cli], { encoding: 'utf8', stdio: 'pipe' })
      } catch (e) {
        err = String((e as { stderr: string }).stderr)
      }
      expect(err).toContain('Commands:')
      try {
        execFileSync(process.execPath, [cli, 'compile', pkg, 'XGFacility_Labs.Nope', join(dir, 'Labs.uc'), '--patch', join(dir, 'x.txt')], { encoding: 'utf8', stdio: 'pipe' })
      } catch (e) {
        err = String((e as { stderr: string }).stderr)
      }
      expect(err.trim().split('\n').length).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)
})

describe.skipIf(!haveCorpus || !existsSync(join(dirname(CORPUS[0]!), '../ew/CookedPCConsole/XComStrategyGame.upk')))('diff', () => {
  it("vanilla against Long War: what Long War changed in a function, a class's defaults and declarations, as diffs of their source", () => {
    const vanilla = join(dirname(CORPUS[0]!), '../ew/CookedPCConsole/XComStrategyGame.upk')
    const out = run('diff', vanilla, CORPUS[3]!, 'XGFacility_Labs.GetResearchPerHour')
    expect(out).toContain('--- a/XGFacility_Labs.GetResearchPerHour')
    expect(out).toContain('-    return int(GetAvailableScientists() * m_fLabBonus * m_fAdjLabBonus);')
    expect(out).toContain('+    return int(GetAvailableScientists() * (1 + m_fLabBonus + m_fAdjLabBonus));')
    // And a class's defaults Long War changed.
    const defaults = run('diff', vanilla, CORPUS[3]!, 'XGStrategyActorNativeBase')
    expect(defaults).toContain('--- a/XGStrategyActorNativeBase (defaultproperties)')
    expect(defaults).toContain('-    LOSE_CONDITION_NUM_DESERTERS=8')
    expect(defaults).toContain('+    LOSE_CONDITION_NUM_DESERTERS=16')
    // And its declarations: values Long War added to an enum.
    expect(defaults).toContain('--- a/XGStrategyActorNativeBase (declarations)')
    expect(defaults).toContain('+    eObjective_Infiltrate_0,')
  })
  it('roundtrip --list: every vanilla function comes back (what source cannot say, as __asm), so none is listed', () => {
    const vanilla = join(dirname(CORPUS[0]!), '../ew/CookedPCConsole/XComStrategyGame.upk')
    const out = run('roundtrip', vanilla, '--list')
    expect(out).toBe('XComStrategyGame: 5349 of 5349 functions compile back byte for byte (100.0%)\n')
  }, 120_000)
})

describe.skipIf(!haveCorpus)('what is not compiled is said, not ignored', () => {
  it("a function's changed declaration, a variable's changed type", () => {
    const pkg = CORPUS[3]!
    const dir = mkdtempSync(join(tmpdir(), 'lwtree-upkit-'))
    const fails = (...args: string[]) => {
      try {
        execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', stdio: 'pipe' })
        return ''
      } catch (e) {
        return String((e as { stderr: string }).stderr)
      }
    }
    try {
      const fn = run('decompile', pkg, 'XGFacility_Labs.GetHoursToResearchProject').replace(/^.*\n(?=function)/, '')
      writeFileSync(join(dir, 'f.uc'), fn.replace('(int iTech)', '(float iTech)'))
      expect(fails('compile', pkg, 'XGFacility_Labs.GetHoursToResearchProject', join(dir, 'f.uc'), '--patch', join(dir, 'x.txt'))).toContain('its declaration changed')
      const cls = run('class', pkg, 'XGFacility_Labs')
      writeFileSync(join(dir, 'c.uc'), cls.replace(/^var int m_iExplosiveNags;/m, 'var float m_iExplosiveNags;'))
      const why = fails('compile', pkg, 'XGFacility_Labs', join(dir, 'c.uc'), '--patch', join(dir, 'x.txt'))
      expect(why).toContain('a changed type is not compiled')
      // A variable's category changed (its modifiers alone do compile), a state's declaration changed: said too.
      writeFileSync(join(dir, 'c.uc'), cls.replace(/^var int m_iExplosiveNags;/m, 'var(Upkit) int m_iExplosiveNags;'))
      expect(fails('compile', pkg, 'XGFacility_Labs', join(dir, 'c.uc'), '--patch', join(dir, 'x.txt'))).toContain('declared otherwise than the package has it')
      const cam = run('class', pkg, 'XComHeadquartersCamera')
      writeFileSync(join(dir, 'cam.uc'), cam.replace(/^state EarthViewTransition$/m, 'simulated state EarthViewTransition'))
      expect(fails('compile', pkg, 'XComHeadquartersCamera', join(dir, 'cam.uc'), '--patch', join(dir, 'x.txt'))).toContain('its state declaration differs')
      // A struct's member changed: said too.
      writeFileSync(join(dir, 'c.uc'), cls.replace(/^( {4})var int m_iExplosiveNags;/m, '$1var float m_iExplosiveNags;'))
      expect(fails('compile', pkg, 'XGFacility_Labs', join(dir, 'c.uc'), '--patch', join(dir, 'x.txt'))).toContain('a changed struct is not compiled')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)
})

describe.skipIf(!haveCorpus)("a struct's defaults edited", () => {
  it('compiled into the struct, as a mod script and as a package', () => {
    const pkg = CORPUS[2]!
    const game = dirname(CORPUS[0]!)
    const dir = mkdtempSync(join(tmpdir(), 'lwtree-upkit-'))
    try {
      const cls = run('class', pkg, 'XGTacticalScreenMgr')
      const edited = cls.replace(/(struct TProgressGraph[\s\S]*?)iProgressState=0/, '$1iProgressState=5')
      expect(edited).not.toBe(cls)
      writeFileSync(join(dir, 'c.uc'), edited)
      expect(run('compile', pkg, 'XGTacticalScreenMgr', join(dir, 'c.uc'), '--patch', join(dir, 'x.txt'))).toContain('XGTacticalScreenMgr.TProgressGraph (default properties)')
      expect(readFileSync(join(dir, 'x.txt'), 'utf8')).toContain('OBJECT=XGTacticalScreenMgr.TProgressGraph')
      run('compile', pkg, 'XGTacticalScreenMgr', join(dir, 'c.uc'), '--out', join(dir, 'new.upk'), '--game', game)
      expect(run('class', join(dir, 'new.upk'), 'XGTacticalScreenMgr', '--game', game)).toMatch(/struct TProgressGraph[\s\S]*?iProgressState=5/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)
})

describe.skipIf(!haveCorpus)('declarations as a mod script, from the command line', () => {
  // What --out writes, as a mod script: with PatchUPK (PATCHUPK), applied to the original,
  // the same package.
  const cases: [string, string, (src: string) => string][] = [
    [
      'a member variable and a function in a class',
      'XGFacility_Labs',
      (src) =>
        src
          .replace('var const localized string m_strCostAlloys;', 'var int m_iUpkitBonus;\nvar const localized string m_strCostAlloys;')
          .replace('function int GetResearchPerHour()', 'function int UpkitBonus(int iBase)\n{\n    return iBase + m_iUpkitBonus;\n}\n\nfunction int GetResearchPerHour()')
          .replace('(1 + m_fLabBonus', '(UpkitBonus(1) + m_fLabBonus'),
    ],
    [
      'a constant, an enum, a struct and a state alone (no variable or function with them)',
      'XGFacility_Labs',
      (src) =>
        src
          .replace('const MELD_TECH_BONUS = 40;', 'const MELD_TECH_BONUS = 40;\nconst UPKIT_STEP = 3;\n\nenum EUpkitMode\n{\n    eUpkit_Off,\n    eUpkit_On\n};\n\nstruct TUpkitPair\n{\n    var int iA;\n};')
          .replace(/^defaultproperties/m, 'state UpkitWaiting\n{\n}\n\ndefaultproperties'),
    ],
    [
      "a value added to an enum the class has, used in a function",
      'XGFacility_Labs',
      (src) => src.replace('    eResearchProgress_Fast\n};', '    eResearchProgress_Fast,\n    eResearchProgress_Upkit\n};').replace('(1 + m_fLabBonus', '(int(eResearchProgress_Upkit) + m_fLabBonus'),
    ],
    ['a new class', 'UpkitHelper', () => 'class UpkitHelper extends Object;\n\nvar int m_iCount;\n\nstatic function int Twice(int i)\n{\n    return i * 2;\n}\n\ndefaultproperties\n{\n    m_iCount=3\n}\n'],
  ]
  for (const [name, cls, edit] of cases)
    it(`${name}`, async () => {
      const pkg = CORPUS[3]!
      const dir = mkdtempSync(join(tmpdir(), 'lwtree-upkit-'))
      try {
        const src = cls === 'UpkitHelper' ? '' : run('class', pkg, cls)
        writeFileSync(join(dir, 'c.uc'), edit(src))
        expect(run('compile', pkg, cls, join(dir, 'c.uc'), '--patch', join(dir, 'mod.txt'))).toContain('as a PatchUPK mod script: declared')
        expect(readFileSync(join(dir, 'mod.txt'), 'utf8')).toMatch(/\[ADD_EXPORT_ENTRY\]|\[BEFORE_HEX\]/)
        run('compile', pkg, cls, join(dir, 'c.uc'), '--out', join(dir, 'out.upk'))
        // upkit apply (the site's engine) makes the same package of the script.
        expectSame(openPackage(new Uint8Array(readFileSync(join(dir, 'out.upk')))), applied(pkg, join(dir, 'mod.txt'), dir))
        if (!process.env.PATCHUPK) return
        const target = join(dir, 'xcomstrategygame.upk')
        writeFileSync(target, openPackage(new Uint8Array(readFileSync(pkg))).bytes)
        const log = execFileSync(process.env.PATCHUPK, [join(dir, 'mod.txt'), dir], { encoding: 'utf8' })
        expect(log).not.toMatch(/Execution stopped|^Bad |^Error/m)
        const a = openPackage(new Uint8Array(readFileSync(join(dir, 'out.upk'))))
        const b = openPackage(new Uint8Array(readFileSync(target)))
        expect(a.names).toEqual(b.names)
        expect(a.imports).toEqual(b.imports)
        expect(a.exports.map((e) => ({ ...e, serialOffset: 0 }))).toEqual(b.exports.map((e) => ({ ...e, serialOffset: 0 })))
        for (let i = 1; i <= a.exports.length; i++) if (Buffer.compare(a.data(i), b.data(i))) throw new Error(`${a.path(i)} differs`)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
})

describe.skipIf(!haveCorpus)('a native class from the command line', () => {
  it('a body edited into a whole package; a function added; a variable refused, as its C++ fixes them', () => {
    const pkg = CORPUS[2]!
    const dir = mkdtempSync(join(tmpdir(), 'lwtree-upkit-'))
    try {
      const src = run('class', pkg, 'XGAction_Fire')
      expect(src).toMatch(/^\s+native$/m)
      writeFileSync(join(dir, 'a.uc'), src.replace('return bReplicationComplete;', 'return !bReplicationComplete;'))
      expect(run('compile', pkg, 'XGAction_Fire', join(dir, 'a.uc'), '--out', join(dir, 'a.upk'))).toContain('compiled XGAction_Fire.')
      const fn = 'function int UpkitTwice(int i)\n{\n    return i * 2;\n}\n\n'
      writeFileSync(join(dir, 'b.uc'), src.replace(/^defaultproperties/m, `${fn}defaultproperties`))
      expect(run('compile', pkg, 'XGAction_Fire', join(dir, 'b.uc'), '--patch', join(dir, 'b.txt'))).toContain('declared XGAction_Fire.UpkitTwice')
      writeFileSync(join(dir, 'c.uc'), src.replace(/^defaultproperties/m, 'var int m_iUpkit;\n\ndefaultproperties'))
      let err = ''
      try {
        execFileSync(process.execPath, [cli, 'compile', pkg, 'XGAction_Fire', join(dir, 'c.uc'), '--out', join(dir, 'c.upk')], { encoding: 'utf8', stdio: 'pipe' })
      } catch (e) {
        err = String((e as { stderr: string }).stderr)
      }
      expect(err).toContain('XGAction_Fire is a native class: its C++ fixes its variables')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe.skipIf(!haveCorpus)("modifiers changed", () => {
  it('made config in a config class, a function made exec: their flags, both ways (with PatchUPK, the same package); refused where the class has no config file, or a type changed', async () => {
    const { readObject } = await import('../src/objects.ts')
    const pkg = CORPUS[2]!
    const dir = mkdtempSync(join(tmpdir(), 'lwtree-upkit-'))
    const fails = (...args: string[]) => {
      try {
        execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', stdio: 'pipe' })
      } catch (e) {
        return String((e as { stderr: string }).stderr)
      }
      return ''
    }
    try {
      const src = run('class', pkg, 'XGTacticalGameCore')
      writeFileSync(join(dir, 'gc.uc'), src.replace('\nvar int m_iDifficulty;', '\nvar config int m_iDifficulty;'))
      const said = run('compile', pkg, 'XGTacticalGameCore', join(dir, 'gc.uc'), '--patch', join(dir, 'gc.txt'))
      expect(said).toContain('modifiers of XGTacticalGameCore.m_iDifficulty')
      expect(said).toContain('its value comes from DefaultGameCore.ini, [XComGame.XGTacticalGameCore] m_iDifficulty=')
      run('compile', pkg, 'XGTacticalGameCore', join(dir, 'gc.uc'), '--out', join(dir, 'gc.upk'))
      const out = openPackage(new Uint8Array(readFileSync(join(dir, 'gc.upk'))))
      const prop = readObject(out, out.find('XGTacticalGameCore.m_iDifficulty')) as { flags: bigint }
      expect(prop.flags & 0x4000n).toBe(0x4000n)
      expect(run('class', join(dir, 'gc.upk'), 'XGTacticalGameCore', '--game', dirname(pkg))).toContain('\nvar config int m_iDifficulty;')
      expectSame(out, applied(pkg, join(dir, 'gc.txt'), dir))
      if (process.env.PATCHUPK) {
        writeFileSync(join(dir, 'xcomgame.upk'), openPackage(new Uint8Array(readFileSync(pkg))).bytes)
        execFileSync(process.env.PATCHUPK, [join(dir, 'gc.txt'), dir], { encoding: 'utf8' })
        const b = openPackage(new Uint8Array(readFileSync(join(dir, 'xcomgame.upk'))))
        for (let i = 1; i <= out.exports.length; i++) if (Buffer.compare(out.data(i), b.data(i))) throw new Error(`${out.path(i)} differs`)
      }
      const ships = run('class', CORPUS[3]!, 'UIShipList')
      writeFileSync(join(dir, 'ui.uc'), ships.replace('\nvar int m_iContinentTransferingTo;', '\nvar config int m_iContinentTransferingTo;'))
      expect(fails('compile', CORPUS[3]!, 'UIShipList', join(dir, 'ui.uc'), '--out', join(dir, 'ui.upk'))).toContain('a config variable needs the class to have a config file')
      // A function made exec (callable from the console): its flags; a changed return type is not compiled.
      const labs = run('class', CORPUS[3]!, 'XGFacility_Labs')
      writeFileSync(join(dir, 'ex.uc'), labs.replace(/^function int GetResearchPerHour\(\)/m, 'exec function int GetResearchPerHour()'))
      expect(run('compile', CORPUS[3]!, 'XGFacility_Labs', join(dir, 'ex.uc'), '--out', join(dir, 'ex.upk'))).toContain('modifiers of XGFacility_Labs.GetResearchPerHour')
      expect(run('decompile', join(dir, 'ex.upk'), 'XGFacility_Labs.GetResearchPerHour', '--game', dirname(pkg))).toContain('exec function int GetResearchPerHour()')
      writeFileSync(join(dir, 'ex2.uc'), labs.replace(/^function int GetResearchPerHour\(\)/m, 'exec function float GetResearchPerHour()'))
      expect(fails('compile', CORPUS[3]!, 'XGFacility_Labs', join(dir, 'ex2.uc'), '--out', join(dir, 'ex2.upk'))).toContain('its declaration changed')
      writeFileSync(join(dir, 'gc2.uc'), src.replace('\nvar int m_iDifficulty;', '\nvar float m_iDifficulty;'))
      expect(fails('compile', pkg, 'XGTacticalGameCore', join(dir, 'gc2.uc'), '--out', join(dir, 'gc2.upk'))).toContain('a changed type is not compiled')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe.skipIf(!haveCorpus)("a hand patch's function edited (its escapes kept)", () => {
  it('a statement added before the escapes: the hand patch kept byte for byte; with PatchUPK, the same package as --out', async () => {
    const pkg = CORPUS[3]!
    const dir = mkdtempSync(join(tmpdir(), 'lwtree-upkit-'))
    try {
      const before = run('decompile', pkg, 'XGFundingCouncil.OnValidRequestAdded')
      const escapes = before.match(/__asm\([^\n;]*/g) ?? []
      expect(escapes.length).toBeGreaterThan(0)
      const src = run('class', pkg, 'XGFundingCouncil')
      writeFileSync(join(dir, 'fc.uc'), src.replace('    m_iFCRequestsThisMonth++;\n', '    m_iFCRequestsThisMonth++;\n    m_iFCRequestsThisMonth += 0;\n'))
      expect(run('compile', pkg, 'XGFundingCouncil', join(dir, 'fc.uc'), '--out', join(dir, 'fc.upk'))).toContain('compiled XGFundingCouncil.OnValidRequestAdded')
      run('compile', pkg, 'XGFundingCouncil', join(dir, 'fc.uc'), '--patch', join(dir, 'fc.txt'))
      // Read back: the edit, and the same escapes (the hand patch's bytes as they were).
      const after = run('decompile', join(dir, 'fc.upk'), 'XGFundingCouncil.OnValidRequestAdded', '--game', dirname(pkg))
      expect(after).toContain('m_iFCRequestsThisMonth += 0;')
      expect(after.match(/__asm\([^\n;]*/g) ?? []).toEqual(escapes)
      expectSame(openPackage(new Uint8Array(readFileSync(join(dir, 'fc.upk')))), applied(pkg, join(dir, 'fc.txt'), dir))
      if (process.env.PATCHUPK) {
        writeFileSync(join(dir, 'xcomstrategygame.upk'), openPackage(new Uint8Array(readFileSync(pkg))).bytes)
        execFileSync(process.env.PATCHUPK, [join(dir, 'fc.txt'), dir], { encoding: 'utf8' })
        const a = openPackage(new Uint8Array(readFileSync(join(dir, 'fc.upk'))))
        const b = openPackage(new Uint8Array(readFileSync(join(dir, 'xcomstrategygame.upk'))))
        for (let i = 1; i <= a.exports.length; i++) if (Buffer.compare(a.data(i), b.data(i))) throw new Error(`${a.path(i)} differs`)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 300_000)
})

describe.skipIf(!existsSync(join(dirname(CORPUS[0]!), '../ew/CookedPCConsole/XComUIShell_SF.upk')))('a seek-free package (its classes inside a package object)', () => {
  it('a class named bare: decompiled, edited, compiled as that class (not declared anew)', () => {
    const pkg = join(dirname(CORPUS[0]!), '../ew/CookedPCConsole/XComUIShell_SF.upk')
    const dir = mkdtempSync(join(tmpdir(), 'lwtree-upkit-'))
    try {
      const src = run('class', pkg, 'UIFinalShell')
      expect(src).toMatch(/^class UIFinalShell\n/)
      writeFileSync(join(dir, 's.uc'), src.replace('myValue.S = m_sSinglePlayer;', 'myValue.S = m_sSinglePlayer $ " (upkit)";'))
      const said = run('compile', pkg, 'UIFinalShell', join(dir, 's.uc'), '--out', join(dir, 's.upk'))
      expect(said).toContain('compiled XComUIShell.UIFinalShell.SetText; 0 names, 0 imports, 0 objects added')
      expect(said).not.toContain('declared')
      expect(run('decompile', join(dir, 's.upk'), 'XComUIShell.UIFinalShell.SetText', '--game', dirname(pkg))).toContain('myValue.S = m_sSinglePlayer $ " (upkit)";')
      // Written uncompressed, not flagged as stored compressed (the game fails to load it so: in the game, 2026-10-22).
      const out = readFileSync(join(dir, 's.upk'))
      expect(out.readUInt32LE(12 + 4 + out.readInt32LE(12)) & 0x02000000).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)
})

describe.skipIf(!existsSync(join(dirname(CORPUS[0]!), '../ew/CookedPCConsole/XComGame.upk')) || !existsSync(join(dirname(CORPUS[0]!), '../ew/CookedPCConsole/XComUIShell_SF.upk')))('upkit apply and restore: mod scripts on the packages as the game ships them', () => {
  it('compressed whole (with its size file) and in chunks: applied decompressed, the originals kept beside the folder, checked, again, restored', () => {
    const ew = join(dirname(CORPUS[0]!), '../ew/CookedPCConsole')
    const dir = mkdtempSync(join(tmpdir(), 'lwtree-upkit-'))
    try {
      const game = join(dir, 'XComGame', 'CookedPCConsole')
      mkdirSync(game, { recursive: true })
      copyFileSync(join(ew, 'XComGame.upk'), join(game, 'XComGame.upk'))
      writeFileSync(join(game, 'XComGame.upk.uncompressed_size'), '12518488\n')
      copyFileSync(join(ew, 'XComUIShell_SF.upk'), join(game, 'XComUIShell_SF.upk'))
      // Two scripts: a function and a variable added to a class (names, objects), and the menu's label.
      const uim = run('class', join(ew, 'XComGame.upk'), 'UIInterfaceMgr')
        .replace('\nvar ', '\nvar int m_iUpkitApplied;\nvar ')
        .replace('simulated function OnInit()\n{\n    super.OnInit();\n', 'simulated function OnInit()\n{\n    super.OnInit();\n    UpkitApplied();\n')
        .replace(/\ndefaultproperties/, '\nfunction UpkitApplied()\n{\n    m_iUpkitApplied += 1;\n}\n\ndefaultproperties')
      writeFileSync(join(dir, 'uim.uc'), uim)
      run('compile', join(ew, 'XComGame.upk'), 'UIInterfaceMgr', join(dir, 'uim.uc'), '--patch', join(dir, 'adds.txt'))
      run('compile', join(ew, 'XComGame.upk'), 'UIInterfaceMgr', join(dir, 'uim.uc'), '--out', join(dir, 'adds.upk'))
      const menu = run('class', join(ew, 'XComUIShell_SF.upk'), 'UIFinalShell').replace('myValue.S = m_sSinglePlayer;', 'myValue.S = m_sSinglePlayer $ " (upkit)";')
      writeFileSync(join(dir, 'menu.uc'), menu)
      run('compile', join(ew, 'XComUIShell_SF.upk'), 'UIFinalShell', join(dir, 'menu.uc'), '--patch', join(dir, 'menu.txt'))
      run('compile', join(ew, 'XComUIShell_SF.upk'), 'UIFinalShell', join(dir, 'menu.uc'), '--out', join(dir, 'menu.upk'))
      const files = () => readdirSync(game).sort()
      const asShipped = files()

      // --check: said, nothing written.
      expect(run('apply', join(dir, 'adds.txt'), join(dir, 'menu.txt'), '--game', game, '--check')).toContain('would change XComGame.upk, XComUIShell_SF.upk')
      expect(existsSync(join(dir, 'XComGame', 'upkit-backup'))).toBe(false)
      expect(Buffer.compare(readFileSync(join(game, 'XComGame.upk')), readFileSync(join(ew, 'XComGame.upk')))).toBe(0)

      const said = run('apply', join(dir, 'adds.txt'), join(dir, 'menu.txt'), '--game', game)
      expect(said).toContain('adds.txt: applies')
      expect(said).toContain('ADD_EXPORT_ENTRY UIInterfaceMgr.UpkitApplied: changes')
      // The originals beside the folder, not in it (the game reads every package under CookedPCConsole).
      expect(readdirSync(join(dir, 'XComGame', 'upkit-backup')).sort()).toEqual(['XComGame.upk', 'XComGame.upk.uncompressed_size', 'XComUIShell_SF.upk'])
      expect(files()).toEqual(['XComGame.upk', 'XComUIShell_SF.upk'])
      const game1 = openPackage(new Uint8Array(readFileSync(join(game, 'XComGame.upk'))))
      expectSame(openPackage(new Uint8Array(readFileSync(join(dir, 'adds.upk')))), game1)
      // The added objects counted among the net objects; the new function linked into the class.
      expect(game1.summary.generations.at(-1)!.netObjects).toBeGreaterThanOrEqual(game1.exports.length)
      expect(run('class', join(game, 'XComGame.upk'), 'UIInterfaceMgr', '--game', ew)).toContain('function UpkitApplied()')
      // Written uncompressed, not flagged as compressed (chunks taken off).
      const shell = readFileSync(join(game, 'XComUIShell_SF.upk'))
      expect(shell.readUInt32LE(12 + 4 + shell.readInt32LE(12)) & 0x02000000).toBe(0)
      expectSame(openPackage(new Uint8Array(readFileSync(join(dir, 'menu.upk')))), openPackage(new Uint8Array(shell)))

      // Again: installed already, nothing changes.
      const again = run('apply', join(dir, 'adds.txt'), join(dir, 'menu.txt'), '--game', game)
      expect(again).toContain('adds.txt: installed already')
      expect(again).toContain('nothing to change')

      // A script that does not fit: nothing written.
      writeFileSync(join(dir, 'bad.txt'), 'UPK_FILE=XComGame.upk\nOBJECT=UIInterfaceMgr.NoSuchFunction\nMODDED_HEX=0B\n')
      const before = readFileSync(join(game, 'XComGame.upk'))
      const refused = (() => {
        try {
          execFileSync(process.execPath, [cli, 'apply', join(dir, 'bad.txt'), '--game', game], { encoding: 'utf8', stdio: 'pipe' })
          return 'applied'
        } catch (e) {
          return String((e as { stdout: string }).stdout)
        }
      })()
      expect(refused).toContain('nothing written')
      expect(Buffer.compare(readFileSync(join(game, 'XComGame.upk')), before)).toBe(0)

      expect(run('restore', '--game', game)).toContain('restored')
      expect(files()).toEqual(asShipped)
      for (const f of ['XComGame.upk', 'XComUIShell_SF.upk']) expect(Buffer.compare(readFileSync(join(game, f)), readFileSync(join(ew, f)))).toBe(0)
      expect(existsSync(join(dir, 'XComGame', 'upkit-backup'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 600_000)
})

describe.skipIf(!haveCorpus)('a class source with code after its defaultproperties', () => {
  it('a function written after the block is compiled as one before it would be', () => {
    const pkg = CORPUS[3]!
    const dir = mkdtempSync(join(tmpdir(), 'lwtree-upkit-'))
    try {
      const src = run('class', pkg, 'XGFacility_Labs')
      const fn = '\nfunction int UpkitAfter(int i)\n{\n    return i + 1;\n}\n'
      writeFileSync(join(dir, 'before.uc'), src.replace(/\ndefaultproperties/, `${fn}\ndefaultproperties`))
      writeFileSync(join(dir, 'after.uc'), `${src.trimEnd()}\n${fn}`)
      expect(run('compile', pkg, 'XGFacility_Labs', join(dir, 'after.uc'), '--patch', join(dir, 'after.txt'))).toContain('declared XGFacility_Labs.UpkitAfter')
      run('compile', pkg, 'XGFacility_Labs', join(dir, 'before.uc'), '--patch', join(dir, 'before.txt'))
      expect(readFileSync(join(dir, 'after.txt'), 'utf8')).toBe(readFileSync(join(dir, 'before.txt'), 'utf8'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)
})

describe.skipIf(!haveCorpus)("a script in upkit's mode (UPK_FILE=…:UPKIT1)", () => {
  it('applied by upkit apply: the package --out writes, its generation counts too', () => {
    const pkg = CORPUS[3]!
    const dir = mkdtempSync(join(tmpdir(), 'lwtree-upkit-'))
    try {
      const src = run('class', pkg, 'XGFacility_Labs')
        .replace('var const localized string m_strCostAlloys;', 'var int m_iUpkitBonus;\nvar const localized string m_strCostAlloys;')
        .replace('function int GetResearchPerHour()', 'function int UpkitBonus(int iBase)\n{\n    return iBase + m_iUpkitBonus;\n}\n\nfunction int GetResearchPerHour()')
      writeFileSync(join(dir, 'c.uc'), src)
      run('compile', pkg, 'XGFacility_Labs', join(dir, 'c.uc'), '--patch', join(dir, 'mod.txt'))
      run('compile', pkg, 'XGFacility_Labs', join(dir, 'c.uc'), '--out', join(dir, 'out.upk'))
      const text = readFileSync(join(dir, 'mod.txt'), 'utf8')
      writeFileSync(join(dir, 'mode.txt'), text.replace(/^UPK_FILE=(.+)$/gm, 'UPK_FILE=$1:UPKIT1'))
      const out = openPackage(new Uint8Array(readFileSync(join(dir, 'out.upk'))))
      const mode = applied(pkg, join(dir, 'mode.txt'), dir)
      expectSame(out, mode)
      expect(mode.summary.generations).toEqual(out.summary.generations)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)
})
