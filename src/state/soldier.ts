// A soldier put together from the player's install, for the 3D view in the
// desktop app (features/game-soldiers.md): the armor's body, a head, a hair
// style on the head's socket, each with its textures, and the class color
// palette. Read on demand through the app's bridge; packages and textures
// are kept in memory while the app runs. Nothing of the game leaves the
// machine or goes into the repository.

import { readMaterialInstance, readPalette, type Color, type PaletteEntry } from '@/model/material'
import { boneWorld, placeMesh, readSkelMesh, type SkelMesh } from '@/model/skelmesh'
import { decodeImage, readTexture, unchunk } from '@/model/texture'
import { Package, decompressPackage } from '@/model/upk'
import { desktop } from './desktop'

export const ARMORS = [
  'Kevlar',
  'Carapace',
  'Skeleton',
  'Titan',
  'Ghost',
  'Archangel',
  'Psi',
] as const
export type Armor = (typeof ARMORS)[number]
export type Gender = 'Male' | 'Female'

export interface SoldierSpec {
  armor: Armor
  gender: Gender
  /** The game's head id (DefaultContent.ini HeadPackageInfo); none: the gender's first. */
  head?: number
  /** The game's hair id; a helmet's id puts the helmet on instead (Long War's headgear numbers). */
  hair?: number
}

/** The game's heads and hair styles (helmets among them), from DefaultContent.ini. */
export interface Looks {
  heads: { id: number; gender: Gender; race: string; pkg: string }[]
  hair: { id: number; gender: Gender | null; helmet: boolean; pkg: string; name: string }[]
}

/** Reads the head and hair lists from the game's DefaultContent.ini. */
export function looksIn(ini: string): Looks {
  const out: Looks = { heads: [], hair: [] }
  for (const line of ini.split(/\r?\n/)) {
    const kind = /^\s*(HeadPackageInfo|HairPackageInfo)\s*=/.exec(line)?.[1]
    if (!kind) continue
    const id = Number(/\bId=(\d+)/.exec(line)?.[1])
    const arc = /ArchetypeName="([^".]+)\.([^"]+)"/.exec(line)
    const gender = /eGender_Female/.test(line)
      ? 'Female'
      : /eGender_Male/.test(line)
        ? 'Male'
        : null
    if (!id || !arc) continue
    if (kind === 'HeadPackageInfo') {
      if (!/eChar_Soldier/.test(line) || !gender) continue
      const race = /eRace_(\w+)/.exec(line)?.[1] ?? ''
      if (!out.heads.some((h) => h.pkg === arc[1]))
        out.heads.push({ id, gender, race, pkg: arc[1]! })
    } else
      out.hair.push({
        id,
        gender,
        helmet: /bIsHelmet=true/i.test(line),
        pkg: arc[1]!,
        name: arc[2]!,
      })
  }
  return out
}

let looks: Promise<Looks> | null = null
/** The install's heads and hair. */
export function gameLooks(): Promise<Looks> {
  looks ??= desktop!.game
    .read('Config/DefaultContent.ini')
    .then((b) => looksIn(b ? new TextDecoder('latin1').decode(b) : ''))
  return looks
}

/** How a material paints: the soldier's armor (tinted), skin, hair, or as it is. */
export type PaintKind = 'armor' | 'skin' | 'hair' | 'plain'
export interface Texture {
  width: number
  height: number
  rgba: Uint8ClampedArray
}
export interface Paint {
  kind: PaintKind
  diffuse: Texture | null
  /** The armor's tint masks (the specular map: alpha the top color, blue the bottom). */
  mask: Texture | null
  /** The material's own colors: the armor's default top and bottom, the skin's or hair's color. */
  primary: Color
  secondary: Color
}
export interface DrawMesh {
  mesh: SkelMesh
  /** Per section, how it is painted. */
  paints: Paint[]
}
export interface Soldier {
  meshes: DrawMesh[]
}

const packages = new Map<string, Promise<Package>>()
const textures = new Map<string, Promise<Texture | null>>()
let palette: Promise<PaletteEntry[]> | null = null

async function pkg(file: string): Promise<Package> {
  if (!packages.has(file))
    packages.set(
      file,
      (async () => {
        const b = await desktop!.game.read(`CookedPCConsole/${file}`)
        if (!b) throw new Error(`${file} is not in the install`)
        return new Package(decompressPackage(b))
      })(),
    )
  return packages.get(file)!
}

/** A texture's largest image up to 1024 wide, from the package or its texture cache. */
function texture(p: Package, index: number, key: string): Promise<Texture | null> {
  if (!textures.has(key))
    textures.set(
      key,
      (async () => {
        const t = readTexture(p, index)
        const mip = t.mips.find((m) => m.where !== 'none' && m.width <= 1024)
        if (!mip) return null
        let data = mip.data
        if (mip.where === 'cache') {
          const raw = await desktop!.game.read(
            `CookedPCConsole/${t.cache}.tfc`,
            mip.offset,
            mip.offset + mip.sizeOnDisk,
          )
          if (!raw) return null
          data = mip.lzo ? unchunk(raw, mip.size) : raw
        }
        if (!data) return null
        try {
          return {
            width: mip.width,
            height: mip.height,
            rgba: decodeImage(t.format, data, mip.width, mip.height),
          }
        } catch {
          return null
        }
      })(),
    )
  return textures.get(key)!
}

