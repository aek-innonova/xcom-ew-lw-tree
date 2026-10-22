import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { Linker } from '../src/linker.ts'
import { cppClasses, nativesReference, parseNotes } from '../src/natives.ts'
import { readableSource } from '../src/fidelity.ts'
import { openPackage } from '../src/package.ts'
import { VANILLA } from './corpus.ts'

// The native interface, from vanilla Enemy Within's packages: the classes only C++
// defines, their parents and members as the bytecode shows them, and the reference.
const dir = dirname(VANILLA[0]!)

describe.skipIf(!VANILLA.every((p) => existsSync(p)))('the native interface', () => {
  it('classes only C++ defines: their parents and what their members hold, as the shipped bytecode shows', () => {
    const c = cppClasses(new Linker([dir]))
    expect(c.get('engine.netconnection')?.parent).toBe('Engine.Player')
    expect(c.get('engine.fracturedstaticmesh')?.parent).toBe('Engine.StaticMesh')
    expect([...(c.get('engine.fracturedstaticmesh')?.ancestors.get('Engine.StaticMesh') ?? [])]).toContain('XComGame.XComFracLevelActor.PostBeginPlay')
    expect(c.get('engine.childconnection')?.holds.get('Parent')).toBe('Engine.NetConnection')
  })

  it('code reading their members compiles as plain source (no __asm)', () => {
    for (const [file, path] of [
      ['Engine.upk', 'PlayerController.IsSplitscreenPlayer'],
      ['Engine.upk', 'PlayerController.GetSplitscreenPlayerByIndex'],
      ['XComGame.upk', 'XComFracLevelActor.PostBeginPlay'],
    ] as const) {
      const linker = new Linker([dir])
      const pkg = openPackage(new Uint8Array(readFileSync(`${dir}/${file}`)))
      linker.add(file.replace('.upk', ''), pkg)
      expect(readableSource(linker, pkg, pkg.find(path)), path).not.toContain('__asm(')
    }
  })

  it('the reference: natives with their index and flags, events, C++-only classes; our notes beside them', () => {
    const notes = parseNotes(readFileSync(new URL('../notes/natives.md', import.meta.url), 'utf8'))
    expect(notes.get('object.rand')).toContain('How known')
    const md = nativesReference(new Linker([dir]), notes)
    expect(md).toContain('- `Object.Rand`: `native(167) static final function int Rand(int Max)` (native 167, final, static)')
    expect(md).toContain('  A random integer from 0 up to, not including, `Max`.')
    expect(md).toMatch(/- `Actor\.Sleep`: .* \(native 256, final, latent\)/)
    expect(md).toContain('### Engine.NetConnection')
    expect(md).toContain('Descends from `Engine.Player`')
    // The command: the same, from beside a package.
    const cli = new URL('../src/cli.ts', import.meta.url).pathname
    expect(execFileSync(process.execPath, [cli, 'natives', `${dir}/Core.upk`], { encoding: 'utf8', maxBuffer: 1 << 26 })).toContain('### Events')
  }, 120_000)
})
