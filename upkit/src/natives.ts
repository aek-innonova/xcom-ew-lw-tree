// The native interface: what the game's script calls and is called by in C++.
// What the packages say (native functions, events, native classes and
// structs) and what they only imply: the classes only C++ defines, which the
// script packages import but do not have. Their members are what the packages
// import of them; their parents, what the shipped bytecode shows (code reading
// a StaticMesh's member on a FracturedStaticMesh says the one descends from
// the other), each with where it was seen. upkit's compiler finds such a
// class's members through those parents; `upkit natives` writes it all as a
// reference, with notes in our own words on what natives do (notes/natives.md).

import { decodeScript, walk, type Node } from './bytecode.ts'
import { FunctionDecompiler } from './decompile.ts'
import { Linker, type Located } from './linker.ts'
import { readStructHead, type ClassObj, type FunctionObj, type StructObj } from './objects.ts'
import type { Package } from './package.ts'
import { CPF, FUNC } from './types.ts'

export interface CppClass {
  /** Its path, its package first (Engine.NetConnection). */
  path: string
  /** Its members as the packages import them: name, and what it is (IntProperty, Function …). */
  members: Map<string, string>
  /** The classes it is seen to descend from, each with where (Package.Class.Function). */
  ancestors: Map<string, Set<string>>
  /** The closest of them: its parent, as far as the bytecode shows. */
  parent: string | null
  /** Its object members' classes, as the bytecode shows them (a member of that class read on one), by member name. */
  holds: Map<string, string>
}

const CACHE = new WeakMap<Linker, Map<string, CppClass>>()

/** The packages the game's script is in, as the linker has them. */
function scriptPackages(linker: Linker): Package[] {
  return Linker.SCRIPT_PACKAGES.map((n) => linker.package(n)).filter((p): p is Package => !!p)
}

