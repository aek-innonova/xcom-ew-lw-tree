// Publish the built site as a signed desktop bundle (features/desktop-updates.md):
// dist/bundle/<version>.json (the bundle, Ed25519-signed) and
// dist/bundle/<channel>.json (what is new: the bundle, and the newest shell
// installer when deploy.sh has put one in dist/app/, signed too). The shell
// fetches these from the site it was built for.
//
//   node scripts/publish-bundle.mjs <channel>
//
// Needs the desktop code built (cd desktop && npm run build) and the private
// key (~/.config/lwtree/bundle-key.pem, or LWTREE_BUNDLE_KEY).
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { bundleMeta, root } from './bundle-meta.mjs'

const require = createRequire(import.meta.url)
const { packBundle, signBundle, signFile, sha256 } = require(path.join(root, 'desktop', 'dist', 'bundle-format.js'))

const channel = process.argv[2]
if (!/^[a-z]+$/.test(channel ?? '')) throw new Error('usage: publish-bundle.mjs <channel>')
const KEY_NAME = 'lwtree-1'
const keyFile = process.env.LWTREE_BUNDLE_KEY ?? path.join(homedir(), '.config', 'lwtree', 'bundle-key.pem')
const key = readFileSync(keyFile, 'utf8')

const dist = path.join(root, 'dist')
const meta = bundleMeta()
const payload = await packBundle(dist, meta, ['app', 'bundle'])
const signed = signBundle(payload, KEY_NAME, key)
const out = path.join(dist, 'bundle')
mkdirSync(out, { recursive: true })
const bundleFile = `${meta.version}.json`
const text = JSON.stringify(signed)
writeFileSync(path.join(out, bundleFile), text)

const info = {
  channel,
  bundle: { ...meta, size: Buffer.byteLength(text), url: `bundle/${bundleFile}` },
}
const latest = path.join(dist, 'app', 'LATEST')
if (existsSync(latest)) {
  const name = readFileSync(latest, 'utf8').trim()
  const m = /^LongWarTechTree-Setup-([\d.]+)\.exe$/.exec(name)
  if (m) {
    const data = readFileSync(path.join(dist, 'app', name))
    info.shell = {
      version: m[1],
      url: `app/${name}`,
      size: data.length,
      sha256: sha256(data),
      key: KEY_NAME,
      signature: signFile(data, key),
    }
  }
}
writeFileSync(path.join(out, `${channel}.json`), JSON.stringify(info, null, 1))
console.log(`bundle ${meta.version} (${payload.files.length} files) on ${channel}${info.shell ? `, shell ${info.shell.version}` : ''}`)
