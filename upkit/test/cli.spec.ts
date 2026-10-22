import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { CORPUS, haveCorpus } from './corpus.ts'

// The command line as a modder runs it: the common case end to end, in a scratch folder.
const cli = new URL('../src/cli.ts', import.meta.url).pathname
const run = (...args: string[]) => execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' })

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
    ['a new class', 'UpkitHelper', () => 'class UpkitHelper extends Object;\n\nvar int m_iCount;\n\nstatic function int Twice(int i)\n{\n    return i * 2;\n}\n\ndefaultproperties\n{\n    m_iCount=3\n}\n'],
  ]
  for (const [name, cls, edit] of cases)
    it(name, async () => {
      const { openPackage } = await import('../src/package.ts')
      const pkg = CORPUS[3]!
      const dir = mkdtempSync(join(tmpdir(), 'lwtree-upkit-'))
      try {
        const src = cls === 'UpkitHelper' ? '' : run('class', pkg, cls)
        writeFileSync(join(dir, 'c.uc'), edit(src))
        expect(run('compile', pkg, cls, join(dir, 'c.uc'), '--patch', join(dir, 'mod.txt'))).toContain('as a PatchUPK mod script: declared')
        expect(readFileSync(join(dir, 'mod.txt'), 'utf8')).toContain('[ADD_EXPORT_ENTRY]')
        run('compile', pkg, cls, join(dir, 'c.uc'), '--out', join(dir, 'out.upk'))
        if (!process.env.PATCHUPK) return
        const target = join(dir, 'xcomstrategygame.upk')
        writeFileSync(target, openPackage(new Uint8Array(readFileSync(pkg))).bytes)
        const log = execFileSync(process.env.PATCHUPK, [join(dir, 'mod.txt'), dir], { encoding: 'utf8' })
        expect(log).not.toMatch(/Execution stopped|^Bad |^Error/m)
        const a = openPackage(new Uint8Array(readFileSync(join(dir, 'out.upk'))))
        const b = openPackage(new Uint8Array(readFileSync(target)))
        expect(a.names).toEqual(b.names)
        expect(a.imports).toEqual(b.imports)
        expect(a.exports.map(({ serialOffset: _, ...e }) => e)).toEqual(b.exports.map(({ serialOffset: _, ...e }) => e))
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
    const { openPackage } = await import('../src/package.ts')
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
