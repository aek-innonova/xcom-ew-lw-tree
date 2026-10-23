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
//   LWTREE_REAL_MODS   = a folder of mods to apply: PatcherGUI .txt scripts, .upkmod files
//   LWTREE_REAL_MODFOLDER = a mod folder to add whole, with "Put its files…" on
// Optional:
//   LWTREE_REAL_KIND   = 'lw' (default), 'lwr' or 'ew', the version to expect
//   LWTREE_REAL_SHOT   = a .png to save the page to once the setup is in
//   LWTREE_REAL_UNFIT  = comma-separated script file names expected not to fit
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, mkdtempSync, statSync } from 'node:fs'
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
    test.setTimeout(300_000)
    const gameXComGame = join(GAME!, 'XEW', 'XComGame')
    const before = hashTree(gameXComGame)

    const scripts = MODS
      ? readdirSync(MODS)
          .filter((f) => /\.(txt|upkmod)$/i.test(f))
          .map((f) => join(MODS, f))
      : []

    app = await electron.launch({
      executablePath: electronBin,
      args: [join(root, 'desktop'), `--game-dir=${GAME}`],
      env: env({
        LWTREE_SITE: join(root, 'dist'),
        LWTREE_USER_DATA: mkdtempSync(join(tmpdir(), 'lwtree-real-')),
        LWTREE_LIBRARY: mkdtempSync(join(tmpdir(), 'lwtree-lib-')),
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
      await page.locator('input[type="file"][accept*=".txt"]').setInputFiles(scripts)
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
    await page.getByRole('button', { name: 'Apply the setup…' }).click()
    const plan = page.getByRole('region', { name: 'What will change' })
    await expect(plan).toBeVisible({ timeout: 30_000 })
    const planText = (await plan.textContent()) ?? ''
    await plan.getByRole('button', { name: 'Write these changes' }).click()
    // "Done" shows only once applyPlan has written every file; waiting on the
    // log text alone would match the first write and race the rest.
    await expect(plan.getByText('✓ Done.')).toBeVisible({ timeout: 60_000 })
    const logText = (await plan.textContent()) ?? ''
    await plan.getByRole('button', { name: 'Close' }).click()
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
    // LWTREE_REAL_SHOT: the page as it reads now, to look at.
    if (process.env.LWTREE_REAL_SHOT) {
      await page.locator('article.mod').first().scrollIntoViewIfNeeded()
      await page.screenshot({ path: process.env.LWTREE_REAL_SHOT })
    }

    // Put the originals back: the version alone, from the setup menu.
    const alone = page.locator('option', { hasText: 'alone, without mods or settings' })
    await page.locator('select', { has: alone }).selectOption((await alone.getAttribute('value'))!)
    await expect(plan).toBeVisible({ timeout: 30_000 })
    await plan.getByRole('button', { name: 'Write these changes' }).click()
    // Wait for the write to finish before closing, or the last files of the
    // restore would be cut off.
    await expect(plan.getByText('✓ Done.')).toBeVisible({ timeout: 60_000 })
    await plan.getByRole('button', { name: 'Close' }).click()

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

  // An apply the player kills half-way must not leave a half-written file the
  // next apply mistakes for a reinstall and backs up over the true original
  // (desktop-app.md, setup.ts 0.1.2). Destructive (hard-kills the app mid-apply),
  // so it runs only on request.
  test('an apply cut short recovers: backups keep the true originals', async () => {
    test.skip(!process.env.LWTREE_REAL_CRASH || !MODS, 'set LWTREE_REAL_CRASH and MODS to run')
    test.setTimeout(240_000) // two app sessions over a real install
    const gameXComGame = join(GAME!, 'XEW', 'XComGame')
    const before = hashTree(gameXComGame)
    const scripts = readdirSync(MODS!)
      .filter((f) => f.toLowerCase().endsWith('.txt'))
      .map((f) => join(MODS!, f))
    const userData = mkdtempSync(join(tmpdir(), 'lwtree-crash-'))
    app = undefined
    const launch = () =>
      electron.launch({
        executablePath: electronBin,
        args: [join(root, 'desktop'), `--game-dir=${GAME}`],
        env: env({
          LWTREE_SITE: join(root, 'dist'),
          LWTREE_USER_DATA: userData,
          LWTREE_LIBRARY: join(userData, 'library'),
        }),
      })

    // Session 1: set the setup up, start applying, hard-kill mid-write.
    const one = await launch()
    const p1 = await one.firstWindow()
    await p1.evaluate(() => localStorage.setItem('lwtree.helpSeen.v1', '1'))
    await p1.reload()
    await p1.getByRole('button', { name: 'Tools' }).click()
    await expect(p1.locator('.facts')).toContainText('XEW')
    await p1.locator('input[type="file"][accept*=".txt"]').setInputFiles(scripts)
    await expect(p1.locator('article.mod')).toHaveCount(scripts.length)
    await expect(p1.locator('.status', { hasText: 'checking' })).toHaveCount(0, { timeout: 60_000 })
    for (const s of scripts) await p1.getByLabel(`Install ${basename(s)}`).check()
    await p1.getByLabel('Find a setting').fill('starting soldiers')
    const soldiers = p1.getByLabel('Set NUM_STARTING_SOLDIERS')
    if (await soldiers.count()) {
      await soldiers.fill('60')
      await soldiers.press('Enter')
    }
    await p1.getByRole('button', { name: 'Apply the setup…' }).click()
    const plan1 = p1.getByRole('region', { name: 'What will change' })
    await expect(plan1).toBeVisible({ timeout: 30_000 })
    // Watch the first game package on disk. The app writes the record and the
    // backups first, then the files; the instant that package changes, one
    // file is written and the rest are not — kill the app dead. (The log is set
    // in one go only after the whole apply, too late to catch it there.)
    const firstPkg = join(gameXComGame, 'CookedPCConsole', 'XComGame.upk')
    const base = statSync(firstPkg)
    await plan1.getByRole('button', { name: 'Write these changes' }).click()
    for (let i = 0; i < 1000; i++) {
      await new Promise((r) => setTimeout(r, 10))
      const s = statSync(firstPkg)
      if (s.mtimeMs !== base.mtimeMs || s.size !== base.size) break
    }
    one.process().kill('SIGKILL')
    // Clear any orphaned child processes before reopening on the same user data.
    try {
      execSync('taskkill /F /IM electron.exe /T', { stdio: 'ignore' })
    } catch {
      /* none left */
    }
    await new Promise((r) => setTimeout(r, 1500)) // let the user-data lock clear

    // The record and the backups were written before any game file.
    expect(existsSync(join(gameXComGame, 'lwtree-backup', 'manifest.json'))).toBe(true)

    // Session 2: reopen (same user data: the library and settings persist),
    // apply the whole setup again, then put the originals back.
    const two = await launch()
    app = two
    const p2 = await two.firstWindow()
    await p2.evaluate(() => localStorage.setItem('lwtree.helpSeen.v1', '1'))
    await p2.reload()
    await p2.getByRole('button', { name: 'Tools' }).click()
    await expect(p2.locator('.facts')).toContainText('XEW')
    // Wait for the persisted library and settings to load and checks to settle
    // before applying, or the setup would be incomplete.
    await expect(p2.locator('article.mod')).toHaveCount(scripts.length, { timeout: 60_000 })
    const idle = () =>
      expect(p2.locator('.status', { hasText: /checking|reading your install/ })).toHaveCount(0, {
        timeout: 60_000,
      })
    await idle()
    const plan2 = p2.getByRole('region', { name: 'What will change' })
    // Apply or restore; if a plan has nothing to do, close it instead of writing.
    const step = async (label: string) => {
      await p2.getByRole('button', { name: label }).click()
      await expect(plan2).toBeVisible({ timeout: 30_000 })
      console.log(`--- session 2: ${label} ---\n` + ((await plan2.textContent()) ?? '').trim())
      const write = plan2.getByRole('button', { name: 'Write these changes' })
      if (await write.count()) {
        await write.click()
        await expect(plan2.getByText('✓ Done.')).toBeVisible({ timeout: 60_000 })
      }
      await plan2.getByRole('button', { name: 'Close' }).click()
      await expect(plan2).toBeHidden({ timeout: 60_000 })
    }
    await step('Apply the setup…')
    await idle()
    await step('Put the originals back…')
    await two.close()
    app = undefined

    // Byte-for-byte against the baseline, and every backup is the true original.
    const after = hashTree(gameXComGame)
    expect(Object.keys(before).filter((k) => before[k] !== after[k])).toEqual([])
    expect(Object.keys(after).filter((k) => !(k in before))).toEqual([])
    const backup = join(gameXComGame, 'lwtree-backup')
    const walk = (rel: string): string[] =>
      readdirSync(join(backup, rel), { withFileTypes: true }).flatMap((e) => {
        const r = rel ? `${rel}/${e.name}` : e.name
        return e.isDirectory() ? walk(r) : e.isFile() ? [r] : []
      })
    for (const rel of walk('')) {
      if (rel === 'manifest.json') continue
      const sha = createHash('sha256')
        .update(readFileSync(join(backup, rel)))
        .digest('hex')
      expect(`${rel} ${sha}:${readFileSync(join(backup, rel)).length}`).toBe(
        `${rel} ${before[rel]}`,
      )
    }
  })
})
