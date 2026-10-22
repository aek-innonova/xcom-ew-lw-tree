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
                                          class writes it), new declarations too; a class
                                          the package does not have: added to it
  new <package.u> <Class.uc>…             a new script package with these classes in it
  diff <package> <other package> [filter] what the other version changed, added, took away:
                                          each changed function as a diff of its source
  natives <package>                       the native interface of the game's packages (beside it,
                                          or --game): natives, events, native classes, classes
                                          only C++ defines; with upkit's notes
  roundtrip <package> [--list]            decompile and compile every function; how many
                                          come back byte for byte (--list: which do not, and
                                          where their source and bytes part)

Options: --game <folder>  where the game's other packages are (default: the
package's folder); packages are read compressed or not. --layout compact: a
whole package laid out anew (default keep: objects stay where they were).`

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { binaryOperators, FunctionCompiler, shared } from './compile.ts'
import { classesPackage, modScriptWith, packageWith } from './changes.ts'
import { classEdits, declaration } from './classsrc.ts'
import { diffPackages } from './diff.ts'
import { stubs } from './stubs.ts'
import { defaultsBlock, defaultsChanges } from './defaults.ts'
import { decompileClass } from './classdecomp.ts'
import { FunctionDecompiler } from './decompile.ts'
import { fidelity, fidelityNote, readableSource, readableStateCode } from './fidelity.ts'
import { Linker } from './linker.ts'
import { readObject, readStructHead } from './objects.ts'
import { CPF } from './types.ts'
import { openPackage, type Package } from './package.ts'
import { modScriptFrom } from './patch.ts'
import { nativesReference, parseNotes } from './natives.ts'
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
// (A flag without a value.)
const listing = argv.includes('--list') && !!argv.splice(argv.indexOf('--list'), 1)
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
// Without the game's packages a mod's code reads as calls to nothing: said once, up front.
if (pkgName.toLowerCase() !== 'core' && !linker.package('Core'))
  console.error(`upkit: no Core.upk in ${game ?? dirname(file)}: the game's classes are not found (--game <the game's CookedPCConsole>)`)

/** What a package build did, in a line. */
function report(r: { compiled: string[]; objects: string[]; declared: string[]; modified?: string[]; added: { names: number; imports: number; exports: number } }): string {
  return [
    r.declared.length && `declared ${r.declared.join(', ')}`,
    r.modified?.length && `modifiers of ${r.modified.join(', ')}`,
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
      if (pkg.className(ref) === 'State') {
        process.stdout.write(readableStateCode(linker, pkg, ref))
        break
      }
      // Said first when the source does not compile back to the same bytes (a hand patch).
      const text = readableSource(linker, pkg, ref)
      process.stdout.write(
        readStructHead(pkg, ref).size
          ? fidelityNote(fidelity(linker, pkg, ref, text), text) + text
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
      const isNew = !target && new RegExp(`^\\s*(class|interface)\\s+${path}\\b`, 'im').test(text)
      const isClass = isNew || (!!target && pkg.className(target) === 'Class')
      const edits = isClass && !isNew ? classEdits(linker, pkg, path, text) : null
      const declared = isNew
        ? [path]
        : edits
          ? [
              ...edits.vars.flatMap((v) => v.names.map((n) => `${path}.${n.name}`)),
              ...edits.functions.map((f) => f.path),
              ...[...edits.consts, ...edits.enums, ...edits.structs, ...edits.states].map((x) => `${path}.${x.name}`),
              ...edits.enumAppends.flatMap((a) => a.values.map((v) => `${a.path}.${v}`)),
            ]
          : []
      // (Variables whose modifiers changed: their flags, written as declarations are.)
      const modified = [...(edits?.varFlags ?? []), ...(edits?.funcFlags ?? [])].map((x) => x.path)
      const changes = edits ? edits.changes : isNew ? [] : [{ ref: functionRef(pkg, path), text, path }]
      // One function's source: its declaration as the package has it (only the body compiles).
      if (!isClass && pkg.className(changes[0]!.ref) === 'Function' && declaration(readableSource(linker, pkg, changes[0]!.ref)) !== declaration(text))
        throw new Error(`${path}: its declaration changed (modifiers, return type, parameters); only a body is compiled, the declaration stays as the package has it (a whole class's source can make it exec, simulated, singular or an event)`)
      const block = isClass && !isNew ? defaultsBlock(text) : null
      const structs = edits?.structDefaults.map((x) => ({ ref: x.ref, block: x.block })) ?? []
      const defaults = block !== null || structs.length ? { classRef: target, block, structs } : undefined
      // What the defaults change (nothing when they are as the package has them; new variables' are checked when declared).
      const objects =
        defaults && !declared.length
          ? [
              ...(defaults.block === null ? [] : defaultsChanges(linker, pkg, target, defaults.block, { shared: shared(), allow: 'all' }).map((e) => e.ref)),
              ...structs.map((x) => x.ref),
            ]
          : []
      if (!changes.length && !objects.length && !declared.length && !modified.length) {
        console.log(`${path}: nothing edited (the source decompiles from the package as it is)`)
        break
      }
      const what = [...changes.map((c) => c.path), ...objects.map((r) => `${pkg.path(r)} (default properties)`)].join(', ')
      // A class's source: the whole package it makes (once; a mod script with declarations is made from it).
      const whole = isClass && (out || declared.length || modified.length) ? classesPackage(linker, pkg, pkgName, [text], patch ? 'keep' : layout) : null
      if (patch && (declared.length || modified.length)) {
        // New declarations: the mod script that makes the original into the whole package.
        if (layout !== 'keep') throw new Error('a mod script is made from the keep layout (--layout compact with --out alone)')
        writeFileSync(patch, modScriptFrom({ name: `${path} (upkit)` }, basename(file), pkg, openPackage(whole!.bytes)))
        console.log(`wrote ${patch} as a PatchUPK mod script: ${report(whole!)}`)
      } else if (patch) {
        const r = modScriptWith(linker, pkg, basename(file), changes, { name: `${path} (upkit)` }, defaults)
        writeFileSync(patch, r.text)
        console.log(`wrote ${patch}: ${what} as a PatchUPK mod script${r.names.length ? `, adding the names ${r.names.join(', ')}` : ''}${r.imports.length ? `, importing ${r.imports.join(', ')}` : ''}`)
      }
      if (out) {
        if (whole) {
          writeFileSync(out, whole.bytes)
          console.log(`wrote ${out} (${layout} layout): ${report(whole)}`)
        } else {
          const r = packageWith(linker, pkg, changes, layout, defaults)
          writeFileSync(out, r.bytes)
          console.log(`wrote ${out} (${layout} layout): ${r.compiled.map((c) => `${pkg.path(c.ref)} → ${c.code.length} bytes`).join('; ')}`)
        }
      }
      // Variables that now read their value from outside the package: where it goes.
      if (whole) {
        const after = openPackage(whole.bytes)
        for (const v of [...whole.modified, ...whole.declared]) {
          const ref = after.find(v)
          if (!ref || !after.className(ref).endsWith('Property')) continue
          const flags = (readObject(after, ref) as { flags: bigint }).flags
          const [cls, name] = v.split('.') as [string, string]
          if (flags & CPF.Config) {
            const config = (readObject(after, after.find(cls)) as { configName: string }).configName
            console.log(`${v} is config: its value comes from Default${config}.ini, [${pkgName}.${cls}] ${name}=…`)
          } else if (flags & CPF.Localized) console.log(`${v} is localized: its text comes from ${pkgName}.int, [${cls}] ${name}=…`)
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
    case 'diff': {
      // The other version, read with its own folder's packages (a mod's beside it).
      const [otherFile, filter] = rest
      if (!otherFile) usage()
      const other = openPackage(new Uint8Array(readFileSync(otherFile)))
      // (Then the first one's folder: a version kept elsewhere still finds the game's packages.)
      const otherLinker = new Linker([...(game ? [game] : []), dirname(otherFile), dirname(file)])
      otherLinker.add(basename(otherFile).replace(/\.(upk|u)$/i, ''), other)
      const r = diffPackages(linker, pkg, otherLinker, other, filter ?? '')
      process.stdout.write(r.text)
      console.error(`${r.changed.length} changed, ${r.added.length} added, ${r.removed.length} taken away`)
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
      // What the classes read from outside the package: a start for its .int and .ini (never over a file there).
      const st = stubs(pkgName, sources)
      const extra: [string, string][] = [...(st.int ? [[`${pkgName}.int`, st.int] as [string, string]] : []), ...[...st.ini].map(([k, v]) => [`Default${k}.ini`, v] as [string, string])]
      for (const [name, text] of extra) {
        const at = join(dirname(file), name)
        if (existsSync(at)) console.log(`${at} is there already: not written (its localized or config values: ${name})`)
        else {
          writeFileSync(at, text + '\r\n')
          console.log(`wrote ${at}: the values its classes' localized or config variables are given (for the game's ${name.endsWith('.int') ? 'Localization/INT' : 'Config'} folder)`)
        }
      }
      break
    }
    case 'natives': {
      // The native interface, from the game's packages beside this one (or --game): a reference, with our notes.
      const notesAt = [new URL('../notes/natives.md', import.meta.url), new URL('./natives.md', import.meta.url)].find((u) => existsSync(u))
      process.stdout.write(nativesReference(linker, notesAt ? parseNotes(readFileSync(notesAt, 'utf8')) : new Map()))
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
        let text = ''
        try {
          text = readableSource(linker, pkg, i)
          const c = new FunctionCompiler(linker, pkg, i).compile(text, ops).code
          if (c.length === orig.length && c.every((b, k) => b === orig[k])) {
            same++
            continue
          }
        } catch {
          // counted as different
        }
        // --list: each that does not, and where (the note decompile writes above it).
        if (listing) {
          const note = text ? fidelityNote(fidelity(linker, pkg, i, text), text) : '// upkit: not decompiled\n'
          console.log(`${pkg.path(i)}\n  ${note.trim().split('\n').pop()!.replace(/^\/\/ (upkit: )?/, '')}`)
        }
      }
      console.log(
        total
          ? `${pkgName}: ${same} of ${total} functions compile back byte for byte (${(Math.floor((1000 * same) / total) / 10).toFixed(1)}%)`
          : `${pkgName}: no functions with code`,
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
