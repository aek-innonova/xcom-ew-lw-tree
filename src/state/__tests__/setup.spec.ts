import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { GameFiles } from '../gamefiles'
import {
  BACKUP,
  MANIFEST,
  applyPlan,
  emptyManaged,
  loadManaged,
  planSetup,
  type Wanted,
} from '../setup'

const root = resolve(import.meta.dirname, '../../..')
const lwr = resolve(root, 'samples/lwr/LW Rebalance v2.06.00')
const mods = resolve(root, 'samples/additional_mods')
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
/** PatchUPK's output for Lightning Reflexes on LWR's XComGame.upk (modpatch.spec.ts). */
const LIGHTNING_PATCHUPK = '893b323d6d5d1cedf3bfcb894ccfd2bb055093320b998582849f020491264e68'

/** A game folder in memory, case-insensitive like Windows. */
function memoryFiles(
  start: Record<string, Uint8Array>,
): GameFiles & { map: Map<string, Uint8Array> } {
  const map = new Map(Object.entries(start))
  const key = (p: string) => [...map.keys()].find((k) => k.toLowerCase() === p.toLowerCase()) ?? p
  return {
    map,
    async read(p) {
      return map.get(key(p))?.slice() ?? null
    },
    async file() {
      return null
    },
    async list(dir) {
      return [...map.keys()]
        .filter((k) => k.startsWith(`${dir}/`) && !k.slice(dir.length + 1).includes('/'))
        .map((k) => k.slice(dir.length + 1))
    },
    async write(p, d) {
      map.set(key(p), d.slice())
    },
    async remove(p) {
      map.delete(key(p))
    },
    async canWrite() {
      return true
    },
  }
}

const read = (p: string) => new Uint8Array(readFileSync(p))
const text = (p: string) => readFileSync(p, 'latin1')
const utf8 = (s: string) => new TextEncoder().encode(s)
const str = (b: Uint8Array | undefined) => new TextDecoder().decode(b)

