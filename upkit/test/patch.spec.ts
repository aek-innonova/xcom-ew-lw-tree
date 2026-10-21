import { describe, expect, it } from 'vitest'
import { decodeScript } from '../src/bytecode.ts'
import { readStructHead } from '../src/objects.ts'
import { modScript } from '../src/patch.ts'
import { Package as AppPackage } from '../../src/model/upk.ts'
import { runScript } from '../../src/model/modpatch.ts'
import { Package } from '../src/package.ts'
import { CORPUS, haveCorpus, load } from './corpus.ts'

describe.skipIf(!haveCorpus)('patch mode: a mod script PatchUPK reads the way we wrote it', () => {
  it('every function of XComStrategyGame, through the app’s PatchUPK implementation', () => {
    const pkg = load(CORPUS[3]!)
    const none = pkg.findName('None')
    const changes = []
    for (let i = 1; i <= pkg.exports.length; i++) {
      if (pkg.className(i) !== 'Function') continue
      const h = readStructHead(pkg, i)
      if (!h.size) continue
      const s = decodeScript(pkg.data(i).subarray(h.scriptAt, h.end), (n) => n.index === none)
      changes.push({ upk: 'XComStrategyGame.upk', pkg, ref: i, statements: s.statements, mem: s.memSize })
    }
    const text = modScript({ name: 'upkit round trip' }, changes)
    const copy = new AppPackage(pkg.bytes.slice())
    const result = runScript(text, { open: () => copy })
    expect(result.status === 'error' ? result.steps.find((s) => s.status === 'error') : null).toBe(null)
    // Each function's code as it was, and its memory size the engine's.
    const out = new Package(copy.bytes)
    let wrong = 0
    for (const c of changes) {
      const before = readStructHead(pkg, c.ref)
      const after = readStructHead(out, c.ref)
      const a = pkg.data(c.ref).subarray(before.scriptAt, before.end)
      const b = out.data(c.ref).subarray(after.scriptAt, after.end)
      if (a.length !== b.length || a.some((x, k) => x !== b[k]) || after.memSize !== c.mem) {
        wrong++
        if (wrong <= 6) {
          const k = a.findIndex((x, j) => x !== b[j])
          console.log(pkg.path(c.ref), 'len', a.length, b.length, 'mem', after.memSize, c.mem, 'first diff', k, Buffer.from(a.subarray(Math.max(0, k - 4), k + 12)).toString('hex'), Buffer.from(b.subarray(Math.max(0, k - 4), k + 12)).toString('hex'))
        }
      }
    }
    console.log(`${changes.length} functions through PatchUPK, ${wrong} wrong; ${result.status}`)
    expect(wrong).toBe(0)
  })
})
