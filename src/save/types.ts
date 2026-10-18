// The parsed save, shaped exactly like xcomsave's xcom2json output so the
// two can be compared field for field (fixtures/saves/save1762.json is the oracle).

export interface XcomString {
  str: string
  is_wide: boolean
}

export interface EnumValue {
  value: string
  number: number
}

interface Base {
  name: string
}

export interface IntProperty extends Base {
  kind: 'IntProperty'
  value: number
}
export interface FloatProperty extends Base {
  kind: 'FloatProperty'
  value: number
}
export interface BoolProperty extends Base {
  kind: 'BoolProperty'
  value: boolean
}
export interface StrProperty extends Base {
  kind: 'StrProperty'
  value: XcomString
}
export interface NameProperty extends Base {
  kind: 'NameProperty'
  string: string
  number: number
}
/** `actor` indexes the save's actor table; -1 is none. */
export interface ObjectProperty extends Base {
  kind: 'ObjectProperty'
  actor: number
}
/** An enum value. Long War extends enums by reusing a name with a growing `number`. */
export interface ByteProperty extends Base {
  kind: 'ByteProperty'
  type: string
  value: string
  number: number
}
export interface StructProperty extends Base {
  kind: 'StructProperty'
  struct_name: string
  /** Hex of the raw bytes for structs stored natively (Vector, Rotator, ...), else "". */
  native_data: string
  properties: Property[]
}

/** Arrays come in shapes decided by sniffing their contents, as in xcomsave. */
export type ArrayProperty = Base & { kind: 'ArrayProperty' } & (
    | { elements: number[] }
    | { actors: number[] }
    | { structs: Property[][] }
    | { strings: XcomString[] }
    | { enum_values: EnumValue[] }
    | { data_length: number; array_bound: number; data: string }
  )

/** A fixed-size array (`var int foo[8]`), stored as repeated properties. */
export type StaticArrayProperty = Base & { kind: 'StaticArrayProperty' } & (
    { int_values: number[] } | { string_values: string[] } | { properties: Property[] }
  )

export type Property =
  | IntProperty
  | FloatProperty
  | BoolProperty
  | StrProperty
  | NameProperty
  | ObjectProperty
  | ByteProperty
  | StructProperty
  | ArrayProperty
  | StaticArrayProperty

export interface Checkpoint {
  name: string
  instance_name: string
  class_name: string
  vector: [number, number, number]
  rotator: [number, number, number]
  properties: Property[]
  template_index: number
  pad_size: number
}

export interface CheckpointChunk {
  unknown_int1: number
  game_type: string
  checkpoint_table: Checkpoint[]
  unknown_int2: number
  class_name: string
  actor_table: string[]
  unknown_int3: number
  display_name: string
  map_name: string
  unknown_int4: number
}

export interface SaveHeader {
  version: number
  uncompressed_size: number
  game_number: number
  save_number: number
  save_description: XcomString
  time: XcomString
  map_command: string
  tactical_save: boolean
  ironman: boolean
  autosave: boolean
  dlc: string
  language: string
}

export interface SaveFile {
  header: SaveHeader
  actor_table: string[]
  checkpoints: CheckpointChunk[]
  /** Set when this was a tactical save and `checkpoints` is its embedded strategy state. */
  strategy_from_tactical?: true
}
