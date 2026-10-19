import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'

// The Tools page through the helper program (helper/main.go), built from
// source and run on a game folder made for the test. No folder access is
// needed in the browser, so this runs in every browser.

const GO = [join(homedir(), '.local/go/bin/go'), '/usr/local/go/bin/go', '/usr/bin/go'].find(
  existsSync,
)
// eslint-disable-next-line playwright/no-skipped-test -- needs a Go toolchain to build the helper
test.skip(!GO, 'no Go toolchain to build the helper')

let helper: ChildProcess | undefined

test.afterEach(() => helper?.kill())

test('tools through the helper: reads the install, writes a setting, puts it back', async ({
  page,
  baseURL,
}) => {
  const work = mkdtempSync(join(tmpdir(), 'lwtree-helper-'))
  const bin = join(work, 'lwtree-helper')
  execFileSync(GO!, ['build', '-o', bin, '.'], { cwd: resolve(import.meta.dirname, '../helper') })
  const game = join(work, 'XCom-Enemy-Unknown', 'XEW', 'XComGame')
  mkdirSync(join(game, 'CookedPCConsole'), { recursive: true })
  mkdirSync(join(game, 'Config'))
  for (const f of ['LongWar.upk', 'LWRebalance.u'])
    writeFileSync(join(game, 'CookedPCConsole', f), 'x')
  const ini = join(game, 'Config', 'DefaultGameCore.ini')
  writeFileSync(
    ini,
    '[XComGame.XGTacticalGameCore]\r\n; How many soldiers XCOM starts with\r\nNUM_STARTING_SOLDIERS=12\r\n',
  )

  helper = spawn(
    bin,
    ['-dir', join(work, 'XCom-Enemy-Unknown'), '-origin', new URL(baseURL!).origin],
    {
      env: { ...process.env, XDG_CONFIG_HOME: join(work, 'config') },
    },
  )
  const code = await new Promise<string>((done, fail) => {
    let out = ''
    helper!.stdout!.on('data', (d) => {
      out += d
      const m = /Pairing code:\s+(\S+)/.exec(out)
      if (m) done(m[1]!)
    })
    helper!.on('exit', () => fail(new Error(`the helper stopped: ${out}`)))
  })

  await page.addInitScript(() => localStorage.setItem('lwtree.helpSeen.v1', '1'))
  await page.goto('/')
  await page.getByRole('button', { name: 'Tools' }).click()
  await page.getByLabel('Pairing code').fill('WRONG-CODE')
  await page.getByRole('button', { name: 'Use the helper program' }).click()
  await expect(page.getByText('That is not the code the helper shows.')).toBeVisible()
  await page.getByLabel('Pairing code').fill(code)
  await page.getByRole('button', { name: 'Use the helper program' }).click()

  await expect(page.locator('.facts')).toContainText('Long War Rebalanced 2.06')
  await expect(page.locator('.facts')).toContainText('through the helper program')

  await page.getByLabel('Find a setting').fill('starting soldiers')
  await page.getByLabel('Set NUM_STARTING_SOLDIERS').fill('60')
  await page.getByLabel('Set NUM_STARTING_SOLDIERS').press('Enter')
  await page.getByRole('button', { name: 'Apply my setup…' }).click()
  const plan = page.getByRole('region', { name: 'What will change' })
  await expect(plan).toContainText('Config/DefaultGameCore.ini changed')
  await plan.getByRole('button', { name: 'Write these changes' }).click()
  await expect(page.locator('.log')).toContainText('Wrote Config/DefaultGameCore.ini')
  expect(readFileSync(ini, 'latin1')).toContain('NUM_STARTING_SOLDIERS=60\r\n')
  expect(
    readFileSync(join(game, 'lwtree-backup', 'Config', 'DefaultGameCore.ini'), 'latin1'),
  ).toContain('NUM_STARTING_SOLDIERS=12\r\n')
  expect(existsSync(join(game, 'lwtree-backup', 'manifest.json'))).toBe(true)

  // A reload reconnects by itself while the helper runs.
  await page.reload()
  await page.getByRole('button', { name: 'Tools' }).click()
  await expect(page.locator('.facts')).toContainText('through the helper program')
  await page.getByRole('button', { name: 'Put the originals back…' }).click()
  await plan.getByRole('button', { name: 'Write these changes' }).click()
  await expect(page.locator('.log')).toContainText('Wrote Config/DefaultGameCore.ini')
  expect(readFileSync(ini, 'latin1')).toContain('NUM_STARTING_SOLDIERS=12\r\n')
})

test('the Tools page offers the site’s own build of the helper', async ({ page }) => {
  // eslint-disable-next-line playwright/no-skipped-test -- the deploy builds it into dist/helper/
  test.skip(
    !existsSync(resolve(import.meta.dirname, '../dist/helper/VERSION')),
    'no helper build in dist/',
  )
  await page.addInitScript(() => localStorage.setItem('lwtree.helpSeen.v1', '1'))
  await page.goto('/')
  await page.getByRole('button', { name: 'Tools' }).click()
  const link = page.getByRole('link', { name: 'Download lwtree-helper.exe' })
  await expect(link).toBeVisible()
  const r = await page.request.get((await link.getAttribute('href'))!)
  expect(r.status()).toBe(200)
  expect((await r.body()).subarray(0, 2).toString()).toBe('MZ') // a Windows program
})
