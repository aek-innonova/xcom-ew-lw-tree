// Reads an XCOM: Enemy Within save into the same structure xcomsave's
// xcom2json produces. A port of xcomsave's xcomreader.cpp, reading only.

import { crc32 } from './crc32'
import { lzo1xDecompress, LzoError } from './lzo'
import { Reader, SaveFormatError, toHex } from './reader'
import type {
  ArrayProperty,
  Checkpoint,
  CheckpointChunk,
  Property,
  SaveFile,
  SaveHeader,
  StaticArrayProperty,
  XcomString,
} from './types'

export { SaveFormatError }

export const enum SaveVersion {
  EnemyUnknown = 0x0f,
  EnemyWithin = 0x10,
  EnemyWithinAndroid = 0x13,
}

const COMPRESSED_DATA_START = 1024
const UPK_MAGIC = 0x9e2a83c1

const PROPERTY_KINDS = new Set([
  'IntProperty',
  'FloatProperty',
  'BoolProperty',
  'StrProperty',
  'ObjectProperty',
  'ByteProperty',
  'StructProperty',
  'NameProperty',
  'ArrayProperty',
  'StaticArrayProperty',
])

export function readHeader(r: Reader): SaveHeader {
  r.pos = 0
  const version = r.int()
  if (version === SaveVersion.EnemyUnknown) {
    throw new SaveFormatError('This is an Enemy Unknown save; only Enemy Within (Long War) saves are supported.')
  }
  if (version === SaveVersion.EnemyWithinAndroid) {
    throw new SaveFormatError('This is an Android save; only PC Enemy Within saves are supported so far.')
  }
  if (version !== SaveVersion.EnemyWithin) {
    throw new SaveFormatError('This does not look like an XCOM: Enemy Within save file.')
  }
  const header: SaveHeader = {
    version,
    uncompressed_size: r.int(),
    game_number: r.int(),
    save_number: r.int(),
    save_description: r.xstring(),
    time: r.xstring(),
    map_command: r.string(),
    tactical_save: r.bool(),
    ironman: r.bool(),
    autosave: r.bool(),
    dlc: r.string(),
    language: r.string(),
  }
  const compressedCrc = r.uint()

  r.pos = 1016
  const headerSize = r.int()
  const headerCrc = r.uint()
  if (headerSize <= 0 || headerSize > COMPRESSED_DATA_START || crc32(r.bytes.subarray(0, headerSize)) !== headerCrc) {
    throw new SaveFormatError('The save header is damaged (checksum mismatch).')
  }
  if (crc32(r.bytes.subarray(COMPRESSED_DATA_START)) !== compressedCrc) {
    throw new SaveFormatError('The save data is damaged or truncated (checksum mismatch).')
  }
  return header
}

/**
 * The body is a sequence of UE3 compressed chunks: magic, block size, total
 * compressed and uncompressed sizes, one (compressed, uncompressed) pair per
 * block, then the blocks' LZO data. XCOM saves have one block per chunk, but
 * the general layout costs nothing to follow.
 */
export function decompressBody(bytes: Uint8Array, start = COMPRESSED_DATA_START): Uint8Array {
  const r = new Reader(bytes)
  const chunks: { blocks: { c: number; u: number }[]; dataStart: number }[] = []
  let total = 0
  r.pos = start
  while (!r.eof()) {
    const at = r.pos
    if (r.uint() !== UPK_MAGIC) throw new SaveFormatError('compressed chunk header not found', at)
    const blockSize = r.int()
    const compressedTotal = r.int()
    const uncompressedTotal = r.int()
    const count = blockSize > 0 ? Math.max(1, Math.ceil(uncompressedTotal / blockSize)) : 1
    const blocks = []
    for (let i = 0; i < count; i++) blocks.push({ c: r.int(), u: r.int() })
    chunks.push({ blocks, dataStart: r.pos })
    total += uncompressedTotal
    r.pos += compressedTotal
  }

  const out = new Uint8Array(total)
  let op = 0
  for (const chunk of chunks) {
    let ip = chunk.dataStart
    for (const { c, u } of chunk.blocks) {
      let n: number
      try {
        n = lzo1xDecompress(bytes.subarray(ip, ip + c), out.subarray(op, op + u))
      } catch (e) {
        if (e instanceof LzoError) throw new SaveFormatError(`decompression failed: ${e.message}`, ip)
        throw e
      }
      if (n !== u) throw new SaveFormatError(`chunk decompressed to ${n} bytes, expected ${u}`, ip)
      ip += c
      op += u
    }
  }
  return out
}

