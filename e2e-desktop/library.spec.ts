// The player's library folder (features/game-bases.md): mods added in the
// app land in it, mods copied in by hand turn up, the player's choices are
// kept beside them, and mods kept in IndexedDB by 0.2 move into it once.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

const root = resolve(import.meta.dirname, '..')
const electronBin = join(
  root,
  'desktop/node_modules/electron/dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron',
)

/** A PatcherGUI script of our own (the game need not have its package). */
const script = (name: string) =>
  `MOD_NAME=${name}\nAUTHOR=lwtree tests\nDESCRIPTION=A test mod.\n\nUPK_FILE=XComGame.upk\nOBJECT=XGUnit.Test:AUTO\n[REPLACEMENT_CODE]\n0B 53\n`

function makeGame(work: string) {
  const game = join(work, 'XCom-Enemy-Unknown', 'XEW', 'XComGame')
  mkdirSync(join(game, 'CookedPCConsole'), { recursive: true })
  mkdirSync(join(game, 'Config'), { recursive: true })
  writeFileSync(join(game, 'CookedPCConsole', 'LongWar.upk'), 'x')
  writeFileSync(join(game, 'Config', 'DefaultGameCore.ini'), '[XComGame.XGTacticalGameCore]\r\n')
  return join(work, 'XCom-Enemy-Unknown')
}

function env(extra: Record<string, string>) {
  const e: Record<string, string | undefined> = { ...process.env, ...extra }
  delete e.ELECTRON_RUN_AS_NODE
  return e
}

let app: ElectronApplication | undefined
test.afterEach(async () => app?.close())

async function launch(work: string, library: string) {
  app = await electron.launch({
    executablePath: electronBin,
    args: [join(root, 'desktop'), `--game-dir=${makeGame(work)}`],
    env: env({
      LWTREE_SITE: join(root, 'dist'),
      LWTREE_USER_DATA: join(work, 'userdata'),
      LWTREE_LIBRARY: library,
      LWTREE_SAVES: join(work, 'SaveData'),
      LWTREE_UPDATE_URL: '',
    }),
  })
  const page = await app.firstWindow()
  await page.evaluate(() => localStorage.setItem('lwtree.helpSeen.v1', '1'))
  await page.reload()
  await page.getByRole('button', { name: 'Tools' }).click()
  return page
}

test('mods live in the library folder: added there, found there, choices beside them', async () => {
  const work = mkdtempSync(join(tmpdir(), 'lwtree-lib-'))
  const library = join(work, 'Long War Tech Tree')
  const page = await launch(work, library)
  await expect(page.getByText(library, { exact: false }).first()).toBeVisible()

  // Added in the app: the script goes into Mods as it is.
  const file = join(work, 'Faster.txt')
  writeFileSync(file, script('Faster Things'))
  await page.locator('input[type="file"][accept=".txt"]').setInputFiles(file)
  await expect(page.getByRole('article', { name: 'Faster Things' })).toBeVisible()
  expect(readFileSync(join(library, 'Mods', 'Faster.txt'), 'utf8')).toBe(script('Faster Things'))

  // Ticked: the choice is in settings.json.
  await page.getByRole('checkbox', { name: 'Install Faster.txt' }).check()
  await expect
    .poll(() => {
      const p = join(library, 'settings.json')
      return existsSync(p) && JSON.parse(readFileSync(p, 'utf8')).mods['Faster.txt']?.wanted
    })
    .toEqual({ 'Faster.txt': true })

  // Copied in by hand: it turns up when the app comes back to the front.
  mkdirSync(join(library, 'Mods', 'Hand Copied'), { recursive: true })
  writeFileSync(join(library, 'Mods', 'Hand Copied', 'Thing.txt'), script('Hand Copied Thing'))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('article', { name: 'Hand Copied' })).toBeVisible()

  // Removed: gone from the list, and from Mods (to the recycle bin).
  await page.getByRole('button', { name: 'Remove Faster Things' }).click()
  await expect(page.getByRole('article', { name: 'Faster Things' })).toHaveCount(0)
  expect(existsSync(join(library, 'Mods', 'Faster.txt'))).toBe(false)
  const s = JSON.parse(readFileSync(join(library, 'settings.json'), 'utf8'))
  expect(s.mods['Faster.txt']).toBeUndefined()
  expect(s.order).toEqual(['Hand Copied'])
})

test('mods kept in the app by 0.2 move into the library folder once', async () => {
  const work = mkdtempSync(join(tmpdir(), 'lwtree-lib-'))
  const library = join(work, 'Long War Tech Tree')
  const page = await launch(work, library)
  // As 0.2 kept them: IndexedDB "lwtree", stores "mods" and "state".
  await page.evaluate(
    async ([one, two]) => {
      const db = await new Promise<IDBDatabase>((ok, fail) => {
        const r = indexedDB.open('lwtree', 3)
        r.onsuccess = () => ok(r.result)
        r.onerror = () => fail(r.error)
      })
      const put = (store: string, value: unknown, key: string) =>
        new Promise((ok, fail) => {
          const r = db.transaction(store, 'readwrite').objectStore(store).put(value, key)
          r.onsuccess = ok
          r.onerror = () => fail(r.error)
        })
      const blob = (t: string) => new Blob([t])
      await put(
        'mods',
        {
          id: 'a',
          name: 'Old Script',
          addedAt: 1,
          values: { 'Old.txt': { SPEED: '3' } },
          wanted: { 'Old.txt': true },
          files: [{ path: 'Old.txt', size: one!.length, kind: 'script', data: blob(one!) }],
        },
        'a',
      )
      await put(
        'mods',
        {
          id: 'b',
          name: 'Old Folder',
          addedAt: 2,
          values: {},
          wantFiles: true,
          files: [
            { path: 'Mod.txt', size: two!.length, kind: 'script', data: blob(two!) },
            { path: 'Config/DefaultThing.ini', size: 6, kind: 'config', data: blob('[A]\nB=1') },
          ],
        },
        'b',
      )
      await put(
        'state',
        [
          {
            section: 'XComGame.XGTacticalGameCore',
            key: 'NUM_STARTING_SOLDIERS',
            occurrence: 0,
            value: '8',
          },
        ],
        'settings',
      )
    },
    [script('Old Script'), script('Old Folder Script')],
  )
  await page.reload()
  await page.getByRole('button', { name: 'Tools' }).click()
  await expect(page.getByRole('article', { name: 'Old Script' })).toBeVisible()
  await expect(page.getByRole('article', { name: 'Old Folder' })).toBeVisible()

  expect(readFileSync(join(library, 'Mods', 'Old.txt'), 'utf8')).toBe(script('Old Script'))
  expect(
    readFileSync(join(library, 'Mods', 'Old Folder', 'Config', 'DefaultThing.ini'), 'utf8'),
  ).toBe('[A]\nB=1')
  const s = JSON.parse(readFileSync(join(library, 'settings.json'), 'utf8'))
  expect(s.order).toEqual(['Old.txt', 'Old Folder'])
  expect(s.mods['Old.txt']).toEqual({
    values: { 'Old.txt': { SPEED: '3' } },
    wanted: { 'Old.txt': true },
  })
  expect(s.mods['Old Folder'].wantFiles).toBe(true)
  expect(s.ini[0].value).toBe('8')

  // Once: IndexedDB no longer has them, so a second start adds nothing twice.
  await page.reload()
  await page.getByRole('button', { name: 'Tools' }).click()
  await expect(page.getByRole('article', { name: 'Old Script' })).toHaveCount(1)
  expect(existsSync(join(library, 'Mods', 'Old (2).txt'))).toBe(false)
})
