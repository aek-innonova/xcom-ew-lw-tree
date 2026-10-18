import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

// The Tools page against a game folder made in the origin-private file
// system (the folder picker is a native dialog): an LWR install's markers, an
// INI, and a made-up mod script with one option.

const SCRIPT = `MOD_NAME=Test Mod
AUTHOR=nobody
DESCRIPTION=Changes nothing; for the test.

UPK_FILE=XComGame.upk
OBJECT=XGUnit.RecordKill:AUTO

// How many days: a test option
ALIAS=Days:<%b 9>

[REPLACEMENT_CODE]
04 0B 53
`

async function makeInstall(page: Page) {
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const steam = await root.getDirectoryHandle('XCom-Enemy-Unknown', { create: true })
    const game = await (
      await steam.getDirectoryHandle('XEW', { create: true })
    ).getDirectoryHandle('XComGame', { create: true })
    const cooked = await game.getDirectoryHandle('CookedPCConsole', { create: true })
    for (const name of ['LongWar.upk', 'LWRebalance.u']) {
      const w = await (await cooked.getFileHandle(name, { create: true })).createWritable()
      await w.write('x')
      await w.close()
    }
    const config = await game.getDirectoryHandle('Config', { create: true })
    const w = await (
      await config.getFileHandle('DefaultGameCore.ini', { create: true })
    ).createWritable()
    await w.write(
      '[XComGame.XGTacticalGameCore]\r\n; How many soldiers XCOM starts with\r\nNUM_STARTING_SOLDIERS=12\r\nTechBalance=(eTech=eTech_Xenobiology, iTime=7, iAlloys=1, iElerium=2, iNumFragments=3, iNumItems=6)\r\n',
    )
    await w.close()
  })
}

// eslint-disable-next-line playwright/no-skipped-test -- the API exists only in Chromium browsers
test.skip(({ browserName }) => browserName !== 'chromium', 'File System Access is Chromium-only')

test('tools: reads the install, follows its version, keeps mods and their options', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('lwtree.helpSeen.v1', '1')
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      return (await root.getDirectoryHandle('XCom-Enemy-Unknown')) as never
    }
  })
  await page.goto('/')
  await makeInstall(page)
  await page.getByRole('button', { name: 'Tools' }).click()
  await page.getByRole('button', { name: 'Pick the game folder' }).click()

  await expect(page.getByText('XCom-Enemy-Unknown/XEW/XComGame', { exact: true })).toBeVisible()
  await expect(page.locator('.facts')).toContainText('Long War Rebalanced 2.06')
  await expect(page.getByLabel('Game version')).toHaveValue('lwr')
  await expect(page.locator('.facts')).toContainText('DefaultGameCore.ini loaded')

  await page.locator('input[type=file][accept=".txt"]').setInputFiles({
    name: 'TestMod.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(SCRIPT),
  })
  const mod = page.getByRole('article', { name: 'Test Mod' })
  await expect(mod).toContainText('by nobody')
  // The fake install has no XComGame.upk.
  await expect(mod).toContainText('XComGame.upk is not in this install')
  await mod.getByLabel('Days').fill('12')
  await mod.getByLabel('Days').press('Enter')
  // Kept in IndexedDB; wait for the write before reloading.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<string | undefined>((done) => {
            const req = indexedDB.open('lwtree')
            req.onsuccess = () => {
              const all = req.result.transaction('mods').objectStore('mods').getAll()
              all.onsuccess = () =>
                done(
                  (all.result as { values: Record<string, Record<string, string>> }[])[0]?.values[
                    'TestMod.txt'
                  ]?.Days,
                )
            }
          }),
      ),
    )
    .toBe('12')

  // All of it is still there after a reload.
  await page.reload()
  await page.getByRole('button', { name: 'Tools' }).click()
  await expect(page.locator('.facts')).toContainText('Long War Rebalanced 2.06')
  await expect(page.getByRole('article', { name: 'Test Mod' }).getByLabel('Days')).toHaveValue('12')

  await page.getByRole('button', { name: 'Remove Test Mod' }).click()
  await expect(page.getByText('No mods yet.')).toBeVisible()
})

