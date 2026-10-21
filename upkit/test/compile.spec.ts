import { describe, expect, it } from 'vitest'
import { dirname } from 'node:path'
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
  const linker = new Linker([dirname(CORPUS[0]!)])
  for (const path of [CORPUS[3]!, CORPUS[2]!, CORPUS[4]!, CORPUS[0]!, CORPUS[1]!])
    it(short(path), () => {
      const r = roundTrip(path, linker)
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
