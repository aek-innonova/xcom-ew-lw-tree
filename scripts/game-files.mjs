// The table of plain Enemy Within's files (features/game-bases.md), for the
// app's planner: every file under XEW\XComGame, its size and the first 32 hex
// digits of its SHA-256. Names, sizes and hashes only; nothing of the game.
//
// Made from a Steam-verified install, hashed on the Windows bench:
//   node scripts/game-files.mjs samples/vanilla-ew.json
// where that file is { "<path under XEW>": { size, sha256 } }.

import { readFileSync, writeFileSync } from 'node:fs'

const [from] = process.argv.slice(2)
if (!from) throw new Error('usage: node scripts/game-files.mjs <vanilla-ew.json>')
const all = JSON.parse(readFileSync(from, 'utf8'))
const out = {}
for (const p of Object.keys(all).sort())
  if (p.startsWith('XComGame/'))
    out[p.slice('XComGame/'.length)] = [all[p].size, all[p].sha256.slice(0, 32)]
writeFileSync('src/data/game-files.json', JSON.stringify(out) + '\n')
console.log(`${Object.keys(out).length} files → src/data/game-files.json`)