function readActorTable(r: Reader): string[] {
  const count = r.int()
  if (count < 0 || count % 2 !== 0) throw new SaveFormatError('malformed actor table', r.pos)
  const actors: string[] = []
  for (let i = 0; i < count; i += 2) {
    const actor = r.string()
    const instance = r.int()
    if (instance === 0) throw new SaveFormatError('malformed actor table entry: expected a non-zero instance', r.pos)
    const pkg = r.string()
    if (r.int() !== 0) throw new SaveFormatError('malformed actor table entry: missing 0 instance', r.pos)
    actors.push(`${pkg}.${actor}_${instance - 1}`)
  }
  return actors
}

function expectZero(r: Reader, what: string) {
  const at = r.pos
  const v = r.int()
  if (v !== 0) throw new SaveFormatError(`expected 0 after ${what}, found ${v.toString(16)}`, at)
}

/** Object references are stored as a pair (2n+1, 2n), or (-1, -1) for none. */
function actorRef(r: Reader): number {
  const a = r.int()
  const b = r.int()
  if (a === -1 && b === -1) return -1
  if (a !== b + 1) throw new SaveFormatError('object reference halves are not related', r.pos)
  return a >> 1
}

const NATIVE_STRUCT_SIZES: Record<string, number> = {
  Vector2D: 8,
  Vector: 12,
  Rotator: 12,
  Box: 25,
  Color: 4,
}

type ArrayKind = 'struct' | 'string' | 'enum' | 'unknown'

/** Guesses what an array holds by looking at its first bytes, as xcomsave does. */
function sniffArrayKind(r: Reader): ArrayKind {
  const start = r.pos
  try {
    return sniff(r)
  } finally {
    r.pos = start
  }

  function sniff(r: Reader): ArrayKind {
    const s = r.xstring(false)
    if (s.str.length === 0) return 'unknown'
    // A leading "None" is either an all-default struct element or enum value 0;
    // skip it and decide on the next element.
    if (s.str === 'None') {
      r.int()
      return sniff(r)
    }
    const afterFirst = r.pos
    if (r.xstring(false).str.length > 0) return 'string'
    r.pos = afterFirst
    r.int()
    const next = r.xstring(false)
    if (next.str.length > 0) return PROPERTY_KINDS.has(next.str) ? 'struct' : 'enum'
    return 'unknown'
  }
}

function readArray(r: Reader, name: string, size: number): ArrayProperty {
  const bound = r.int()
  const dataSize = size - 4
  const base = { name, kind: 'ArrayProperty' as const }
  if (dataSize > 0) {
    if (bound * 8 === dataSize) {
      const actors: number[] = []
      for (let i = 0; i < bound; i++) actors.push(actorRef(r))
      return { ...base, actors }
    }
    if (bound * 4 === dataSize) {
      const elements: number[] = []
      for (let i = 0; i < bound; i++) elements.push(r.int())
      return { ...base, elements }
    }
    switch (sniffArrayKind(r)) {
      case 'struct': {
        const structs: Property[][] = []
        for (let i = 0; i < bound; i++) structs.push(readProperties(r))
        return { ...base, structs }
      }
      case 'enum': {
        const enum_values = []
        for (let i = 0; i < bound; i++) enum_values.push({ value: r.string(), number: r.int() })
        return { ...base, enum_values }
      }
      case 'string': {
        const strings: XcomString[] = []
        for (let i = 0; i < bound; i++) strings.push(r.xstring())
        return { ...base, strings }
      }
      case 'unknown':
        return { ...base, data_length: dataSize, array_bound: bound, data: toHex(r.raw(dataSize)) }
    }
  }
  return { ...base, data_length: Math.max(dataSize, 0), array_bound: bound, data: '' }
}

