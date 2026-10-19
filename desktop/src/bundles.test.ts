import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  openBundle,
  packBundle,
  sha256,
  signBundle,
  signFile,
  unpack,
  type SignedBundle,
  type UpdateInfo,
} from './bundle-format'
import { BundleStore, type Fetch } from './bundles'

const pair = () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return {
    priv: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    pub: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  }
}
const ours = pair()
const theirs = pair()
const KEYS = { k1: ours.pub }

function site(marker: string) {
  const dir = mkdtempSync(path.join(tmpdir(), 'lwtree-site-'))
  mkdirSync(path.join(dir, 'assets'))
  writeFileSync(path.join(dir, 'index.html'), `<html>${marker}</html>`)
  writeFileSync(path.join(dir, 'assets', 'app.js'), `console.log(${JSON.stringify(marker)})`)
  return dir
}
async function bundle(version: string, minShellVersion = '0.2.0', key = ours.priv) {
  const payload = await packBundle(site(`site ${version}`), {
    version,
    minShellVersion,
    releaseDate: '2026-10-19T00:00:00Z',
  })
  return signBundle(payload, 'k1', key)
}

/** An update server in memory: path → bytes. */
function server(files: Record<string, unknown>): Fetch {
  return async (url) => {
    const p = new URL(url).pathname.replace(/^\//, '')
    const body = files[p]
    if (body === undefined)
      return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }
    const bytes =
      body instanceof Uint8Array
        ? body
        : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    }
  }
}
function info(version: string, minShellVersion = '0.2.0', shell?: UpdateInfo['shell']): UpdateInfo {
  return {
    channel: 'test',
    bundle: { version, minShellVersion, releaseDate: '', size: 0, url: `bundle/${version}.json` },
    shell,
  }
}
function store(
  files: Record<string, unknown>,
  shellVersion = '0.2.0',
  dir = mkdtempSync(path.join(tmpdir(), 'lwtree-bundles-')),
) {
  return new BundleStore({
    dir,
    baseDir: site('base'),
    baseVersion: '2026.1019.100000',
    shellVersion,
    keys: KEYS,
    updateUrl: 'https://updates.test',
    channel: 'test',
    fetch: server(files),
  })
}
const served = (s: BundleStore) => readFileSync(path.join(s.activeDir, 'index.html'), 'utf8')

test('opens a bundle signed with a trusted key, and nothing else', async () => {
  const b = await bundle('2026.1019.120000')
  assert.equal(openBundle(b, KEYS).version, '2026.1019.120000')
  const tampered: SignedBundle = {
    ...b,
    payload: b.payload.replace('2026.1019.120000', '2026.1019.130000'),
  }
  assert.throws(() => openBundle(tampered, KEYS), /signature does not match/)
  const forged = await bundle('2026.1019.120000', '0.2.0', theirs.priv)
  assert.throws(() => openBundle(forged, KEYS), /signature does not match/)
  assert.throws(() => openBundle({ ...b, key: 'k9' }, KEYS), /unknown key/)
})

test('refuses a damaged file or a path out of the bundle', async () => {
  const payload = await packBundle(site('x'), {
    version: '1',
    minShellVersion: '0',
    releaseDate: '',
  })
  const bad = { ...payload, files: payload.files.map((f) => ({ ...f, sha256: '0'.repeat(64) })) }
  assert.throws(() => [...unpack(bad)], /damaged/)
  const out = { ...payload, files: [{ ...payload.files[0]!, path: '../evil.html' }] }
  assert.throws(() => [...unpack(out)], /bad path/)
})

test('installs a newer bundle for the next start, and serves it once restarted into', async () => {
  const s = store({
    'bundle/test.json': info('2026.1019.120000'),
    'bundle/2026.1019.120000.json': await bundle('2026.1019.120000'),
  })
  await s.start()
  assert.equal(served(s), '<html>base</html>')
  const st = await s.check()
  assert.equal(st.error, undefined)
  assert.equal(st.ready, '2026.1019.120000')
  assert.equal(served(s), '<html>base</html>') // not until the player says so
  assert.ok(s.activate())
  assert.equal(served(s), '<html>site 2026.1019.120000</html>')
})

