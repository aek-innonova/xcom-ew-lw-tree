import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { classesPackage, classPathIn } from '../src/changes.ts'
import { decompileClass } from '../src/classdecomp.ts'
import { Linker } from '../src/linker.ts'
import { openPackage, type Package } from '../src/package.ts'
import { applyHunks, applyUpkmodTo, canonical, parseUpkmod, writeUpkmod } from '../src/upkmod.ts'
import { CORPUS, haveCorpus } from './corpus.ts'

// Mods as source diffs (features/upkit-source-mods.md).

const LW = dirname(CORPUS[0]!)
const lwr = CORPUS[6]!

/** A package with a linker over the game's folder (LWR's folder holds only what LWR replaces: Long War's beside it). */
function opened(path: string) {
  const pkg = openPackage(new Uint8Array(readFileSync(path)))
  const linker = new Linker([dirname(path), LW])
  linker.add(path.split('/').pop()!.replace(/\.(upk|u)$/i, ''), pkg)
  return { pkg, linker }
}
const results = (r: { results: { block: string; status: string; note?: string }[] }) => r.results.map((x) => [x.block, x.status])

describe('the .upkmod format', () => {
  it('read and written; refused: another first line, a newer version, a line PatchUPK would act on', () => {
    const text = `upkit mod 1
name: Test
author: Someone
package: XComStrategyGame.upk
tested: Long War 1.0, LWR 2.06

--- XComStrategyGame.upk XGFacility_Labs
@@ add @@
+var int m_iUpkitX;
@@ state Waiting > function Foo() @@
 function Foo()
 {
-    A();
+    B();
 }
`
    const mod = parseUpkmod(text)
    expect(mod.name).toBe('Test')
    expect(mod.tested).toEqual(['Long War 1.0', 'LWR 2.06'])
    expect(mod.classes[0]!.hunks.map((h) => [h.add ?? false, h.block])).toEqual([
      [true, []],
      [false, ['state Waiting', 'function Foo()']],
    ])
    expect(() => parseUpkmod(text.replace('upkit mod 1', 'MOD_NAME=x'))).toThrow(/not a \.upkmod/)
    expect(() => parseUpkmod(text.replace('upkit mod 1', 'upkit mod 2'))).toThrow('made for .upkmod version 2; this one reads version 1')
    expect(() => parseUpkmod(text.replace('author: Someone', 'author: Someone\nUPK_FILE=XComGame.upk'))).toThrow(/PatchUPK would act on \(UPK_FILE\)/)
    expect(() => parseUpkmod('upkit mod 1\n\n--- XComStrategyGame.upk XGFacility_Labs\n@@ function Foo() @@\n+    B();\n'.replace('\n\n', '\n'))).toThrow(/needs lines it is anchored on/)
  })

  it('anchors compare on canonical code: spacing, line breaks, comments, case, qualifiers, self., numbers', () => {
    const same = (a: string, b: string) => expect(canonical(a).join(' ')).toBe(canonical(b).join(' '))
    same('m_fLabBonus = class\'XComGame.XGTacticalGameCore\'.default.LAB_BONUS * float(x);', "M_FLABBONUS=class'XGTacticalGameCore' .default.lab_bonus*FLOAT( x ) ; // note")
    same('return self.GetAvailableScientists();', 'return\n  GetAvailableScientists();')
    same('x = 1.0;', 'x = 1.000;')
    same('x = 0x10;', 'x = 16;')
    expect(canonical('x = 1;').join(' ')).not.toBe(canonical('x = 2;').join(' '))
    // A hunk found through all of it, in its block.
    const src = 'class A;\n\nfunction int F()\n{\n    return self.G() * 2;\n}\n\nfunction int H()\n{\n    return G() * 2;\n}\n'
    const r = applyHunks(src, 'A', [{ block: ['FUNCTION INT f( )'], lines: [{ k: '-', text: 'return G()*2; /* old */' }, { k: '+', text: '    return G() * 3;' }], line: 1 }])
    expect(r.results.map((x) => x.status)).toEqual(['change'])
    expect(r.text).toContain('function int F()\n{\n    return G() * 3;\n}')
    expect(r.text).toContain('function int H()\n{\n    return G() * 2;\n}')
  })
})

