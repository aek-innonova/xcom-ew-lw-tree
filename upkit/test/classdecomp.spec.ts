import { describe, expect, it } from 'vitest'
import { dirname } from 'node:path'
import { ClassDecompiler } from '../src/classdecomp.ts'
import { Linker } from '../src/linker.ts'
import { CORPUS, haveCorpus, load, short } from './corpus.ts'

describe.skipIf(!haveCorpus)('class decompiler: every class in the game', () => {
  const linker = new Linker([dirname(CORPUS[0]!)])
  for (const path of CORPUS)
    it(short(path), () => {
      const pkg = load(path)
      linker.add(short(path).replace(/^lwr\//, '').replace(/\.(upk|u)$/, ''), pkg)
      let classes = 0
      let unread = 0
      const crashes: string[] = []
      for (let i = 1; i <= pkg.exports.length; i++) {
        if (pkg.className(i) !== 'Class') continue
        classes++
        try {
          const text = new ClassDecompiler(linker, pkg, i).decompile()
          unread += (text.match(/not decompiled|not read|<\d+ bytes>/g) ?? []).length
        } catch (e) {
          crashes.push(`${pkg.path(i)}: ${(e as Error).message}`)
        }
      }
      console.log(`${short(path)}: ${classes} classes, ${crashes.length} crashes, ${unread} parts not read`, crashes.slice(0, 3))
      expect(crashes).toEqual([])
    })
})
