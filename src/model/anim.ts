// A pose out of the game's animations (features/game-soldiers.md): an
// AnimSet's tracks by bone, and one frame of a sequence, decoded from its
// compressed track data. UE3 package version 845, as UE Viewer (MIT)
// documents the formats; nothing copied.

import type { Package } from './upk'

export type Quat = [number, number, number, number]
export type Vec3 = [number, number, number]

export interface AnimSequenceInfo {
  index: number
  name: string
  frames: number
}
export interface AnimSetInfo {
  /** Bone name per track. */
  tracks: string[]
  /** Animated rotations only: positions come from the mesh's own skeleton. */
  rotationOnly: boolean
  sequences: AnimSequenceInfo[]
}
/** A bone's place relative to its parent in one frame. */
export interface BonePose {
  rotation: Quat
  position: Vec3 | null
}

const view = (pkg: Package) =>
  new DataView(pkg.bytes.buffer, pkg.bytes.byteOffset, pkg.bytes.byteLength)

/** Tagged properties: each name, type, the enum or struct name, and where its value is. */
function props(
  pkg: Package,
  start: number,
  end: number,
  on: (name: string, type: string, sub: string, at: number, size: number) => void,
): number {
  const v = view(pkg)
  let o = start
  const name = () => {
    const i = v.getInt32(o, true)
    o += 8
    return pkg.names[i] ?? ''
  }
  while (o < end) {
    const p = name()
    if (p === 'None') return o
    const type = name()
    const size = v.getInt32(o, true)
    o += 8
    if (type === 'BoolProperty') {
      on(p, type, '', o, 1)
      o += 1
      continue
    }
    const sub = type === 'StructProperty' || type === 'ByteProperty' ? name() : ''
    on(p, type, sub, o, size)
    o += size
  }
  return o
}

export function readAnimSet(pkg: Package, index: number): AnimSetInfo {
  const e = pkg.exports[index]!
  const v = view(pkg)
  const out: AnimSetInfo = { tracks: [], rotationOnly: false, sequences: [] }
  let seqRefs: number[] = []
  props(pkg, e.offset + 4, e.offset + e.size, (name, type, _s, at) => {
    if (name === 'bAnimRotationOnly') out.rotationOnly = pkg.bytes[at] !== 0
    if (name === 'TrackBoneNames' && type === 'ArrayProperty')
      out.tracks = Array.from(
        { length: v.getInt32(at, true) },
        (_, k) => pkg.names[v.getInt32(at + 4 + 8 * k, true)] ?? '',
      )
    if (name === 'Sequences' && type === 'ArrayProperty')
      seqRefs = Array.from({ length: v.getInt32(at, true) }, (_, k) =>
        v.getInt32(at + 4 + 4 * k, true),
      )
  })
  for (const r of seqRefs) {
    if (r <= 0) continue
    const s = readSequenceHeader(pkg, r - 1)
    out.sequences.push({ index: r - 1, name: s.name, frames: s.frames })
  }
  return out
}

interface SequenceHeader {
  name: string
  frames: number
  rotationFormat: string
  translationFormat: string
  keyFormat: string
  offsets: number[]
  /** Where the compressed bytes are, and how many. */
  stream: number
  streamSize: number
}

export function readSequenceHeader(pkg: Package, index: number): SequenceHeader {
  const e = pkg.exports[index]!
  const v = view(pkg)
  const h: SequenceHeader = {
    name: '',
    frames: 0,
    rotationFormat: 'ACF_Float96NoW',
    translationFormat: 'ACF_None',
    keyFormat: 'AKF_ConstantKeyLerp',
    offsets: [],
    stream: 0,
    streamSize: 0,
  }
  const end = props(pkg, e.offset + 4, e.offset + e.size, (name, type, _s, at) => {
    if (name === 'SequenceName') h.name = pkg.names[v.getInt32(at, true)] ?? ''
    if (name === 'NumFrames') h.frames = v.getInt32(at, true)
    if (name === 'RotationCompressionFormat')
      h.rotationFormat = pkg.names[v.getInt32(at, true)] ?? ''
    if (name === 'TranslationCompressionFormat')
      h.translationFormat = pkg.names[v.getInt32(at, true)] ?? ''
    if (name === 'KeyEncodingFormat') h.keyFormat = pkg.names[v.getInt32(at, true)] ?? ''
    if (name === 'CompressedTrackOffsets' && type === 'ArrayProperty')
      h.offsets = Array.from({ length: v.getInt32(at, true) }, (_, k) =>
        v.getInt32(at + 4 + 4 * k, true),
      )
  })
  // Then: the raw animation (bulk data, empty when cooked), the raw tracks
  // (an empty array), and the compressed bytes: the one array that ends the object.
  const objEnd = e.offset + e.size
  for (let o = end; o + 4 <= objEnd; o += 4) {
    const n = v.getInt32(o, true)
    if (n > 0 && o + 4 + n === objEnd) {
      h.stream = o + 4
      h.streamSize = n
      break
    }
  }
  return h
}

