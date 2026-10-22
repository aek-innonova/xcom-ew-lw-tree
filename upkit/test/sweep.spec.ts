import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { classesPackage } from '../src/changes.ts'
import { decompileClass } from '../src/classdecomp.ts'
import { Linker } from '../src/linker.ts'
import { openPackage } from '../src/package.ts'
import { modScriptFrom } from '../src/patch.ts'
import { CORPUS, haveCorpus } from './corpus.ts'

// Edits of the kinds modders make, on classes of every sort (actors, UI, sequence actions,
// native ones), each as a mod script that PatchUPK (PATCHUPK) applies to the original: the
// same package as --out. (A sweep like it found that a native class's source did not compile.)
const patchUPK = process.env.PATCHUPK

/** The class's source with a function added (and a variable where the class is not native), a statement in its first body, its first plain default changed. */
function edited(src: string, cls: string, native: boolean): string {
  if (!native) {
    const head = src.indexOf(';', src.search(new RegExp(`^class ${cls}\\b`, 'm')))
    src = `${src.slice(0, head + 1)}\n\nvar int m_iUpkitSweep;\n${src.slice(head + 1)}`
  }
  const body = /^(?:[a-z]+ )*(?:function|event) [^\n]*\n\{\n((?: {4}local [^\n]*\n)*\n?)/m.exec(src)
  if (body) {
    const at = body.index + body[0].length
    src = `${src.slice(0, at)}    if (false)\n    {\n    }\n${src.slice(at)}`
  }
  const fn = native
    ? 'function int UpkitSweep(int iBy)\n{\n    local int iDone;\n\n    iDone = iBy * 2;\n    return iDone;\n}\n\n'
    : 'function int UpkitSweep(int iBy)\n{\n    m_iUpkitSweep += iBy;\n    return m_iUpkitSweep;\n}\n\n'
  const dp = src.search(/^defaultproperties/m)
  if (dp < 0) return `${src}\n${fn}`
  let defaults = src.slice(dp)
  const m = /^(\s+\w+(?:\(\d+\)|\[\d+\])?=)(-?\d+(?:\.\d+)?|True|False|"[^"\n]*")\s*$/m.exec(defaults)
  if (m) {
    const v = m[2]!
    const nv = v.startsWith('"') ? `${v.slice(0, -1)} (upkit)"` : v === 'True' ? 'False' : v === 'False' ? 'True' : v.includes('.') ? String(parseFloat(v) + 1.5) : String(parseInt(v) + 7)
    defaults = defaults.replace(m[0], m[1] + nv)
  }
  return src.slice(0, dp) + fn + defaults
}

describe.skipIf(!haveCorpus || !patchUPK)('a sweep of edits as mod scripts, through PatchUPK', () => {
  const sweep: [string, string[]][] = [
    [CORPUS[2]!, ['XGUnit', 'XGAction_Fire', 'UITacticalHUD', 'SeqAct_DelayVictory', 'XComProfileGrid']],
    [CORPUS[3]!, ['XGStrategy', 'XGFacility_Engineering', 'UIShipList', 'XComHeadquartersCamera', 'XGSetupPhaseManager']],
  ]
  for (const [file, classes] of sweep)
    it(`${basename(file)}: ${classes.join(', ')}`, () => {
      const bytes = new Uint8Array(readFileSync(file))
      const name = basename(file).replace(/\.upk$/, '')
      for (const cls of classes) {
        const pkg = openPackage(bytes)
        const linker = new Linker([dirname(file)])
        linker.add(name, pkg)
        const src = decompileClass(linker, pkg, cls)
        const native = /^\s+native(replication)?$/m.test(src.slice(0, src.indexOf(';')))
        const ours = classesPackage(linker, pkg, name, [edited(src, cls, native)], 'keep').bytes
        const script = modScriptFrom({ name: 'sweep' }, basename(file), pkg, openPackage(ours))
        const dir = mkdtempSync(join(tmpdir(), 'lwtree-sweep-'))
        try {
          const target = join(dir, basename(file).toLowerCase())
          writeFileSync(target, pkg.bytes)
          writeFileSync(join(dir, 'mod.txt'), script)
          const log = execFileSync(patchUPK!, [join(dir, 'mod.txt'), dir], { encoding: 'utf8', maxBuffer: 1 << 28 })
          expect(log, cls).not.toMatch(/Execution stopped|^Bad |^Error/m)
          const a = openPackage(ours)
          const b = openPackage(new Uint8Array(readFileSync(target)))
          expect(b.names, cls).toEqual(a.names)
          expect(b.imports, cls).toEqual(a.imports)
          expect(b.exports.length, cls).toBe(a.exports.length)
          for (let i = 1; i <= a.exports.length; i++) if (Buffer.compare(a.data(i), b.data(i))) throw new Error(`${cls}: ${a.path(i)} differs`)
        } finally {
          rmSync(dir, { recursive: true, force: true })
        }
      }
    }, 300_000)
})
