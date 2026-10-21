// Whether a function's UnrealScript says all its bytecode says. Hand patches
// (PatchUPK's hex, as Long War's and LWR's packages carry) can hold bytecode
// no UnrealScript compiles to: a flag set otherwise, a skip size that is not
// what it skips. The decompiler writes the closest source; compiled, that is
// what Epic's compiler would write, and it differs from the patch in those
// places. Said where it happens, so nobody takes the source for the bytes.

import { decodeScript, tokenName, type Node } from './bytecode.ts'
import { binaryOperators, FunctionCompiler } from './compile.ts'
import type { Linker } from './linker.ts'
import { readStructHead } from './objects.ts'
import type { Package } from './package.ts'

export interface Fidelity {
  same: boolean
  /** Where they part: the statement (0-based, in the script) and the token there in each. */
  statement?: number
  original?: string
  compiled?: string
  error?: string
}

const flat = (n: Node, out: string[]) => {
  out.push(`${tokenName(n)}(${n.args.filter((a) => typeof a !== 'object').join(',')})`)
  for (const a of n.args) {
    if (a && typeof a === 'object' && 'op' in (a as object)) flat(a as Node, out)
    else if (Array.isArray(a)) for (const x of a as unknown[]) if (x && typeof x === 'object' && 'op' in (x as object)) flat(x as Node, out)
  }
}

export function fidelity(linker: Linker, pkg: Package, ref: number, source: string): Fidelity {
  const h = readStructHead(pkg, ref)
  const orig = pkg.data(ref).subarray(h.scriptAt, h.end)
  let compiled: Node[]
  try {
    compiled = new FunctionCompiler(linker, pkg, ref).compileStatements(source, binaryOperators(linker))
  } catch (e) {
    return { same: false, error: (e as Error).message }
  }
  const none = pkg.findName('None')
  const original = decodeScript(orig, (n) => n.index === none).statements
  for (let i = 0; i < Math.max(original.length, compiled.length); i++) {
    const a: string[] = []
    const b: string[] = []
    if (original[i]) flat(original[i]!, a)
    if (compiled[i]) flat(compiled[i]!, b)
    const k = a.findIndex((x, j) => x !== b[j])
    if (k >= 0 || a.length !== b.length) {
      const at = k >= 0 ? k : Math.min(a.length, b.length)
      return { same: false, statement: i, original: a[at] ?? '(nothing)', compiled: b[at] ?? '(nothing)' }
    }
  }
  return { same: true }
}

/** The note the decompiler puts above a function whose source does not say all its bytes. */
export function fidelityNote(f: Fidelity): string {
  if (f.same) return ''
  if (f.error) return `// upkit: this source does not compile back yet (${f.error}).\n`
  return (
    `// upkit: this function's bytecode holds something UnrealScript does not say (a hand patch?).\n` +
    `// Compiled, this source differs from it from statement ${f.statement! + 1}: ${f.original} in the package, ${f.compiled} compiled.\n`
  )
}
