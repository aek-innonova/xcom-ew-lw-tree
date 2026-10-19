// On a real game (the Windows bench, features/game-bases.md): the app puts
// Long War and LWR in from the library and takes them out again, and every
// step is compared byte for byte with what the installers left on this
// machine before (baselines) and with Steam's own plain Enemy Within.
//
// Skipped unless pointed at a real install:
//   LWTREE_REAL_GAME     = the folder holding XEW, as Steam left it (plain Enemy Within)
//   LWTREE_REAL_LIBRARY  = a library folder with the Long War installer and the LWR download
//                          (Mods\ in it with the person's mods, to apply them on the way)
//   LWTREE_REAL_EW       = plain Enemy Within's files: { "<path under XEW>": { size, sha256 } }
//   LWTREE_REAL_LW       = Long War's: { "<path under XComGame>": "sha256:size" }
//   LWTREE_REAL_LWR      = LWR's, the same
//   LWTREE_REAL_UNFIT    = comma-separated mod script names expected not to fit LWR

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test'

const root = resolve(import.meta.dirname, '..')
const electronBin = join(
  root,
  'desktop/node_modules/electron/dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron',
)
const GAME = process.env.LWTREE_REAL_GAME
const LIBRARY = process.env.LWTREE_REAL_LIBRARY
const UNFIT = (process.env.LWTREE_REAL_UNFIT ?? '').split(',').filter(Boolean)

const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex')

/** Path under XComGame → sha256, from either baseline shape. */
function expected(file: string): Map<string, string> {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string | { sha256: string }>
  const out = new Map<string, string>()
  for (const [p, v] of Object.entries(raw)) {
    // Steam's table is of all XEW: only XComGame is compared.
    if (typeof v !== 'string' && !p.startsWith('XComGame/')) continue
    const rel = p.startsWith('XComGame/') ? p.slice('XComGame/'.length) : p
    out.set(rel.toLowerCase(), typeof v === 'string' ? v.split(':')[0]! : v.sha256)
  }
  return out
}

/** Every file under XComGame but the app's backups, as lower-case path → path. */
function tree(game: string): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (dir: string, rel: string) => {
    for (const e of readdirSync(dir)) {
      const r = rel ? `${rel}/${e}` : e
      if (r === 'lwtree-backup') continue
      const p = join(dir, e)
      if (statSync(p).isDirectory()) walk(p, r)
      else out.set(r.toLowerCase(), r)
    }
  }
  walk(game, '')
  return out
}

/**
 * The game matches a baseline: every file it lists, byte for byte, and, in the
 * folders it covers, nothing more.
 */
function matches(game: string, want: Map<string, string>): string[] {
  const have = tree(game)
  const covered = new Set([...want.keys()].map((k) => k.split('/')[0]))
  const wrong: string[] = []
  for (const [k, s] of want) {
    const p = have.get(k)
    if (!p) wrong.push(`missing ${k}`)
    else if (sha(join(game, p)) !== s) wrong.push(`differs ${k}`)
  }
  for (const [k] of have) if (covered.has(k.split('/')[0]) && !want.has(k)) wrong.push(`extra ${k}`)
  return wrong
}

function env(extra: Record<string, string>) {
  const e: Record<string, string | undefined> = { ...process.env, ...extra }
  delete e.ELECTRON_RUN_AS_NODE
  return e
}