function readProperty(r: Reader, name: string, type: string, size: number): Property {
  switch (type) {
    case 'ObjectProperty':
      return { name, kind: type, actor: actorRef(r) }
    case 'IntProperty':
      return { name, kind: type, value: r.int() }
    case 'FloatProperty':
      return { name, kind: type, value: r.float() }
    case 'BoolProperty':
      return { name, kind: type, value: r.byte() !== 0 }
    case 'StrProperty':
      return { name, kind: type, value: r.xstring() }
    case 'NameProperty':
      return { name, kind: type, string: r.string(), number: r.int() }
    case 'ByteProperty': {
      const enumType = r.string()
      expectZero(r, 'enum type')
      // With enum type "None" the value is a single raw byte.
      if (enumType === 'None') return { name, kind: type, type: enumType, value: 'None', number: r.byte() }
      return { name, kind: type, type: enumType, value: r.string(), number: r.int() }
    }
    case 'StructProperty': {
      const structName = r.string()
      expectZero(r, 'struct name')
      const nativeSize = NATIVE_STRUCT_SIZES[structName]
      if (nativeSize !== undefined) {
        return { name, kind: type, struct_name: structName, native_data: toHex(r.raw(nativeSize)), properties: [] }
      }
      return { name, kind: type, struct_name: structName, native_data: '', properties: readProperties(r) }
    }
    case 'ArrayProperty':
      return readArray(r, name, size)
    default:
      throw new SaveFormatError(`unknown property type ${type}`, r.pos)
  }
}

interface PendingStatic {
  name: string
  kind: 'StaticArrayProperty'
  items: Property[]
}

function finishStatic(p: PendingStatic): StaticArrayProperty {
  const first = p.items[0]
  if (first?.kind === 'IntProperty') {
    return { name: p.name, kind: p.kind, int_values: p.items.map((i) => (i as { value: number }).value) }
  }
  if (first?.kind === 'StrProperty' && p.items.every((i) => i.kind === 'StrProperty' && !i.value.is_wide)) {
    return { name: p.name, kind: p.kind, string_values: p.items.map((i) => (i as { value: XcomString }).value.str) }
  }
  return { name: p.name, kind: p.kind, properties: p.items }
}

export function readProperties(r: Reader): Property[] {
  const props: (Property | PendingStatic)[] = []
  for (;;) {
    const name = r.string()
    expectZero(r, 'property name')
    if (name === 'None') break
    const type = r.string()
    expectZero(r, 'property type')
    const size = r.int()
    const arrayIndex = r.int()
    const prop = readProperty(r, name, type, size)

    if (arrayIndex === 0) {
      props.push(prop)
      continue
    }
    // Elements 1..n of a static array follow element 0 under the same name.
    const last = props[props.length - 1]
    if (last === undefined) throw new SaveFormatError(`static array element ${name}[${arrayIndex}] without element 0`, r.pos)
    if (last.kind === 'StaticArrayProperty' && 'items' in last) {
      last.items.push(prop)
    } else {
      props[props.length - 1] = { name, kind: 'StaticArrayProperty', items: [last as Property, prop] }
    }
  }
  return props.map((p) => (p.kind === 'StaticArrayProperty' && 'items' in p ? finishStatic(p) : (p as Property)))
}

function readCheckpoints(r: Reader): Checkpoint[] {
  const count = r.int()
  const out: Checkpoint[] = []
  for (let i = 0; i < count; i++) {
    const name = r.string()
    const instance_name = r.string()
    const vector: [number, number, number] = [r.float(), r.float(), r.float()]
    const rotator: [number, number, number] = [r.int(), r.int(), r.int()]
    const class_name = r.string()
    const propLength = r.int()
    if (propLength < 0) throw new SaveFormatError('negative property length', r.pos)
    const start = r.pos
    const properties = readProperties(r)
    const used = r.pos - start
    let pad_size = 0
    if (used < propLength) {
      pad_size = propLength - used
      for (let k = 0; k < pad_size; k++) {
        if (r.byte() !== 0) throw new SaveFormatError('non-zero padding byte', r.pos)
      }
    } else if (used > propLength) {
      throw new SaveFormatError(`properties of ${name} overran their declared length`, r.pos)
    }
    out.push({ name, instance_name, class_name, vector, rotator, properties, template_index: r.int(), pad_size })
  }
  return out
}