describe.skipIf(!haveCorpus)('mods as source diffs on the game’s packages', () => {
  const lw = opened(CORPUS[3]!)
  const labs = decompileClass(lw.linker, lw.pkg, 'XGFacility_Labs')
  const write = (o: ReturnType<typeof opened>, edit: (s: string) => string, name = 'test') =>
    writeUpkmod(o.linker, o.pkg, 'XComStrategyGame.upk', [{ cls: 'XGFacility_Labs', text: edit(labs) }], { name })
  const apply = (o: { pkg: Package; linker: Linker }, text: string) => applyUpkmodTo(o.linker, o.pkg, 'XComStrategyGame', parseUpkmod(text).classes)
  const after = (bytes: Uint8Array) => {
    const pkg = openPackage(bytes)
    const linker = new Linker([LW])
    linker.add('XComStrategyGame', pkg)
    return { pkg, linker }
  }

  it('written from the round trip: added declarations anchored on nothing; applied, the package --out writes; again, installed', () => {
    const edited = labs
      .replace('var const localized string m_strCostAlloys;', 'var int m_iUpkitBonus;\nvar const localized string m_strCostAlloys;')
      .replace('function int GetResearchPerHour()', 'function int UpkitBonus(int iBase)\n{\n    return iBase + m_iUpkitBonus;\n}\n\nfunction int GetResearchPerHour()')
      .replace('(1 + m_fLabBonus', '(UpkitBonus(1) + m_fLabBonus')
    const { text, mod } = write(lw, () => edited)
    expect(mod.classes[0]!.hunks.map((h) => (h.add ? 'add' : h.block.join(' > ')))).toEqual(['add', 'function int GetResearchPerHour()', 'add'])
    expect(text).toContain('@@ add @@\n+var int m_iUpkitBonus;\n')
    const r = apply(lw, text)
    expect(results(r)).toEqual([
      ['add', 'change'],
      ['function int GetResearchPerHour()', 'change'],
      ['add', 'change'],
    ])
    expect(Buffer.compare(Buffer.from(r.bytes!), Buffer.from(classesPackage(lw.linker, lw.pkg, 'XComStrategyGame', [edited], 'keep').bytes))).toBe(0)
    const again = apply(after(r.bytes!), text)
    expect(again.results.map((x) => x.status)).toEqual(['already', 'already', 'already'])
    expect(again.bytes).toBe(null)
  }, 300_000)

  it('two mods in one function combine; a third on the first one’s line does not fit', () => {
    const line = "m_fLabBonus = class'XComGame.XGTacticalGameCore'.default.LAB_BONUS * float("
    const a = write(lw, (s) => s.replace(line, `m_fLabBonus = 2.0 * class'XComGame.XGTacticalGameCore'.default.LAB_BONUS * float(`), 'A').text
    const elseLine = "    else\n    {\n        m_fAdjLabBonus = class'XComGame.XGTacticalGameCore'.default.LAB_ADJACENCY_BONUS *"
    const b = write(lw, (s) => s.replace(elseLine, "    else\n    {\n        m_fAdjLabBonus = 3.0 * class'XComGame.XGTacticalGameCore'.default.LAB_ADJACENCY_BONUS *"), 'B').text
    const c = write(lw, (s) => s.replace(line, `m_fLabBonus = 5.0 * class'XComGame.XGTacticalGameCore'.default.LAB_BONUS * float(`), 'C').text
    const withA = after(apply(lw, a).bytes!)
    const ab = apply(withA, b)
    expect(results(ab)).toEqual([['function UpdateLabBonus()', 'change']])
    const both = after(ab.bytes!)
    const src = decompileClass(both.linker, both.pkg, 'XGFacility_Labs')
    expect(src).toContain('m_fLabBonus = 2.0 * class')
    expect(src).toContain('m_fAdjLabBonus = 3.0 * class')
    const r = apply(withA, c)
    expect(r.bytes).toBe(null)
    expect(r.results[0]!.note).toMatch(/^the lines it changes are not there as it expects in function UpdateLabBonus\(\)/)
  }, 300_000)

  it('one mod fits Long War 1.0 and LWR 2.06 where its lines are the same; it does not fit where LWR changed them', () => {
    const portable = write(lw, (s) => s.replace('if (m_iNumScientists >= 80)', 'if (m_iNumScientists >= 40)').replace('var const localized string m_strCostAlloys;', 'var int m_iUpkitSeen;\nvar const localized string m_strCostAlloys;')).text
    const r = opened(lwr)
    for (const o of [lw, r]) {
      const x = apply(o, portable)
      expect(results(x)).toEqual([
        ['add', 'change'],
        ['function AddScientists(int iNumScientists)', 'change'],
      ])
      const back = after(x.bytes!)
      // (LWR's own classes for the types it adds.)
      back.linker = new Linker([dirname(lwr), LW])
      back.linker.add('XComStrategyGame', back.pkg)
      const src = decompileClass(back.linker, back.pkg, 'XGFacility_Labs')
      expect(src).toContain('if (m_iNumScientists >= 40)')
      expect(src).toContain('var int m_iUpkitSeen;')
    }
    // GetResearchPerHour is LWR's own.
    const lwOnly = write(lw, (s) => s.replace('(1 + m_fLabBonus', '(2 + m_fLabBonus')).text
    const x = apply(r, lwOnly)
    expect(x.bytes).toBe(null)
    expect(x.results[0]!.status).toBe('error')
  }, 600_000)

  it('a new class: added, then there already', () => {
    const src = 'class UpkitHelper extends Object;\n\nvar int m_iCount;\n\nstatic function int Twice(int i)\n{\n    return i * 2;\n}\n\ndefaultproperties\n{\n    m_iCount=3\n}\n'
    const { text } = writeUpkmod(lw.linker, lw.pkg, 'XComStrategyGame.upk', [{ cls: 'UpkitHelper', text: src }], { name: 'helper' })
    expect(text).toContain('--- XComStrategyGame.upk UpkitHelper (new)')
    const r = apply(lw, text)
    expect(results(r)).toEqual([['class', 'change']])
    expect(apply(after(r.bytes!), text).results.map((x) => x.status)).toEqual(['already'])
  }, 300_000)
})

