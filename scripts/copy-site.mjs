// Copy the built site (dist/) into desktop/site, for the desktop app to bundle
// (features/desktop-app.md, features/windows-test-env.md). A Node script, not
// `rm -rf && cp -r`, so `npm run dist:win` works on Windows (where npm runs
// scripts through cmd, which has neither) as well as on Linux.
import { cpSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const from = path.join(root, 'dist')
const to = path.join(root, 'desktop', 'site')

rmSync(to, { recursive: true, force: true })
cpSync(from, to, { recursive: true })
console.log(`copied ${from} -> ${to}`)