/** The classes only C++ defines, by path in lower case. */
export function cppClasses(linker: Linker): Map<string, CppClass> {
  const known = CACHE.get(linker)
  if (known) return known
  const out = new Map<string, CppClass>()
  const packages = scriptPackages(linker)
  const pathOf = (pkg: Package, ref: number) => (ref < 0 ? pkg.path(ref) : `${linker.nameOf(pkg)}.${pkg.path(ref)}`)
  // The classes: imported, found in no package. Their members: what is imported of them.
  for (const pkg of packages)
    for (let i = 1; i <= pkg.imports.length; i++) {
      if (pkg.className(-i) !== 'Class' || linker.resolve(pkg, -i)) continue
      const path = pkg.path(-i)
      if (!out.has(path.toLowerCase())) out.set(path.toLowerCase(), { path, members: new Map(), ancestors: new Map(), parent: null, holds: new Map() })
    }
  for (const pkg of packages)
    for (let i = 1; i <= pkg.imports.length; i++) {
      const outer = pkg.imports[i - 1]!.outer
      const c = outer < 0 ? out.get(pkg.path(outer).toLowerCase()) : undefined
      if (c) c.members.set(pkg.objectName(-i), pkg.className(-i))
    }
  // The class an object-valued node holds, where the node says (a variable's, a cast's, a call's return).
  const classOfProperty = (at: Located | null): string | null => {
    const p = at ? linker.object(at) : null
    if (!at || p?.kind !== 'property' || !['ObjectProperty', 'ComponentProperty'].includes(p.type) || !p.refs[0]) return null
    return pathOf(at.pkg, p.refs[0])
  }
  const classOf = (pkg: Package, n: Node): string | null => {
    switch (n.op) {
      case 0x00:
      case 0x01:
      case 0x02:
      case 0x48:
        return classOfProperty(linker.resolve(pkg, n.args[0] as number))
      case 0x35:
        return classOfProperty(linker.resolve(pkg, n.args[0] as number))
      case 0x2e:
        return pathOf(pkg, n.args[0] as number)
      case 0x19:
      case 0x12:
        return classOf(pkg, n.args[4] as Node)
      case 0x1c: {
        const f = linker.resolve(pkg, n.args[0] as number)
        const fo = f ? linker.object(f) : null
        if (!f || fo?.kind !== 'function') return null
        for (let c = fo.head.children; c; ) {
          const p = linker.object({ pkg: f.pkg, ref: c })
          if (p?.kind !== 'property') break
          if (p.flags & CPF.ReturnParm) return classOfProperty({ pkg: f.pkg, ref: c })
          c = p.next
        }
        return null
      }
    }
    return null
  }
  // The class a member belongs to: an import's outer, an export's class.
  const ownerOf = (pkg: Package, ref: number): string | null => {
    if (ref < 0) {
      const outer = pkg.imports[-ref - 1]!.outer
      return outer ? pkg.path(outer) : null
    }
    for (let r = pkg.outerOf(ref); r; r = pkg.outerOf(r)) if (pkg.className(r) === 'Class') return pathOf(pkg, r)
    return null
  }
  // Where the bytecode reads a member through a context on such a class's object.
  for (const pkg of packages)
    for (let i = 1; i <= pkg.exports.length; i++) {
      const kind = pkg.className(i)
      if (kind !== 'Function' && kind !== 'State') continue
      const h = readStructHead(pkg, i)
      if (h.size <= 2) continue
      const none = pkg.findName('None')
      let statements: Node[]
      try {
        statements = decodeScript(pkg.data(i).subarray(h.scriptAt, h.end), (n) => n.index === none).statements
      } catch {
        continue
      }
      for (const st of statements)
        for (const n of walk(st)) {
          if (n.op !== 0x19) continue
          // An object member of such a class, read through: the class its member's owner is.
          // (The member last read: itself, or a context's member: obj.Parent.Children reads Parent's.)
          let objNode = n.args[0] as Node
          if (objNode.op === 0x19) objNode = objNode.args[4] as Node
          if ((objNode.op === 0x01 || objNode.op === 0x00) && (objNode.args[0] as number) < 0) {
            const m = objNode.args[0] as number
            const holder = out.get((ownerOf(pkg, m) ?? '').toLowerCase())
            let inner = n.args[4] as Node
            if (inner.op === 0x2d) inner = inner.args[0] as Node
            const owner = inner.op === 0x01 || inner.op === 0x1c ? ownerOf(pkg, inner.args[0] as number) : null
            if (holder && owner && pkg.className(m) === 'ObjectProperty' && !holder.holds.has(pkg.objectName(m))) holder.holds.set(pkg.objectName(m), owner)
          }
          const objClass = classOf(pkg, n.args[0] as Node)
          const c = objClass ? out.get(objClass.toLowerCase()) : undefined
          if (!c) continue
          // (A bool member is read through BoolVariable.)
          let inner = n.args[4] as Node
          if (inner.op === 0x2d) inner = inner.args[0] as Node
          if (inner.op !== 0x01 && inner.op !== 0x1c) continue
          const owner = ownerOf(pkg, inner.args[0] as number)
          if (!owner || owner.toLowerCase() === c.path.toLowerCase()) continue
          let seen = c.ancestors.get(owner)
          if (!seen) c.ancestors.set(owner, (seen = new Set()))
          seen.add(`${linker.nameOf(pkg)}.${pkg.path(i)}`)
        }
    }
  // The parent: the closest of the ancestors seen (the one the others are ancestors of).
  const chain = (path: string, depth = 0): string[] => {
    if (depth > 20) return []
    const c = out.get(path.toLowerCase())
    if (c) return c.parent ? [c.parent, ...chain(c.parent, depth + 1)] : []
    const dot = path.indexOf('.')
    const pkg = dot > 0 ? linker.package(path.slice(0, dot)) : null
    const ref = pkg ? pkg.find(path.slice(dot + 1)) : 0
    const o = pkg && ref ? linker.object({ pkg, ref }) : null
    if (!pkg || o?.kind !== 'class' || !o.head.superStruct) return []
    const sup = linker.resolve(pkg, o.head.superStruct)
    const supPath = sup ? pathOf(sup.pkg, sup.ref) : pkg.path(o.head.superStruct)
    return [supPath, ...chain(supPath, depth + 1)]
  }
  for (let pass = 0; pass < 3; pass++)
    for (const c of out.values()) {
      const all = [...c.ancestors.keys()]
      // (One that another seen is a descendant of is not the closest.)
      const closest = all.filter((a) => !all.some((b) => b !== a && chain(b).some((x) => x.toLowerCase() === a.toLowerCase())))
      c.parent = closest[0] ?? null
    }
  CACHE.set(linker, out)
  return out
}

/** A class only C++ defines, as one of a package's imports: its parent, where the packages have it (an export, or an import). */
export function cppParent(linker: Linker, at: Located): Located | null {
  if (at.ref >= 0) return null
  const c = cppClasses(linker).get(at.pkg.path(at.ref).toLowerCase())
  return c?.parent ? locateClass(linker, at.pkg, c.parent) : null
}

/** A member of a class only C++ defines (as a package imports it) that holds an object: of the class the bytecode shows, if it does. */
export function cppMemberClass(linker: Linker, member: Located): Located | null {
  if (member.ref >= 0) return null
  const outer = member.pkg.imports[-member.ref - 1]!.outer
  const c = outer < 0 ? cppClasses(linker).get(member.pkg.path(outer).toLowerCase()) : undefined
  const path = c?.holds.get(member.pkg.objectName(member.ref))
  return path ? locateClass(linker, member.pkg, path) : null
}

/** A class by its path: its export where a package has it, else an import of it (this package's first). */
function locateClass(linker: Linker, from: Package, path: string): Located | null {
  const dot = path.indexOf('.')
  const pkg = dot > 0 ? linker.package(path.slice(0, dot)) : null
  const ref = pkg ? pkg.find(path.slice(dot + 1)) : 0
  if (pkg && ref) return { pkg, ref }
  // Another class only C++ defines: as this package imports it, else as another does.
  for (const p of [from, ...scriptPackages(linker)])
    for (let i = 1; i <= p.imports.length; i++) if (p.className(-i) === 'Class' && p.path(-i).toLowerCase() === path.toLowerCase()) return { pkg: p, ref: -i }
  return null
}