/** A normalized −1..1 value out of an n-bit unsigned field. */
const unit = (x: number, bits: number) => {
  const half = (1 << (bits - 1)) - 1
  return (x - half) / half
}
const withW = (x: number, y: number, z: number): Quat => [
  x,
  y,
  z,
  Math.sqrt(Math.max(0, 1 - x * x - y * y - z * z)),
]

/** The first frame's pose of each track of a sequence. */
export function readPose(pkg: Package, set: AnimSetInfo, index: number): Map<string, BonePose> {
  const h = readSequenceHeader(pkg, index)
  const v = view(pkg)
  const out = new Map<string, BonePose>()
  if (!h.stream) return out
  const f32 = (o: number) => v.getFloat32(h.stream + o, true)
  const u16 = (o: number) => v.getUint16(h.stream + o, true)
  const u32 = (o: number) => v.getUint32(h.stream + o, true)
  if (h.keyFormat === 'AKF_PerTrackCompression') {
    set.tracks.forEach((bone, j) => out.set(bone, perTrack(h, j, f32, u16, u32)))
    return out
  }
  set.tracks.forEach((bone, j) => {
    const [tOff, tKeys, rOff, rKeys] = h.offsets.slice(4 * j, 4 * j + 4) as number[]
    let position: Vec3 | null = null
    if (tKeys && tKeys > 0 && tOff! >= 0) {
      const fmt = tKeys === 1 ? 'ACF_None' : h.translationFormat
      if (fmt === 'ACF_IntervalFixed32NoW') {
        const mins = [f32(tOff!), f32(tOff! + 4), f32(tOff! + 8)]
        const ranges = [f32(tOff! + 12), f32(tOff! + 16), f32(tOff! + 20)]
        const p = u32(tOff! + 24)
        const q = [unit(p >>> 21, 11), unit((p >>> 10) & 2047, 11), unit(p & 1023, 10)]
        position = [0, 1, 2].map((k) => q[k]! * ranges[k]! + mins[k]!) as Vec3
      } else if (fmt === 'ACF_Fixed48NoW')
        position = [unit(u16(tOff!), 16), unit(u16(tOff! + 2), 16), unit(u16(tOff! + 4), 16)]
      else if (fmt !== 'ACF_Identity') position = [f32(tOff!), f32(tOff! + 4), f32(tOff! + 8)]
    }
    let rotation: Quat = [0, 0, 0, 1]
    if (rKeys && rKeys > 0 && rOff! >= 0) {
      const fmt = rKeys === 1 ? 'ACF_Float96NoW' : h.rotationFormat
      let o = rOff!
      let mins = [0, 0, 0]
      let ranges = [1, 1, 1]
      if (rKeys > 1 && fmt === 'ACF_IntervalFixed32NoW') {
        mins = [f32(o), f32(o + 4), f32(o + 8)]
        ranges = [f32(o + 12), f32(o + 16), f32(o + 20)]
        o += 24
      }
      if (fmt === 'ACF_None') rotation = [f32(o), f32(o + 4), f32(o + 8), f32(o + 12)]
      else if (fmt === 'ACF_Float96NoW') rotation = withW(f32(o), f32(o + 4), f32(o + 8))
      else if (fmt === 'ACF_Fixed48NoW')
        rotation = withW(unit(u16(o), 16), unit(u16(o + 2), 16), unit(u16(o + 4), 16))
      else if (fmt === 'ACF_Fixed32NoW' || fmt === 'ACF_IntervalFixed32NoW') {
        const p = u32(o)
        const q = [unit(p >>> 21, 11), unit((p >>> 10) & 2047, 11), unit(p & 1023, 10)]
        rotation = withW(...([0, 1, 2].map((k) => q[k]! * ranges[k]! + mins[k]!) as Vec3))
      } else if (fmt === 'ACF_Float32NoW') {
        const p = u32(o)
        // 11, 11 and 10 bit floats; rare: left as no rotation.
        void p
      }
    }
    out.set(bone, { rotation, position })
  })
  return out
}

