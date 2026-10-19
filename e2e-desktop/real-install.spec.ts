// The real Windows test bench (features/windows-test-env.md): the app's mod
// and settings flow against a real Steam + Long War install, not a fake one.
// It applies the player's PatcherGUI mods through Tools, checks each reads
// installed, puts the originals back, and proves every file the setup touched
// is byte-for-byte what Steam and the Long War installer left (hashed before,
// compared after). No whole-game copy: just the hashes.
//
// Skipped unless the install is pointed at by env, so it runs only on the
// bench:
//   LWTREE_REAL_GAME = the folder holding XEW (…/common/XCom-Enemy-Unknown)
//   LWTREE_REAL_MODS = a folder of PatcherGUI .txt mod scripts to apply
// Optional:
//   LWTREE_REAL_KIND = 'lw' (default) or 'lwr', the version to expect.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

const GAME = process.env.LWTREE_REAL_GAME
const MODS = process.env.LWTREE_REAL_MODS
const KIND = process.env.LWTREE_REAL_KIND ?? 'lw'

const root = resolve(import.meta.dirname, '..')
const electronBin = join(
  root,
  'desktop/node_modules/electron/dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron',
)

function env(extra: Record<string, string>) {
  const e: Record<string, string | undefined> = { ...process.env, ...extra }
  delete e.ELECTRON_RUN_AS_NODE
  return e
}

// SHA-256:size of every file under CookedPCConsole and Config (the app's own
// backup store, lwtree-backup, is skipped), keyed by relative path.
function hashTree(gameXComGame: string) {
  const out: Record<string, string> = {}
  const walk = (rel: string) => {
    for (const e of readdirSync(join(gameXComGame, rel), { withFileTypes: true })) {
      if (e.name === 'lwtree-backup') continue
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) walk(r)
      else if (e.isFile()) {
        const buf = readFileSync(join(gameXComGame, r))
        out[r] = `${createHash('sha256').update(buf).digest('hex')}:${buf.length}`
      }
    }
  }
  for (const d of ['CookedPCConsole', 'Config']) walk(d)
  return out
}

test.describe('real Long War install', () => {
  test.skip(!GAME || !MODS, 'set LWTREE_REAL_GAME and LWTREE_REAL_MODS to run')

  let app: ElectronApplication | undefined
  test.afterEach(async () => app?.close())

  test('mods apply and read installed; originals restore byte-for-byte', async () => {
    const gameXComGame = join(GAME!, 'XEW', 'XComGame')
    const before = hashTree(gameXComGame)

    const scripts = readdirSync(MODS!)
      .filter((f) => f.toLowerCase().endsWith('.txt'))
      .map((f) => join(MODS!, f))
    expect(scripts.length).toBeGreaterThan(0)

    app = await electron.launch({
      executablePath: electronBin,
      args: [join(root, 'desktop'), `--game-dir=${GAME}`],
      env: env({ LWTREE_SITE: join(root, 'dist'), LWTREE_USER_DATA: mkdtempSync(join(tmpdir(), 'lwtree-real-')) }),
    })
    const page = await app.firstWindow()
    await page.evaluate(() => localStorage.setItem('lwtree.helpSeen.v1', '1'))
    await page.reload()

    await page.getByRole('button', { name: 'Tools' }).click()
    await expect(page.locator('.facts')).toContainText('XEW')
    await expect(page.getByLabel('Game version')).toHaveValue(KIND)

    // Add the mod scripts (each lone .txt is its own mod).
    await page.locator('input[type="file"][accept=".txt"]').setInputFiles(scripts)
    await expect(page.locator('article.mod')).toHaveCount(scripts.length)
    // Let the first round of checks settle.
    await expect(page.locator('.status', { hasText: 'checking' })).toHaveCount(0, { timeout: 60_000 })

    // Want every script in the game.
    for (const s of scripts) {
      const name = s.split(/[\\/]/).pop()!
      await page.getByLabel(`Install ${name}`).check()
    }

    // One INI setting too, to exercise the Config write/restore.
    await page.getByLabel('Find a setting').fill('starting soldiers')
    const soldiers = page.getByLabel('Set NUM_STARTING_SOLDIERS')
    if (await soldiers.count()) {
      await soldiers.fill('60')
      await soldiers.press('Enter')
    }

    // Apply.
    await page.getByRole('button', { name: 'Apply my setup…' }).click()
    const plan = page.getByRole('region', { name: 'What will change' })
    await expect(plan).toBeVisible({ timeout: 30_000 })
    await plan.getByRole('button', { name: 'Write these changes' }).click()
    await expect(page.locator('.log')).toContainText('Wrote', { timeout: 60_000 })

    // After applying, each wanted script should read installed.
    await expect(page.locator('.status', { hasText: 'checking' })).toHaveCount(0, { timeout: 60_000 })
    for (const s of scripts) {
      const name = s.split(/[\\/]/).pop()!
      const mod = page.locator('article.mod', { has: page.getByLabel(`Install ${name}`) })
      await expect(mod.locator('.status').first()).toHaveText('installed', { timeout: 30_000 })
    }

    // Put the originals back.
    await page.getByRole('button', { name: 'Put the originals back…' }).click()
    await expect(plan).toBeVisible({ timeout: 30_000 })
    await plan.getByRole('button', { name: 'Write these changes' }).click()
    await expect(page.locator('.log')).toContainText('Wrote', { timeout: 60_000 })

    await app.close()
    app = undefined

    // Byte-for-byte: every file as it was, lwtree-backup aside.
    const after = hashTree(gameXComGame)
    const changed = Object.keys(before).filter((k) => before[k] !== after[k])
    const missing = Object.keys(before).filter((k) => !(k in after))
    const added = Object.keys(after).filter((k) => !(k in before) && k !== 'CookedPCConsole')
    expect({ changed, missing, added }).toEqual({ changed: [], missing: [], added: [] })
  })
})
