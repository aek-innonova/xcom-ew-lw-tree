// A .upkmod run where the site's engine runs mod scripts (src/model/modpatch.ts,
// RunOptions.upkmod): on the packages it is given, with its steps and its
// standing as the engine reports a PatcherGUI script's. Its classes are
// decompiled, its hunks applied and the classes compiled back by upkit
// (upkmod.ts); the game's other packages, which the compiler reads for their
// types, come from `neighbour` (a folder, or what the site read beforehand).

import type { RunOptions, RunResult, Step } from '../../src/model/modpatch.ts'
import { Package as ScriptPackage } from '../../src/model/upk.ts'
import { Linker } from './linker.ts'
import { openPackage } from './package.ts'
import { applyUpkmodTo, parseUpkmod, UpkmodError } from './upkmod.ts'

export function upkmodRunner(neighbour: (file: string) => Uint8Array | undefined) {
  return (text: string, opts: RunOptions): RunResult => {
    const steps: Step[] = []
    const packages = new Map<string, ScriptPackage>()
    const fail = (where: string, note: string, line: number): RunResult => {
      steps.push({ where, what: 'upkit mod', status: 'error', note, line })
      return { steps, packages, status: 'does-not-fit' }
    }
    let mod
    try {
      mod = parseUpkmod(text)
    } catch (e) {
      return fail('', (e as Error).message, e instanceof UpkmodError ? e.line : 1)
    }
    // A package by name: as the run has it now (earlier mods in it), else from beside it.
    const bytesOf = (name: string): Uint8Array | undefined => {
      for (const file of [`${name}.upk`, `${name}.u`]) {
        const p = opts.open(file)
        if (p) return p.bytes
      }
      return neighbour(`${name}.upk`) ?? neighbour(`${name}.u`)
    }
    // The classes decompile as they compile only with the game's script packages at hand.
    if (!bytesOf('Core')) return fail('', "a .upkmod needs the game's script packages beside the one it changes (no Core.upk)", 1)
    for (const upk of new Set(mod.classes.map((c) => c.upk))) {
      const current = opts.open(upk)
      if (!current) return fail(upk, `${upk} is not in this install`, mod.classes.find((c) => c.upk === upk)!.line)
      if (current.compressed) return fail(upk, `${upk} is compressed`, 1)
      const name = upk.replace(/\.(upk|u)$/i, '')
      const pkg = openPackage(current.bytes)
      const linker = new Linker([], bytesOf)
      linker.add(name, pkg)
      let r
      try {
        r = applyUpkmodTo(linker, pkg, name, mod.classes.filter((c) => c.upk === upk))
      } catch (e) {
        // (Compiling it failed: said as the compiler says it.)
        return fail(upk, (e as Error).message, 1)
      }
      for (const h of r.results)
        steps.push({ where: `${upk}: ${h.cls}${h.block === 'class' ? '' : ` ${h.block}`}`, what: 'hunk', status: h.status, note: h.note, line: h.line })
      packages.set(upk.toLowerCase(), r.bytes ? new ScriptPackage(r.bytes) : current)
      if (steps.some((s) => s.status === 'error')) break
    }
    const changes = steps.filter((s) => s.status === 'change').length
    const already = steps.filter((s) => s.status === 'already').length
    const status = steps.some((s) => s.status === 'error')
      ? 'does-not-fit'
      : changes === 0 && already > 0
        ? 'installed'
        : already === 0
          ? 'not-installed'
          : 'partly'
    return { steps, packages, status }
  }
}
