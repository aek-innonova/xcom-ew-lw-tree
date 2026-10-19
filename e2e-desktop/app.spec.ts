import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

const root = resolve(import.meta.dirname, '..')
// The Electron binary shipped with the desktop package: electron.exe on Windows.
const electronBin = join(
  root,
  'desktop/node_modules/electron/dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron',
)

function makeGame() {
  const work = mkdtempSync(join(tmpdir(), 'lwtree-app-'))
  const steam = join(work, 'XCom-Enemy-Unknown')
  // Enemy Unknown's own XComGame beside XEW: the app must take XEW's.
  for (const d of [
    'XComGame/CookedPCConsole',
    'XComGame/Config',
    'XEW/XComGame/CookedPCConsole',
    'XEW/XComGame/Config',
  ])
    mkdirSync(join(steam, d), { recursive: true })
  const game = join(steam, 'XEW', 'XComGame')
  for (const f of ['LongWar.upk', 'LWRebalance.u'])
    writeFileSync(join(game, 'CookedPCConsole', f), 'x')
  writeFileSync(
    join(game, 'Config', 'DefaultGameCore.ini'),
    '[XComGame.XGTacticalGameCore]\r\n; How many soldiers XCOM starts with\r\nNUM_STARTING_SOLDIERS=12\r\n' +
      'TechBalance=(eTech=eTech_Xenobiology, iTime=7, iAlloys=1, iElerium=2, iNumFragments=3, iNumItems=6)\r\n',
  )
  const saves = join(work, 'SaveData')
  mkdirSync(saves)
  copyFileSync(join(root, 'fixtures/saves/lwr-save1779'), join(saves, 'save1779'))
  return { work, steam, game, saves }
}

// Electron's env for a launch. ELECTRON_RUN_AS_NODE must be absent, not empty:
// on Windows an empty value still counts as set, so Electron would run as Node
// and reject Playwright's --remote-debugging-port. Deleting works on both.
function env(extra: Record<string, string>) {
  const e: Record<string, string | undefined> = { ...process.env, ...extra }
  delete e.ELECTRON_RUN_AS_NODE
  return e
}

let app: ElectronApplication | undefined
test.afterEach(async () => app?.close())

test('the app: Tools finds the game, writes an INI setting, follows the save folder', async () => {
  const { work, steam, game, saves } = makeGame()
  app = await electron.launch({
    executablePath: electronBin,
    args: [join(root, 'desktop'), `--game-dir=${steam}`],
    env: env({
      LWTREE_SITE: join(root, 'dist'),
      LWTREE_USER_DATA: join(work, 'userdata'),
      LWTREE_LIBRARY: join(work, 'library'),
      LWTREE_SAVES: saves,
    }),
  })
  const page = await app.firstWindow()
  await page.evaluate(() => localStorage.setItem('lwtree.helpSeen.v1', '1'))
  await page.reload()

  // The page has the bridge and nothing of Node.
  expect(await page.evaluate(() => typeof (window as { require?: unknown }).require)).toBe(
    'undefined',
  )
  expect(await page.evaluate(() => typeof window.lwtreeDesktop?.game.read)).toBe('function')

  await page.getByRole('button', { name: 'Tools' }).click()
  await expect(page.locator('.facts')).toContainText(game)
  await expect(page.locator('.facts')).toContainText('Long War Rebalanced 2.06')
  await expect(page.locator('.facts')).toContainText('DefaultGameCore.ini loaded')

  await page.getByLabel('Find a setting').fill('starting soldiers')
  await page.getByLabel('Set NUM_STARTING_SOLDIERS').fill('60')
  await page.getByLabel('Set NUM_STARTING_SOLDIERS').press('Enter')
  await page.getByRole('button', { name: 'Apply my setup…' }).click()
  const plan = page.getByRole('region', { name: 'What will change' })
  await expect(plan).toContainText('Config/DefaultGameCore.ini changed')
  await plan.getByRole('button', { name: 'Write these changes' }).click()
  await expect(page.locator('.log')).toContainText('Wrote Config/DefaultGameCore.ini')
  const ini = join(game, 'Config', 'DefaultGameCore.ini')
  expect(readFileSync(ini, 'latin1')).toContain('NUM_STARTING_SOLDIERS=60\r\n')
  expect(
    readFileSync(join(game, 'lwtree-backup', 'Config', 'DefaultGameCore.ini'), 'latin1'),
  ).toContain('NUM_STARTING_SOLDIERS=12\r\n')
  expect(existsSync(join(steam, 'XComGame', 'lwtree-backup'))).toBe(false) // not Enemy Unknown's

  // The save folder: the game's usual one (here the test's), watched.
  await page.getByRole('button', { name: 'Watch save folder' }).click()
  await expect(page.locator('.campaign')).toContainText('1 Mar 2030')
  await expect(page.getByLabel('Game version')).toHaveValue('lwr')

  // Back to the original.
  await page.getByRole('button', { name: 'Tools' }).click()
  await page.getByRole('button', { name: 'Put the originals back…' }).click()
  await plan.getByRole('button', { name: 'Write these changes' }).click()
  await expect(page.locator('.log')).toContainText('Wrote Config/DefaultGameCore.ini')
  expect(readFileSync(ini, 'latin1')).toContain('NUM_STARTING_SOLDIERS=12\r\n')
})

