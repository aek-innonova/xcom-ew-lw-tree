import { describe, expect, it } from 'vitest'
import { dirname } from 'node:path'
import { ClassDecompiler } from '../src/classdecomp.ts'
import { shared } from '../src/compile.ts'
import { defaultsBlock, defaultsChanges } from '../src/defaults.ts'
import { Linker } from '../src/linker.ts'
import { CORPUS, haveCorpus, load, short } from './corpus.ts'

// Every class's defaultproperties as the decompiler writes them, compiled from
// the text alone (no entry's bytes kept): the default objects come out as they are.
describe.skipIf(!haveCorpus)('defaultproperties: written, compiled back, byte for byte', () => {
  for (const path of CORPUS)
    it(short(path), () => {
      const pkg = load(path)
      const linker = new Linker([...new Set([dirname(path), dirname(CORPUS[0]!)])])
      linker.add(short(path).replace(/^lwr\//, '').replace(/\.(upk|u)$/, ''), pkg)
      const differ: string[] = []
      for (let ref = 1; ref <= pkg.exports.length; ref++) {
        if (pkg.className(ref) !== 'Class') continue
        const block = defaultsBlock(new ClassDecompiler(linker, pkg, ref, false).decompile())
        if (block === null) continue
        try {
          if (defaultsChanges(linker, pkg, ref, block, { shared: shared(), allow: 'none' }, false).length) differ.push(pkg.objectName(ref))
        } catch (e) {
          differ.push(`${pkg.objectName(ref)}: ${(e as Error).message}`)
        }
      }
      expect(differ).toEqual([])
    }, 120_000)
})
