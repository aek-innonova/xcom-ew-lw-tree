import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseCommands, runScript } from '../modpatch'
import { Package } from '../upk'

const root = resolve(import.meta.dirname, '../../..')
const lwr = resolve(root, 'samples/lwr/LW Rebalance v2.06.00/CookedPCConsole')
const lw = resolve(root, 'samples/CookedPCConsole')
const mods = resolve(root, 'samples/additional_mods/Mods')

const opener = (dir: string) => (name: string) => {
  const f = readdirSync(dir).find((x) => x.toLowerCase() === name.toLowerCase())
  return f ? new Package(new Uint8Array(readFileSync(resolve(dir, f)))) : undefined
}
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

describe('reading PatchUPK scripts', () => {
  it('splits keys (to the next key) and sections, without comments, keeping line numbers', () => {
    const c = parseCommands(`MOD_NAME=Test
/* a comment
   over lines */
UPK_FILE = XComGame.upk { curly
comment }
OBJECT = XGUnit.RecordKill : AUTO
ALIAS=Days:<%b 9> // a trailing comment
[REPLACEMENT_CODE]
04 0B
53
[/REPLACEMENT_CODE]
`)
    expect(c.map((x) => [x.name, x.value.trim(), x.line])).toEqual([
      ['MOD_NAME', 'Test', 1],
      ['UPK_FILE', 'XComGame.upk', 4],
      ['OBJECT', 'XGUnit.RecordKill : AUTO', 6],
      ['ALIAS', 'Days:<%b 9>', 7],
      ['REPLACEMENT_CODE', '04 0B\n53', 8],
    ])
  })
})

// The references: PatchUPK 7.3 (UPKUtils, built from its source) run on the
// same files; these are the SHA-256 of what it wrote.
const PATCHUPK = {
  'EXALTReminder.txt': {
    'xcomstrategygame.upk': '96592696be3d74cea83b9083f8c577c0e6a30f4bb8b9bd9e1dfeff5af8bed736',
  },
  'LightningReflexes.txt': {
    'xcomgame.upk': '893b323d6d5d1cedf3bfcb894ccfd2bb055093320b998582849f020491264e68',
  },
  'Sightlines_LW.txt': {
    'xcomgame.upk': 'aff07e43504f0cb2dd0a8b83eeb6c4a57b6fa2a7c5e7beb30a043cdb2e3b9fa7',
  },
  'SoldierGenderEW.txt': {
    'xcomgame.upk': '1b25d68c8a1049f511ce370b16006345608834da8f6c745c3ff470e6caced03c',
  },
} as Record<string, Record<string, string>>

describe.skipIf(!existsSync(lwr) || !existsSync(mods))('mods on LWR 2.06, against PatchUPK', () => {
  it.each(Object.keys(PATCHUPK))('%s: the same bytes as PatchUPK', (mod) => {
    const r = runScript(readFileSync(resolve(mods, mod), 'latin1'), { open: opener(lwr) })
    expect(r.steps.filter((s) => s.status === 'error')).toEqual([])
    for (const [name, hash] of Object.entries(PATCHUPK[mod]!))
      expect(sha(r.packages.get(name)!.bytes)).toBe(hash)
  })

  it('reports a mod applied twice as installed, changing nothing', () => {
    const text = readFileSync(resolve(mods, 'LightningReflexes.txt'), 'latin1')
    const first = runScript(text, { open: opener(lwr) })
    expect(first.status).toBe('not-installed')
    const again = runScript(text, { open: (n) => first.packages.get(n.toLowerCase()) })
    expect(again.status).toBe('installed')
    expect(sha(again.packages.get('xcomgame.upk')!.bytes)).toBe(
      PATCHUPK['LightningReflexes.txt']!['xcomgame.upk'],
    )
  })

  it('finds Enhanced Tactical Info does not fit LWR’s tactical UI movie, as PatchUPK does', () => {
    const r = runScript(readFileSync(resolve(mods, 'EnhancedTacticalInfo.txt'), 'latin1'), {
      open: opener(lwr),
    })
    expect(r.status).toBe('does-not-fit')
    const err = r.steps.find((s) => s.status === 'error')!
    expect(err.where).toBe('UICollection_Tactical_SF.upk: gfxUnitGermanMode.UnitGermanMode')
  })

  it('uses the player’s option value in place of the script’s', () => {
    const text = readFileSync(resolve(mods, 'SoldierGenderEW.txt'), 'latin1')
    const asIs = runScript(text, { open: opener(lwr) })
    const changed = runScript(text, { open: opener(lwr), values: { FemaleProb: '40' } })
    const a = asIs.packages.get('xcomgame.upk')!.bytes
    const b = changed.packages.get('xcomgame.upk')!.bytes
    const diff = [...a].flatMap((x, i) => (x !== b[i] ? [i] : []))
    expect(diff).toHaveLength(1)
    expect(b[diff[0]!]).toBe(40)
  })

  it('adds names and moves a grown function exactly as PatchUPK does', () => {
    const r = runScript(
      `UPK_FILE=XComStrategyGame.upk
[ADD_NAME_ENTRY]
<%u 9>
<%t "WGhost81">
<%u 0x00000000>
<%u 0x00070010>
[ADD_NAME_ENTRY]
<%u 11>
<%t "LWTreeTest">
<%u 0x00000000>
<%u 0x00070010>
OBJECT=XGHeadQuarters.OrderStaff:AUTO
[REPLACEMENT_CODE]
04 0B
53
`,
      { open: opener(lwr) },
    )
    expect(r.steps.map((s) => s.status)).toEqual(['change', 'change', 'change'])
    const pkg = r.packages.get('xcomstrategygame.upk')!
    expect(sha(pkg.bytes)).toBe('d8a5d273befeeb2a2841057ff0bc668677f8858c41adad781a22c65368f39b28')
    // And the package still reads: the new names, the shrunk function.
    const again = new Package(pkg.bytes)
    expect(again.findName('LWTreeTest')).toBeGreaterThan(0)
    expect(again.scriptOf(again.findObject('XGHeadQuarters.OrderStaff', true))?.size).toBe(3)
  })
})

describe.skipIf(!existsSync(lw) || !existsSync(mods))(
  'mods on the person’s Long War 1.0 install',
  () => {
    it.each(readdirSync(existsSync(mods) ? mods : root).filter((f) => f.endsWith('.txt')))(
      '%s is installed there',
      (mod) => {
        const r = runScript(readFileSync(resolve(mods, mod), 'latin1'), { open: opener(lw) })
        expect(r.status).toBe('installed')
      },
    )
  },
)
