// A soldier put together from the player's install, for the 3D view in the
// desktop app (features/game-soldiers.md): the armor's body, a head, a hair
// style on the head's socket, each with its textures, and the class color
// palette. Read on demand through the app's bridge; packages and textures
// are kept in memory while the app runs. Nothing of the game leaves the
// machine or goes into the repository.

import { readMaterialInstance, readPalette, type Color, type PaletteEntry } from '@/model/material'
import {
  readAnimSet,
  readClip,
  sampleClip,
  type BonePose,
  type Clip,
  type Quat,
} from '@/model/anim'
import {
  boneWorld,
  placeMesh,
  poseMesh,
  posedBone,
  readSkelMesh,
  type LocalPose,
  type SkelMesh,
} from '@/model/skelmesh'
import { decodeImage, readTexture, unchunk } from '@/model/texture'
import { Package, decompressPackage, readEnum } from '@/model/upk'
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
  /** An armor deco by its EArmorKit value (Long War's deco numbers); none: the armor's own. */
  deco?: number
}

/** The barracks idle the soldier stands in: at ease, arms at the sides, a 3 s loop. */
const IDLE = 'Loadout_DressUniform_IdleA'
let idle: Promise<Clip | null> | null = null
function idleClip(): Promise<Clip | null> {
  idle ??= pkg('Anim_Barracks.upk')
    .then((p) => {
      const set = readAnimSet(
        p,
        p.exports.findIndex((e) => e.type === 'AnimSet'),
      )
      const seq = set.sequences.find((s) => s.name === IDLE)
      return seq ? readClip(p, set, seq.index) : null
    })
    .catch(() => null)
  return idle
}

/**
 * The skeleton the barracks animations were made on: the male body's
 * (SM_Lv1MedMale). Each bone's place in it, by name, so the animation's
 * positions can be taken as a change from it.
 */
let animSkeleton: Promise<Map<string, [number, number, number]>> | null = null
function animBones(): Promise<Map<string, [number, number, number]>> {
  animSkeleton ??= part('Soldier_MaleKevlar_SF.upk', (n) => n === 'SM_Lv1MedMale')
    .then(({ mesh }) => new Map(mesh.bones.map((b) => [b.name, b.position])))
    .catch(() => new Map())
  return animSkeleton
}

/**
 * Each bone's place at a time in the clip. The animation stores rotations
 * conjugated relative to the skeleton; it moves bones as well as turning them
 * (the set is not rotation-only), so its positions count where it has them.
 */
function bonesAt(clip: Clip | null, seconds: number): Map<string, BonePose> {
  if (!clip) return new Map()
  return new Map(
    [...sampleClip(clip, seconds)].map(([bone, b]) => [
      bone,
      {
        rotation: [-b.rotation[0], -b.rotation[1], -b.rotation[2], b.rotation[3]] as Quat,
        position: b.position,
      },
    ]),
  )
}

/**
 * A pose for one mesh, by bone name. The animation moves bones as a change
 * from the male skeleton it was made on, added to the mesh's own: a female
 * face keeps its shape (taking the male positions outright gave it the male
 * one), the shoulder pads still lift. A bone the animation does not move, or
 * the male skeleton lacks, stays where the mesh has it.
 */
function poseFor(
  m: SkelMesh,
  bones: Map<string, BonePose>,
  made: Map<string, [number, number, number]>,
) {
  const out = new Map<string, LocalPose>()
  for (const b of m.bones) {
    const a = bones.get(b.name)
    if (!a || b.parent < 0 || b.name === 'RigRoot') continue
    const from = made.get(b.name)
    const position: [number, number, number] =
      a.position && from
        ? [
            b.position[0] + a.position[0] - from[0],
            b.position[1] + a.position[1] - from[1],
            b.position[2] + a.position[2] - from[2],
          ]
        : b.position
    out.set(b.name, { rotation: a.rotation, position })
  }
  return out
}

/** The game's heads and hair styles (helmets among them), and armor decos, from DefaultContent.ini. */
export interface Looks {
  heads: { id: number; gender: Gender; race: string; pkg: string }[]
  hair: { id: number; gender: Gender | null; helmet: boolean; pkg: string; name: string }[]
  /** Armor kits by name (eKit_Deco_Kevlar0) → package. */
  kits: Record<string, string>
  /** Each armor's own deco: eItem_ArmorKevlar → eKit_Deco_Kevlar0. */
  decos: Record<string, string>
}

