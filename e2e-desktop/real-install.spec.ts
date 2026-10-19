// The real Windows test bench (features/windows-test-env.md): the app's mod
// and settings flow against a real Steam + Long War install, not a fake one.
// It applies the player's PatcherGUI mods (and, if asked, a mod folder whose
// files go into the game) through Tools, checks what each reads, puts the
// originals back, and proves every file the setup touched is byte-for-byte
// what Steam and the Long War installer left (hashed before, compared after).
// No whole-game copy: just the hashes.
//
// Skipped unless an install is pointed at by env, so it runs only on the bench:
//   LWTREE_REAL_GAME   = the folder holding XEW (…/common/XCom-Enemy-Unknown)
// At least one of:
//   LWTREE_REAL_MODS   = a folder of PatcherGUI .txt mod scripts to apply
//   LWTREE_REAL_MODFOLDER = a mod folder to add whole, with "Put its files…" on
// Optional:
//   LWTREE_REAL_KIND   = 'lw' (default) or 'lwr', the version to expect
//   LWTREE_REAL_UNFIT  = comma-separated script file names expected not to fit
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

const GAME = process.env.LWTREE_REAL_GAME
const MODS = process.env.LWTREE_REAL_MODS
const MODFOLDER = process.env.LWTREE_REAL_MODFOLDER
const KIND = process.env.LWTREE_REAL_KIND ?? 'lw'
const UNFIT = (process.env.LWTREE_REAL_UNFIT ?? '').split(',').filter(Boolean)

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
  test.skip(!GAME || (!MODS && !MODFOLDER), 'set LWTREE_REAL_GAME and MODS or MODFOLDER to run')

  let app: ElectronApplication | undefined
  test.afterEach(async () => app?.close())

  test('setup applies and reads as expected; originals restore byte-for-byte', async () => {
    const gameXComGame = join(GAME!, 'XEW', 'XComGame')
    const before = hashTree(gameXComGame)

    const scripts = MODS
      ? readdirSync(MODS)
          .filter((f) => f.toLowerCase().endsWith('.txt'))
          .map((f) => join(MODS, f))
      : []

    app = await electron.launch({
      executablePath: electronBin,
      args: [join(root, 'desktop'), `--game-dir=${GAME}`],
      env: env({
        LWTREE_SITE: join(root, 'dist'),
        LWTREE_USER_DATA: mkdtempSync(join(tmpdir(), 'lwtree-real-')),
      }),
    })
    const page = await app.firstWindow()
    await page.evaluate(() => localStorage.setItem('lwtree.helpSeen.v1', '1'))
    await page.reload()

    await page.getByRole('button', { name: 'Tools' }).click()
    await expect(page.locator('.facts')).toContainText('XEW')
    await expect(page.getByLabel('Game version')).toHaveValue(KIND)

    const settled = () =>
      expect(page.locator('.status', { hasText: 'checking' })).toHaveCount(0, { timeout: 60_000 })

    if (scripts.length) {
      await page.locator('input[type="file"][accept=".txt"]').setInputFiles(scripts)
      await expect(page.locator('article.mod')).toHaveCount(scripts.length)
      await settled()
      for (const s of scripts) await page.getByLabel(`Install ${basename(s)}`).check()
    }

    if (MODFOLDER) {
      await page.locator('input[webkitdirectory]').setInputFiles(MODFOLDER)
      const name = basename(MODFOLDER)
      await expect(page.locator('article.mod', { hasText: name })).toBeVisible()
      await settled()
      await page.getByLabel(`Put ${name}'s files into the game`).check()
    }

    // An INI setting too, to exercise the Config write/restore.
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
    const planText = (await plan.textContent()) ?? ''
    await plan.getByRole('button', { name: 'Write these changes' }).click()
    // The plan clears only once applyPlan has written every file; waiting on the
    // log text alone would match the first write and race the rest.
    await expect(plan).toBeHidden({ timeout: 60_000 })
    const logText = (await page.locator('.log').textContent()) ?? ''
    console.log('--- plan ---\n' + planText.trim())
    console.log('--- log ---\n' + logText.trim())

    // Read each script's final status after applying (collect now, assert after
    // the restore, so an unexpected status can never leave the game modified).
    // Wait past the transient "checking…" / "reading your install…" texts.
    const FINAL = /^(installed|not installed|partly installed|does not fit this install)/
    const status: Record<string, string> = {}
    for (const s of scripts) {
      const name = basename(s)
      const loc = page
        .locator('article.mod', { has: page.getByLabel(`Install ${name}`) })
        .locator('.status')
        .first()
      await expect(loc).toHaveText(FINAL, { timeout: 60_000 })
      status[name] = (await loc.textContent())?.trim() ?? ''
      console.log(`STATUS ${name}: ${status[name]}`)
    }

    // Put the originals back.
    await page.getByRole('button', { name: 'Put the originals back…' }).click()
    await expect(plan).toBeVisible({ timeout: 30_000 })
    await plan.getByRole('button', { name: 'Write these changes' }).click()
    // Wait for the write to finish (plan clears) before closing, or the last
    // files of the restore would be cut off.
    await expect(plan).toBeHidden({ timeout: 60_000 })

    await app.close()
    app = undefined

    // Byte-for-byte: every file as it was, lwtree-backup aside.
    const after = hashTree(gameXComGame)
    const changed = Object.keys(before).filter((k) => before[k] !== after[k])
    const missing = Object.keys(before).filter((k) => !(k in after))
    const added = Object.keys(after).filter((k) => !(k in before))
    expect({ changed, missing, added }).toEqual({ changed: [], missing: [], added: [] })

    // Then the statuses: expected-unfit scripts say so, the rest read installed.
    for (const name of Object.keys(status)) {
      if (UNFIT.includes(name)) expect(status[name]).toContain('does not fit')
      else expect(status[name]).toBe('installed')
    }
  })
})
