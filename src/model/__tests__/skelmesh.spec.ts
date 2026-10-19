import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readSkelMesh } from '../skelmesh'
import { Package, decompressPackage } from '../upk'

// The person's install (git-ignored samples/).
const C = resolve(import.meta.dirname, '../../../samples/CookedPCConsole')
describe.skipIf(!existsSync(`${C}/Soldier_MaleKevlar_SF.upk`))(
  'soldiers (model/skelmesh.ts)',
  () => {
    it('reads the male Kevlar body: bones, sections, vertices in the rest pose', () => {
      const p = new Package(
        decompressPackage(new Uint8Array(readFileSync(`${C}/Soldier_MaleKevlar_SF.upk`))),
      )
      const m = readSkelMesh(
        p,
        p.exports.findIndex((e) => e.type === 'SkeletalMesh' && e.name === 'SM_Lv1MedMale'),
      )
      expect(m.bones.length).toBe(109)
      expect(m.bones.slice(0, 3).map((b) => b.name)).toEqual(['RigRoot', 'RigPelvis', 'RigLThigh'])
      expect(m.sections).toEqual([
        { material: 0, firstIndex: 0, triangles: 4824 },
        { material: 1, firstIndex: 14472, triangles: 32 },
      ])
      expect(m.vertexCount).toBe(3091)
      expect(Math.max(...m.indices)).toBeLessThan(m.vertexCount)
      // About 120 units tall, feet at 0, and the normals of unit length.
      let top = 0
      for (let i = 2; i < m.positions.length; i += 3) top = Math.max(top, m.positions[i]!)
      expect(Math.round(top)).toBe(120)
      const n = Math.hypot(m.normals[0]!, m.normals[1]!, m.normals[2]!)
      expect(n).toBeGreaterThan(0.9)
      expect(n).toBeLessThan(1.1)
    })

    it('opens a package compressed whole: Startup.upk and its color palettes', () => {
      const p = new Package(decompressPackage(new Uint8Array(readFileSync(`${C}/Startup.upk`))))
      const palettes = p.exports
        .filter((e) => e.type === 'XComLinearColorPalette')
        .map((e) => e.name)
      expect(palettes).toContain('ArmorTint')
      expect(palettes.length).toBe(10)
    })
  },
)