/** A file in the fake install, as text (null if absent). */
const readInstalled = (page: Page, path: string) =>
  page.evaluate(async (path) => {
    let d = await (await navigator.storage.getDirectory()).getDirectoryHandle('XCom-Enemy-Unknown')
    const parts = ['XEW', 'XComGame', ...path.split('/')]
    try {
      for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p)
      return await (await (await d.getFileHandle(parts[parts.length - 1]!)).getFile()).text()
    } catch {
      return null
    }
  }, path)

test('tools: a setting and a mod’s files into the game, the originals kept, and put back', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('lwtree.helpSeen.v1', '1')
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      return (await root.getDirectoryHandle('XCom-Enemy-Unknown')) as never
    }
  })
  await page.goto('/')
  await makeInstall(page)
  await page.getByRole('button', { name: 'Tools' }).click()
  await page.getByRole('button', { name: 'Pick the game folder' }).click()
  await expect(page.locator('.facts')).toContainText('Long War Rebalanced 2.06')

  // A setting, found by its comment.
  await page.getByLabel('Find a setting').fill('soldiers XCOM')
  await page.getByLabel('Set NUM_STARTING_SOLDIERS').fill('60')
  await page.getByLabel('Set NUM_STARTING_SOLDIERS').press('Enter')
  await expect(page.locator('.settings')).toContainText('in the game now: 12')

  // A mod folder that brings an INI file.
  const modDir = mkdtempSync(join(tmpdir(), 'lwtree-mod-'))
  mkdirSync(join(modDir, 'TestMod'))
  writeFileSync(
    join(modDir, 'TestMod', 'DefaultTestMod.ini'),
    '[TestMod.Settings]\r\nEnabled=true\r\n',
  )
  await page.locator('input[aria-label="Mod folder"]').setInputFiles(join(modDir, 'TestMod'))
  await page.getByLabel("Put TestMod's files into the game").check()

  await page.getByRole('button', { name: 'Apply my setup…' }).click()
  const plan = page.getByRole('region', { name: 'What will change' })
  await expect(plan).toContainText('Config/DefaultGameCore.ini changed')
  await expect(plan).toContainText('(original kept first)')
  await expect(plan).toContainText('Config/DefaultTestMod.ini added')
  await plan.getByRole('button', { name: 'Write these changes' }).click()
  await expect(page.locator('.log')).toContainText('Wrote Config/DefaultGameCore.ini')

  expect(await readInstalled(page, 'Config/DefaultGameCore.ini')).toContain(
    'NUM_STARTING_SOLDIERS=60\r\n',
  )
  expect(await readInstalled(page, 'lwtree-backup/Config/DefaultGameCore.ini')).toContain(
    'NUM_STARTING_SOLDIERS=12\r\n',
  )
  expect(await readInstalled(page, 'Config/DefaultTestMod.ini')).toContain('Enabled=true')
  await expect(page.locator('.settings')).toContainText('in the game now: 60')

  // Nothing more to do; then everything back as it was.
  await page.getByRole('button', { name: 'Apply my setup…' }).click()
  await expect(plan).toContainText('Nothing to change')
  await plan.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: 'Put the originals back…' }).click()
  await expect(plan).toContainText('Config/DefaultTestMod.ini removed')
  await plan.getByRole('button', { name: 'Write these changes' }).click()
  await expect(page.locator('.log')).toContainText('Removed Config/DefaultTestMod.ini')
  expect(await readInstalled(page, 'Config/DefaultGameCore.ini')).toContain(
    'NUM_STARTING_SOLDIERS=12\r\n',
  )
  expect(await readInstalled(page, 'Config/DefaultTestMod.ini')).toBeNull()
})