/** The formats a per-track header names (its top four bits). */
const FORMATS = [
  'None',
  'Float96NoW',
  'Fixed48NoW',
  'IntervalFixed32NoW',
  'Fixed32NoW',
  'Float32NoW',
  'Identity',
]

/**
 * One track's first key, compressed per track: each of translation and
 * rotation starts with a word holding its format, which of x, y, z it
 * stores, and how many keys.
 */
function perTrack(
  h: SequenceHeader,
  j: number,
  f32: (o: number) => number,
  u16: (o: number) => number,
  u32: (o: number) => number,
): BonePose {
  const [tOff, rOff] = h.offsets.slice(2 * j, 2 * j + 2) as [number, number]
  const info = (o: number) => {
    const w = u32(o)
    return { format: FORMATS[w >>> 28] ?? '?', mask: (w >>> 24) & 0xf, at: o + 4 }
  }
  let position: Vec3 | null = null
  if (tOff >= 0) {
    const { format, mask, at } = info(tOff)
    let o = at
    if (format === 'Float96NoW') {
      if (mask & 7) {
        position = [0, 0, 0]
        for (let k = 0; k < 3; k++)
          if (mask & (1 << k)) {
            position[k] = f32(o)
            o += 4
          }
      } else position = [f32(o), f32(o + 4), f32(o + 8)]
    } else if (format === 'Fixed48NoW') {
      position = [0, 0, 0]
      for (let k = 0; k < 3; k++)
        if (mask & (1 << k)) {
          position[k] = u16(o) - 255
          o += 2
        }
    } else if (format === 'IntervalFixed32NoW') {
      const mins = [0, 0, 0]
      const ranges = [0, 0, 0]
      for (let k = 0; k < 3; k++)
        if (mask & (1 << k)) {
          mins[k] = f32(o)
          ranges[k] = f32(o + 4)
          o += 8
        }
      const p = u32(o)
      const q = [(p >>> 21) / 1023 - 1, ((p >>> 10) & 2047) / 1023 - 1, (p & 1023) / 511 - 1]
      position = [0, 1, 2].map((k) => q[k]! * ranges[k]! + mins[k]!) as Vec3
    } else if (format === 'Identity') position = [0, 0, 0]
  }
  let rotation: Quat = [0, 0, 0, 1]
  if (rOff >= 0) {
    const { format, mask, at } = info(rOff)
    let o = at
    if (format === 'Float96NoW') rotation = withW(f32(o), f32(o + 4), f32(o + 8))
    else if (format === 'Fixed48NoW') {
      const q = [32767, 32767, 32767]
      for (let k = 0; k < 3; k++)
        if (mask & (1 << k)) {
          q[k] = u16(o)
          o += 2
        }
      rotation = withW(...(q.map((x) => (x - 32767) / 32767) as Vec3))
    } else if (format === 'Fixed32NoW' || format === 'IntervalFixed32NoW') {
      const mins = [0, 0, 0]
      const ranges = [1, 1, 1]
      if (format === 'IntervalFixed32NoW')
        for (let k = 0; k < 3; k++)
          if (mask & (1 << k)) {
            mins[k] = f32(o)
            ranges[k] = f32(o + 4)
            o += 8
          } else ranges[k] = 0
      const p = u32(o)
      const q = [(p >>> 21) / 1023 - 1, ((p >>> 10) & 2047) / 1023 - 1, (p & 1023) / 511 - 1]
      rotation = withW(...([0, 1, 2].map((k) => q[k]! * ranges[k]! + mins[k]!) as Vec3))
    }
  }
  return { rotation, position }
}
