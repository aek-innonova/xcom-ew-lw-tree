// Packages that refer to each other: an import names an object in another
// package ("Core.Object.Rand"); the linker opens that package from the game's
// folder and finds it there. Native functions are known by their index
// (iNative) across all loaded packages.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readObject, type FunctionObj, type ScriptObject } from './objects.ts'
import { openPackage, type Package } from './package.ts'

/** An object somewhere: a package and an export in it (ref > 0). */
export interface Located {
  pkg: Package
  ref: number
}

export class Linker {
  private dirs: string[]
  private byName = new Map<string, Package | null>()
  private objects = new WeakMap<Package, Map<number, ScriptObject | null>>()
  private natives?: Map<number, Located & { fn: FunctionObj }>

  /** Folders to look in for packages (the game's CookedPCConsole first). */
  constructor(dirs: string[]) {
    this.dirs = dirs
  }

  /** Adds a package already read (named by its file name without the extension). */
  add(name: string, pkg: Package) {
    this.byName.set(name.toLowerCase(), pkg)
  }

  /** A package by name ("Core"), opened from the folders once; null if none has it. */
  package(name: string): Package | null {
    const key = name.toLowerCase()
    if (!this.byName.has(key)) {
      let pkg: Package | null = null
      for (const d of this.dirs)
        for (const ext of ['.upk', '.u']) {
          const p = join(d, name + ext)
          if (!pkg && existsSync(p)) pkg = openPackage(new Uint8Array(readFileSync(p)))
        }
      this.byName.set(key, pkg)
    }
    return this.byName.get(key)!
  }

  /** The package's own name, as other packages import it. */
  nameOf(pkg: Package): string {
    for (const [k, v] of this.byName) if (v === pkg) return k
    return ''
  }

  /** Where a reference really is: an export as it is, an import followed to its package. */
  resolve(pkg: Package, ref: number): Located | null {
    if (ref > 0) return { pkg, ref }
    if (ref === 0) return null
    const path = pkg.path(ref).split('.')
    // The first part is the package; the rest is the export's path there.
    const other = this.package(path[0]!)
    if (!other) return null
    const found = other.find(path.slice(1).join('.'))
    return found ? { pkg: other, ref: found } : null
  }

  /** A script object, read once. */
  object(at: Located): ScriptObject | null {
    if (at.ref <= 0) return null
    let m = this.objects.get(at.pkg)
    if (!m) this.objects.set(at.pkg, (m = new Map()))
    if (!m.has(at.ref)) m.set(at.ref, readObject(at.pkg, at.ref))
    return m.get(at.ref)!
  }

  /**
   * Enum values by name, as a package sees them: its own enums, then the ones it
   * imports; the first enum with a name wins (what the compiler resolves).
   */
  private enumMaps = new WeakMap<Package, Map<string, { at: Located; index: number }>>()
  enumValues(pkg: Package): Map<string, { at: Located; index: number }> {
    let values = this.enumMaps.get(pkg)
    if (!values) {
      values = new Map()
      const add = (at: Located | null) => {
        const o = at && this.object(at)
        if (!o || o.kind !== 'enum') return
        o.names.forEach((n, i) => {
          if (!values!.has(n.toLowerCase())) values!.set(n.toLowerCase(), { at: at!, index: i })
        })
      }
      for (let i = 1; i <= pkg.exports.length; i++) if (pkg.className(i) === 'Enum') add({ pkg, ref: i })
      for (let i = 1; i <= pkg.imports.length; i++) if (pkg.className(-i) === 'Enum') add(this.resolve(pkg, -i))
      this.enumMaps.set(pkg, values)
    }
    return values
  }

  /** The native function with an index, from the packages that define natives. */
  native(index: number): (Located & { fn: FunctionObj }) | null {
    if (!this.natives) {
      this.natives = new Map()
      for (const name of ['Core', 'Engine', 'GameFramework', 'IpDrv', 'XComGame']) {
        const pkg = this.package(name)
        if (!pkg) continue
        for (let i = 1; i <= pkg.exports.length; i++) {
          if (pkg.className(i) !== 'Function') continue
          const fn = this.object({ pkg, ref: i }) as FunctionObj
          if (fn.native && !this.natives.has(fn.native)) this.natives.set(fn.native, { pkg, ref: i, fn })
        }
      }
    }
    return this.natives.get(index) ?? null
  }
}
