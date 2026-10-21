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
