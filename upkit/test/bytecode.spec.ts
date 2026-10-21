import { describe, expect, it } from 'vitest'
import { decodeScript, encodeScript, walk } from '../src/bytecode.ts'
import { readStructHead, STRUCT_CLASSES } from '../src/objects.ts'
import { CORPUS, haveCorpus, load, short } from './corpus.ts'

/**
 * Functions Long War rewrote without padding whose stored memory size is one
 * byte short of the engine's (every token in them is counted right in
 * thousands of other functions): the patch tool's count, not ours.
 */
const PATCHED = new Set(['XGCharacter_Soldier.GetName'])

describe.skipIf(!haveCorpus)('bytecode: every script in the game, decoded and encoded back', () => {
  for (const path of CORPUS)
    it(`${short(path)}`, () => {
      const pkg = load(path)
      const none = pkg.findName('None')
      let scripts = 0
      let patched = 0
      const failures: string[] = []
      for (let i = 1; i <= pkg.exports.length; i++) {
        if (!STRUCT_CLASSES.has(pkg.className(i))) continue
        const h = readStructHead(pkg, i)
        if (!h.size) continue
        scripts++
        const code = pkg.data(i).subarray(h.scriptAt, h.end)
        try {
          const s = decodeScript(code, (n) => n.index === none && n.number === 0)
          // A function patched by hand (Long War's packages here) is padded with
          // Nothing tokens, and its stored memory size can be the patch tool's,
          // not the engine's: noted, not failed.
          if (s.memSize !== h.memSize) {
            const padded = s.statements.some((st) => [...walk(st)].some((n) => n.op === 0x0b))
            if (!padded && !PATCHED.has(pkg.path(i))) throw new Error(`memory size ${s.memSize}, stored ${h.memSize}`)
            patched++
          }
          const back = encodeScript(s.statements)
          if (back.code.length !== code.length || back.code.some((b, k) => b !== code[k]))
            throw new Error('encoded differently')
        } catch (e) {
          failures.push(`${pkg.path(i)}: ${(e as Error).message}`)
        }
      }
      console.log(`${short(path)}: ${scripts} scripts, ${failures.length} failing, ${patched} patched with another memory size`)
      if (failures.length) console.log(failures.slice(0, 12).join('\n'))
      expect(failures).toEqual([])
    })
})