describe.skipIf(!existsSync(lwr) || !existsSync(mods))(
  'putting a setup into the game (state/setup.ts)',
  () => {
    const start = () =>
      memoryFiles({
        'CookedPCConsole/XComGame.upk': read(`${lwr}/CookedPCConsole/XComGame.upk`),
        'CookedPCConsole/Sightlines.u': read(`${lwr}/CookedPCConsole/Sightlines.u`),
        'Config/DefaultGameCore.ini': utf8(
          '[XComGame.XGTacticalGameCore]\r\nNUM_STARTING_SOLDIERS=12\r\n',
        ),
        'Config/DefaultMutatorLoader.ini': utf8(
          '[XComMutator.XComMutatorLoader]\r\narrTacticalMutators="XComLZMutator.XComLZMutator"\r\n',
        ),
      })
    const lightning: Wanted['scripts'][number] = {
      label: 'Lightning Reflexes',
      text: text(`${mods}/Mods/LightningReflexes.txt`),
      values: {},
    }
    const soldier: Wanted['scripts'][number] = {
      label: 'Soldier Gender',
      text: text(`${mods}/Mods/SoldierGenderEW.txt`),
      values: { FemaleProb: '40' },
    }
    const sl = `${mods}/mod.files/Sightlines-1.4`
    const sightlinesFiles: Wanted['files'][number] = {
      label: 'Sightlines-1.4',
      files: [
        { path: 'Sightlines.u', kind: 'package', data: read(`${sl}/Sightlines.u`) },
        {
          path: 'DefaultSightlines.ini',
          kind: 'config',
          data: read(`${sl}/DefaultSightlines.ini`),
        },
        {
          path: 'DefaultMutatorLoader.ini',
          kind: 'config',
          data: read(`${sl}/DefaultMutatorLoader.ini`),
        },
      ],
    }
    const setting = {
      section: 'XComGame.XGTacticalGameCore',
      key: 'NUM_STARTING_SOLDIERS',
      occurrence: 0,
      value: '60',
    }

    it('installs, keeps the originals, and does nothing the second time', async () => {
      const files = start()
      const original = files.map.get('CookedPCConsole/XComGame.upk')!.slice()
      const wanted = { scripts: [lightning], files: [], settings: [setting] }
      const plan = await planSetup(files, wanted, emptyManaged())
      expect(plan.problems).toEqual([])
      expect(plan.changes.map((c) => [c.path, c.action, !!c.backup])).toEqual([
        ['CookedPCConsole/XComGame.upk', 'write', true],
        ['Config/DefaultGameCore.ini', 'write', true],
      ])
      const steps: string[] = []
      await applyPlan(files, plan, (done, total, path) =>
        steps.push(`${done + 1}/${total} ${path}`),
      )
      expect(steps).toEqual(['1/2 CookedPCConsole/XComGame.upk', '2/2 Config/DefaultGameCore.ini'])
      expect(sha(files.map.get('CookedPCConsole/XComGame.upk')!)).toBe(LIGHTNING_PATCHUPK)
      expect(sha(files.map.get(`${BACKUP}/CookedPCConsole/XComGame.upk`)!)).toBe(sha(original))
      expect(str(files.map.get('Config/DefaultGameCore.ini'))).toContain(
        'NUM_STARTING_SOLDIERS=60\r\n',
      )
      expect((await planSetup(files, wanted, plan.managed)).changes).toEqual([])
    })

    it('takes a mod out again by going back to the original', async () => {
      const files = start()
      const original = sha(files.map.get('CookedPCConsole/XComGame.upk')!)
      const first = await planSetup(
        files,
        { scripts: [lightning], files: [], settings: [] },
        emptyManaged(),
      )
      await applyPlan(files, first)
      const out = await planSetup(files, { scripts: [], files: [], settings: [] }, first.managed)
      expect(out.changes.map((c) => [c.path, c.action, !!c.backup])).toEqual([
        ['CookedPCConsole/XComGame.upk', 'write', false],
      ])
      await applyPlan(files, out)
      expect(sha(files.map.get('CookedPCConsole/XComGame.upk')!)).toBe(original)
    })

    it('keeps its record in the game folder, and never overwrites a backup when the record is lost', async () => {
      const files = start()
      const original = sha(files.map.get('CookedPCConsole/XComGame.upk')!)
      const wanted = { scripts: [lightning], files: [], settings: [] }
      const first = await planSetup(files, wanted, emptyManaged())
      await applyPlan(files, first)
      expect(await loadManaged(files)).toEqual(first.managed)
      // The record goes missing; the modded file is not taken for the original.
      files.map.delete(MANIFEST)
      const plan = await planSetup(
        files,
        { scripts: [], files: [], settings: [] },
        await loadManaged(files),
      )
      expect(plan.changes.map((c) => [c.path, !!c.backup])).toEqual([
        ['CookedPCConsole/XComGame.upk', false],
      ])
      await applyPlan(files, plan)
      expect(sha(files.map.get('CookedPCConsole/XComGame.upk')!)).toBe(original)
      expect(sha(files.map.get(`${BACKUP}/CookedPCConsole/XComGame.upk`)!)).toBe(original)
    })

    it('survives an apply cut short: its own half-written files are never taken for originals', async () => {
      const files = start()
      const original = sha(files.map.get('CookedPCConsole/XComGame.upk')!)
      const ini = sha(files.map.get('Config/DefaultGameCore.ini')!)
      // A first setup, applied in full.
      const first = await planSetup(
        files,
        { scripts: [lightning], files: [], settings: [] },
        emptyManaged(),
      )
      await applyPlan(files, first)
      // A second, cut short after its first file (the app closed mid-way).
      const second = await planSetup(
        files,
        { scripts: [lightning], files: [], settings: [setting] },
        await loadManaged(files),
      )
      expect(second.changes.map((c) => c.path)).toEqual(['Config/DefaultGameCore.ini'])
      const write = files.write
      let writes = 0
      files.write = async (p, d) => {
        if (!p.startsWith(BACKUP) && ++writes > 1) throw new Error('closed')
        return write(p, d)
      }
      const third = await planSetup(
        files,
        { scripts: [soldier], files: [], settings: [setting] },
        await loadManaged(files),
      )
      await expect(applyPlan(files, third)).rejects.toThrow('closed')
      files.write = write
      // Everything back: the originals, from the first backups, untouched.
      const back = await planSetup(
        files,
        { scripts: [], files: [], settings: [] },
        await loadManaged(files),
      )
      expect(back.changes.filter((c) => c.backup)).toEqual([])
      await applyPlan(files, back)
      expect(sha(files.map.get('CookedPCConsole/XComGame.upk')!)).toBe(original)
      expect(sha(files.map.get(`${BACKUP}/CookedPCConsole/XComGame.upk`)!)).toBe(original)
      expect(sha(files.map.get('Config/DefaultGameCore.ini')!)).toBe(ini)
    })

    it('takes a reinstalled file as the new original', async () => {
      const files = start()
      const wanted = { scripts: [lightning], files: [], settings: [] }
      const first = await planSetup(files, wanted, emptyManaged())
      await applyPlan(files, first)
      // Reinstalled: another file is there now (the person's Long War 1.0 one,
      // which has Lightning Reflexes in it already).
      const reinstalled = read(resolve(root, 'samples/CookedPCConsole/XComGame.upk'))
      files.map.set('CookedPCConsole/XComGame.upk', reinstalled)
      const plan = await planSetup(files, wanted, first.managed)
      expect(plan.changes).toEqual([])
      expect(plan.managed.originals['CookedPCConsole/XComGame.upk']).toBe(sha(reinstalled))
    })

    it('brings a mod’s files: new ones added, INI lines merged, the game’s own package kept; and takes them out', async () => {
      const files = start()
      const plan = await planSetup(
        files,
        { scripts: [], files: [sightlinesFiles], settings: [] },
        emptyManaged(),
      )
      expect(plan.changes.map((c) => [c.path, c.action])).toEqual([
        ['Config/DefaultSightlines.ini', 'create'],
        ['Config/DefaultMutatorLoader.ini', 'write'],
      ])
      await applyPlan(files, plan)
      expect(str(files.map.get('Config/DefaultMutatorLoader.ini'))).toContain(
        'arrTacticalMutators="Sightlines.SightlineMutator"',
      )
      const out = await planSetup(files, { scripts: [], files: [], settings: [] }, plan.managed)
      expect(out.changes.map((c) => [c.path, c.action])).toEqual([
        ['Config/DefaultMutatorLoader.ini', 'write'],
        ['Config/DefaultSightlines.ini', 'remove'],
      ])
      await applyPlan(files, out)
      expect(files.map.has('Config/DefaultSightlines.ini')).toBe(false)
      expect(str(files.map.get('Config/DefaultMutatorLoader.ini'))).not.toContain('Sightlines')
    })

    it('leaves out a mod that does not fit, saying why', async () => {
      const files = start()
      const eti = {
        label: 'Enhanced Tactical Info',
        text: text(`${mods}/Mods/EnhancedTacticalInfo.txt`),
        values: {},
      }
      const plan = await planSetup(
        files,
        { scripts: [eti, lightning], files: [], settings: [] },
        emptyManaged(),
      )
      expect(plan.problems[0]).toMatch(/^Enhanced Tactical Info does not fit this install/)
      expect(plan.changes.map((c) => c.path)).toEqual(['CookedPCConsole/XComGame.upk'])
    })
  },
)
