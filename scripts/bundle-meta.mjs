// A site bundle's version and needs (features/desktop-updates.md). The
// version is the time of the commit it was built from (UTC,
// "2026.1019.173005"), so the same commit builds the same version wherever
// it is built. minShellVersion is the oldest desktop shell whose bridge
// the site needs (package.json "lwtree"): raise it when the site starts
// using a new bridge call.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function bundleMeta() {
  const t = Number(execFileSync('git', ['log', '-1', '--format=%ct'], { cwd: root }).toString().trim()) * 1000
  const d = new Date(t)
  const p = (n, w = 2) => String(n).padStart(w, '0')
  const version = `${d.getUTCFullYear()}.${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}.${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
  const { minShellVersion } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).lwtree
  return { version, minShellVersion, releaseDate: d.toISOString() }
}