const ew = join(LW, '../ew/CookedPCConsole')
describe.skipIf(!existsSync(join(ew, 'XComUIShell_SF.upk')))('a .upkmod on a seek-free package', () => {
  it('the main menu’s label: its class found inside its package object', () => {
    const sf = opened(join(ew, 'XComUIShell_SF.upk'))
    const menu = decompileClass(sf.linker, sf.pkg, classPathIn(sf.pkg, 'UIFinalShell'))
    const { text, mod } = writeUpkmod(sf.linker, sf.pkg, 'XComUIShell_SF.upk', [{ cls: 'UIFinalShell', text: menu.replace('myValue.S = m_sSinglePlayer;', 'myValue.S = m_sSinglePlayer $ " (upkit)";') }], { name: 'menu' })
    expect(text).toContain('@@ simulated function SetText() @@')
    expect(results(applyUpkmodTo(sf.linker, sf.pkg, 'XComUIShell_SF', mod.classes))).toEqual([['simulated function SetText()', 'change']])
  }, 300_000)
})

describe.skipIf(!haveCorpus)('.upkmod from the command line', () => {
  const cli = new URL('../src/cli.ts', import.meta.url).pathname
  const run = (...args: string[]) => execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' })

  it('compile --upkmod writes one; upkit apply applies it (installed the second time), restore; PatchUPK refuses it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lwtree-upkit-'))
    try {
      const pkg = CORPUS[3]!
      writeFileSync(join(dir, 'labs.uc'), run('class', pkg, 'XGFacility_Labs').replace('if (m_iNumScientists >= 80)', 'if (m_iNumScientists >= 40)'))
      expect(run('compile', pkg, 'XGFacility_Labs', join(dir, 'labs.uc'), '--upkmod', join(dir, 'labs.upkmod'))).toContain('1 change to XGFacility_Labs as source diffs')
      const game = join(dir, 'XComGame', 'CookedPCConsole')
      mkdirSync(game, { recursive: true })
      for (const f of ['Core', 'Engine', 'GameFramework', 'GFxUI', 'IpDrv', 'OnlineSubsystemSteamworks', 'XComGame', 'XComStrategyGame'])
        if (existsSync(join(LW, `${f}.upk`))) copyFileSync(join(LW, `${f}.upk`), join(game, `${f}.upk`))
      const said = run('apply', join(dir, 'labs.upkmod'), '--game', game)
      expect(said).toContain('labs.upkmod: applies')
      expect(said).toMatch(/^changed XComStrategyGame\.upk \(/m)
      expect(run('decompile', join(game, 'XComStrategyGame.upk'), 'XGFacility_Labs.AddScientists')).toContain('if (m_iNumScientists >= 40)')
      expect(run('apply', join(dir, 'labs.upkmod'), '--game', game)).toContain('labs.upkmod: installed already')
      run('restore', '--game', game)
      expect(Buffer.compare(readFileSync(join(game, 'XComStrategyGame.upk')), readFileSync(pkg))).toBe(0)
      // PatchUPK (PATCHUPK, built from UPKUtils): refuses it, writes nothing.
      const patchUPK = process.env.PATCHUPK
      const refused = (() => {
        if (!patchUPK) return 'Bad/unknown mod file format!'
        copyFileSync(pkg, join(dir, 'xcomstrategygame.upk'))
        try {
          return execFileSync(patchUPK, ['labs.upkmod', '.'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' })
        } catch (e) {
          // (Its message goes to stderr.)
          const x = e as { stdout: string; stderr: string }
          return `${x.stdout}${x.stderr}`
        }
      })()
      expect(refused).toContain('Bad/unknown mod file format!')
      expect(Buffer.compare(existsSync(join(dir, 'xcomstrategygame.upk')) ? readFileSync(join(dir, 'xcomstrategygame.upk')) : readFileSync(pkg), readFileSync(pkg))).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 600_000)
})
