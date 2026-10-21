import { describe, expect, it } from 'vitest'
import { decodeScript, encodeScript } from '../src/bytecode.ts'
import { readStructHead } from '../src/objects.ts'
import { Package } from '../src/package.ts'
import { writePackage } from '../src/writer.ts'
import { CORPUS, haveCorpus, load, short } from './corpus.ts'

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i])

describe.skipIf(!haveCorpus)('writer', () => {
  for (const path of CORPUS)
    it(`${short(path)}: written back unchanged, byte for byte`, () => {
      const pkg = load(path)
      expect(same(writePackage(pkg), pkg.bytes)).toBe(true)
    })

  it('a function made longer moves to the end, and reads back with its new code', () => {
    const pkg = load(CORPUS[3]!) // XComStrategyGame
    const ref = pkg.find('XGStrategySoldier.GetEnergy')
    const h = readStructHead(pkg, ref)
    const none = pkg.findName('None')
    const data = pkg.data(ref)
    const script = decodeScript(data.subarray(h.scriptAt, h.end), (n) => n.index === none)
    // Ten more Nothing statements before the end.
    const nothing = { op: 0x0b, args: [], at: 0, mem: 0 }
    const longer = [...script.statements.slice(0, -1), ...Array(10).fill(nothing), script.statements.at(-1)!]
    const { code, memSize } = encodeScript(longer)
    const next = new Uint8Array(data.length + (code.length - h.size))
    next.set(data.subarray(0, h.scriptAt - 8))
    const v = new DataView(next.buffer)
    v.setInt32(h.scriptAt - 8, memSize, true)
    v.setInt32(h.scriptAt - 4, code.length, true)
    next.set(code, h.scriptAt)
    next.set(data.subarray(h.end), h.scriptAt + code.length)
    for (const layout of ['keep', 'compact'] as const) {
      const out = new Package(writePackage(pkg, { data: new Map([[ref, next]]), layout }))
      const h2 = readStructHead(out, out.find('XGStrategySoldier.GetEnergy'))
      expect(h2.size).toBe(code.length)
      expect(same(out.data(ref), next)).toBe(true)
      // Everything else as it was.
      const other = pkg.find('XGStrategySoldier.GetName')
      expect(same(out.data(other), pkg.data(other))).toBe(true)
    }
  })
})
