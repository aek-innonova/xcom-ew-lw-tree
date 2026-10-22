import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseCommands, runScript, scriptPackages } from '../modpatch'
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

// Every command PatchUPK's readme documents (features/upkit-apply.md), each on
// LWR's XComStrategyGame.upk: the SHA-256 of what PatchUPK 7.3 (UPKUtils
// 9b2fd07, built from its source) made of the same script. With PATCHUPK set
// to its binary, it is run as well and its bytes compared.
const GET_ALT = 'OBJECT=XGStrategyAI.GetAltWeapon'
const COMMANDS: { name: string; script: string; hash: string; files?: (pkg: Package) => Record<string, Uint8Array> }[] = [
  {
    name: 'values: BYTE, INTEGER, FLOAT, UNSIGNED, NAMEIDX, OBJIDX (UPDATE_REL)',
    script: `${GET_ALT}\nUPDATE_REL=TRUE\nREL_OFFSET=0x30\nBYTE=0x0B\nINTEGER=-5\nFLOAT=1.5\nUNSIGNED=0xFFFFFFFF\nNAMEIDX=None\nOBJIDX=XGStrategyAI.GetAltWeapon`,
    hash: '18097151eb88c3c56787fc54d11938fa823fb230e16d8a68aa50256220e75cc7',
  },
  {
    name: 'scopes: OFFSET, NAME_ENTRY, EXPORT_ENTRY, IMPORT_ENTRY',
    script: `OFFSET=0x100\nMODDED_HEX=AA\nNAME_ENTRY=GetAltWeapon\nREL_OFFSET=0\nUNSIGNED=13\nEXPORT_ENTRY=XGStrategyAI.GetAltWeapon\nREL_OFFSET=40\nUNSIGNED=7\nIMPORT_ENTRY=Core.Object\nREL_OFFSET=24\nINTEGER=0`,
    hash: '1fccf1c2bc92c75b089b44001f19dbc000089525987e93d9fd98af948a55e870',
  },
  { name: 'RENAME (and NAMELIST_NAME)', script: 'RENAME=GetAltWeapon:GetAltWeapoX\nNAMELIST_NAME=GetAltWeapoX:#etAltWeapoY', hash: '68ad33d420a6c4edf7ab64f75164bf486065e7a244ee0440e661eac3c23bbe55' },
  { name: 'INSERT_CODE (AUTO): the byte at the offset written over, as PatchUPK does', script: `${GET_ALT}:AUTO\nREL_OFFSET=62\n[INSERT_CODE]\nAA BB CC`, hash: '7c42f2a470a3f620cf153e8bf094f4d993fbe45b35ce1cd6abca1169aeef941a' },
  { name: 'INSERT_CODE of one byte: written in place', script: `${GET_ALT}:AUTO\nREL_OFFSET=62\n[INSERT_CODE]\nAA`, hash: 'decb0dc8b807e9a2e121bd3a95245a7781a0a8683775e44982e3967646027316' },
  { name: 'INSERT_CODE (INPL): resized where it is, the objects after it moved', script: `${GET_ALT}:INPL\nREL_OFFSET=62\n[INSERT_CODE]\nAA BB CC`, hash: '964c3e43a056638fb217da32ed45cfd942e05f5a0d0312f4efb11648ed23b841' },
  { name: 'REPLACE_HEX (AUTO): both places, the script size adjusted', script: `${GET_ALT}:AUTO\nREPLACE_HEX=35 4f 00 00 00:35 4e 00 00 00 0b`, hash: '3529da45c89609b52ea10f587807f221e58fc0a22de8255eeb957bae2133c4ab' },
  { name: 'REPLACE_HEX (INPL)', script: `${GET_ALT}:INPL\nREPLACE_HEX=35 4f 00 00 00:35 4e 00 00 00 0b`, hash: 'a6fd53a3d894580096a7b4df6788c68142ad52fccbcd21923610d2e824487c73' },
  {
    name: 'MODDED_FILE: the object by the file name, resized to the file (AUTO)',
    script: 'MODDED_FILE=XGStrategyAI.GetAltWeapon.Function:AUTO',
    hash: '2820cc6a682f5101d2cc40c30f71c82c771d9fced694363f607c0c163cf71dfb',
    files: (pkg) => {
      const d = pkg.exportData(pkg.findObject('XGStrategyAI.GetAltWeapon', true))
      const f = new Uint8Array(d.length + 5)
      f.set(d)
      f[60] = 0x77
      return { 'XGStrategyAI.GetAltWeapon.Function': f }
    },
  },
  { name: 'BULK_DATA: a bulk data mirror where the offset is', script: `${GET_ALT}:AUTO\nREL_OFFSET=60\nBULK_DATA=01 02 03 04 05`, hash: '7c1e1ade96423423eb9d1558e3f1c4d272fae361254e4fcaf900d9b1a7a63651' },
  {
    name: 'EXPAND_FUNCTION (nops before the end, sizes grown), of a class (zeros), EXPAND_UNDO',
    script: 'EXPAND_FUNCTION=XGStrategyAI.GetAltWeapon:400\nEXPAND_FUNCTION=XGStrategyAI:20000\nEXPAND_UNDO=XGStrategyAI',
    hash: 'eb6071d5a6bdfe5f614f7f467ce25576e3ae8bfbee6a9cd81c132925647aeead',
  },
]

