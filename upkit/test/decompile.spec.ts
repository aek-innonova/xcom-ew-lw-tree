import { describe, expect, it } from 'vitest'
import { dirname } from 'node:path'
import { FunctionDecompiler } from '../src/decompile.ts'
import { Linker } from '../src/linker.ts'
import { CORPUS, haveCorpus, load, short } from './corpus.ts'

describe.skipIf(!haveCorpus)('decompiler: every function in the game', () => {
  const linker = new Linker([dirname(CORPUS[0]!)])
  for (const path of CORPUS)
    it(short(path), () => {
      const pkg = load(path)
      linker.add(short(path).replace(/^lwr\//, '').replace(/\.(upk|u)$/, ''), pkg)
      let total = 0
      let withGoto = 0
      let raw = 0
      const crashes: string[] = []
      for (let i = 1; i <= pkg.exports.length; i++) {
        if (pkg.className(i) !== 'Function') continue
        total++
        try {
          const text = new FunctionDecompiler(linker, pkg, i).decompile()
          if (/\bgoto L\d+/.test(text)) withGoto++
          if (/__[A-Z]/.test(text)) raw++
        } catch (e) {
          crashes.push(`${pkg.path(i)}: ${(e as Error).message}`)
        }
      }
      console.log(`${short(path)}: ${total} functions; ${withGoto} with goto, ${raw} with raw tokens, ${crashes.length} crashes`, crashes.slice(0, 5))
      expect(crashes).toEqual([])
    })
})
