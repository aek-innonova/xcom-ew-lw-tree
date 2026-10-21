import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { binaryOperators, FunctionCompiler } from '../src/compile.ts'
import { Linker } from '../src/linker.ts'
import { readStructHead } from '../src/objects.ts'
import { openPackage, type Package } from '../src/package.ts'
import { readableSource } from '../src/fidelity.ts'
import { CORPUS, haveCorpus } from './corpus.ts'

// Mods people wrote for the game (PatcherGUI scripts, in the samples' additional_mods):
// each applied with the app's PatchUPK implementation; every function it changed,
// decompiled, compiled back. The share that comes back byte for byte is how much of
// those mods upkit could have been used to write, from UnrealScript.
const MODS = resolve(dirname(CORPUS[0]!), '../additional_mods')
const VANILLA = resolve(dirname(CORPUS[0]!), '../ew/CookedPCConsole')
const scripts = existsSync(MODS)
  ? [
      ...readdirSync(`${MODS}/Mods`).map((f) => `${MODS}/Mods/${f}`),
      ...readdirSync(`${MODS}/mod.files`).flatMap((d) => readdirSync(`${MODS}/mod.files/${d}`).filter((f) => /^(Sightlines|XComMutator).*\.txt$/.test(f)).map((f) => `${MODS}/mod.files/${d}/${f}`)),
    ].filter((f) => f.endsWith('.txt'))
  : []

describe.skipIf(!haveCorpus || !scripts.length || !existsSync(`${VANILLA}/XComGame.upk`))('mods people wrote, compiled back from their decompiled source', () => {
  it('every function the mods change', async () => {
    const { Package: AppPackage } = await import('../../src/model/upk.ts')
    const { runScript } = await import('../../src/model/modpatch.ts')
    let total = 0
    let same = 0
    const report: string[] = []
    for (const script of scripts) {
      const text = readFileSync(script, 'utf8')
      // Vanilla or Long War: whichever it applies to without an error.
      let applied: { dir: string; pkgs: Map<string, InstanceType<typeof AppPackage>>; touched: Set<string> } | null = null
      for (const dir of [VANILLA, dirname(CORPUS[0]!)]) {
        const pkgs = new Map<string, InstanceType<typeof AppPackage>>()
        const open = (name: string) => {
          const key = name.toLowerCase()
          if (!pkgs.has(key)) {
            const file = readdirSync(dir).find((f) => f.toLowerCase() === key)
            if (!file) throw new Error(`no ${name}`)
            pkgs.set(key, new AppPackage(openPackage(new Uint8Array(readFileSync(`${dir}/${file}`))).bytes.slice()))
          }
          return pkgs.get(key)!
        }
        try {
          const r = runScript(text, { open })
          if (r.steps.some((s) => s.status === 'error')) continue
          const touched = new Set(r.steps.filter((s) => s.status === 'change' && s.where.includes(': ')).map((s) => s.where))
          applied = { dir, pkgs, touched }
          break
        } catch {
          // the other one
        }
      }
      if (!applied) {
        report.push(`${script.split('/').pop()}: applies to neither`)
        continue
      }
      let modSame = 0
      let modTotal = 0
      for (const where of applied.touched) {
        const [file, path] = where.split(': ') as [string, string]
        const pkg: Package = openPackage(applied.pkgs.get(file.toLowerCase())!.bytes)
        const ref = pkg.find(path)
        if (!ref || pkg.className(ref) !== 'Function') continue
        const linker = new Linker([applied.dir])
        linker.add(file.replace(/\.(upk|u)$/i, ''), pkg)
        const h = readStructHead(pkg, ref)
        const orig = pkg.data(ref).subarray(h.scriptAt, h.end)
        modTotal++
        try {
          const src = readableSource(linker, pkg, ref)
          const code = new FunctionCompiler(linker, pkg, ref).compile(src, binaryOperators(linker)).code
          if (code.length === orig.length && code.every((b, k) => b === orig[k])) modSame++
          else if (process.env.UPKIT_MODS_WHY) {
            const { fidelity } = await import('../src/fidelity.ts')
            const f = fidelity(linker, pkg, ref, src)
            report.push(`    ${path}: statement ${f.statement}: ${f.original} | ${f.compiled}`)
          }
        } catch (e) {
          if (process.env.UPKIT_MODS_WHY) report.push(`    ${path}: ${(e as Error).message}`)
        }
      }
      total += modTotal
      same += modSame
      report.push(`${script.split('/').pop()} (${applied.dir === VANILLA ? 'vanilla' : 'Long War'}): ${modSame} of ${modTotal} functions`)
    }
    console.log(`mods: ${same} of ${total} functions they change come back byte for byte\n  ${report.join('\n  ')}`)
    expect(total).toBeGreaterThan(0)
  }, 300_000)
})
