// Make the Ed25519 key that signs desktop bundles and installers
// (features/desktop-updates.md), if there is none: the private half in
// ~/.config/lwtree/bundle-key.pem (owner-only), never in the repository.
// Prints the public half, for desktop/src/keys.ts.
import { generateKeyPairSync, createPrivateKey, createPublicKey } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const file = process.env.LWTREE_BUNDLE_KEY ?? path.join(homedir(), '.config', 'lwtree', 'bundle-key.pem')
if (!existsSync(file)) {
  const { privateKey } = generateKeyPairSync('ed25519')
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  chmodSync(file, 0o600)
  console.error(`made ${file}`)
}
const pub = createPublicKey(createPrivateKey(readFileSync(file)))
process.stdout.write(pub.export({ type: 'spki', format: 'pem' }))
