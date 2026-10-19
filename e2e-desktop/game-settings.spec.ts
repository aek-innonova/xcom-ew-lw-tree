// Game settings in a player's words (features/game-settings.md), through
// the app: hand edits found and kept as settings, then a number, a checkbox
// and a color set and written into DefaultGameCore.ini.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

const root = resolve(import.meta.dirname, '..')
const electronBin = join(
  root,
  'desktop/node_modules/electron/dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron',
)

const ini = (hp: string, color: string) =>
  [
    '[XComGame.XGTacticalGameCore]',
    `Characters=( strName="", iType=eChar_Soldier,    HP=${hp},  Offense=65,  Mobility=13, Will=30, Defense=0 )`,
    'NUM_STARTING_SOLDIERS=40',
    `HQ_BASE_POWER = ${color}\t\t\t; Sniper Color`,
    'Weapons=( strName="", iType=eItem_ArcThrower,  Properties[5]=0,        iRange=27 )',
    ';Weapons=( strName="", iType=eItem_ArcThrower,  Properties[5]=eWP_Pistol,iRange=27 );',
    '',
  ].join('\r\n')

function env(extra: Record<string, string>) {
  const e: Record<string, string | undefined> = { ...process.env, ...extra }
  delete e.ELECTRON_RUN_AS_NODE
  return e
}

let app: ElectronApplication | undefined
test.afterEach(async () => app?.close())

test('game settings: hand edits kept, then set in words and written', async () => {
  const work = mkdtempSync(join(tmpdir(), 'lwtree-gs-'))
  const steam = join(work, 'XCom-Enemy-Unknown')
  const game = join(steam, 'XEW', 'XComGame')
  for (const d of ['CookedPCConsole', 'Config', 'lwtree-backup/Config'])
    mkdirSync(join(game, d), { recursive: true })
  writeFileSync(join(game, 'CookedPCConsole', 'LongWar.upk'), 'x')
  // The original the app kept, and the file since edited by hand (HP 4 → 5).
  writeFileSync(join(game, 'lwtree-backup', 'Config', 'DefaultGameCore.ini'), ini('4', '32'))
  writeFileSync(join(game, 'Config', 'DefaultGameCore.ini'), ini('5', '32'))
  const library = join(work, 'library')
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

  const hand = page.getByRole('region', { name: 'Edits by hand' })
  await expect(hand).toContainText('Soldiers: Base HP 4 → 5')
  await hand.getByRole('button', { name: 'Keep them as my settings' }).click()
  await expect(hand).toHaveCount(0)
  const settings = () => JSON.parse(readFileSync(join(library, 'settings.json'), 'utf8')).game
  expect(settings()).toEqual({ 'soldier.hp': '5' })

  // In words: the starting soldiers, the pistol slot, the sniper's color.
  await page.getByLabel('Soldiers at the start').fill('60')
  await page.getByLabel('Soldiers at the start').press('Enter')
  await page.getByLabel('In the pistol slot').check()
  await page.getByLabel('Sniper color').fill('16')
  await page.getByLabel('Sniper color').press('Enter')
  await expect.poll(settings).toEqual({
    'soldier.hp': '5',
    'campaign.starting-soldiers': '60',
    'arcthrower.pistol': 'on',
    'class.sniper.color': '16',
  })

  await page.getByRole('button', { name: 'Apply my setup…' }).click()
  const plan = page.getByRole('region', { name: 'What will change' })
  await expect(plan).toContainText('4 game settings')
  await plan.getByRole('button', { name: 'Write these changes' }).click()
  await expect(page.locator('.log')).toContainText('Wrote Config/DefaultGameCore.ini')
  expect(readFileSync(join(game, 'Config', 'DefaultGameCore.ini'), 'latin1')).toBe(
    ini('5', '16')
      .replace('NUM_STARTING_SOLDIERS=40', 'NUM_STARTING_SOLDIERS=60')
      .replace(
        '\nWeapons=( strName="", iType=eItem_ArcThrower,  Properties[5]=0,',
        '\n;Weapons=( strName="", iType=eItem_ArcThrower,  Properties[5]=0,',
      )
      .replace(
        ';Weapons=( strName="", iType=eItem_ArcThrower,  Properties[5]=eWP_Pistol',
        'Weapons=( strName="", iType=eItem_ArcThrower,  Properties[5]=eWP_Pistol',
      ),
  )
})
