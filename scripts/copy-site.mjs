// Copy the built site (dist/) into desktop/site, the base bundle the
// desktop installer carries (features/desktop-app.md, desktop-updates.md),
// with its version and needs in .bundle-info.json. A Node script, not
// `rm -rf && cp -r`, so `npm run dist:win` works on Windows (where npm runs
// scripts through cmd) as well as on Linux. The staging extras deploy.sh
// adds to dist/ (app/, bundle/) are left out.
import { cpSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { bundleMeta, root } from './bundle-meta.mjs'

const from = path.join(root, 'dist')
const to = path.join(root, 'desktop', 'site')

rmSync(to, { recursive: true, force: true })
cpSync(from, to, {
  recursive: true,
  filter: (src) => !['app', 'bundle'].includes(path.relative(from, src).split(path.sep)[0]),
})
const meta = bundleMeta()
writeFileSync(path.join(to, '.bundle-info.json'), JSON.stringify(meta))
console.log(`copied ${from} -> ${to} (bundle ${meta.version})`)