test('installs nothing older, equal, unsigned or for a newer shell', async () => {
  for (const [files, why] of [
    [
      {
        'bundle/test.json': info('2026.1019.090000'),
        'bundle/2026.1019.090000.json': await bundle('2026.1019.090000'),
      },
      'older',
    ],
    [
      {
        'bundle/test.json': info('2026.1019.100000'),
        'bundle/2026.1019.100000.json': await bundle('2026.1019.100000'),
      },
      'equal',
    ],
    [
      {
        'bundle/test.json': info('2026.1019.120000'),
        'bundle/2026.1019.120000.json': await bundle('2026.1019.120000', '0.2.0', theirs.priv),
      },
      'their key',
    ],
    [
      {
        'bundle/test.json': info('2026.1019.120000', '0.9.0'),
        'bundle/2026.1019.120000.json': await bundle('2026.1019.120000', '0.9.0'),
      },
      'newer shell',
    ],
  ] as const) {
    const s = store(files as Record<string, unknown>)
    await s.start()
    const st = await s.check()
    assert.equal(st.ready, undefined, why)
    assert.equal(served(s), '<html>base</html>', why)
  }
})

test('a bundle announced as one version but signed as another is refused', async () => {
  const s = store({
    'bundle/test.json': info('2026.1019.150000'),
    'bundle/2026.1019.150000.json': await bundle('2026.1019.120000'),
  })
  await s.start()
  assert.match((await s.check()).error ?? '', /not the version announced/)
})

test('a bundle that needs a newer shell brings the shell, checked before it may run', async () => {
  const exe = Buffer.from('MZ pretend installer')
  const shell = {
    version: '0.9.0',
    url: 'app/setup.exe',
    size: exe.length,
    sha256: sha256(exe),
    key: 'k1',
    signature: signFile(exe, ours.priv),
  }
  const files = {
    'bundle/test.json': info('2026.1019.120000', '0.9.0', shell),
    'bundle/2026.1019.120000.json': await bundle('2026.1019.120000', '0.9.0'),
    'app/setup.exe': exe,
  }
  const s = store(files)
  await s.start()
  const st = await s.check()
  assert.deepEqual(st.shell, { version: '0.9.0', needed: true, downloaded: true })
  assert.ok(s.installer && readFileSync(s.installer).equals(exe))
  // Signed by someone else: refused.
  const forged = store({
    ...files,
    'bundle/test.json': info('2026.1019.120000', '0.9.0', {
      ...shell,
      signature: signFile(exe, theirs.priv),
    }),
  })
  await forged.start()
  assert.match((await forged.check()).error ?? '', /not signed by us/)
  assert.equal(forged.installer, undefined)
})

test('rolls back a bundle that never says it started, and does not take it again', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lwtree-bundles-'))
  const files = {
    'bundle/test.json': info('2026.1019.120000'),
    'bundle/2026.1019.120000.json': await bundle('2026.1019.120000'),
  }
  const a = store(files, '0.2.0', dir)
  await a.start()
  await a.check()
  // Next start serves it; it never reports good; the start after rolls back.
  const b = store(files, '0.2.0', dir)
  await b.start()
  assert.equal(served(b), '<html>site 2026.1019.120000</html>')
  const c = store(files, '0.2.0', dir)
  await c.start()
  assert.equal(served(c), '<html>base</html>')
  assert.equal((await c.check()).ready, undefined)
})

test('a bundle that reports good stays, and a partial one is never served', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lwtree-bundles-'))
  const files = {
    'bundle/test.json': info('2026.1019.120000'),
    'bundle/2026.1019.120000.json': await bundle('2026.1019.120000'),
  }
  const a = store(files, '0.2.0', dir)
  await a.start()
  await a.check()
  for (let i = 0; i < 3; i++) {
    const s = store(files, '0.2.0', dir)
    await s.start()
    assert.equal(served(s), '<html>site 2026.1019.120000</html>')
    await s.good()
  }
  rmSync(path.join(dir, '2026.1019.120000', 'assets', 'app.js'))
  const broken = store(files, '0.2.0', dir)
  await broken.start()
  assert.equal(served(broken), '<html>base</html>')
})
