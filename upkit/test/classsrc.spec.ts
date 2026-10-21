import { describe, expect, it } from 'vitest'
import { dirname } from 'node:path'
import { ClassDecompiler } from '../src/classdecomp.ts'
import { classEdits } from '../src/classsrc.ts'
import { Linker } from '../src/linker.ts'
import { CORPUS, haveCorpus, load, short } from './corpus.ts'

// Every class decompiled whole, then read back as a class's source: nothing
// counts as edited and nothing is new (what `compile <package> <Class>` sees
// when a modder changed nothing), and no declaration fails to read.
describe.skipIf(!haveCorpus)('a class as decompiled is a class unchanged', () => {
  for (const path of CORPUS)
    it(short(path), () => {
      const pkg = load(path)
      const linker = new Linker([...new Set([dirname(path), dirname(CORPUS[0]!)])])
      linker.add(short(path).replace(/^lwr\//, '').replace(/\.(upk|u)$/, ''), pkg)
      const wrong: string[] = []
      for (let ref = 1; ref <= pkg.exports.length; ref++) {
        if (pkg.className(ref) !== 'Class') continue
        const name = pkg.objectName(ref)
        try {
          const e = classEdits(linker, pkg, name, new ClassDecompiler(linker, pkg, ref, false).decompile())
          const fresh = [...e.changes.map((c) => c.path), ...e.functions.map((f) => f.path), ...[...e.vars, ...e.consts, ...e.enums, ...e.structs, ...e.states].map((x) => ('names' in x ? x.names.map((n) => n.name).join(',') : x.name))]
          if (fresh.length) wrong.push(`${name}: ${fresh.slice(0, 3).join(', ')}`)
        } catch (err) {
          wrong.push(`${name}: ${(err as Error).message}`)
        }
      }
      expect(wrong).toEqual([])
    }, 120_000)
})
