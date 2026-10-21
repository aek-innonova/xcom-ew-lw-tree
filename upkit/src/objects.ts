// Objects' data, as the engine serializes them (UE3, version 845): the
// tagged properties every object starts with, and UField, UStruct, UFunction,
// UState, UClass, UScriptStruct, UEnum, UConst and the properties.

import { Reader } from './bytes.ts'
import type { NameRef, Package } from './package.ts'

export interface Tag {
  name: string
  type: string
  size: number
  arrayIndex: number
  /** StructProperty: the struct's name; ByteProperty: the enum's ("None" for a plain byte). */
  structName?: string
  enumName?: string
  /** BoolProperty: the value (kept in the tag, size 0). */
  boolValue?: number
  /** Where the value is in the object's data, and its bytes. */
  valueAt: number
  value: Uint8Array
}

const nameRef = (r: Reader): NameRef => ({ index: r.i32(), number: r.i32() })

/** Tagged properties up to the None that ends them. */
export function readTags(r: Reader, pkg: Package): Tag[] {
  const out: Tag[] = []
  for (;;) {
    const name = pkg.name(nameRef(r))
    if (name === 'None') return out
    const type = pkg.name(nameRef(r))
    const size = r.i32()
    const arrayIndex = r.i32()
    const tag: Partial<Tag> = { name, type, size, arrayIndex }
    if (type === 'StructProperty') tag.structName = pkg.name(nameRef(r))
    else if (type === 'ByteProperty') tag.enumName = pkg.name(nameRef(r))
    else if (type === 'BoolProperty') tag.boolValue = r.u8()
    tag.valueAt = r.o
    tag.value = r.bytes(size)
    out.push(tag as Tag)
  }
}

/** UStruct's part of an object: where its script is, and the links around it. */
export interface StructHead {
  netIndex: number
  tags: Tag[]
  next: number
  superStruct: number
  scriptText: number
  children: number
  cppText: number
  line: number
  textPos: number
  /** The script: its size in memory and in the file, and where it starts in the object's data. */
  memSize: number
  size: number
  scriptAt: number
  /** After the script: where the subclass's own fields start. */
  end: number
}

export function readStructHead(pkg: Package, ref: number): StructHead {
  const data = pkg.data(ref)
  const r = new Reader(data)
  const netIndex = r.i32()
  // A class object carries no tagged properties (its defaults are its Default__ object).
  const tags = pkg.className(ref) === 'Class' ? [] : readTags(r, pkg)
  const h = {
    netIndex,
    tags,
    next: r.i32(),
    superStruct: r.i32(),
    scriptText: r.i32(),
    children: r.i32(),
    cppText: r.i32(),
    line: r.i32(),
    textPos: r.i32(),
    memSize: r.i32(),
    size: r.i32(),
    scriptAt: 0,
    end: 0,
  }
  h.scriptAt = r.o
  h.end = r.o + h.size
  return h
}

/** The classes whose objects are structs (have a script). */
export const STRUCT_CLASSES = new Set(['Function', 'State', 'Class', 'ScriptStruct'])

// --- Each kind of script object, read whole ---------------------------------

export interface FieldHead {
  netIndex: number
  tags: Tag[]
  next: number
}

export interface PropertyObj extends FieldHead {
  kind: 'property'
  type: string
  arrayDim: number
  flags: bigint
  category: string
  arrayEnum: number
  repOffset?: number
  /** Byte: the enum; Object, Component, Interface: the class; Class: the class and its meta class;
   * Struct: the struct; Array: the inner property; Map: key and value; Delegate: the function and its source. */
  refs: number[]
}
export interface FunctionObj {
  kind: 'function'
  head: StructHead
  native: number
  precedence: number
  flags: number
  repOffset?: number
  friendlyName: string
}
export interface StateObj {
  kind: 'state'
  head: StructHead
  probeMask: number
  labelTableOffset: number
  stateFlags: number
  funcMap: { name: string; func: number }[]
}
export interface ClassObj extends Omit<StateObj, 'kind'> {
  kind: 'class'
  classFlags: number
  within: number
  configName: string
  componentMap: { name: string; obj: number }[]
  interfaces: { cls: number; prop: number }[]
  /** The rest of the class's fields as read (category lists, DLL bind name, the default object). */
  dontSortCategories: string[]
  hideCategories: string[]
  autoExpandCategories: string[]
  autoCollapseCategories: string[]
  forceScriptOrder: number
  classGroups: string[]
  nativeClassName: string
  dllBindName: string
  defaultObject: number
}
export interface StructObj {
  kind: 'struct'
  head: StructHead
  structFlags: number
  defaults: Tag[]
}
export interface EnumObj extends FieldHead {
  kind: 'enum'
  names: string[]
}
export interface ConstObj extends FieldHead {
  kind: 'const'
  value: string
}
export type ScriptObject = PropertyObj | FunctionObj | StateObj | ClassObj | StructObj | EnumObj | ConstObj