test.describe('real game: versions put in and taken out by the app', () => {
  test.skip(
    !GAME || !LIBRARY || !process.env.LWTREE_REAL_EW || !process.env.LWTREE_REAL_LW,
    'set LWTREE_REAL_GAME, _LIBRARY, _EW, _LW (and _LWR) to run',
  )
  test.setTimeout(30 * 60_000)
  let app: ElectronApplication | undefined
  test.afterEach(async () => app?.close())

  test('plain EW → Long War → LWR (+ mods) → Long War → plain EW, byte for byte', async () => {
    const game = join(GAME!, 'XEW', 'XComGame')
    const exe = join(GAME!, 'XEW', 'Binaries', 'Win32', 'XComEW.exe')
    const ew = expected(process.env.LWTREE_REAL_EW!)
    const lw = expected(process.env.LWTREE_REAL_LW!)
    const lwr = process.env.LWTREE_REAL_LWR ? expected(process.env.LWTREE_REAL_LWR) : null
    const exeAtStart = sha(exe)
    expect(matches(game, ew), 'the game starts as plain Enemy Within').toEqual([])

    app = await electron.launch({
      executablePath: electronBin,
      args: [join(root, 'desktop'), `--game-dir=${GAME}`],
      env: env({
        LWTREE_SITE: join(root, 'dist'),
        LWTREE_USER_DATA: join(tmpdir(), `lwtree-real-bases-${Date.now()}`),
        LWTREE_LIBRARY: LIBRARY!,
        LWTREE_UPDATE_URL: '',
      }),
    })
    const page = await app.firstWindow()
    await page.evaluate(() => localStorage.setItem('lwtree.helpSeen.v1', '1'))
    await page.reload()
    await page.getByRole('button', { name: 'Tools' }).click()
    const versions = page.getByRole('radiogroup', { name: 'Version in the game' })

    async function apply(p: Page, label: RegExp) {
      await versions.getByRole('radio', { name: label }).check()
      await p.getByRole('button', { name: 'Apply my setup…' }).click()
      const plan = p.getByRole('region', { name: 'What will change' })
      await expect(plan).toBeVisible({ timeout: 5 * 60_000 })
      await expect(plan.locator('.problems')).toHaveCount(0)
      const write = plan.getByRole('button', { name: 'Write these changes' })
      if (await write.count()) {
        await write.click()
        await expect(p.getByRole('button', { name: 'Apply my setup…' })).toBeVisible({
          timeout: 10 * 60_000,
        })
      } else await plan.getByRole('button', { name: 'Close' }).click()
      await expect(p.locator('.tools .error')).toHaveCount(0)
    }
    const exePatched = () =>
      readFileSync(exe).includes(Buffer.from('prod.xcom-ex.firaxis.com', 'utf16le'))

    await apply(page, /^Long War 1\.0$/)
    expect(matches(game, lw), 'Long War as its installer leaves it').toEqual([])
    expect(exePatched()).toBe(true)
    await expect(page.locator('.facts')).toContainText('Long War 1.0')

    if (lwr) {
      await apply(page, /^Long War Rebalanced/)
      expect(matches(game, lwr), 'LWR as copied over Long War by hand').toEqual([])
      expect(exePatched()).toBe(true)

      // The person's mods on top, then out again.
      const boxes = page.getByRole('checkbox', { name: /^Install / })
      const n = await boxes.count()
      if (n) {
        for (let i = 0; i < n; i++) await boxes.nth(i).check()
        await page.getByRole('button', { name: 'Apply my setup…' }).click()
        const plan = page.getByRole('region', { name: 'What will change' })
        await plan.getByRole('button', { name: 'Write these changes' }).click()
        await expect(page.getByRole('button', { name: 'Apply my setup…' })).toBeVisible({
          timeout: 10 * 60_000,
        })
        for (let i = 0; i < n; i++) {
          const name = ((await boxes.nth(i).getAttribute('aria-label')) ?? '').slice(
            'Install '.length,
          )
          // The status of this checkbox's own script row: the same script name
          // can appear in two mods (a standalone script and a folder that also
          // carries it), so scope to the row, not every .script with that text.
          const status = boxes
            .nth(i)
            .locator('xpath=ancestor::*[contains(@class,"script-head")][1]')
            .locator('.status')
          // "partly installed" / "installed, with …" both contain "installed".
          await expect(status).toContainText(UNFIT.includes(name) ? 'does not fit' : 'installed', {
            timeout: 60_000,
          })
        }
        for (let i = 0; i < n; i++) await boxes.nth(i).uncheck()
      }
    }

    await apply(page, /^Long War 1\.0$/)
    expect(matches(game, lw), 'back to Long War').toEqual([])

    await apply(page, /^Plain Enemy Within$/)
    expect(matches(game, ew), 'back to plain Enemy Within').toEqual([])
    expect(sha(exe), 'the exe as Steam left it').toBe(exeAtStart)
    expect(existsSync(join(game, 'CookedPCConsole', 'LongWar.upk'))).toBe(false)
  })
})
