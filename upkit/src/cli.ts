#!/usr/bin/env node
// upkit's command line. Run with Node 24 or later (it runs TypeScript as it
// is): node upkit/src/cli.ts <command> …, or the one-file build: node upkit.mjs.

const USAGE = `upkit: decompile Enemy Within's UnrealScript, edit it, compile it back.

  node upkit.mjs <command> …

Commands:
  info <package>                          the summary and what the package holds
  list <package> [filter]                 functions (and states) by path
  decompile <package> <Class.Function>    a function as UnrealScript (a state: its code)
  class <package> <Class>                 a whole class as UnrealScript
  export <package> <folder>               every class of the package, a Class.uc each
  compile <package> <Class.Function> <file.uc> (--out <new package> | --patch <mod.txt>)
                                          an edited function (or a state's code) back into
                                          the package: a whole new package, or a mod script
  compile <package> <Class> <Class.uc> (--out … | --patch …)
                                          what was edited in a whole class's source (as
                                          class writes it), new declarations too (--out)
  new <package.u> <Class.uc>…             a new script package with these classes in it
  roundtrip <package>                     decompile and compile every function; how many
                                          come back byte for byte

Options: --game <folder>  where the game's other packages are (default: the
package's folder); packages are read compressed or not. --layout compact: a
whole package laid out anew (default keep: objects stay where they were).`

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { binaryOperators, FunctionCompiler, shared } from './compile.ts'
import { classesPackage, modScriptWith, packageWith } from './changes.ts'
import { classEdits } from './classsrc.ts'
import { defaultsBlock, defaultsChanges } from './defaults.ts'
import { decompileClass } from './classdecomp.ts'
import { FunctionDecompiler } from './decompile.ts'
import { fidelity, fidelityNote } from './fidelity.ts'
import { Linker } from './linker.ts'
import { readStructHead } from './objects.ts'
import { openPackage, type Package } from './package.ts'
import { emptyPackage } from './writer.ts'

const argv = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name)
  if (i < 0) return undefined
  const v = argv[i + 1]
  argv.splice(i, 2)
  return v
}
const game = flag('--game')
const out = flag('--out')
const patch = flag('--patch')
const layout = (flag('--layout') ?? 'keep') as 'keep' | 'compact'
const [command, file, ...rest] = argv

function usage(): never {
  console.error(USAGE)
  process.exit(2)
}

if (!command || !file) usage()
// (new writes the package it is given; every other command reads it.)
if (command !== 'new' && !existsSync(file)) {
  console.error(`no file ${file}`)
  process.exit(1)
}
const pkgName = basename(file).replace(/\.(upk|u)$/i, '')
const linker = new Linker([...(game ? [game] : []), dirname(file)])
const pkg = command === 'new' ? (null as unknown as Package) : openPackage(new Uint8Array(readFileSync(file)))
if (pkg) linker.add(pkgName, pkg)

/** What a package build did, in a line. */
function report(r: { compiled: string[]; objects: string[]; declared: string[]; added: { names: number; imports: number; exports: number } }): string {
  return [
    r.declared.length && `declared ${r.declared.join(', ')}`,
    r.compiled.length && `compiled ${r.compiled.join(', ')}`,
    r.objects.length && `defaults of ${r.objects.join(', ')}`,
    `${r.added.names} names, ${r.added.imports} imports, ${r.added.exports} objects added`,
  ]
    .filter(Boolean)
    .join('; ')
}

function functionRef(p: Package, path: string): number {
  const ref = p.find(path)
  if (!ref || !['Function', 'State'].includes(p.className(ref))) {
    console.error(`no function ${path} in ${pkgName}`)
    process.exit(1)
  }
  return ref
}

