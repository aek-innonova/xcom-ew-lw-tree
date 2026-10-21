#!/usr/bin/env node
// upkit's command line. Run with Node 24 or later (it runs TypeScript as it is):
//
//   node upkit/src/cli.ts <command> …
//
// Commands:
//   info <package>                          the summary and what the package holds
//   list <package> [filter]                 functions (and states) by path
//   decompile <package> <Class.Function>    a function as UnrealScript (a state: its code)
//   class <package> <Class>                 a whole class as UnrealScript (for reading)
//   compile <package> <Class.Function> <file.uc> (--out <new package> | --patch <mod.txt>)
//                                           an edited function back into the package:
//                                           a whole new package, or a PatchUPK mod script
//   roundtrip <package>                     decompile and compile every function; how many
//                                           come back byte for byte
//
// Options: --game <folder>  where the game's other packages are (default: the
// package's folder); packages are read compressed or not.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import { binaryOperators, FunctionCompiler } from './compile.ts'
import { decompileClass } from './classdecomp.ts'
import { FunctionDecompiler } from './decompile.ts'
import { withScript } from './edit.ts'
import { fidelity, fidelityNote } from './fidelity.ts'
import { Linker } from './linker.ts'
import { readStructHead } from './objects.ts'
import { openPackage, type Package } from './package.ts'
import { modScript } from './patch.ts'
import { writePackage } from './writer.ts'

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
  console.error(
    readFileSync(new URL(import.meta.url), 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('//'))
      .slice(0, 18)
      .map((l) => l.slice(3))
      .join('\n'),
  )
  process.exit(2)
}

if (!command || !file) usage()
if (!existsSync(file)) {
  console.error(`no file ${file}`)
  process.exit(1)
}
const pkg = openPackage(new Uint8Array(readFileSync(file)))
const pkgName = basename(file).replace(/\.(upk|u)$/i, '')
const linker = new Linker([...(game ? [game] : []), dirname(file)])
linker.add(pkgName, pkg)

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
      const ref = functionRef(pkg, path)
      const text = readFileSync(source, 'utf8')
      if (patch) {
        // A mod script can add names; imports and new locals need a whole package.
        const fc = new FunctionCompiler(linker, pkg, ref)
        fc.allow = 'names'
        const statements = fc.compileStatements(text, binaryOperators(linker))
        writeFileSync(
          patch,
          modScript({ name: `${path} (upkit)` }, [
            { upk: basename(file), pkg, ref, statements, names: fc.added.names },
          ]),
        )
        console.log(
          `wrote ${patch}: ${path} as a PatchUPK mod script${fc.added.names.length ? `, adding the names ${fc.added.names.join(', ')}` : ''}`,
        )
      }
      if (out) {
        const fc = new FunctionCompiler(linker, pkg, ref)
        fc.allow = 'all'
        const { code, memSize } = fc.compile(text, binaryOperators(linker))
        const add = fc.additions()
        const data = withScript(pkg, ref, code, memSize, add.children)
        writeFileSync(
          out,
          writePackage(pkg, {
            data: new Map([[ref, data]]),
            names: add.names,
            imports: add.imports,
            exports: add.exports,
            layout,
          }),
        )
        const h = readStructHead(pkg, ref)
        const extras = [
          add.names.length && `${add.names.length} names`,
          add.imports.length && `${add.imports.length} imports`,
          add.exports.length && `${add.exports.length} new local properties`,
        ].filter(Boolean)
        console.log(
          `wrote ${out}: ${path}, ${h.size} → ${code.length} bytes of script (${layout} layout)${extras.length ? `; added ${extras.join(', ')}` : ''}`,
        )
      }
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
  // A compile error or a bad package: said, without a stack.
  console.error(`upkit: ${(e as Error).message}`)
  process.exit(1)
}
