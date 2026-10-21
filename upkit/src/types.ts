// UnrealScript types, from property objects: what a variable holds, how it
// is declared, and how big it is.

import type { Linker, Located } from './linker.ts'
import type { PropertyObj } from './objects.ts'

export type Ty =
  | { k: 'int' }
  | { k: 'float' }
  | { k: 'bool' }
  | { k: 'byte'; enumOf: Located | null }
  | { k: 'name' }
  | { k: 'string' }
  | { k: 'object'; cls: Located | null }
  | { k: 'class'; meta: Located | null }
  | { k: 'interface'; cls: Located | null }
  | { k: 'component'; cls: Located | null }
  | { k: 'struct'; struct: Located | null }
  | { k: 'array'; inner: Ty }
  | { k: 'map' }
  | { k: 'delegate'; fn: Located | null }
  | { k: 'none' }
  | { k: 'unknown' }

/** Property flags (CPF_…) the declarations show. */
export const CPF = {
  Edit: 0x1n,
  Const: 0x2n,
  Input: 0x4n,
  ExportObject: 0x8n,
  OptionalParm: 0x10n,
  Net: 0x20n,
  EditFixedSize: 0x40n,
  Parm: 0x80n,
  OutParm: 0x100n,
  SkipParm: 0x200n,
  ReturnParm: 0x400n,
  CoerceParm: 0x800n,
  Native: 0x1000n,
  Transient: 0x2000n,
  Config: 0x4000n,
  Localized: 0x8000n,
  EditConst: 0x20000n,
  GlobalConfig: 0x40000n,
  Component: 0x80000n,
  AlwaysInit: 0x100000n,
  DuplicateTransient: 0x200000n,
  NoExport: 0x800000n,
  NoImport: 0x1000000n,
  NoClear: 0x2000000n,
  EditInline: 0x4000000n,
  EditInlineUse: 0x10000000n,
  Deprecated: 0x20000000n,
  RepNotify: 0x100000000n,
  Interp: 0x200000000n,
  NonTransactional: 0x400000000n,
  EditorOnly: 0x800000000n,
  NotForConsole: 0x1000000000n,
  PrivateWrite: 0x4000000000n,
  ProtectedWrite: 0x8000000000n,
  ArchetypeProperty: 0x10000000000n,
  EditHide: 0x20000000000n,
  EditTextBox: 0x40000000000n,
  CrossLevelPassive: 0x100000000000n,
  CrossLevelActive: 0x200000000000n,
} as const

/** Function flags (FUNC_…). */
export const FUNC = {
  Final: 0x1,
  Defined: 0x2,
  Iterator: 0x4,
  Latent: 0x8,
  PreOperator: 0x10,
  Singular: 0x20,
  Net: 0x40,
  NetReliable: 0x80,
  Simulated: 0x100,
  Exec: 0x200,
  Native: 0x400,
  Event: 0x800,
  Operator: 0x1000,
  Static: 0x2000,
  HasOptionalParms: 0x4000,
  Const: 0x8000,
  Public: 0x20000,
  Private: 0x40000,
  Protected: 0x80000,
  Delegate: 0x100000,
  NetServer: 0x200000,
  HasOutParms: 0x400000,
  HasDefaults: 0x800000,
  NetClient: 0x1000000,
  DLLImport: 0x2000000,
} as const

/** A property's type, its references followed through the linker. */
export function typeOf(linker: Linker, at: Located, p: PropertyObj): Ty {
  const ref = (i: number) => linker.resolve(at.pkg, p.refs[i] ?? 0)
  switch (p.type) {
    case 'IntProperty':
      return { k: 'int' }
    case 'FloatProperty':
      return { k: 'float' }
    case 'BoolProperty':
      return { k: 'bool' }
    case 'ByteProperty':
      return { k: 'byte', enumOf: ref(0) }
    case 'NameProperty':
      return { k: 'name' }
    case 'StrProperty':
      return { k: 'string' }
    case 'ObjectProperty':
      return { k: 'object', cls: ref(0) }
    case 'ClassProperty':
      return { k: 'class', meta: ref(1) }
    case 'InterfaceProperty':
      return { k: 'interface', cls: ref(0) }
    case 'ComponentProperty':
      return { k: 'component', cls: ref(0) }
    case 'StructProperty':
      return { k: 'struct', struct: ref(0) }
    case 'ArrayProperty': {
      const inner = ref(0)
      const ip = inner && linker.object(inner)
      return { k: 'array', inner: ip && ip.kind === 'property' ? typeOf(linker, inner!, ip) : { k: 'unknown' } }
    }
    case 'MapProperty':
      return { k: 'map' }
    case 'DelegateProperty':
      return { k: 'delegate', fn: ref(0) }
  }
  return { k: 'unknown' }
}

const objName = (at: Located | null) => (at ? at.pkg.objectName(at.ref) : '?')

/** How a type is written in a declaration: "int", "array<XGUnit>", "class<Actor>", "EItemType". */
export function typeText(t: Ty): string {
  switch (t.k) {
    case 'byte':
      return t.enumOf ? objName(t.enumOf) : 'byte'
    case 'object':
    case 'interface':
    case 'component':
      return objName(t.cls)
    case 'class':
      return t.meta && objName(t.meta) !== 'Object' ? `class<${objName(t.meta)}>` : 'class'
    case 'struct':
      return objName(t.struct)
    case 'array':
      return `array<${typeText(t.inner)}>`
    case 'delegate':
      return `delegate<${objName(t.fn)}>`
    case 'none':
      return 'none'
    case 'unknown':
      return '?'
    default:
      return t.k
  }
}
