import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { decodeScript, type Node } from '../src/bytecode.ts'
import { readStructHead } from '../src/objects.ts'
import { modScript } from '../src/patch.ts'
import { Package as AppPackage } from '../../src/model/upk.ts'
import { runScript } from '../../src/model/modpatch.ts'
import { Package } from '../src/package.ts'
import { CORPUS, haveCorpus, load } from './corpus.ts'

/** Every function of a package, its code written back unchanged as a mod script. */
function roundTripScript(path: string) {
  const pkg = load(path)
  const none = pkg.findName('None')
  const changes: { upk: string; pkg: Package; ref: number; statements: Node[]; mem: number }[] = []
  for (let i = 1; i <= pkg.exports.length; i++) {
    if (pkg.className(i) !== 'Function') continue
    const h = readStructHead(pkg, i)
    if (!h.size) continue
    const s = decodeScript(pkg.data(i).subarray(h.scriptAt, h.end), (n) => n.index === none)
    changes.push({ upk: basename(path), pkg, ref: i, statements: s.statements, mem: s.memSize })
  }
  return { pkg, changes, text: modScript({ name: 'upkit round trip' }, changes) }
}

/** Each function's code as it was, and its memory size the engine's: the functions that are not. */
function wrongOnes(pkg: Package, out: Package, changes: { ref: number; mem: number }[]): number {
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
  return wrong
}

describe.skipIf(!haveCorpus)('patch mode: a mod script PatchUPK reads the way we wrote it', () => {
  it('every function of XComStrategyGame, through the app’s PatchUPK implementation', () => {
    const { pkg, changes, text } = roundTripScript(CORPUS[3]!)
    const copy = new AppPackage(pkg.bytes.slice())
    const result = runScript(text, { open: () => copy })
    expect(result.status === 'error' ? result.steps.find((s) => s.status === 'error') : null).toBe(null)
    const wrong = wrongOnes(pkg, new Package(copy.bytes), changes)
    console.log(`${changes.length} functions through PatchUPK, ${wrong} wrong; ${result.status}`)
    expect(wrong).toBe(0)
  })
  // PatchUPK itself (PATCHUPK: its binary, built from wghost's UPKUtils), on the largest packages (Engine with paths it would find another object by).
  const patchUPK = process.env.PATCHUPK
  for (const path of [CORPUS[1]!, CORPUS[2]!, CORPUS[3]!, CORPUS[4]!])
    it.skipIf(!patchUPK)(`every function of ${basename(path)}, through PatchUPK`, () => {
      const { pkg, changes, text } = roundTripScript(path)
      const dir = mkdtempSync(join(tmpdir(), 'lwtree-patchupk-'))
      try {
        // (It opens the package by its name in lower case, as on Windows.)
        const file = join(dir, basename(path).toLowerCase())
        writeFileSync(file, pkg.bytes)
        writeFileSync(join(dir, 'mod.txt'), text)
        const log = execFileSync(patchUPK!, [join(dir, 'mod.txt'), dir], { encoding: 'utf8', maxBuffer: 1 << 30 })
        expect(log).not.toMatch(/Execution stopped|^Bad |^Error/m)
        const wrong = wrongOnes(pkg, new Package(new Uint8Array(readFileSync(file))), changes)
        console.log(`${changes.length} functions through PatchUPK, ${wrong} wrong`)
        expect(wrong).toBe(0)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }, 600_000)
})