function skipNameTable(r: Reader) {
  const count = r.int()
  for (let i = 0; i < count; i++) {
    r.string()
    const zeros = r.raw(8)
    if (zeros.some((b) => b !== 0)) throw new SaveFormatError('expected zeros in name table entry', r.pos)
    r.raw(r.int())
  }
}

function skipActorTemplates(r: Reader) {
  const count = r.int()
  for (let i = 0; i < count; i++) {
    r.string()
    r.raw(64)
    r.string()
  }
}

export function readCheckpointChunks(r: Reader): CheckpointChunk[] {
  const chunks: CheckpointChunk[] = []
  do {
    const unknown_int1 = r.int()
    const game_type = r.string()
    if (r.string() !== 'None') throw new SaveFormatError("expected 'None' after checkpoint chunk game type", r.pos)
    const unknown_int2 = r.int()
    const checkpoint_table = readCheckpoints(r)
    if (r.int() > 0) skipNameTable(r)
    const class_name = r.string()
    const actor_table = readActorTable(r)
    const unknown_int3 = r.int()
    skipActorTemplates(r)
    chunks.push({
      unknown_int1,
      game_type,
      checkpoint_table,
      unknown_int2,
      class_name,
      actor_table,
      unknown_int3,
      display_name: r.string(),
      map_name: r.string(),
      unknown_int4: r.int(),
    })
  } while (!r.eof())
  return chunks
}

/**
 * A tactical save holds the mission's own checkpoints (which xcomsave cannot
 * fully parse) followed by the strategy state the game returns to afterwards,
 * stored as a second set of compressed chunks: an int (byte count + 4), a zero
 * int, then chunks running exactly to the end of the body. Found by looking for
 * a chunk magic whose preceding size points exactly at the end, and whose
 * chunks chain to it.
 */
export function findEmbeddedStrategy(body: Uint8Array): number | undefined {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength)
  for (let at = 8; at + 24 <= body.length; at++) {
    if (view.getUint32(at, true) !== UPK_MAGIC) continue
    if (view.getInt32(at - 8, true) !== body.length - at + 4 || view.getInt32(at - 4, true) !== 0) continue
    let p = at
    while (p + 24 <= body.length && view.getUint32(p, true) === UPK_MAGIC) {
      const blockSize = view.getInt32(p + 4, true)
      const compressed = view.getInt32(p + 8, true)
      const uncompressed = view.getInt32(p + 12, true)
      const blocks = blockSize > 0 ? Math.max(1, Math.ceil(uncompressed / blockSize)) : 1
      p += 16 + 8 * blocks + compressed
    }
    if (p === body.length) return at
  }
  return undefined
}

/**
 * Parses a save. Strategy saves are read whole. For a tactical save the
 * mission data is skipped and `checkpoints` holds the embedded strategy state
 * (`actor_table` is then empty); `strategy_from_tactical` marks that case.
 * Throws SaveFormatError with a message a player can act on.
 */
export function parseSave(bytes: Uint8Array): SaveFile {
  if (bytes.length < COMPRESSED_DATA_START + 24) {
    throw new SaveFormatError('This file is too small to be an XCOM save.')
  }
  const header = readHeader(new Reader(bytes))
  const body = decompressBody(bytes)

  if (header.tactical_save) {
    const at = findEmbeddedStrategy(body)
    if (at === undefined) {
      throw new SaveFormatError('This is a mid-mission save and its campaign data could not be found. Try a geoscape save.')
    }
    const checkpoints = readCheckpointChunks(new Reader(decompressBody(body, at)))
    return { header, actor_table: [], checkpoints, strategy_from_tactical: true }
  }

  const r = new Reader(body)
  const actor_table = readActorTable(r)
  const checkpoints = readCheckpointChunks(r)
  return { header, actor_table, checkpoints }
}