test('the website has no Tools', async () => {
  const { work } = makeGame()
  app = await electron.launch({
    executablePath: electronBin,
    args: [join(root, 'desktop')],
    env: env({
      LWTREE_SITE: join(root, 'dist'),
      LWTREE_USER_DATA: join(work, 'u'),
      LWTREE_LIBRARY: join(work, 'library'),
    }),
  })
  // The same site in a plain window, without the bridge: as on the web.
  const page = await app.firstWindow()
  await page.evaluate(() => localStorage.setItem('lwtree.helpSeen.v1', '1'))
  const plain = await app.evaluate(async ({ BrowserWindow }) => {
    const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
    await w.loadURL('app://lwtree/')
    return w.id
  })
  expect(plain).toBeGreaterThan(0)
  const pages = app.windows()
  const web = pages[pages.length - 1]!
  await expect(web.getByRole('tab', { name: 'Research' })).toBeVisible()
  await expect(web.getByRole('button', { name: 'Tools' })).toHaveCount(0)
})

test('Load save opens the app’s dialog in the save folder, Load INI in the game’s Config', async () => {
  const { work, steam, game, saves } = makeGame()
  app = await electron.launch({
    executablePath: electronBin,
    args: [join(root, 'desktop'), `--game-dir=${steam}`],
    env: env({
      LWTREE_SITE: join(root, 'dist'),
      LWTREE_USER_DATA: join(work, 'userdata'),
      LWTREE_LIBRARY: join(work, 'library'),
      LWTREE_SAVES: saves,
    }),
  })
  const page = await app.firstWindow()
  await page.evaluate(() => localStorage.setItem('lwtree.helpSeen.v1', '1'))
  await page.reload()
  await page.getByRole('button', { name: 'Tools' }).click() // finds the game
  await expect(page.locator('.facts')).toContainText(game)
  await page.getByRole('button', { name: 'Watch save folder' }).click() // sets the save folder
  await expect(page.locator('.campaign')).toBeVisible()

  // The native dialog, replaced: it records where it was to open and picks a file.
  const answer = async (file: string) =>
    app!.evaluate(({ dialog }, file) => {
      const g = globalThis as { asked?: string[] }
      g.asked = []
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        const opts = args[args.length - 1] as { defaultPath?: string }
        g.asked!.push(opts.defaultPath ?? '')
        return { canceled: false, filePaths: [file] }
      }) as typeof dialog.showOpenDialog
    }, file)
  const asked = () => app!.evaluate(() => (globalThis as { asked?: string[] }).asked)

  await page.getByRole('button', { name: 'Stop watching the save folder' }).click()
  await answer(join(saves, 'save1779'))
  await page.getByRole('button', { name: /Load save|Change save/ }).click()
  await expect(page.locator('.loaded').first()).toContainText('save1779')
  expect(await asked()).toEqual([saves])

  await answer(join(game, 'Config', 'DefaultGameCore.ini'))
  await page.getByRole('button', { name: /DefaultGameCore\.ini|Change INI/ }).click()
  expect(await asked()).toEqual([join(game, 'Config')])
})