/** Reads the head and hair lists from the game's DefaultContent.ini. */
export function looksIn(ini: string): Looks {
  const out: Looks = { heads: [], hair: [], kits: {}, decos: {} }
  for (const line of ini.split(/\r?\n/)) {
    const kit = /^\s*ArmorKitPackageInfo=\(KitType=(\w+),\s*ArchetypeName="([^".]+)\./.exec(line)
    if (kit) out.kits[kit[1]!] = kit[2]!
    const deco = /^\s*ArmorDeco=\(Armor=(\w+),\s*ArmorKit=(\w+)\)/.exec(line)
    if (deco && !(deco[1]! in out.decos)) out.decos[deco[1]!] = deco[2]!
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

let kitNames: Promise<string[]> | null = null
/** The game's armor kit names, in value order (EArmorKit in XComGame.upk). */
function armorKits(): Promise<string[]> {
  kitNames ??= pkg('XComGame.upk')
    .then((p) => readEnum(p, 'EArmorKit'))
    .catch(() => [])
  return kitNames
}

/** The decos Long War suggests for the rookie (its Kevlar ones), by number: "67" → "Kevlar 0". */
export async function kevlarDecos(): Promise<[string, string][]> {
  return (await armorKits()).flatMap((name, i) => {
    const m = /^eKit_Deco_Kevlar(\d+)$/.exec(name)
    return m ? [[String(i), `Kevlar ${m[1]}`] as [string, string]] : []
  })
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
/** "lashes": the eye shade layer, not drawn. */
export type PaintKind = 'armor' | 'skin' | 'hair' | 'plain' | 'lashes'
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
  /** The normal map, where the material has one. */
  normal: Texture | null
  /** The material's own colors: the armor's default top and bottom, the skin's or hair's color. */
  primary: Color
  secondary: Color
  /** Armor: the glow where the specular map's green says (the material's color × strength), if given. */
  glow?: Color
}
export interface DrawMesh {
  mesh: SkelMesh
  /** Per section, how it is painted. */
  paints: Paint[]
}
export interface Soldier {
  meshes: DrawMesh[]
  /** The meshes moved to a time in the idle (seconds), in the same order; none: it stands still. */
  at?: (seconds: number) => SkelMesh[]
}

const packages = new Map<string, Promise<Package>>()
const textures = new Map<string, Promise<Texture | null>>()
const palettes = new Map<string, Promise<PaletteEntry[]>>()

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

/** One of the game's color palettes (UnitPalettes in Startup.upk): ArmorTint, HairColor… */
export function gamePalette(name: string): Promise<PaletteEntry[]> {
  if (!palettes.has(name))
    palettes.set(
      name,
      pkg('Startup.upk').then((p) =>
        readPalette(
          p,
          p.exports.findIndex((e) => e.type === 'XComLinearColorPalette' && e.name === name),
        ),
      ),
    )
  return palettes.get(name)!
}
export const armorPalette = () => gamePalette('ArmorTint')

/**
 * The colors for one of Long War's color numbers (its Armor Kit codes): 0 is
 * the armor's own (the vanilla default), n the palette's entry n − 1. Long
 * War's list agrees entry by entry: 5 white with black is entry 4, 18 red
 * with yellow entry 17, 32 black with black entry 31.
 */
export function tintFor(
  code: number,
  palette: PaletteEntry[],
  own: Paint,
): { top: Color; bottom: Color } {
  const e = code >= 1 ? palette[code - 1] : undefined
  return e ? { top: e.primary, bottom: e.secondary } : { top: own.primary, bottom: own.secondary }
}

const PAINTS: Record<string, PaintKind> = {
  CHH_Soldiers: 'armor',
  CHH_SkinCustomizable: 'skin',
  CHH_Hair: 'hair',
  CHH_HairMask: 'hair',
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
        normal: null,
        primary: [1, 1, 1, 1],
        secondary: [1, 1, 1, 1],
      }
      if (!ref) return none
      // The eye shade, by itself or through an instance: a see-through layer
      // over the eyes, which the skin texture already paints. Left out.
      const refName = (ref > 0 ? p.exports[ref - 1]?.name : p.imports[-ref - 1]?.name) ?? ''
      if (/^EyeShade/i.test(refName)) return { ...none, kind: 'lashes' as const }
      if (ref <= 0 || p.exports[ref - 1]?.type !== 'MaterialInstanceConstant') return none
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
      const normal = kind === 'armor' || kind === 'skin' ? await tex('Normal') : null
      const ems = v.EmsColor_EmsValue
      const strength = m.scalars.EmsValue ?? ems?.[3] ?? 1
      const glow: Color | undefined = ems
        ? [ems[0] * strength, ems[1] * strength, ems[2] * strength, 1]
        : undefined
      return { kind, diffuse, mask, normal, primary: own, secondary: v.CMODB ?? own, glow }
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
  // The armor's deco, over the body: the one chosen (by its kit number), else the armor's own.
  const kitName =
    (spec.deco !== undefined && spec.deco >= 0 ? (await armorKits())[spec.deco] : undefined) ??
    l.decos[`eItem_Armor${spec.armor}`]
  const decoPkg = kitName ? l.kits[kitName] : undefined
  const deco = decoPkg
    ? await part(`${decoPkg}_SF.upk`, (n) => helmetFor.test(n)).catch(() => null)
    : null
  // Standing in the barracks' idle, each mesh posed by bone name (the rest pose without it).
  const [clip, made] = await Promise.all([idleClip(), animBones()])
  const rest = { body: body.mesh, head: head.mesh, hair: hair.mesh, deco: deco?.mesh }
  const at = (seconds: number): SkelMesh[] => {
    const bones = bonesAt(clip, seconds)
    const pose = (m: SkelMesh) => (bones.size ? poseMesh(m, poseFor(m, bones, made)) : m)
    // The hair sits on the head's socket, on the head bone.
    const headBone = bones.size
      ? posedBone(rest.body, poseFor(rest.body, bones, made), 'RigHead')
      : boneWorld(rest.body.bones)[rest.body.bones.findIndex((b) => b.name === 'RigHead')]
    return [
      pose(rest.body),
      pose(rest.head),
      headBone ? placeMesh(rest.hair, headBone) : rest.hair,
      ...(rest.deco ? [pose(rest.deco)] : []),
    ]
  }
  const first = at(0)
  body.mesh = first[0]!
  head.mesh = first[1]!
  const hairMesh = first[2]!
  if (deco) deco.mesh = first[3]!
  return {
    meshes: [
      { mesh: body.mesh, paints: await paints(body.p, body.file, body.mesh) },
      { mesh: head.mesh, paints: await paints(head.p, head.file, head.mesh) },
      { mesh: hairMesh, paints: await paints(hair.p, hair.file, hair.mesh) },
      ...(deco ? [{ mesh: deco.mesh, paints: await paints(deco.p, deco.file, deco.mesh) }] : []),
    ],
    at: clip && clip.frames > 1 ? at : undefined,
  }
}