/** The armor tint palette (UnitPalettes.ArmorTint in Startup.upk). */
export function armorPalette(): Promise<PaletteEntry[]> {
  palette ??= pkg('Startup.upk').then((p) =>
    readPalette(
      p,
      p.exports.findIndex((e) => e.type === 'XComLinearColorPalette' && e.name === 'ArmorTint'),
    ),
  )
  return palette
}

/**
 * The colors for one of Long War's color numbers: entry n of the palette (as
 * Long War's own picture of the colors shows them; its text list is one off
 * in places); a number past the palette, or none, is the armor's own.
 */
export function tintFor(
  code: number,
  palette: PaletteEntry[],
  own: Paint,
): { top: Color; bottom: Color } {
  const e = code >= 0 ? palette[code] : undefined
  return e ? { top: e.primary, bottom: e.secondary } : { top: own.primary, bottom: own.secondary }
}

const PAINTS: Record<string, PaintKind> = {
  CHH_Soldiers: 'armor',
  CHH_SkinCustomizable: 'skin',
  CHH_Hair: 'hair',
}

/** A mesh's materials, as paints. */
async function paints(p: Package, file: string, mesh: SkelMesh): Promise<Paint[]> {
  return Promise.all(
    mesh.sections.map(async (s) => {
      const ref = mesh.materials[s.material]
      const none: Paint = {
        kind: 'plain',
        diffuse: null,
        mask: null,
        primary: [1, 1, 1, 1],
        secondary: [1, 1, 1, 1],
      }
      if (!ref || ref <= 0 || p.exports[ref - 1]?.type !== 'MaterialInstanceConstant') return none
      const m = readMaterialInstance(p, ref - 1)
      const kind = PAINTS[m.parent] ?? 'plain'
      const tex = (name: string) => {
        const r = m.textures[name]
        return r && r > 0 ? texture(p, r - 1, `${file}:${r}`) : Promise.resolve(null)
      }
      const diffuse = await tex(kind === 'hair' ? 'Hairstyle Texture' : 'Diffuse')
      // Armor: its tint masks; skin: the skin mask ("Skn", the third channel).
      const mask =
        kind === 'armor'
          ? await tex('Spc_Ems_Ref_Opc')
          : kind === 'skin'
            ? await tex('Spc_dNrm_Skn_iBrw')
            : null
      const v = m.vectors
      const own: Color = (kind === 'armor'
        ? v.CMOD
        : kind === 'skin'
          ? v.SkinColor
          : v.ColorMod) ?? [1, 1, 1, 1]
      return { kind, diffuse, mask, primary: own, secondary: v.CMODB ?? own }
    }),
  )
}

async function part(
  file: string,
  pick: (name: string) => boolean,
): Promise<{ p: Package; mesh: SkelMesh; file: string }> {
  const p = await pkg(file)
  const i = p.exports.findIndex((e) => e.type === 'SkeletalMesh' && pick(e.name))
  if (i < 0) throw new Error(`no mesh in ${file}`)
  return { p, mesh: readSkelMesh(p, i), file }
}

/** The soldier: the armor's body, a head, and hair or a helmet on the head's socket. */
export async function loadSoldier(spec: SoldierSpec): Promise<Soldier> {
  const g = spec.gender === 'Male' ? 'Male' : 'Fem'
  const l = await gameLooks()
  const headPkg =
    l.heads.find((h) => h.id === spec.head && h.gender === spec.gender)?.pkg ??
    l.heads.find((h) => h.gender === spec.gender)?.pkg ??
    `Head_Cauc${g}_A`
  const hairs = l.hair.filter((h) => !h.helmet && h.gender === spec.gender)
  const chosen = l.hair.find((h) => h.id === spec.hair && (h.helmet || h.gender === spec.gender))
  const hairPkg = chosen?.pkg ?? hairs[0]?.pkg ?? `Hair_${g}Hair_A`
  const body = await part(
    `Soldier_${spec.gender}${spec.armor}_SF.upk`,
    (n) => !/CovertOps/i.test(n),
  )
  const head = await part(`${headPkg}_SF.upk`, () => true)
  // A helmet has a mesh for each gender (and "FB" ones, left alone).
  const helmetFor = new RegExp(`_${spec.gender === 'Male' ? 'male' : 'fem'}$`, 'i')
  const hair = await part(`${hairPkg}_SF.upk`, (n) => !chosen?.helmet || helmetFor.test(n))
  // The hair sits on the head's socket, on the head bone.
  const bones = boneWorld(body.mesh.bones)
  const at = body.mesh.bones.findIndex((b) => b.name === 'RigHead')
  const hairMesh = at >= 0 ? placeMesh(hair.mesh, bones[at]!) : hair.mesh
  return {
    meshes: [
      { mesh: body.mesh, paints: await paints(body.p, body.file, body.mesh) },
      { mesh: head.mesh, paints: await paints(head.p, head.file, head.mesh) },
      { mesh: hairMesh, paints: await paints(hair.p, hair.file, hair.mesh) },
    ],
  }
}
