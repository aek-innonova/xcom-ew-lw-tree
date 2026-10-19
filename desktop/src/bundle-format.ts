// Signed site bundles (features/desktop-updates.md): the built site packed
// into one file, signed with Ed25519, and checked by the shell before it is
// ever served. Used by the shell (bundles.ts) and by the script that
// publishes bundles (scripts/publish-bundle.mjs).

import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'

export interface BundleFile {
  /** Relative path with "/" ("assets/index-abc.js"). */
  path: string
  size: number
  sha256: string
  /** The file, gzipped, in base64. */
  data: string
}

/** What is signed: everything about the bundle, its version included. */
export interface BundlePayload {
  version: string
  /** The oldest shell that can run this bundle (its bridge calls). */
  minShellVersion: string
  releaseDate: string
  files: BundleFile[]
}

export interface SignedBundle {
  format: 1
  /** Which key signed it (the shell may know more than one). */
  key: string
  /** The payload as signed: JSON text, so nothing has to be re-serialized to check it. */
  payload: string
  /** Ed25519 over the payload's UTF-8 bytes, base64. */
  signature: string
}

/** What the update server says is available: `/bundle/<channel>.json`. */
export interface UpdateInfo {
  channel: string
  bundle: {
    version: string
    minShellVersion: string
    releaseDate: string
    size: number
    url: string
  }
  /** The newest shell (installer), when one is published. */
  shell?: {
    version: string
    url: string
    size: number
    sha256: string
    key: string
    signature: string
  }
}

/** Numeric dot versions ("0.2.0", "2026.1019.183005"): < 0, 0, > 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d
  }
  return 0
}

export const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

async function walk(dir: string, base = dir): Promise<string[]> {
  const out: string[] = []
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(p, base)))
    else if (e.isFile()) out.push(path.relative(base, p).split(path.sep).join('/'))
  }
  return out.sort()
}

/** Packs a built site (leaving out the given top-level folders, such as app/ and bundle/). */
export async function packBundle(
  dir: string,
  meta: { version: string; minShellVersion: string; releaseDate: string },
  leaveOut: string[] = [],
): Promise<BundlePayload> {
  const files: BundleFile[] = []
  for (const rel of await walk(dir)) {
    if (leaveOut.includes(rel.split('/')[0]!)) continue
    const data = await fs.readFile(path.join(dir, rel))
    files.push({
      path: rel,
      size: data.length,
      sha256: sha256(data),
      data: gzipSync(data).toString('base64'),
    })
  }
  return { ...meta, files }
}

export function signBundle(
  payload: BundlePayload,
  keyName: string,
  privateKeyPem: string,
): SignedBundle {
  const text = JSON.stringify(payload)
  const signature = sign(null, Buffer.from(text, 'utf8'), createPrivateKey(privateKeyPem)).toString(
    'base64',
  )
  return { format: 1, key: keyName, payload: text, signature }
}

export function signFile(data: Uint8Array, privateKeyPem: string): string {
  return sign(null, data, createPrivateKey(privateKeyPem)).toString('base64')
}

/** Public keys the shell trusts, by name, in PEM. */
export type TrustedKeys = Record<string, string>

export function verifyFile(
  data: Uint8Array,
  signature: string,
  keyName: string,
  keys: TrustedKeys,
): boolean {
  const pem = keys[keyName]
  if (!pem) return false
  try {
    return verify(null, data, createPublicKey(pem), Buffer.from(signature, 'base64'))
  } catch {
    return false
  }
}

/** Checks a signed bundle and returns its payload; throws with the reason otherwise. */
export function openBundle(signed: SignedBundle, keys: TrustedKeys): BundlePayload {
  if (signed?.format !== 1 || typeof signed.payload !== 'string') throw new Error('not a bundle')
  if (!keys[signed.key]) throw new Error(`signed with an unknown key (${signed.key})`)
  if (!verifyFile(Buffer.from(signed.payload, 'utf8'), signed.signature, signed.key, keys))
    throw new Error('the signature does not match')
  const payload = JSON.parse(signed.payload) as BundlePayload
  if (!payload.version || !Array.isArray(payload.files)) throw new Error('not a bundle')
  return payload
}

/** A bundle's files, unpacked and checked against their size and hash. */
export function* unpack(payload: BundlePayload): Generator<{ path: string; data: Buffer }> {
  for (const f of payload.files) {
    if (
      !f.path ||
      f.path.split('/').some((p) => !p || p === '.' || p === '..') ||
      /^[\\/]|:/.test(f.path)
    )
      throw new Error(`bad path in bundle: ${f.path}`)
    const data = gunzipSync(Buffer.from(f.data, 'base64'))
    if (data.length !== f.size || sha256(data) !== f.sha256)
      throw new Error(`damaged file in bundle: ${f.path}`)
    yield { path: f.path, data }
  }
}