function patchUPK(script: string, files: Record<string, Uint8Array>): Uint8Array | undefined {
  if (!process.env.PATCHUPK) return undefined
  const dir = mkdtempSync(join(tmpdir(), 'lwtree-patchupk-'))
  try {
    writeFileSync(join(dir, 'xcomstrategygame.upk'), readFileSync(resolve(lwr, 'XComStrategyGame.upk')))
    for (const [f, b] of Object.entries(files)) writeFileSync(join(dir, f), b)
    writeFileSync(join(dir, 'mod.txt'), script)
    try {
      execFileSync(process.env.PATCHUPK, ['mod.txt', '.'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' })
    } catch {
      // (A script it stops: the package as it left it.)
    }
    return new Uint8Array(readFileSync(join(dir, 'xcomstrategygame.upk')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe.skipIf(!existsSync(lwr))('every command PatchUPK’s readme documents, against PatchUPK', () => {
  it.each(COMMANDS.map((c) => [c.name, c] as const))('%s', (_, c) => {
    const script = `UPK_FILE=XComStrategyGame.upk\n${c.script}\n`
    const files = c.files?.(opener(lwr)('XComStrategyGame.upk')!) ?? {}
    const r = runScript(script, { open: opener(lwr), readFile: (f) => files[f] })
    expect(r.steps.filter((s) => s.status === 'error')).toEqual([])
    const ours = r.packages.get('xcomstrategygame.upk')!.bytes
    // With PatchUPK at hand, its bytes now; else the hash of what it made.
    const theirs = patchUPK(script, files)
    if (theirs) console.log(`${c.name}: ${sha(theirs)}`)
    expect(sha(ours)).toBe(theirs ? sha(theirs) : c.hash)
    expect(sha(ours)).toBe(c.hash)
    // Applied again: as it is already (INSERT_CODE excepted: it inserts again, as its readme warns;
    // and a rename of a renamed name, which finds neither).
    const again = /INSERT_CODE|EXPAND_UNDO|NAMELIST_NAME/.test(c.script)
      ? 'installed'
      : runScript(script, { open: (n) => r.packages.get(n.toLowerCase()), readFile: (f) => files[f] }).status
    expect(again).toBe('installed')
  })

  it('GUID: a package of another GUID refused, as PatchUPK does', () => {
    const r = runScript('GUID=00000000000000000000000000000000:XComStrategyGame.upk\nUPK_FILE=XComStrategyGame.upk\n', { open: opener(lwr) })
    expect(r.status).toBe('does-not-fit')
    const pkg = opener(lwr)('XComStrategyGame.upk')!
    const ok = runScript(`GUID=${pkg.guid()}:XComStrategyGame.upk\nUPK_FILE=XComStrategyGame.upk\n${GET_ALT}\n`, { open: opener(lwr) })
    expect(ok.steps.filter((s) => s.status === 'error')).toEqual([])
  })

  it('REPLACE_HEX: every place replaced (where PatchUPK stops at the second: "Package is not opened!")', () => {
    const r = runScript(`UPK_FILE=XComStrategyGame.upk\n${GET_ALT}:AUTO\nREPLACE_HEX=00:AB CD\n`, { open: opener(lwr) })
    const step = r.steps.find((s) => s.what === 'REPLACE_HEX')!
    expect(step.status).toBe('change')
    expect(Number(step.note!.split(' ')[0])).toBeGreaterThan(2)
  })

  it('ADD_IMPORT_ENTRY, ADD_EXPORT_ENTRY: what PatchUPK makes, linked, counted, with a depends entry', () => {
    // A variable and a function with a parameter added to a class, as upkit writes them.
    const script = `UPK_FILE=XComStrategyGame.upk
[ADD_NAME_ENTRY]
<%i 13> <%t "m_iUpkitTest"> <%u 0x00000000> <%u 0x00070010>
[ADD_NAME_ENTRY]
<%i 10> <%t "UpkitTest"> <%u 0x00000000> <%u 0x00070010>
[ADD_NAME_ENTRY]
<%i 7> <%t "XGUnit"> <%u 0x00000000> <%u 0x00070010>
[ADD_IMPORT_ENTRY]
<Core> <Class> <Class.XComGame> <XGUnit>
[ADD_EXPORT_ENTRY]
<Core.IntProperty> <NullRef> <Class.XGFundingCouncil> <m_iUpkitTest> <NullRef> 00 00 00 00 04 00 07 00 28 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
[ADD_EXPORT_ENTRY]
<Core.Function> <NullRef> <Class.XGFundingCouncil> <UpkitTest> <NullRef> 00 00 00 00 04 00 07 00 80 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
[ADD_EXPORT_ENTRY]
<Core.ObjectProperty> <NullRef> <XGFundingCouncil.UpkitTest> <m_iUpkitTest> <NullRef> 00 00 00 00 04 00 07 00 2C 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
`
    const orig = opener(lwr)('XComStrategyGame.upk')!
    const r = runScript(script, { open: opener(lwr) })
    expect(r.steps.map((s) => s.status)).toEqual(Array(7).fill('change'))
    const pkg = new Package(r.packages.get('xcomstrategygame.upk')!.bytes)
    const n = orig.exports.length
    expect(pkg.exports.length).toBe(n + 3)
    expect(pkg.findObject('XComGame.XGUnit')).toBeLessThan(0)
    const view = new DataView(pkg.bytes.buffer, pkg.bytes.byteOffset)
    const i32 = (at: number) => view.getInt32(at, true)
    // Each object's data: its net index (its own index), None, zeros, as long as its entry says.
    const fn = pkg.findObject('XGFundingCouncil.UpkitTest', true)
    expect(fn).toBe(n + 2)
    const f = pkg.exports[fn - 1]!
    expect([f.size, i32(f.offset), pkg.names[i32(f.offset + 4)]]).toEqual([128, n + 1, 'None'])
    // Linked: the class's children end in the variable then the function; the function's first child is its parameter.
    const cls = pkg.exports[pkg.findObject('XGFundingCouncil', true) - 1]!
    const chain: number[] = []
    for (let c = i32(cls.offset + 4 + 12); c; c = i32(pkg.exports[c - 1]!.offset + 12)) chain.push(c)
    expect(chain.slice(-2)).toEqual([n + 1, n + 2])
    expect(i32(f.offset + 12 + 12)).toBe(n + 3)
    // Counted among the net objects (the game logs it as invalid otherwise), and in the depends table.
    const sum = (b: Uint8Array) => {
      const v = new DataView(b.buffer, b.byteOffset)
      const at = 12 + 4 + v.getInt32(12, true) + 4
      const gens = at + 4 * 7 + 16 + 16
      return { depends: v.getInt32(at + 4 * 6, true), serial: v.getInt32(at + 4 * 7, true), net: v.getInt32(gens + 4 + 12 * (v.getInt32(gens, true) - 1) + 8, true) }
    }
    expect(sum(pkg.bytes).net).toBeGreaterThanOrEqual(n + 3)
    // (LWR's own package has fewer depends entries than exports: it added objects with PatchUPK.)
    const span = (b: Uint8Array) => sum(b).serial - sum(b).depends
    expect(span(pkg.bytes) - span(orig.bytes)).toBe(4 * 3)
    // Applied again: there already.
    expect(runScript(script, { open: (x) => r.packages.get(x.toLowerCase()) }).status).toBe('installed')
    // PatchUPK: the same tables and objects but for the links, the count and the depends entries; and 4 stray bytes at the end.
    const theirs = patchUPK(script, {})
    const entries = (p: Package) => p.exports.map((e) => [e.fullName, e.type, e.size])
    expect(theirs ? entries(new Package(theirs)) : entries(pkg)).toEqual(entries(pkg))
    expect(theirs ? theirs.length : pkg.bytes.length - 4 * 3 + 4).toBe(pkg.bytes.length - 4 * 3 + 4)
  })
})

// upkit's mode (features/upkit-mode.md): asked for on the package line, read without PatchUPK's faults.
describe.skipIf(!existsSync(lwr))('upkit’s mode: UPK_FILE=…:UPKIT1', () => {
  const marked = (body: string) => `UPK_FILE=XComStrategyGame.upk:UPKIT1\n${body}\n`

  it('PatchUPK stops at the marked package line before writing anything', () => {
    const script = marked(`${GET_ALT}\nREL_OFFSET=0x30\nBYTE=0x0B`)
    const original = readFileSync(resolve(lwr, 'XComStrategyGame.upk'))
    const theirs = patchUPK(script, {})
    expect(sha(theirs ?? original)).toBe(sha(original))
    // Ours reads the name without the mark, and applies it.
    expect(scriptPackages(script)).toEqual(['XComStrategyGame.upk'])
    expect(runScript(script, { open: opener(lwr) }).status).toBe('not-installed')
  })

  it('INSERT_CODE inserts, and the script’s serial and memory sizes grow with it', () => {
    const before = opener(lwr)('XComStrategyGame.upk')!
    const ref = before.findObject('XGStrategyAI.GetAltWeapon', true)
    const was = before.exportData(ref).slice()
    const s0 = before.scriptOf(ref)!
    const r = runScript(marked(`${GET_ALT}:AUTO\nREL_OFFSET=62\n[INSERT_CODE]\n0B <XGStrategyAI.GetAltWeapon> 0B`), { open: opener(lwr) })
    expect(r.steps.filter((x) => x.status === 'error')).toEqual([])
    const pkg = r.packages.get('xcomstrategygame.upk')!
    const now = pkg.exportData(ref)
    expect(now.length).toBe(was.length + 6)
    // (The script's sizes, before its code, differ: below.)
    expect([...now.subarray(0, s0.relOffset - 8), ...now.subarray(s0.relOffset, 62)]).toEqual([...was.subarray(0, s0.relOffset - 8), ...was.subarray(s0.relOffset, 62)])
    expect([...now.subarray(62, 68)]).toEqual([0x0b, ...new Uint8Array(new Int32Array([ref]).buffer), 0x0b])
    expect([...now.subarray(68)]).toEqual([...was.subarray(62)])
    const s1 = pkg.scriptOf(ref)!
    expect([s1.size, s1.memSize]).toEqual([s0.size + 6, s0.memSize + 10])
  })

  it('names and exports added are counted in the generation', () => {
    const gen = (b: Uint8Array) => {
      const v = new DataView(b.buffer, b.byteOffset)
      const g = 12 + 4 + v.getInt32(12, true) + 4 + 4 * 7 + 16 + 16
      const at = g + 4 + 12 * (v.getInt32(g, true) - 1)
      return [v.getInt32(at, true), v.getInt32(at + 4, true)]
    }
    const add = '[ADD_NAME_ENTRY]\n<%i 10> <%t "UpkitMode"> <%u 0x00000000> <%u 0x00070010>'
    const plain = runScript(`UPK_FILE=XComStrategyGame.upk\n${add}\n`, { open: opener(lwr) })
    const mode = runScript(marked(add), { open: opener(lwr) })
    const [e0, n0] = gen(plain.packages.get('xcomstrategygame.upk')!.bytes)
    expect(gen(mode.packages.get('xcomstrategygame.upk')!.bytes)).toEqual([e0, n0! + 1])
  })

  it('refused: a key the format does not have, a script marked in part, a newer mode', () => {
    const note = (text: string) => runScript(text, { open: opener(lwr) }).steps.find((x) => x.status === 'error')?.note
    expect(note(marked(`${GET_ALT}\nREL_OFSET=0x30\nBYTE=0x0B`))).toBe('REL_OFSET=0x30: not a command of the format')
    expect(note(marked(`${GET_ALT}\n[MODDED_HEXX]\n0B`))).toBe('[MODDED_HEXX]: not a command of the format')
    // (Without the mode, as PatchUPK: skipped.)
    expect(note(`UPK_FILE=XComStrategyGame.upk\n${GET_ALT}\nREL_OFSET=0x30\n`)).toBeUndefined()
    expect(note(`UPK_FILE=XComStrategyGame.upk\n${GET_ALT}\nUPK_FILE=XComStrategyGame.upk:UPKIT1\n`)).toMatch(/^some package lines ask for upkit's mode 1 and some do not/)
    expect(note('UPK_FILE=XComStrategyGame.upk:UPKIT2\n')).toBe("made for upkit's mode 2; this patcher knows mode 1")
  })
})