try {
  switch (command) {
    case 'info': {
      const s = pkg.summary
      const counts = new Map<string, number>()
      for (let i = 1; i <= pkg.exports.length; i++)
        counts.set(pkg.className(i), (counts.get(pkg.className(i)) ?? 0) + 1)
      console.log(
        `${pkgName}: version ${s.version}/${s.licensee}, ${pkg.names.length} names, ${pkg.imports.length} imports, ${pkg.exports.length} exports`,
      )
      for (const [k, v] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 20))
        console.log(`  ${String(v).padStart(6)} ${k}`)
      break
    }
    case 'list': {
      const filter = rest[0]?.toLowerCase()
      for (let i = 1; i <= pkg.exports.length; i++) {
        const c = pkg.className(i)
        if (c !== 'Function' && c !== 'State') continue
        const path = pkg.path(i)
        if (!filter || path.toLowerCase().includes(filter))
          console.log(c === 'State' ? `${path} (state)` : path)
      }
      break
    }
    case 'decompile': {
      if (!rest[0]) usage()
      const ref = functionRef(pkg, rest[0])
      const d = new FunctionDecompiler(linker, pkg, ref)
      if (pkg.className(ref) === 'State') {
        process.stdout.write(d.decompileStateCode())
        break
      }
      // Said first when the source does not compile back to the same bytes (a hand patch).
      const text = d.decompile()
      process.stdout.write(
        readStructHead(pkg, ref).size
          ? fidelityNote(fidelity(linker, pkg, ref, text)) + text
          : text,
      )
      break
    }
    case 'class': {
      if (!rest[0]) usage()
      process.stdout.write(decompileClass(linker, pkg, rest[0]))
      break
    }
    case 'compile': {
      const [path, source] = rest
      if (!path || !source || (!out && !patch)) usage()
      const text = readFileSync(source, 'utf8')
      // A class: what was edited (or declared anew) in its source. Else one function or state.
      const target = pkg.find(path)
      // (A class the package does not have, declared in the source: a new class.)
      const isNew = !target && new RegExp(`^\\s*class\\s+${path}\\b`, 'im').test(text)
      const isClass = isNew || (!!target && pkg.className(target) === 'Class')
      const edits = isClass && !isNew ? classEdits(linker, pkg, path, text) : null
      const declared = isNew
        ? [path]
        : edits
          ? [...edits.vars.flatMap((v) => v.names.map((n) => `${path}.${n.name}`)), ...edits.functions.map((f) => f.path)]
          : []
      const changes = edits ? edits.changes : isNew ? [] : [{ ref: functionRef(pkg, path), text, path }]
      const block = isClass && !isNew ? defaultsBlock(text) : null
      const defaults = block !== null ? { classRef: target, block } : undefined
      // What the defaults change (nothing when they are as the package has them; new variables' are checked when declared).
      const objects =
        defaults && !declared.length
          ? defaultsChanges(linker, pkg, target, defaults.block, { shared: shared(), allow: 'all' }).map((e) => e.ref)
          : []
      if (!changes.length && !objects.length && !declared.length) {
        console.log(`${path}: nothing edited (the source decompiles from the package as it is)`)
        break
      }
      const what = [...changes.map((c) => c.path), ...objects.map((r) => `${pkg.path(r)} (default properties)`)].join(', ')
      if (patch) {
        if (declared.length) throw new Error(`new declarations (${declared.join(', ')}) need a whole package (--out): a mod script cannot add objects`)
        const r = modScriptWith(linker, pkg, basename(file), changes, { name: `${path} (upkit)` }, defaults)
        writeFileSync(patch, r.text)
        console.log(`wrote ${patch}: ${what} as a PatchUPK mod script${r.names.length ? `, adding the names ${r.names.join(', ')}` : ''}`)
      }
      if (out) {
        if (isClass) {
          const r = classesPackage(linker, pkg, pkgName, [text], layout)
          writeFileSync(out, r.bytes)
          console.log(`wrote ${out} (${layout} layout): ${report(r)}`)
        } else {
          const r = packageWith(linker, pkg, changes, layout, defaults)
          writeFileSync(out, r.bytes)
          console.log(`wrote ${out} (${layout} layout): ${r.compiled.map((c) => `${pkg.path(c.ref)} → ${c.code.length} bytes`).join('; ')}`)
        }
      }
      break
    }
    case 'export': {
      // Every class as its own file, the package's source tree to read (or edit and compile back).
      const dir = rest[0]
      if (!dir) usage()
      mkdirSync(dir, { recursive: true })
      let n = 0
      for (let i = 1; i <= pkg.exports.length; i++) {
        if (pkg.className(i) !== 'Class') continue
        const name = pkg.objectName(i)
        writeFileSync(join(dir, `${name}.uc`), decompileClass(linker, pkg, name))
        n++
      }
      console.log(`wrote ${n} classes of ${pkgName} to ${dir}`)
      break
    }
    case 'new': {
      // A new script package: file is the package to write, rest the classes' sources.
      if (!rest.length) usage()
      const template = linker.package('Core')
      if (!template) throw new Error('no Core package to take the header from (--game <the game\'s CookedPCConsole>)')
      const sources = rest.map((f) => readFileSync(f, 'utf8'))
      const r = classesPackage(linker, openPackage(emptyPackage(template)), pkgName, sources, layout)
      writeFileSync(file, r.bytes)
      console.log(`wrote ${file}: ${report(r)}`)
      break
    }
    case 'roundtrip': {
      const ops = binaryOperators(linker)
      let total = 0
      let same = 0
      for (let i = 1; i <= pkg.exports.length; i++) {
        if (pkg.className(i) !== 'Function') continue
        const h = readStructHead(pkg, i)
        if (!h.size) continue
        total++
        const orig = pkg.data(i).subarray(h.scriptAt, h.end)
        try {
          const text = new FunctionDecompiler(linker, pkg, i).decompile()
          const c = new FunctionCompiler(linker, pkg, i).compile(text, ops).code
          if (c.length === orig.length && c.every((b, k) => b === orig[k])) same++
        } catch {
          // counted as different
        }
      }
      console.log(
        `${pkgName}: ${same} of ${total} functions compile back byte for byte (${((100 * same) / total).toFixed(1)}%)`,
      )
      break
    }
    default:
      usage()
  }
} catch (e) {
  if (process.env.UPKIT_DEBUG) console.error(e)
  // A compile error or a bad package: said, without a stack.
  console.error(`upkit: ${(e as Error).message}`)
  process.exit(1)
}
