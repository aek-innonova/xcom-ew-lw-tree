import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type Locator, type Page } from '@playwright/test'

// The website's screenshots of the desktop app (features/desktop-app-page.md),
// made from the app on this machine against a stand-in game folder of the
// person's packages and a library with the Long War installer and the LWR
// download. Not a test: scripts/site-shots.sh makes both from samples/, runs
// this with LWTREE_SHOTS=1, and turns the PNGs it writes to /tmp/lwtree-shots
// into public/desktop/.

const root = resolve(import.meta.dirname, '..')
const game = process.env.LWTREE_SHOTS_GAME ?? '/tmp/shotgame'
const library = process.env.LWTREE_SHOTS_LIBRARY ?? '/tmp/shotlib'
const out = '/tmp/lwtree-shots'

test.skip(!process.env.LWTREE_SHOTS || !existsSync(game), 'screenshots on request')

const shot = (l: Locator | Page, name: string) => l.screenshot({ path: join(out, `${name}.png`) })

test('screenshots for the website', async () => {
  test.setTimeout(10 * 60_000)
  mkdirSync(out, { recursive: true })
  mkdirSync('/tmp/lwtree-check', { recursive: true })
  const work = mkdtempSync(join(tmpdir(), 'lwtree-shots-'))
  const env: Record<string, string | undefined> = {
    ...process.env,
    LWTREE_SITE: join(root, 'dist'),
    LWTREE_USER_DATA: join(work, 'u'),
    LWTREE_LIBRARY: library,
    LWTREE_CACHE: join(work, 'c'),
    LWTREE_SAVES: join(work, 's'),
    LWTREE_UPDATE_URL: '',
  }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({
    executablePath: join(root, 'desktop/node_modules/electron/dist/electron'),
    args: [join(root, 'desktop'), `--game-dir=${game}`],
    env: env as Record<string, string>,
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('load')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.evaluate(() => localStorage.setItem('lwtree.helpSeen.v1', '1'))
  await page.reload()

  // The research tree with the game's own pictures, a campaign loaded.
  await page
    .locator('input[type=file]:not([accept]):not([multiple]):not([webkitdirectory])')
    .first()
    .setInputFiles(resolve(root, 'fixtures/saves/save1762'))
  await expect(page.locator('.campaign')).toBeVisible()
  await page.locator('[data-tech]', { hasText: 'Beam Lasers' }).first().click()
  await page.waitForTimeout(1500)
  await shot(page, 'research')

  // An air war fight in the game's interception look.
  await page.getByRole('tab', { name: 'Air war' }).click()
  await page.waitForTimeout(2500)
  await page.getByRole('button', { name: 'Fly it' }).first().click()
  const fight = page.getByRole('dialog', { name: 'Air fight' })
  await page.waitForTimeout(3200)
  await shot(fight.locator('.fight'), 'air-war')
  await page.keyboard.press('Escape')

  // Tools: the versions, each with its own setup, from the library's downloads.
  await page.getByRole('button', { name: 'Tools' }).click()
  await page.waitForTimeout(2500)
  // Parts of the page on their own: the bar and the footer not pinned over them.
  await page.addStyleTag({
    content: '.setup-bar { position: static !important } .foot { display: none }',
  })
  const bar = page.getByRole('region', { name: 'Your setup' })
  await expect(bar.getByRole('button', { name: /^Long War 1\.0/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.waitForTimeout(500)
  await shot(bar, 'versions')

  // Game settings: the soldier stats table.
  const stats = page.locator('details[aria-label="Soldier stats"]')
  await stats.scrollIntoViewIfNeeded()
  await shot(stats.locator('table'), 'soldier-stats')

  // The class colours with the soldier.
  const colors = page.locator('details[aria-label="Class colors"]')
  await colors.evaluate((d) => ((d as HTMLDetailsElement).open = true))
  await colors.getByRole('button', { name: 'Show Medic on the soldier' }).click()
  await colors.scrollIntoViewIfNeeded()
  await page.waitForTimeout(6000)
  await shot(colors.locator('.looks'), 'class-colors')

  // An item's card.
  const items = page.locator('details[aria-label="Items"]')
  await items.evaluate((d) => ((d as HTMLDetailsElement).open = true))
  await items.getByRole('button', { name: 'Carapace Armor', exact: true }).click()
  await page.addStyleTag({ content: '.item-card { max-width: 640px }' })
  await items.scrollIntoViewIfNeeded()
  await page.waitForTimeout(800)
  await shot(items.locator('article'), 'item-card')

  // LWR put in place of Long War: the console under the setup bar.
  await page.evaluate(() => document.querySelector('.tools')?.scrollTo(0, 0))
  await bar.getByRole('button', { name: /^Long War Rebalanced/ }).click()
  await page.getByRole('button', { name: /^Switch the game to / }).click()
  const plan = page.getByRole('region', { name: 'What will change' })
  await expect(plan).toContainText(/These files will change|Nothing to change/, {
    timeout: 120_000,
  })
  // The bar and the top of the console: the steps and the first files.
  const box = (await bar.boundingBox())!
  await page.screenshot({
    path: join(out, 'apply.png'),
    clip: { x: box.x, y: box.y, width: Math.min(box.width, 980), height: 420 },
  })
  await plan.getByRole('button', { name: /Cancel|Close/ }).click()

  // Not for the site: LWR's class colours, to look at.
  const lwrColors = page.locator('details[aria-label="Class colors"]')
  await lwrColors.evaluate((d) => ((d as HTMLDetailsElement).open = true))
  await lwrColors.getByRole('button', { name: 'Show Sniper on the soldier' }).click()
  await lwrColors.scrollIntoViewIfNeeded()
  await page.waitForTimeout(4000)
  await lwrColors.locator('.looks').screenshot({ path: '/tmp/lwtree-check/lwr-colors.png' })
  await bar.getByRole('button', { name: /^Long War 1\.0/ }).click()

  await app.close()
})
