// The game version under the mods (features/game-bases.md), through the
// app: a base found in the library, chosen, planned and written, with a file
// the app does not recognise kept aside before it goes. A made-up LWR (a
// real Long War installer cannot be made here; the bench runs the real ones).

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

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

let app: ElectronApplication | undefined
test.afterEach(async () => app?.close())

/** LWR "installed" by hand, and a library with an unpacked LWR; the app started on them. */
async function start(mods: Record<string, string> = {}) {
  const work = mkdtempSync(join(tmpdir(), 'lwtree-bases-'))
  const steam = join(work, 'XCom-Enemy-Unknown')
  const game = join(steam, 'XEW', 'XComGame')
  for (const d of ['CookedPCConsole', 'Config']) mkdirSync(join(game, d), { recursive: true })
  // LWR "installed" by hand: its marker, with bytes the app has never seen.
  writeFileSync(join(game, 'CookedPCConsole', 'LWRebalance.u'), 'copied in by hand')
  writeFileSync(join(game, 'Config', 'DefaultGameCore.ini'), '[XComGame.XGTacticalGameCore]\r\n')
  // The library: an unpacked LWR, as its zip unpacks.
  const library = join(work, 'library')
  for (const [name, text] of Object.entries(mods)) {
    mkdirSync(join(library, 'Mods'), { recursive: true })
    writeFileSync(join(library, 'Mods', name), text)
  }
  const lwr = join(library, 'LW Rebalance v9.1.0')
  for (const [p, t] of Object.entries({
    'CookedPCConsole/LWRebalance.u': 'rebalance',
    'Config/DefaultLWRebalance.ini': '[A]\r\nB=1\r\n',
    'Config/DefaultGameCore.ini': '[XComGame.XGTacticalGameCore]\r\nA=2\r\n',
  })) {
    mkdirSync(join(lwr, p, '..'), { recursive: true })
    writeFileSync(join(lwr, p), t)
  }
  app = await electron.launch({
    executablePath: electronBin,
    args: [join(root, 'desktop'), `--game-dir=${steam}`],
    env: env({
      LWTREE_SITE: join(root, 'dist'),
      LWTREE_USER_DATA: join(work, 'userdata'),
      LWTREE_LIBRARY: library,
      LWTREE_CACHE: join(work, 'cache'),
      LWTREE_SAVES: join(work, 'SaveData'),
      LWTREE_UPDATE_URL: '',
    }),
  })
  const page = await app.firstWindow()
  await page.evaluate(() => localStorage.setItem('lwtree.helpSeen.v1', '1'))
  await page.reload()
  await page.getByRole('button', { name: 'Tools' }).click()
  return { page, game, library }
}

test('a version from the library: offered, planned, written, with what is unknown kept aside', async () => {
  const { page, game, library } = await start()

  const versions = page.getByRole('group', { name: 'Version in the game' })
  const downloads = page.locator('section[aria-labelledby="base-h"]')
  await expect(downloads.getByText('Long War Rebalanced 9.1.0', { exact: true })).toBeVisible()
  // LWR is in the game: its setup is the one shown. LWR goes over Long War:
  // without Long War's installer, Long War cannot be put in.
  await expect(versions.getByRole('button', { name: /^Long War Rebalanced/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(versions.getByRole('button', { name: /^Long War (?!Rebalanced)/ })).toBeDisabled()
  await versions.getByRole('button', { name: /^Plain Enemy Within/ }).click()
  expect(JSON.parse(readFileSync(join(library, 'settings.json'), 'utf8')).base).toBe('ew')

  // Another version than the one in the game: said on the button and in the plan.
  await page.getByRole('button', { name: 'Switch the game to Plain Enemy Within…' }).click()
  const plan = page.getByRole('region', { name: 'What will change' })
  await expect(plan).toContainText(
    'This replaces Long War Rebalanced 9.1.0 in the game with plain Enemy Within',
  )
  await expect(plan).toContainText('for plain Enemy Within under this setup')
  await expect(plan).toContainText('CookedPCConsole/LWRebalance.u removed')
  await expect(plan).toContainText('the file as it is now kept first in lwtree-backup/found-')
  // The game's own DefaultGameCore.ini is nowhere to be had: said, and left.
  await expect(plan).toContainText('Config/DefaultGameCore.ini: the game’s own copy is not at hand')
  await page.getByRole('button', { name: 'Write these changes' }).click()
  await expect(plan).toContainText('Removed CookedPCConsole/LWRebalance.u')
  await expect(plan).toContainText('✓ Done.')

  expect(existsSync(join(game, 'CookedPCConsole', 'LWRebalance.u'))).toBe(false)
  const found = readdirSync(join(game, 'lwtree-backup')).find((d) => d.startsWith('found-'))!
  expect(
    readFileSync(join(game, 'lwtree-backup', found, 'CookedPCConsole', 'LWRebalance.u'), 'utf8'),
  ).toBe('copied in by hand')
  expect(readFileSync(join(game, 'Config', 'DefaultGameCore.ini'), 'utf8')).toBe(
    '[XComGame.XGTacticalGameCore]\r\n',
  )
})

test('each version keeps its own setup: mods ticked, saved setups', async () => {
  const mod =
    'MOD_NAME=Faster\nAUTHOR=lwtree tests\n\nUPK_FILE=XComGame.upk\nOBJECT=XGUnit.Test:AUTO\n[REPLACEMENT_CODE]\n0B 53\n'
  const { page, library } = await start({ 'Faster.txt': mod })
  const versions = page.getByRole('group', { name: 'Version in the game' })
  const lwr = versions.getByRole('button', { name: /^Long War Rebalanced/ })
  const ew = versions.getByRole('button', { name: /^Plain Enemy Within/ })
  const tick = page.getByRole('checkbox', { name: 'Install Faster.txt' })
  const bar = page.getByRole('region', { name: 'Setup' })
  const pick = bar.getByRole('combobox', { name: 'Setup' })

  // In LWR's setup (the version installed): ticked, and saved by name.
  await expect(lwr).toHaveAttribute('aria-pressed', 'true')
  await tick.check()
  await pick.selectOption({ label: 'Save as a new setup…' })
  await bar.getByLabel('Name for this setup').fill('Mine')
  await bar.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(bar.getByText('in use')).toBeVisible()

  // Plain Enemy Within has its own: nothing ticked, no saved setups.
  await ew.click()
  await expect(ew).toHaveAttribute('aria-pressed', 'true')
  await expect(tick).not.toBeChecked()
  await expect(pick.locator('option', { hasText: 'Mine' })).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Switch the game to Plain Enemy Within…' }),
  ).toBeVisible()

  // Back to LWR: its choices as they were.
  await lwr.click()
  await expect(tick).toBeChecked()
  await expect(bar.getByText('in use')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Apply the setup…' })).toBeVisible()

  const s = JSON.parse(readFileSync(join(library, 'settings.json'), 'utf8'))
  expect(s.base).toBe('lwr')
  expect(s.versions.lwr.mods['Faster.txt'].wanted).toEqual({ 'Faster.txt': true })
  expect(Object.keys(s.versions.lwr.setups)).toEqual(['Mine'])
  expect(s.versions.ew.mods['Faster.txt']?.wanted?.['Faster.txt']).toBeFalsy()
  expect(s.versions.ew.setups).toEqual({})
})
