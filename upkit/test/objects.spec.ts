import { describe, expect, it } from 'vitest'
import { readObject } from '../src/objects.ts'
import { CORPUS, haveCorpus, load, short } from './corpus.ts'

describe.skipIf(!haveCorpus)('objects: every script object read to its end', () => {
  for (const path of CORPUS)
    it(short(path), () => {
      const pkg = load(path)
      const read = new Map<string, number>()
      const failures = new Map<string, string[]>()
      for (let i = 1; i <= pkg.exports.length; i++) {
        const cls = pkg.className(i)
        try {
          if (readObject(pkg, i)) read.set(cls, (read.get(cls) ?? 0) + 1)
        } catch (e) {
          failures.set(cls, [...(failures.get(cls) ?? []), (e as Error).message])
        }
      }
      console.log(`${short(path)}: read ${[...read.values()].reduce((a, b) => a + b, 0)}; failing: ${[...failures].map(([c, f]) => `${c} ${f.length}`).join(', ') || 'none'}`)
      for (const [, f] of failures) console.log('  ' + f.slice(0, 2).join('\n  '))
      expect([...failures.keys()]).toEqual([])
    })
})
