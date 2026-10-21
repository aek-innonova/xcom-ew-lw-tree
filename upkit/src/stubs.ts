// What a new package's classes read from outside it: localized strings from
// <Package>.int ([Class] sections), config values from Default<Config>.ini
// ([Package.Class] sections). Written from the values the classes' own
// defaultproperties give those variables, as a start the mod edits and
// installs into the game's Localization/INT and Config folders.

import { splitClass } from './classsrc.ts'
import { parseClassHeader, parseVar } from './declare.ts'
import { defaultsBlock } from './defaults.ts'
import { CPF } from './types.ts'

export interface Stubs {
  /** <Package>.int, or null when no class has a localized variable with a value. */
  int: string | null
  /** Default<Config>.ini by config name. */
  ini: Map<string, string>
}

export function stubs(packageName: string, sources: string[]): Stubs {
  const int: string[] = []
  const ini = new Map<string, string[]>()
  for (const src of sources) {
    const head = parseClassHeader(src)
    const values = new Map<string, string[]>()
    for (const line of (defaultsBlock(src) ?? '').split('\n')) {
      const m = /^\s*(\w+)(\s*[([]\s*\d+\s*[)\]])?\s*=\s*(.*?)\s*$/.exec(line)
      if (m) values.set(m[1]!.toLowerCase(), [...(values.get(m[1]!.toLowerCase()) ?? []), `${m[1]}${m[2] ?? ''}=${m[3]}`])
    }
    const localized: string[] = []
    const config: string[] = []
    for (const p of splitClass(src)) {
      if (p.kind !== 'var') continue
      let v
      try {
        v = parseVar(p.text, head.name)
      } catch {
        continue
      }
      for (const n of v.names) {
        const set = values.get(n.name.toLowerCase())
        if (!set) continue
        if (v.flags & CPF.Localized) localized.push(...set)
        else if (v.flags & (CPF.Config | CPF.GlobalConfig)) config.push(...set)
      }
    }
    if (localized.length) int.push(`[${head.name}]`, ...localized, '')
    if (config.length && head.config) {
      const list = ini.get(head.config) ?? []
      list.push(`[${packageName}.${head.name}]`, ...config, '')
      ini.set(head.config, list)
    }
  }
  return {
    int: int.length ? int.join('\r\n') : null,
    ini: new Map([...ini].map(([k, v]) => [k, v.join('\r\n')])),
  }
}
