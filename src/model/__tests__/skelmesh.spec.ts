import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readAnimSet, readPose } from '../anim'
import { posedBone, poseMesh, readSkelMesh, type LocalPose } from '../skelmesh'
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

    it('stands the body in the barracks idle: arms at the sides, as tall, the head moved', () => {
      const open = (f: string) =>
        new Package(decompressPackage(new Uint8Array(readFileSync(`${C}/${f}`))))
      const a = open('Anim_Barracks.upk')
      const set = readAnimSet(
        a,
        a.exports.findIndex((e) => e.type === 'AnimSet'),
      )
      expect(set.tracks.length).toBe(109)
      const seq = set.sequences.find((s) => s.name === 'Loadout_Veteran_1Hand_IdleA')!
      const anim = readPose(a, set, seq.index)
      const p = open('Soldier_MaleKevlar_SF.upk')
      const m = readSkelMesh(
        p,
        p.exports.findIndex((e) => e.type === 'SkeletalMesh' && e.name === 'SM_Lv1MedMale'),
      )
      // The animation's rotations are the skeleton's conjugated.
      const pose = new Map<string, LocalPose>()
      for (const b of m.bones) {
        const q = anim.get(b.name)?.rotation
        if (q && b.parent >= 0)
          pose.set(b.name, { rotation: [-q[0], -q[1], -q[2], q[3]], position: b.position })
      }
      const span = (xs: Float32Array, k: number) => {
        let lo = Infinity
        let hi = -Infinity
        for (let i = k; i < xs.length; i += 3) {
          lo = Math.min(lo, xs[i]!)
          hi = Math.max(hi, xs[i]!)
        }
        return [Math.round(lo), Math.round(hi)]
      }
      const posed = poseMesh(m, pose)
      expect(span(m.positions, 0)).toEqual([-45, 45])
      expect(span(posed.positions, 0)).toEqual([-27, 28])
      expect(span(posed.positions, 2)[1]).toBe(120)
      const head = posedBone(m, pose, 'RigHead')!
      expect(head.position.map((x) => Math.round(x) + 0)).toEqual([0, 3, 117])
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
