import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { decompileClass } from '../src/classdecomp.ts'
import { Linker } from '../src/linker.ts'
import { openPackage } from '../src/package.ts'
import { canonical } from '../src/upkmod.ts'
import { CORPUS, short, VANILLA } from './corpus.ts'

// The golden copy (features/upkit-source-mods.md): .upkmod anchors match on
// the canonical tokens of the code upkit decompiles. upkit may print code
// differently over time, but never so that those tokens change, or old mods
// would stop finding their lines. Kept as one SHA-256 per class of the
// corpus (nothing of the game's in the repository), from the packages on
// this machine. A change here is a change to the .upkmod format: deliberate,
// and recorded with UPKIT_GOLDEN_WRITE=1.
const FILE = new URL('./golden/canonical.json', import.meta.url).pathname
const PACKAGES = [CORPUS[3]!, VANILLA.find((p) => p.endsWith('XComStrategyGame.upk'))].filter((p): p is string => !!p && existsSync(p))

describe.skipIf(!PACKAGES.length)('the golden copy: classes decompile to the canonical tokens recorded', () => {
  it('every class of Long War’s and vanilla’s XComStrategyGame.upk', () => {
    const now: Record<string, Record<string, string>> = {}
    for (const path of PACKAGES) {
      const pkg = openPackage(new Uint8Array(readFileSync(path)))
      const linker = new Linker([dirname(path), dirname(CORPUS[0]!)])
      linker.add('XComStrategyGame', pkg)
      const classes: Record<string, string> = {}
      for (let i = 1; i <= pkg.exports.length; i++)
        if (pkg.className(i) === 'Class') classes[pkg.path(i)] = createHash('sha256').update(canonical(decompileClass(linker, pkg, pkg.path(i))).join('\u0001')).digest('hex')
      now[short(path)] = classes
    }
    if (process.env.UPKIT_GOLDEN_WRITE) writeFileSync(FILE, JSON.stringify(now, null, 1) + '\n')
    const recorded = JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, Record<string, string>>
    for (const [pkg, classes] of Object.entries(now)) {
      const changed = Object.keys(classes).filter((c) => recorded[pkg]?.[c] !== classes[c])
      expect(changed, `${pkg}: classes whose canonical tokens are not those recorded`).toEqual([])
    }
  }, 600_000)
})
