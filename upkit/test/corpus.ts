// The game's own packages, from the git-ignored samples/ folder of the
// repository: the corpus every phase is measured on. Tests skip when absent.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { openPackage, type Package } from '../src/package.ts'

const SAMPLES = resolve(import.meta.dirname, '../../samples')
export const CORPUS = [
  'CookedPCConsole/Core.upk',
  'CookedPCConsole/Engine.upk',
  'CookedPCConsole/XComGame.upk',
  'CookedPCConsole/XComStrategyGame.upk',
  'lwr/LW Rebalance v2.06.00/CookedPCConsole/LWRebalance.u',
  'lwr/LW Rebalance v2.06.00/CookedPCConsole/XComGame.upk',
  'lwr/LW Rebalance v2.06.00/CookedPCConsole/XComStrategyGame.upk',
].map((p) => resolve(SAMPLES, p))

export const haveCorpus = CORPUS.every((p) => existsSync(p))

/** Vanilla Enemy Within's script packages (no hand patches), where the samples have them: ew/CookedPCConsole. */
export const VANILLA = ['Core.upk', 'Engine.upk', 'XComGame.upk', 'XComStrategyGame.upk']
  .map((p) => resolve(SAMPLES, 'ew/CookedPCConsole', p))
  .filter((p) => existsSync(p))

const cache = new Map<string, Package>()
export function load(path: string): Package {
  if (!cache.has(path)) cache.set(path, openPackage(new Uint8Array(readFileSync(path))))
  return cache.get(path)!
}
/** "XComGame.upk", or "lwr/XComGame.upk" for LWR's own. */
export const short = (p: string) => (p.includes('/lwr/') ? 'lwr/' : p.includes('/ew/') ? 'ew/' : '') + p.split('/').pop()!
