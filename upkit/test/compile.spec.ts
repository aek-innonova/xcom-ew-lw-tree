import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { openPackage } from '../src/package.ts'
import { readStructHead } from '../src/objects.ts'
import { FunctionDecompiler } from '../src/decompile.ts'
import { binaryOperators, FunctionCompiler } from '../src/compile.ts'
import { Linker } from '../src/linker.ts'
import { CORPUS, haveCorpus, load, short } from './corpus.ts'

/** Decompile every function, compile it back, and count those that come out byte for byte. */
export function roundTrip(path: string, linker: Linker, limit = Infinity) {
  const pkg = load(path)
  linker.add(short(path).replace(/^lwr\//, '').replace(/\.(upk|u)$/, ''), pkg)
  const ops = binaryOperators(linker)
  let total = 0
  let same = 0
  const why = new Map<string, { n: number; eg: string }>()
  const note = (k: string, eg: string) => {
    const w = why.get(k) ?? { n: 0, eg }
    w.n++
    why.set(k, w)
  }
  for (let i = 1; i <= pkg.exports.length && total < limit; i++) {
    if (pkg.className(i) !== 'Function') continue
    const h = readStructHead(pkg, i)
    if (!h.size) continue
    total++
    const orig = pkg.data(i).subarray(h.scriptAt, h.end)
    let text = ''
    try {
      text = new FunctionDecompiler(linker, pkg, i).decompile()
      const out = new FunctionCompiler(linker, pkg, i).compile(text, ops)
      if (out.code.length === orig.length && out.code.every((b, k) => b === orig[k])) same++
      else {
        const k = out.code.findIndex((b, j) => b !== orig[j])
        const at = k < 0 ? Math.min(out.code.length, orig.length) : k
        note(`differs: orig ${orig[at]?.toString(16)} ours ${out.code[at]?.toString(16)}`, pkg.path(i))
      }
    } catch (e) {
      note(`error: ${(e as Error).message.replace(/\d+/g, '#').replace(/'[^']*'/g, "'…'").slice(0, 80)}`, pkg.path(i))
    }
  }
  return { total, same, why }
}

describe.skipIf(!haveCorpus)('compiler: decompiled, compiled back, byte for byte', () => {
  // Each package against the ones it is installed with (LWR's own XComGame for LWRebalance), then the game's.
  for (const path of [CORPUS[3]!, CORPUS[2]!, CORPUS[4]!, CORPUS[0]!, CORPUS[1]!])
    it(`${short(path)}`, () => {
      const r = roundTrip(path, new Linker([...new Set([dirname(path), dirname(CORPUS[0]!)])]))
      console.log(`${short(path)}: ${r.same} of ${r.total} functions identical (${((100 * r.same) / r.total).toFixed(1)}%)`)
      for (const [k, v] of [...r.why].sort((a, b) => b[1].n - a[1].n).slice(0, 25)) console.log(`  ${String(v.n).padStart(5)} ${k}   e.g. ${v.eg}`)
      expect(r.same).toBeGreaterThan(0)
    })
})

describe.skipIf(!haveCorpus)('an edit, end to end', () => {
  it('a function decompiled, changed, compiled into a new package and as a mod script', async () => {
    const { withScript } = await import('../src/edit.ts')
    const { writePackage } = await import('../src/writer.ts')
    const { Package } = await import('../src/package.ts')
    const { modScript } = await import('../src/patch.ts')
    const linker = new Linker([dirname(CORPUS[0]!)])
    const pkg = load(CORPUS[3]!)
    linker.add('XComStrategyGame', pkg)
    const ref = pkg.find('XGFacility_Labs.GetResearchPerHour')
    const text = new FunctionDecompiler(linker, pkg, ref).decompile()
    expect(text).toContain('float(1) + m_fLabBonus')
    const edited = text.replace('float(1) + m_fLabBonus', 'float(2) + m_fLabBonus')
    const fc = new FunctionCompiler(linker, pkg, ref)
    const { code, memSize } = fc.compile(edited, binaryOperators(linker))
    const out = new Package(writePackage(pkg, { data: new Map([[ref, withScript(pkg, ref, code, memSize)]]) }))
    const back = new Linker([dirname(CORPUS[0]!)])
    back.add('XComStrategyGame', out)
    expect(new FunctionDecompiler(back, out, ref).decompile()).toContain('float(2) + m_fLabBonus')
    const mod = modScript({ name: 'test' }, [{ upk: 'XComStrategyGame.upk', pkg, ref, statements: new FunctionCompiler(linker, pkg, ref).compileStatements(edited, binaryOperators(linker)) }])
    expect(mod).toContain('OBJECT=XGFacility_Labs.GetResearchPerHour:AUTO')
    expect(mod).toContain('2C 02')
  })
})

describe.skipIf(!haveCorpus)('edits that add to the package', () => {
  const SOURCE = `function int GetResearchPerHour()
{
    local float fBonus;
    local array<int> arrSeen;

    fBonus = 1.0 + m_fLabBonus + m_fAdjLabBonus;
    arrSeen.AddItem(GetAvailableScientists());
    if (IsInState('UpkitBrandNewStateName'))
    {
        fBonus += 0.5;
    }
    return int(float(GetAvailableScientists()) * fBonus);
}
`
  it('new locals and a new name, into a whole package that reads back and compiles the same against itself', async () => {
    const { withScript } = await import('../src/edit.ts')
    const { writePackage } = await import('../src/writer.ts')
    const { Package } = await import('../src/package.ts')
    const { readObject } = await import('../src/objects.ts')
    const linker = new Linker([dirname(CORPUS[0]!)])
    const pkg = load(CORPUS[3]!)
    linker.add('XComStrategyGame', pkg)
    const ref = pkg.find('XGFacility_Labs.GetResearchPerHour')
    const fc = new FunctionCompiler(linker, pkg, ref)
    fc.allow = 'all'
    const { code, memSize } = fc.compile(SOURCE, binaryOperators(linker))
    const add = fc.additions()
    expect(add.exports.length).toBe(3) // fBonus, arrSeen and its inner int
    const out = new Package(
      writePackage(pkg, { data: new Map([[ref, withScript(pkg, ref, code, memSize, add.children)], ...add.edits]), ...add }),
    )
    // The new locals follow the function's own children (its return value here): parameters stay first.
    const chain: string[] = []
    for (let c = (readObject(out, ref) as { head: { children: number } }).head.children; c; c = (readObject(out, c) as { next: number }).next)
      chain.push(out.objectName(c))
    expect(chain).toEqual(['ReturnValue', 'fBonus', 'arrSeen'])
    // Every new object reads to its end; the function lists its new locals.
    for (let i = pkg.exports.length + 1; i <= out.exports.length; i++) expect(readObject(out, i)).not.toBeNull()
    const back = new Linker([dirname(CORPUS[0]!)])
    back.add('XComStrategyGame', out)
    const text = new FunctionDecompiler(back, out, ref).decompile()
    expect(text).toContain('local float fBonus;')
    expect(text).toContain('local array<int> arrSeen;')
    expect(text).toContain("IsInState('UpkitBrandNewStateName')")
    // The new package's function, decompiled and compiled against itself: the same bytes.
    const again = new FunctionCompiler(back, out, ref).compile(text, binaryOperators(back)).code
    const h = (await import('../src/objects.ts')).readStructHead(out, ref)
    expect([...again]).toEqual([...out.data(ref).subarray(h.scriptAt, h.end)])
  })

  it('a new name, as a mod script the app’s PatchUPK implementation applies', async () => {
    const { modScript } = await import('../src/patch.ts')
    const { Package: AppPackage } = await import('../../src/model/upk.ts')
    const { runScript } = await import('../../src/model/modpatch.ts')
    const { Package } = await import('../src/package.ts')
    const linker = new Linker([dirname(CORPUS[0]!)])
    const pkg = load(CORPUS[3]!)
    linker.add('XComStrategyGame', pkg)
    const ref = pkg.find('XGFacility_Labs.GetResearchPerHour')
    const src = SOURCE.replace(/ *local .*\n/g, '').replace(/fBonus/g, 'm_fLabBonus').replace(/.*arrSeen.*\n/, '')
    const fc = new FunctionCompiler(linker, pkg, ref)
    fc.allow = 'names'
    const statements = fc.compileStatements(src, binaryOperators(linker))
    const text = modScript({ name: 'test' }, [{ upk: 'XComStrategyGame.upk', pkg, ref, statements, names: fc.added.names }])
    const copy = new AppPackage(pkg.bytes.slice())
    const result = runScript(text, { open: () => copy })
    expect(result.steps.filter((s) => s.status === 'error')).toEqual([])
    const out = new Package(copy.bytes)
    const back = new Linker([dirname(CORPUS[0]!)])
    back.add('XComStrategyGame', out)
    expect(new FunctionDecompiler(back, out, ref).decompile()).toContain("IsInState('UpkitBrandNewStateName')")
  })
})

describe.skipIf(!haveCorpus)('a whole class edited', () => {
  // A function and a state's code (with a new label) changed in the class's source.
  const edit = (src: string) =>
    src
      .replace(/(state EarthViewTransition[\s\S]*?Begin:\n {4})Sleep\(0\.01\);/, '$1Sleep(0.5);\nDone:\n    Sleep(0.25);')
      .replace(/(function bool IsMoving\(\)\n\{\n[\s\S]*?)return /, '$1if (true) { return true; }\n    return ')
      // A default changed, and one added (the default object grows).
      .replace('DefaultFOV=30.0', 'DefaultFOV=45.0\n    fEarthTransitionInterp=2.5')

  it('compiles what was edited, into a package and as a mod script, which agree', async () => {
    const { decompileClass } = await import('../src/classdecomp.ts')
    const { classChanges } = await import('../src/classsrc.ts')
    const { packageWith, modScriptWith } = await import('../src/changes.ts')
    const { defaultsBlock } = await import('../src/defaults.ts')
    const { Package } = await import('../src/package.ts')
    const { Package: AppPackage } = await import('../../src/model/upk.ts')
    const { runScript } = await import('../../src/model/modpatch.ts')
    const { readObject, readStructHead } = await import('../src/objects.ts')
    const linker = new Linker([dirname(CORPUS[0]!)])
    const pkg = load(CORPUS[3]!)
    linker.add('XComStrategyGame', pkg)
    const src = decompileClass(linker, pkg, 'XComHeadquartersCamera')
    expect(classChanges(linker, pkg, 'XComHeadquartersCamera', src)).toEqual([])
    const edited = edit(src)
    const changes = classChanges(linker, pkg, 'XComHeadquartersCamera', edited)
    expect(changes.map((c) => c.path).sort()).toEqual(['XComHeadquartersCamera.EarthViewTransition', 'XComHeadquartersCamera.IsMoving'])

    const check = (out: InstanceType<typeof Package>) => {
      const back = new Linker([dirname(CORPUS[0]!)])
      back.add('XComStrategyGame', out)
      const state = out.find('XComHeadquartersCamera.EarthViewTransition')
      const code = new FunctionDecompiler(back, out, state).decompileStateCode()
      expect(code).toContain('Sleep(0.5);\nDone:\n    Sleep(0.25);')
      // The state keeps where its label table now starts.
      const so = readObject(out, state) as { labelTableOffset: number }
      const h = readStructHead(out, state)
      const decoded = new FunctionCompiler(back, out, state).compileStateCode(code, binaryOperators(back))
      expect(so.labelTableOffset).toBe(decoded.labelTableOffset)
      expect(h.size).toBeGreaterThan(0)
      expect(new FunctionDecompiler(back, out, out.find('XComHeadquartersCamera.IsMoving')).decompile()).toContain('if (true)')
      return code
    }
    const defaults = { classRef: pkg.find('XComHeadquartersCamera'), block: defaultsBlock(edited)! }
    const whole = new Package(packageWith(linker, pkg, changes, 'keep', defaults).bytes)
    const a = check(whole)
    const mod = modScriptWith(linker, pkg, 'XComStrategyGame.upk', changes, { name: 'test' }, defaults)
    expect(mod.text).toContain('REL_OFFSET=')
    expect(mod.text).toContain('OBJECT=Default__XComHeadquartersCamera:AUTO')
    const copy = new AppPackage(pkg.bytes.slice())
    const result = runScript(mod.text, { open: () => copy })
    expect(result.steps.filter((s) => s.status === 'error')).toEqual([])
    const patched = new Package(copy.bytes)
    const b = check(patched)
    expect(b).toEqual(a)
    // The default object, the same either way, and as edited.
    const dobj = pkg.find('Default__XComHeadquartersCamera')
    expect([...patched.data(dobj)]).toEqual([...whole.data(dobj)])
    const back = new Linker([dirname(CORPUS[0]!)])
    back.add('XComStrategyGame', whole)
    const text = decompileClass(back, whole, 'XComHeadquartersCamera')
    expect(text).toContain('DefaultFOV=45.0\n    fEarthTransitionInterp=2.5\n}')
  })
})

describe.skipIf(!haveCorpus)('new declarations in a class', () => {
  it('a member variable, an array, a function calling it and a default: declared, compiled, read back', async () => {
    const { decompileClass } = await import('../src/classdecomp.ts')
    const { classesPackage } = await import('../src/changes.ts')
    const { Package } = await import('../src/package.ts')
    const { readObject } = await import('../src/objects.ts')
    const linker = new Linker([dirname(CORPUS[0]!)])
    const pkg = load(CORPUS[3]!)
    linker.add('XComStrategyGame', pkg)
    let src = decompileClass(linker, pkg, 'XGFacility_Labs')
    const v = src.indexOf('\nvar')
    src = src.slice(0, v) + '\nvar config float m_fUpkitBonus;\nvar array<string> m_arrUpkitLog;' + src.slice(v)
    src = src.replace('(1 + m_fLabBonus', '(1 + UpkitBonus(2) + m_fLabBonus')
    const d = src.indexOf('\ndefaultproperties')
    src =
      src.slice(0, d) +
      `
function float UpkitBonus(int iScale, optional string strWhy)
{
    local int iCount;

    iCount = m_arrUpkitLog.Length;
    m_arrUpkitLog.AddItem("bonus " $ string(iScale) $ strWhy);
    return m_fUpkitBonus * float(iScale) + float(iCount);
}
` +
      src.slice(d)
    src = src.replace('defaultproperties\n{', 'defaultproperties\n{\n    m_fUpkitBonus=0.25')
    const r = classesPackage(linker, pkg, 'XComStrategyGame', [src])
    expect(r.declared).toEqual(['XGFacility_Labs.m_fUpkitBonus', 'XGFacility_Labs.m_arrUpkitLog', 'XGFacility_Labs.UpkitBonus'])
    const out = new Package(r.bytes)
    // Every object reads to its end.
    for (let i = 1; i <= out.exports.length; i++) expect(() => readObject(out, i)).not.toThrow()
    const back = new Linker([dirname(CORPUS[0]!)])
    back.add('XComStrategyGame', out)
    const text = decompileClass(back, out, 'XGFacility_Labs')
    expect(text).toContain('var config float m_fUpkitBonus;')
    expect(text).toContain('var array<string> m_arrUpkitLog;')
    expect(text).toContain('function float UpkitBonus(int iScale, optional string strWhy)')
    expect(text).toContain('m_fUpkitBonus=0.25')
    expect(text).toContain('UpkitBonus(2)')
    // The new function: in the class's function map, parameters first in its fields, and compiled back the same.
    const fn = out.find('XGFacility_Labs.UpkitBonus')
    const cls = readObject(out, out.find('XGFacility_Labs')) as { funcMap: { name: string; func: number }[] }
    expect(cls.funcMap.find((f) => f.name === 'UpkitBonus')?.func).toBe(fn)
    const chain: string[] = []
    for (let c = (readObject(out, fn) as { head: { children: number } }).head.children; c; c = (readObject(out, c) as { next: number }).next)
      chain.push(out.objectName(c))
    expect(chain).toEqual(['iScale', 'strWhy', 'ReturnValue', 'iCount'])
    const again = new FunctionDecompiler(back, out, fn).decompile()
    const h = (await import('../src/objects.ts')).readStructHead(out, fn)
    expect([...new FunctionCompiler(back, out, fn).compile(again, binaryOperators(back)).code]).toEqual([...out.data(fn).subarray(h.scriptAt, h.end)])
  })
})

describe.skipIf(!haveCorpus)('a new script package', () => {
  it('two classes that use each other, from their sources: declared, compiled, read back as written', async () => {
    const { readFileSync } = await import('node:fs')
    const { classesPackage } = await import('../src/changes.ts')
    const { decompileClass } = await import('../src/classdecomp.ts')
    const { emptyPackage } = await import('../src/writer.ts')
    const { openPackage } = await import('../src/package.ts')
    const { readObject } = await import('../src/objects.ts')
    const { lex } = await import('../src/parse.ts')
    const linker = new Linker([dirname(CORPUS[0]!)])
    const sources = ['UpkitModInfo', 'UpkitModData'].map((n) => readFileSync(new URL(`./fixtures/${n}.uc`, import.meta.url), 'utf8'))
    const r = classesPackage(linker, openPackage(emptyPackage(linker.package('Core')!)), 'UpkitMod', sources)
    const out = openPackage(r.bytes)
    for (let i = 1; i <= out.exports.length; i++) expect(() => readObject(out, i)).not.toThrow()
    const back = new Linker([dirname(CORPUS[0]!)])
    back.add('UpkitMod', out)
    // Each class decompiles to its source (token for token, the header and local lists aside).
    const body = (src: string) =>
      lex(src.slice(src.indexOf(';') + 1).replace(/local int I, iTotal;/, 'local int I; local int iTotal;'))
        .map((t) => t.v)
        .join(' ')
    expect(body(decompileClass(back, out, 'UpkitModData'))).toBe(body(sources[1]!))
    const info = decompileClass(back, out, 'UpkitModInfo')
    expect(body(info)).toBe(body(sources[0]!))
    expect(info).toContain('extends Info')
  })
})

describe.skipIf(!haveCorpus)('a mod package rebuilt from its decompiled source', () => {
  it('LWRebalance.u: every class decompiled, built anew as a package, compared with the original', async () => {
    const { classesPackage } = await import('../src/changes.ts')
    const { ClassDecompiler } = await import('../src/classdecomp.ts')
    const { emptyPackage } = await import('../src/writer.ts')
    const { openPackage } = await import('../src/package.ts')
    const { sameCode, sameDeclarations } = await import('./support/compare.ts')
    const path = CORPUS[4]!
    const orig = load(path)
    const linker = new Linker([dirname(path), dirname(CORPUS[0]!)])
    linker.add('LWRebalance', orig)
    const sources: string[] = []
    for (let ref = 1; ref <= orig.exports.length; ref++)
      if (orig.className(ref) === 'Class') sources.push(new ClassDecompiler(linker, orig, ref, false).decompile())
    const fresh = new Linker([dirname(path), dirname(CORPUS[0]!)])
    const built = openPackage(classesPackage(fresh, openPackage(emptyPackage(fresh.package('Core')!)), 'LWRebalance', sources).bytes)
    const code = sameCode(orig, built, 'LWRebalance')
    const decl = sameDeclarations(orig, built, 'LWRebalance')
    console.log(`LWRebalance.u rebuilt: code ${code.same}/${code.total} (${((100 * code.same) / code.total).toFixed(1)}%), declarations ${decl.same}/${decl.total} (${((100 * decl.same) / decl.total).toFixed(1)}%)`)
    // As compiling each function back in place (the rest: LWR built against its own stubs of the game).
    expect(code.same / code.total).toBeGreaterThan(0.96)
    expect(decl.same / decl.total).toBeGreaterThan(0.995)
    // Its imports: each the original has, imported as the original imports it (its class's package and name).
    const how = (p: typeof orig, i: number) => `${p.name(p.imports[-i - 1]!.classPackage)}.${p.name(p.imports[-i - 1]!.className)}`.toLowerCase()
    const theirs = new Map<string, string>()
    for (let i = 1; i <= orig.imports.length; i++) theirs.set(orig.path(-i).toLowerCase(), how(orig, -i))
    const otherwise: string[] = []
    for (let i = 1; i <= built.imports.length; i++) {
      const t = theirs.get(built.path(-i).toLowerCase())
      if (t !== undefined && t !== how(built, -i)) otherwise.push(built.path(-i))
    }
    expect(otherwise).toEqual([])
  }, 180_000)
})

describe.skipIf(!haveCorpus)('the other mod packages beside LWR, rebuilt from their decompiled source', () => {
  it('each built anew; together, their code as the originals', async () => {
    const { readdirSync } = await import('node:fs')
    const { classesPackage } = await import('../src/changes.ts')
    const { ClassDecompiler } = await import('../src/classdecomp.ts')
    const { emptyPackage } = await import('../src/writer.ts')
    const { openPackage } = await import('../src/package.ts')
    const { sameCode } = await import('./support/compare.ts')
    const dir = dirname(CORPUS[4]!)
    // (XComModShell names XComUIShell.UIFinalShell, in no package the samples have.)
    const mods = readdirSync(dir).filter((f) => f.endsWith('.u') && !['LWRebalance.u', 'XComModShell.u'].includes(f))
    let total = 0
    let same = 0
    for (const f of mods) {
      const name = f.slice(0, -2)
      const orig = load(`${dir}/${f}`)
      const linker = new Linker([dir, dirname(CORPUS[0]!)])
      linker.add(name, orig)
      const sources: string[] = []
      for (let ref = 1; ref <= orig.exports.length; ref++)
        if (orig.className(ref) === 'Class') sources.push(new ClassDecompiler(linker, orig, ref, false).decompile())
      const fresh = new Linker([dir, dirname(CORPUS[0]!)])
      const built = openPackage(classesPackage(fresh, openPackage(emptyPackage(fresh.package('Core')!)), name, sources).bytes)
      const r = sameCode(orig, built, name)
      total += r.total
      same += r.same
    }
    console.log(`${mods.length} mod packages rebuilt: code ${same}/${total} (${((100 * same) / total).toFixed(1)}%)`)
    expect(same / total).toBeGreaterThan(0.95)
  }, 300_000)
})

// Vanilla Enemy Within (no hand patches): in samples/ew/CookedPCConsole when it is there.
const VANILLA = resolve(dirname(CORPUS[0]!), '../ew/CookedPCConsole')
describe.skipIf(!existsSync(`${VANILLA}/XComGame.upk`))('vanilla Enemy Within: decompiled, compiled back, byte for byte', () => {
  for (const name of ['XComGame.upk', 'XComStrategyGame.upk', 'Engine.upk'])
    it(`${name}`, () => {
      const linker = new Linker([VANILLA])
      const pkg = openPackage(new Uint8Array(readFileSync(`${VANILLA}/${name}`)))
      linker.add(name.replace(/\.upk$/, ''), pkg)
      const ops = binaryOperators(linker)
      let total = 0
      let same = 0
      for (let i = 1; i <= pkg.exports.length; i++) {
        if (pkg.className(i) !== 'Function') continue
        const h = readStructHead(pkg, i)
        if (!h.size) continue
        total++
        const orig = pkg.data(i).subarray(h.scriptAt, h.end)
        try {
          const out = new FunctionCompiler(linker, pkg, i).compile(new FunctionDecompiler(linker, pkg, i).decompile(), ops).code
          if (out.length === orig.length && out.every((b, k) => b === orig[k])) same++
        } catch {
          // counted as different
        }
      }
      console.log(`vanilla ${name}: ${same} of ${total} functions identical (${((100 * same) / total).toFixed(1)}%)`)
      expect(same / total).toBeGreaterThan(0.99)
    }, 120_000)
})

describe.skipIf(!haveCorpus)('UnrealScript written by hand (not as the decompiler writes it)', () => {
  it('compiles; decompiles to the same structure; that compiles to the same bytes', async () => {
    const { readFileSync: read } = await import('node:fs')
    const { packageWith } = await import('../src/changes.ts')
    const { readStructHead: head } = await import('../src/objects.ts')
    const src = read(new URL('./fixtures/HandWritten.uc', import.meta.url), 'utf8')
    const linker = new Linker([dirname(CORPUS[0]!)])
    const pkg = load(CORPUS[3]!)
    linker.add('XComStrategyGame', pkg)
    const ref = pkg.find('XGFacility_Labs.GetResearchPerHour')
    const out = openPackage(packageWith(linker, pkg, [{ ref, text: src }]).bytes)
    const back = new Linker([dirname(CORPUS[0]!)])
    back.add('XComStrategyGame', out)
    const text = new FunctionDecompiler(back, out, ref).decompile()
    // for, continue, else if, switch with its break, coerced $ and @, a float comparison kept float.
    for (const want of ['for (I = 0; I < 5; I++)', 'continue;', 'else if (I > 3)', 'break;', '"Total: " $ string(iTotal) @ "bonus"', 'VSize(vOffset) > float(0)', '} until (iTotal <= 0);'])
      expect(text).toContain(want)
    const h = head(out, ref)
    expect([...new FunctionCompiler(back, out, ref).compile(text, binaryOperators(back)).code]).toEqual([...out.data(ref).subarray(h.scriptAt, h.end)])
  })
})

describe.skipIf(!haveCorpus)('a mod class written by hand, built as a new package', () => {
  it('builds; reads back whole; decompiles to a source compile finds unchanged', async () => {
    const { readFileSync: read } = await import('node:fs')
    const { classesPackage } = await import('../src/changes.ts')
    const { classEdits } = await import('../src/classsrc.ts')
    const { decompileClass } = await import('../src/classdecomp.ts')
    const { defaultsBlock, defaultsChanges } = await import('../src/defaults.ts')
    const { emptyPackage } = await import('../src/writer.ts')
    const { readObject } = await import('../src/objects.ts')
    const { shared } = await import('../src/compile.ts')
    const src = read(new URL('./fixtures/UpkitTestMod.uc', import.meta.url), 'utf8')
    const linker = new Linker([dirname(CORPUS[0]!)])
    const out = openPackage(classesPackage(linker, openPackage(emptyPackage(linker.package('Core')!)), 'UpkitTestMod', [src]).bytes)
    for (let i = 1; i <= out.exports.length; i++) expect(() => readObject(out, i)).not.toThrow()
    const back = new Linker([dirname(CORPUS[0]!)])
    back.add('UpkitTestMod', out)
    const text = decompileClass(back, out, 'UpkitTestMod')
    for (const want of ['enum EUpkitMode', 'struct UpkitEntry', 'strLabel="entry"', 'var config int m_iInterval;', 'optional int iCount = 2', "m_arrEntries.Find('strLabel', strLabel)", 'return iValue < 0 ? 0 : iValue;', 'auto state Watching', "goto 'Begin';", 'm_iInterval=30'])
      expect(text).toContain(want)
    // What it decompiles to is what it is: nothing edited, defaults the same.
    const e = classEdits(back, out, 'UpkitTestMod', text)
    expect(e.changes.map((c) => c.path)).toEqual([])
    expect(defaultsChanges(back, out, out.find('UpkitTestMod'), defaultsBlock(text)!, { shared: shared(), allow: 'none' })).toEqual([])
  })
})

describe.skipIf(!haveCorpus)('mistakes the compiler refuses, said with the line', () => {
  const cases: [string, RegExp][] = [
    ['local int iCount;\n    iCount = "abc";\n    return iCount;', /line 4: a string where an int is wanted/],
    ['return GetAvailableScientists() $ 2;', /line 3: a string where an int is wanted/],
    ['local XGFacility kFac;\n    local XGFacility_Labs kLabs;\n    kLabs = kFac;\n    return 0;', /line 5: an? XGFacility where an? XGFacility_Labs is wanted \(cast it/],
    ['GetAvailableScientists() = 5;\n    return 0;', /line 3: this cannot be assigned to/],
    ['return GetAvailableScientists(1, 2);', /line 3: 3 arguments, where it takes 0|line 3: 2 arguments, where it takes 0/],
    ['return m_fNoSuchThing;', /line 3: unknown name m_fNoSuchThing/],
    ['return (1 + ;', /line 3: /],
  ]
  for (const [body, want] of cases)
    it(`${body.split('\n').at(-1)!.trim()}`, async () => {
      const { packageWith } = await import('../src/changes.ts')
      const linker = new Linker([dirname(CORPUS[0]!)])
      const pkg = load(CORPUS[3]!)
      linker.add('XComStrategyGame', pkg)
      const ref = pkg.find('XGFacility_Labs.GetResearchPerHour')
      expect(() => packageWith(linker, pkg, [{ ref, text: `function int GetResearchPerHour()\n{\n    ${body}\n}\n` }])).toThrow(want)
    })
})

describe.skipIf(!haveCorpus)('a whole package as PatchUPK makes it', () => {
  // The same edit two ways: upkit's whole package (keep layout), and the app's PatchUPK
  // implementation applying upkit's mod script to the original. PatchUPK's packages load
  // in the game; upkit's are to come out the same, byte for byte.
  const cases: [string, (s: string) => string][] = [
    ['the same size', (s) => s.replace('(1 + m_fLabBonus', '(2 + m_fLabBonus')],
    ['grown', (s) => s.replace('(1 + m_fLabBonus', '(GetAvailableScientists() + 1 + m_fLabBonus')],
    ['shrunk', (s) => s.replace('return int(GetAvailableScientists() * (1 + m_fLabBonus + m_fAdjLabBonus));', 'return GetAvailableScientists();')],
    ['naming a name the package lacks', (s) => s.replace('(1 + m_fLabBonus', "(int(IsInState('UpkitBrandNewState')) + m_fLabBonus")],
  ]
  for (const [name, edit] of cases)
    it(`a function's code ${name}`, async () => {
      const { decompileClass } = await import('../src/classdecomp.ts')
      const { classEdits } = await import('../src/classsrc.ts')
      const { modScriptWith, packageWith } = await import('../src/changes.ts')
      const { Package: AppPackage } = await import('../../src/model/upk.ts')
      const { runScript } = await import('../../src/model/modpatch.ts')
      const linker = new Linker([dirname(CORPUS[0]!)])
      const pkg = load(CORPUS[3]!)
      linker.add('XComStrategyGame', pkg)
      const src = edit(decompileClass(linker, pkg, 'XGFacility_Labs'))
      const changes = classEdits(linker, pkg, 'XGFacility_Labs', src).changes
      expect(changes.length).toBe(1)
      const ours = packageWith(linker, pkg, changes, 'keep').bytes
      const copy = new AppPackage(pkg.bytes.slice())
      const r = runScript(modScriptWith(linker, pkg, 'XComStrategyGame.upk', changes, { name: 'x' }).text, { open: () => copy })
      expect(r.steps.filter((s) => s.status === 'error')).toEqual([])
      // The same package: the same names, imports and export entries (but where the objects
      // lie), and every object's data. (PatchUPK also moves a shrunk object to the end and
      // leaves its undo record after a moved one; the game reads neither.)
      const a = openPackage(ours)
      const b = openPackage(copy.bytes)
      expect(a.names.map((n) => n.name)).toEqual(b.names.map((n) => n.name))
      expect(a.imports).toEqual(b.imports)
      expect(a.exports.length).toBe(b.exports.length)
      for (let i = 1; i <= a.exports.length; i++) {
        const { serialOffset: _x, ...ea } = a.exports[i - 1]!
        const { serialOffset: _y, ...eb } = b.exports[i - 1]!
        expect(ea).toEqual(eb)
        const da = a.data(i)
        const db = b.data(i)
        if (da.length !== db.length || da.some((x, k) => x !== db[k])) throw new Error(`${a.path(i)} differs`)
      }
    })
})

describe.skipIf(!haveCorpus)('an interface and a class implementing it, built as a new package', () => {
  it('declared as the game declares its interfaces; called through the interface', async () => {
    const { readFileSync: read } = await import('node:fs')
    const { classesPackage } = await import('../src/changes.ts')
    const { decompileClass } = await import('../src/classdecomp.ts')
    const { emptyPackage } = await import('../src/writer.ts')
    const { readObject } = await import('../src/objects.ts')
    const sources = ['IUpkitScorer', 'UpkitScorer'].map((n) => read(new URL(`./fixtures/${n}.uc`, import.meta.url), 'utf8'))
    const linker = new Linker([dirname(CORPUS[0]!)])
    const out = openPackage(classesPackage(linker, openPackage(emptyPackage(linker.package('Core')!)), 'UpkitScore', sources).bytes)
    const iface = readObject(out, out.find('IUpkitScorer')) as { classFlags: number }
    expect(iface.classFlags).toBe(0x4013) // interface, abstract, compiled, parsed: as the game's
    const impl = readObject(out, out.find('UpkitScorer')) as { interfaces: { cls: number }[] }
    expect(impl.interfaces.map((x) => out.path(x.cls))).toEqual(['IUpkitScorer'])
    const back = new Linker([dirname(CORPUS[0]!)])
    back.add('UpkitScore', out)
    expect(decompileClass(back, out, 'IUpkitScorer')).toContain('function int Score(Actor kTarget);')
    expect(decompileClass(back, out, 'UpkitScorer')).toContain('iTotal += S.Score(kTarget);')
  })
})

describe.skipIf(!haveCorpus)('replication', () => {
  it("an Actor's replication decompiled as Epic wrote it", async () => {
    const { decompileClass } = await import('../src/classdecomp.ts')
    const linker = new Linker([dirname(CORPUS[0]!)])
    const text = decompileClass(linker, load(CORPUS[1]!), 'Actor')
    expect(text).toContain('replication\n{')
    expect(text).toMatch(/if \(\(!bSkipActorPropertyReplication \|\| bNetInitial\) && Role == ROLE_Authority\)\n {8}bNetOwner, bTearOff, Role, RemoteRole;/)
  })
  it("a new class's replication compiled: its conditions the class's script, its variables marked", async () => {
    const { readFileSync: read } = await import('node:fs')
    const { classesPackage } = await import('../src/changes.ts')
    const { emptyPackage } = await import('../src/writer.ts')
    const { readObject } = await import('../src/objects.ts')
    const { FunctionDecompiler: D } = await import('../src/decompile.ts')
    const src = read(new URL('./fixtures/UpkitNetActor.uc', import.meta.url), 'utf8')
    const linker = new Linker([dirname(CORPUS[0]!)])
    const out = openPackage(classesPackage(linker, openPackage(emptyPackage(linker.package('Core')!)), 'UpkitNet', [src]).bytes)
    const score = readObject(out, out.find('UpkitNetActor.m_iScore')) as { flags: bigint; repOffset?: number }
    const active = readObject(out, out.find('UpkitNetActor.m_bActive')) as { flags: bigint; repOffset?: number }
    expect(score.flags & 0x20n).toBe(0x20n)
    expect(score.repOffset).toBe(0)
    expect(active.repOffset).toBeGreaterThan(0)
    const back = new Linker([dirname(CORPUS[0]!)])
    back.add('UpkitNet', out)
    const rep = new D(back, out, out.find('UpkitNetActor')).decompileReplication()
    expect(rep).toContain('m_iScore, m_strLabel;')
    expect(rep).toContain('if (bNetInitial)\n        m_bActive;')
  })
})

describe.skipIf(!haveCorpus)('what modders write, by the handful', () => {
  it('array methods, strings and their operators, vectors, names, switch on strings, static arrays, bit operators, casts, defaults', async () => {
    const { readFileSync: read } = await import('node:fs')
    const { packageWith } = await import('../src/changes.ts')
    const { readableSource } = await import('../src/fidelity.ts')
    const { readStructHead: head } = await import('../src/objects.ts')
    const src = read(new URL('./fixtures/Syntax.uc', import.meta.url), 'utf8')
    const linker = new Linker([dirname(CORPUS[0]!)])
    const pkg = load(CORPUS[3]!)
    linker.add('XComStrategyGame', pkg)
    const ref = pkg.find('XGFacility_Labs.GetResearchPerHour')
    const out = openPackage(packageWith(linker, pkg, [{ ref, text: src }]).bytes)
    const back = new Linker([dirname(CORPUS[0]!)])
    back.add('XComStrategyGame', out)
    const text = readableSource(back, out, ref)
    for (const want of ['A.InsertItem(0, 7);', 'S @= "e";', 'if (S ~= "BCD")', 'case "x":', 'R.Yaw += 16384;', 'J += 4;', 'J = B ? (J > 1 ? 2 : 3) : 4;', 'default.m_fLabBonus = 2.0;'])
      expect(text).toContain(want)
    const h = head(out, ref)
    expect([...new FunctionCompiler(back, out, ref).compile(text, binaryOperators(back)).code]).toEqual([...out.data(ref).subarray(h.scriptAt, h.end)])
  })
})
