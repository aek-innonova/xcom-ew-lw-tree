import { describe, expect, it } from 'vitest'
import { dirname } from 'node:path'
import { decodeScript, walk } from '../src/bytecode.ts'
import { Linker } from '../src/linker.ts'
import { readStructHead } from '../src/objects.ts'
import { CORPUS, haveCorpus, load, short } from './corpus.ts'

describe.skipIf(!haveCorpus)('linker', () => {
  const linker = new Linker([dirname(CORPUS[0]!)])
  it('every import of the game’s packages is found in its package', () => {
    for (const path of CORPUS.slice(0, 4)) {
      const pkg = load(path)
      const missing: string[] = []
      for (let i = 1; i <= pkg.imports.length; i++) {
        const cls = pkg.className(-i)
        if (cls === 'Package') continue
        // Core's built-in classes (ArrayProperty, Function …) are C++ only: no package exports them.
        if (cls === 'Class' && pkg.path(-i).startsWith('Core.') && pkg.path(-i).split('.').length === 2) continue
        if (!linker.resolve(pkg, -i)) missing.push(`${pkg.path(-i)} (${cls})`)
      }
      console.log(`${short(path)}: ${pkg.imports.length} imports, ${missing.length} not found`, missing.slice(0, 8))
      // Engine imports native-only things the cooker left out (their names still print).
      if (!path.endsWith('Engine.upk')) expect(missing.length).toBeLessThan(pkg.imports.length / 100)
    }
  })
  it('every native call in the game names a native function', () => {
    const pkg = load(CORPUS[2]!)
    const none = pkg.findName('None')
    const unknown = new Map<number, number>()
    for (let i = 1; i <= pkg.exports.length; i++) {
      if (pkg.className(i) !== 'Function') continue
      const h = readStructHead(pkg, i)
      if (!h.size) continue
      for (const st of decodeScript(pkg.data(i).subarray(h.scriptAt, h.end), (n) => n.index === none).statements)
        for (const n of walk(st))
          if (n.native !== undefined && !linker.native(n.native)) unknown.set(n.native, (unknown.get(n.native) ?? 0) + 1)
    }
    console.log('unknown natives', [...unknown])
    expect(unknown.size).toBe(0)
  })
})
