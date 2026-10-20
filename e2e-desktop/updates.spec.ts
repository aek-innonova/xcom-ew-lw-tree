import { generateKeyPairSync } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

// The desktop app's updates (features/desktop-updates.md) against a local
// update server signing with a test key: a newer site is fetched, checked,
// offered, and served after a restart into it; a forged one is refused.

const root = resolve(import.meta.dirname, '..')
const electronBin = join(
  root,
  'desktop/node_modules/electron/dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron',
)
const require = createRequire(import.meta.url)
const { packBundle, signBundle } = require(join(root, 'desktop/dist/bundle-format.js'))

const pair = () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return {
    priv: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    pub: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  }
}

/** The built site with a mark in its title: what "a newer site" looks like here. */
async function newerSite(version: string, key: string) {
  const dir = mkdtempSync(join(tmpdir(), 'lwtree-newer-'))
  cpSync(join(root, 'dist'), dir, {
    recursive: true,
    filter: (src) => !/[\\/](app|bundle)([\\/]|$)/.test(src.slice(join(root, 'dist').length)),
  })
  const index = join(dir, 'index.html')
  writeFileSync(
    index,
    readFileSync(index, 'utf8').replace(/<title>[^<]*/, `<title>Newer site ${version}`),
  )
  const payload = await packBundle(dir, {
    version,
    minShellVersion: '0.2.0',
    releaseDate: new Date().toISOString(),
  })
  return JSON.stringify(signBundle(payload, 'test', key))
}

function serve(files: Record<string, string>): Promise<{ url: string; server: Server }> {
  return new Promise((done) => {
    const server = createServer((req, res) => {
      const body = files[(req.url ?? '').split('?')[0]!.replace(/^\//, '')]
      res.writeHead(body ? 200 : 404, { 'Content-Type': 'application/json' })
      res.end(body ?? '')
    })
    server.listen(0, '127.0.0.1', () => {
      const a = server.address() as { port: number }
      done({ url: `http://127.0.0.1:${a.port}`, server })
    })
  })
}

let app: ElectronApplication | undefined
let server: Server | undefined
test.afterEach(async () => {
  await app?.close()
  server?.close()
})

async function launch(url: string, pub: string) {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  delete env.ELECTRON_RUN_AS_NODE
  app = await electron.launch({
    executablePath: electronBin,
    args: [join(root, 'desktop')],
    env: {
      ...env,
      LWTREE_SITE: join(root, 'dist'),
      LWTREE_USER_DATA: mkdtempSync(join(tmpdir(), 'lwtree-upd-')),
      LWTREE_LIBRARY: mkdtempSync(join(tmpdir(), 'lwtree-lib-')),
      LWTREE_UPDATE_URL: url,
      LWTREE_UPDATE_CHANNEL: 'test',
      LWTREE_UPDATE_KEYS: JSON.stringify({ test: pub }),
    },
  })
  const page = await app.firstWindow()
  await page.evaluate(() => localStorage.setItem('lwtree.helpSeen.v1', '1'))
  await page.reload()
  return page
}

const info = (version: string) =>
  JSON.stringify({
    channel: 'test',
    bundle: {
      version,
      minShellVersion: '0.2.0',
      releaseDate: '',
      size: 0,
      url: `bundle/${version}.json`,
    },
  })

test('a newer signed site: fetched, offered, and served after restarting into it', async () => {
  const key = pair()
  const v = '2099.0101.000000'
  const s = await serve({
    'bundle/test.json': info(v),
    [`bundle/${v}.json`]: await newerSite(v, key.priv),
  })
  server = s.server
  const page = await launch(s.url, key.pub)
  await expect(page).not.toHaveTitle(/Newer site/)
  await page.getByRole('button', { name: 'Help', exact: true }).click()
  await page.getByRole('button', { name: 'Check for updates' }).click()
  // Said where it was asked for, with what to do; and marked in the header.
  const help = page.getByRole('dialog', { name: 'How this works' })
  await expect(help).toContainText(`A new site is ready: ${v}.`)
  await expect(page.getByRole('button', { name: 'Update ready' })).toBeVisible()
  await help.getByRole('button', { name: 'Restart into it' }).click()
  await expect(page).toHaveTitle(`Newer site ${v}`)
  // After the restart, said once.
  await expect(
    page.getByRole('status').filter({ hasText: `Updated: now on site ${v}.` }),
  ).toBeVisible()
})

test('a site signed with another key is refused, and the app keeps its own', async () => {
  const key = pair()
  const forger = pair()
  const v = '2099.0101.000000'
  const s = await serve({
    'bundle/test.json': info(v),
    [`bundle/${v}.json`]: await newerSite(v, forger.priv),
  })
  server = s.server
  const page = await launch(s.url, key.pub)
  await page.getByRole('button', { name: 'Help', exact: true }).click()
  await page.getByRole('button', { name: 'Check for updates' }).click()
  await expect(page.getByText(/last check failed: the signature does not match/i)).toBeVisible()
  await expect(page.getByText(/A new site is ready/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Update ready' })).toHaveCount(0)
  await expect(page).not.toHaveTitle(/Newer site/)
})
