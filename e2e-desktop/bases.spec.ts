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

test('a version from the library: offered, planned, written, with what is unknown kept aside', async () => {
  const work = mkdtempSync(join(tmpdir(), 'lwtree-bases-'))
  const steam = join(work, 'XCom-Enemy-Unknown')
  const game = join(steam, 'XEW', 'XComGame')
  for (const d of ['CookedPCConsole', 'Config']) mkdirSync(join(game, d), { recursive: true })
  // LWR "installed" by hand: its marker, with bytes the app has never seen.
  writeFileSync(join(game, 'CookedPCConsole', 'LWRebalance.u'), 'copied in by hand')
  writeFileSync(join(game, 'Config', 'DefaultGameCore.ini'), '[XComGame.XGTacticalGameCore]\r\n')
  // The library: an unpacked LWR, as its zip unpacks.
  const library = join(work, 'library')
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

  const versions = page.getByRole('radiogroup', { name: 'Version in the game' })
  await expect(page.getByText('Long War Rebalanced 9.1.0', { exact: true })).toBeVisible()
  // LWR goes over Long War: without its installer, neither is on offer.
  await expect(versions.getByRole('radio', { name: /Long War Rebalanced/ })).toBeDisabled()
  await expect(versions.getByRole('radio', { name: /^Long War\b/ }).first()).toBeDisabled()
  await versions.getByRole('radio', { name: 'Plain Enemy Within' }).check()
  expect(JSON.parse(readFileSync(join(library, 'settings.json'), 'utf8')).base).toBe('ew')

  await page.getByRole('button', { name: 'Apply my setup…' }).click()
  const plan = page.getByRole('region', { name: 'What will change' })
  await expect(plan).toContainText('for plain Enemy Within under your setup')
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