/** Notes on what natives do, in our own words: `## Class.Function`, then the note. */
export function parseNotes(text: string): Map<string, string> {
  const notes = new Map<string, string>()
  let key: string | null = null
  let lines: string[] = []
  const flush = () => {
    if (key) notes.set(key.toLowerCase(), lines.join('\n').trim())
  }
  for (const line of text.split('\n')) {
    const m = /^##\s+(\S+)\s*$/.exec(line)
    if (m) {
      flush()
      key = m[1]!
      lines = []
    } else if (key) lines.push(line)
  }
  flush()
  return notes
}

const FUNCTION_WORDS: [number, string][] = [
  [FUNC.Final, 'final'],
  [FUNC.Static, 'static'],
  [FUNC.Latent, 'latent'],
  [FUNC.Iterator, 'iterator'],
  [FUNC.Simulated, 'simulated'],
  [FUNC.Exec, 'exec'],
  [FUNC.Event, 'event'],
]

/**
 * The native interface as a reference (markdown): per package its native
 * classes and structs, its native functions and its events, each with its
 * declaration and the note we have on it; then the classes only C++ defines.
 */
export function nativesReference(linker: Linker, notes: Map<string, string> = new Map()): string {
  const out: string[] = ['# The native interface', '']
  out.push(
    'Generated by `upkit natives` from the game\'s packages on this machine (not shipped:',
    'the declarations are the game\'s). Notes, where there are any, are ours: what a',
    'native does as far as it is known, and how it is known.',
    '',
  )
  const declaration = (pkg: Package, ref: number) => {
    try {
      return new FunctionDecompiler(linker, pkg, ref).decompile().split('\n')[0]!.replace(/;$/, '')
    } catch {
      return pkg.path(ref)
    }
  }
  const note = (path: string) => {
    const n = notes.get(path.toLowerCase())
    return n ? n.split('\n').map((l) => `  ${l}`) : []
  }
  for (const pkg of scriptPackages(linker)) {
    const name = linker.nameOf(pkg)
    const classes: string[] = []
    const structs: string[] = []
    const natives: string[] = []
    const events: string[] = []
    for (let i = 1; i <= pkg.exports.length; i++) {
      const kind = pkg.className(i)
      const o = linker.object({ pkg, ref: i })
      if (kind === 'Class' && o?.kind === 'class' && (o as ClassObj).classFlags & 0x80) classes.push(pkg.objectName(i))
      if (kind === 'ScriptStruct' && o?.kind === 'struct' && (o as StructObj).structFlags & 0x1) structs.push(pkg.path(i))
      if (kind !== 'Function' || o?.kind !== 'function') continue
      const f = o as FunctionObj
      const path = pkg.path(i)
      if (f.flags & FUNC.Native) {
        const words = FUNCTION_WORDS.filter(([b]) => f.flags & b).map(([, w]) => w)
        if (f.flags & FUNC.Operator) words.push(`operator, precedence ${f.precedence}`)
        const index = f.native ? `native ${f.native}` : 'native'
        natives.push(`- \`${path}\`: \`${declaration(pkg, i)}\` (${[index, ...words].join(', ')})`, ...note(path))
      } else if (f.flags & FUNC.Event) events.push(`- \`${path}\`: \`${declaration(pkg, i)}\``, ...note(path))
    }
    if (!classes.length && !structs.length && !natives.length && !events.length) continue
    out.push(`## ${name}`, '')
    if (classes.length) out.push('### Native classes', '', 'Their layout is C++\'s: no variable can be added to them.', '', classes.map((c) => `\`${c}\``).join(', '), '')
    if (structs.length) out.push('### Native structs', '', structs.map((c) => `\`${c}\``).join(', '), '')
    if (natives.length) out.push(`### Native functions (${natives.filter((l) => l.startsWith('- ')).length})`, '', ...natives, '')
    if (events.length) out.push(`### Events (${events.filter((l) => l.startsWith('- ')).length})`, '', 'Script functions C++ calls: what a mod overrides to be called.', '', ...events, '')
  }
  const cpp = [...cppClasses(linker).values()].sort((a, b) => a.path.localeCompare(b.path))
  out.push('## Classes only C++ defines', '')
  out.push('Imported by the script packages, defined in none. Their members are what the packages import of them; their parents, what the shipped bytecode shows (a member of one read on the other).', '')
  for (const c of cpp) {
    out.push(`### ${c.path}`, '')
    if (c.parent) {
      const seen = [...(c.ancestors.get(c.parent) ?? [])]
      out.push(`Descends from \`${c.parent}\` (seen in ${seen.slice(0, 3).map((s) => `\`${s}\``).join(', ')}${seen.length > 3 ? ` and ${seen.length - 3} more` : ''}).`, '')
    } else out.push('Its parent is not seen in the bytecode.', '')
    const members = [...c.members].sort((a, b) => a[0].localeCompare(b[0]))
    if (members.length) out.push(members.map(([n, k]) => `\`${n}\` (${k})`).join(', '), '')
  }
  return out.join('\n') + '\n'
}

