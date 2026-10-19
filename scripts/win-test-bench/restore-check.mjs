// Byte-for-byte restore check for the real Windows test bench
// (features/windows-test-env.md). The app's "Put the originals back" must
// leave every file the setup touched exactly as the game and the Long War
// installer left it. Rather than keep a whole second copy of the 20 GB game,
// we take SHA-256 of everything the setup could touch *before* the first
// apply, and compare the restored files against that baseline.
//
// Everything the setup could touch = the package files in CookedPCConsole and
// the INIs in Config. (lwtree-backup/ is the app's own backup store and is
// skipped.)
//
//   node scripts/win-test-bench/restore-check.mjs baseline <gameRoot> <out.json>
//   node scripts/win-test-bench/restore-check.mjs compare  <gameRoot> <baseline.json>
//
// `compare` prints every file that differs, is missing, or is new, and exits
// non-zero if the restore is not byte-for-byte. <gameRoot> is the XComGame
// folder the app found (…/XEW/XComGame).
import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile, stat } from 'node:fs/promises'
import path from 'node:path'

const DIRS = ['CookedPCConsole', 'Config']
const SKIP = 'lwtree-backup'

async function walk(root, rel = '') {
  const out = []
  const abs = path.join(root, rel)
  let entries
  try {
    entries = await readdir(abs, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name === SKIP) continue
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...(await walk(root, r)))
    else if (e.isFile()) out.push(r)
  }
  return out
}

async function hashTree(gameRoot) {
  const map = {}
  for (const d of DIRS)
    for (const rel of await walk(gameRoot, d)) {
      const buf = await readFile(path.join(gameRoot, rel))
      map[rel.replace(/\\/g, '/')] = `${createHash('sha256').update(buf).digest('hex')}:${buf.length}`
    }
  return map
}

async function main() {
  const [cmd, gameRoot, file] = process.argv.slice(2)
  if (!cmd || !gameRoot || !file) {
    console.error('usage: restore-check.mjs baseline|compare <gameRoot> <json>')
    process.exit(2)
  }
  if (!(await stat(gameRoot).then((s) => s.isDirectory()).catch(() => false))) {
    console.error(`not a folder: ${gameRoot}`)
    process.exit(2)
  }
  const now = await hashTree(gameRoot)
  if (cmd === 'baseline') {
    await writeFile(file, JSON.stringify(now, null, 1))
    console.log(`baseline: ${Object.keys(now).length} files under ${DIRS.join(', ')} -> ${file}`)
    return
  }
  if (cmd === 'compare') {
    const base = JSON.parse(await readFile(file, 'utf8'))
    const changed = [],
      missing = [],
      added = []
    for (const [k, v] of Object.entries(base)) {
      if (!(k in now)) missing.push(k)
      else if (now[k] !== v) changed.push(k)
    }
    for (const k of Object.keys(now)) if (!(k in base)) added.push(k)
    for (const k of changed) console.log(`CHANGED  ${k}`)
    for (const k of missing) console.log(`MISSING  ${k}`)
    for (const k of added) console.log(`ADDED    ${k}`)
    const bad = changed.length + missing.length + added.length
    console.log(
      bad === 0
        ? `restore is byte-for-byte: ${Object.keys(base).length} files identical`
        : `NOT restored: ${changed.length} changed, ${missing.length} missing, ${added.length} added`,
    )
    process.exit(bad === 0 ? 0 : 1)
  }
  console.error(`unknown command: ${cmd}`)
  process.exit(2)
}

await main()
