import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseSave } from '../parse'

const saves = resolve(__dirname, '../../../fixtures/saves')
const oracle = resolve(saves, 'save1762.json')

/** Deep comparison that tolerates float formatting in the oracle's JSON. */
function diff(a: unknown, b: unknown, path = '$'): string | undefined {
  if (typeof a === 'number' && typeof b === 'number') {
    if (a === b) return
    if (Math.abs(a - b) <= 1e-4 * Math.max(1, Math.abs(b))) return
    return `${path}: ${a} !== ${b}`
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}: length ${a.length} !== ${b.length}`
    for (let i = 0; i < a.length; i++) {
      const d = diff(a[i], b[i], `${path}[${i}]`)
      if (d) return d
    }
    return
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort()
    const kb = Object.keys(b).sort()
    if (ka.join() !== kb.join()) return `${path}: keys [${ka}] !== [${kb}]`
    for (const k of ka) {
      const d = diff(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
        `${path}.${k}`,
      )
      if (d) return d
    }
    return
  }
  return a === b ? undefined : `${path}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`
}

describe('parseSave against xcomsave output', () => {
  it('matches save1762.json property for property', () => {
    const parsed = parseSave(new Uint8Array(readFileSync(resolve(saves, 'save1762'))))
    const expected = JSON.parse(readFileSync(oracle, 'utf8'))
    expect(diff(parsed, expected)).toBeUndefined()
  })
})