const PROPERTY_REFS: Record<string, number> = {
  ByteProperty: 1,
  ObjectProperty: 1,
  ComponentProperty: 1,
  InterfaceProperty: 1,
  ClassProperty: 2,
  StructProperty: 1,
  ArrayProperty: 1,
  MapProperty: 2,
  DelegateProperty: 2,
  IntProperty: 0,
  BoolProperty: 0,
  FloatProperty: 0,
  StrProperty: 0,
  NameProperty: 0,
}
export const isPropertyClass = (c: string) => c in PROPERTY_REFS

const CPF_Net = 0x20n
const FUNC_Net = 0x40

/** A script object read whole; throws when the data does not end where the reading does. */
export function readObject(pkg: Package, ref: number): ScriptObject | null {
  const cls = pkg.className(ref)
  if (!STRUCT_CLASSES.has(cls) && cls !== 'Enum' && cls !== 'Const' && !isPropertyClass(cls)) return null
  const data = pkg.data(ref)
  const names = (r: Reader) => {
    const n = r.i32()
    return Array.from({ length: n }, () => pkg.name(nameRef(r)))
  }
  let r: Reader
  let obj: ScriptObject
  if (STRUCT_CLASSES.has(cls)) {
    const head = readStructHead(pkg, ref)
    r = new Reader(data, head.end)
    if (cls === 'Function') {
      const f: FunctionObj = {
        kind: 'function',
        head,
        native: r.u16(),
        precedence: r.u8(),
        flags: r.u32(),
        friendlyName: '',
      }
      if (f.flags & FUNC_Net) f.repOffset = r.u16()
      f.friendlyName = pkg.name(nameRef(r))
      obj = f
    } else if (cls === 'ScriptStruct') {
      obj = { kind: 'struct', head, structFlags: r.u32(), defaults: readTags(r, pkg) }
    } else {
      const s: StateObj = {
        kind: 'state',
        head,
        probeMask: r.u32(),
        labelTableOffset: r.u16(),
        stateFlags: r.u32(),
        funcMap: [],
      }
      const n = r.i32()
      for (let i = 0; i < n; i++) s.funcMap.push({ name: pkg.name(nameRef(r)), func: r.i32() })
      if (cls === 'State') obj = s
      else {
        const c = { ...s, kind: 'class' } as ClassObj
        c.classFlags = r.u32()
        c.within = r.i32()
        c.configName = pkg.name(nameRef(r))
        c.componentMap = Array.from({ length: r.i32() }, () => ({
          name: pkg.name(nameRef(r)),
          obj: r.i32(),
        }))
        c.interfaces = Array.from({ length: r.i32() }, () => ({ cls: r.i32(), prop: r.i32() }))
        c.dontSortCategories = names(r)
        c.hideCategories = names(r)
        c.autoExpandCategories = names(r)
        c.autoCollapseCategories = names(r)
        c.forceScriptOrder = r.i32()
        c.classGroups = names(r)
        c.nativeClassName = r.fstr()
        c.dllBindName = pkg.name(nameRef(r))
        c.defaultObject = r.i32()
        obj = c
      }
    }
  } else {
    r = new Reader(data)
    const head: FieldHead = { netIndex: r.i32(), tags: readTags(r, pkg), next: 0 }
    head.next = r.i32()
    if (cls === 'Enum') obj = { ...head, kind: 'enum', names: names(r) }
    else if (cls === 'Const') obj = { ...head, kind: 'const', value: r.fstr() }
    else if (isPropertyClass(cls)) {
      const p: PropertyObj = {
        ...head,
        kind: 'property',
        type: cls,
        arrayDim: r.i32(),
        flags: r.u64(),
        category: pkg.name(nameRef(r)),
        arrayEnum: r.i32(),
        refs: [],
      }
      if (p.flags & CPF_Net) p.repOffset = r.u16()
      for (let i = 0; i < PROPERTY_REFS[cls]!; i++) p.refs.push(r.i32())
      obj = p
    } else return null
  }
  if (r.o !== data.length)
    throw new Error(`${cls} ${pkg.path(ref)}: read ${r.o} of ${data.length} bytes`)
  return obj
}
