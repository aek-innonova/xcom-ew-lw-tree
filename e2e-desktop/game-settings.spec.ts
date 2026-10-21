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
    'ROOKIE_MOBILITY=104\t\t\t; xxyy: xx = Point cost for defense; yy = Point cost for mobility',
    'ROOKIE_STARTING_WILL=301\t\t; xxyy: xx = Point cost for hit points; yy = Point cost for will',
    'PSI_GIFT_CHANCE=0.45\t\t; Chance of successful training if soldier Will equals the target',
    `HQ_BASE_POWER = ${color}\t\t\t; Sniper Color`,
    'Weapons=( strName="", iType=eItem_ArcThrower,  Properties[5]=0,        iRange=27 )',
    ';Weapons=( strName="", iType=eItem_ArcThrower,  Properties[5]=eWP_Pistol,iRange=27 );',
    '; Arc Thrower',
    'Itembalance_Normal=(eItem=eItem_ArcThrower,\t\tiCash=100,\tiElerium=0,\tiAlloys=0,\tiTime=10,\tiEng=20)',
    'BalanceMods_Classic=(eType=73,\t\t\t\tiDamage=0,\tiHP=0,\tiMobility=-2,\tiWill=40);',
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
  // Kept by an earlier app: HP and will costs as one setting (xxyy), 305: HP
  // 3 as Long War has it, will 5.
  mkdirSync(library)
  writeFileSync(
    join(library, 'settings.json'),
    JSON.stringify({
      order: [],
      mods: {},
      ini: [],
      game: { lw: { 'rookie.cost-hp-will': '305' } },
    }),
  )
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
  await expect(hand).toContainText('Soldier stats: Base HP 4 → 5')
  // The older settings.json is in its new shape on disk before anything is changed.
  expect(JSON.parse(readFileSync(join(library, 'settings.json'), 'utf8')).versions.lw).toBeTruthy()
  await hand.getByRole('button', { name: 'Keep them as settings' }).click()
  await expect(hand).toHaveCount(0)
  // Kept for Long War, the version installed.
  const settings = () =>
    JSON.parse(readFileSync(join(library, 'settings.json'), 'utf8')).versions.lw.game
  // The old combined value came back as its one changed half.
  expect(settings()).toEqual({ 'soldier.hp': '5', 'rookie.cost-will': '5' })

  // The Tools page scrolls inside itself: nothing in it makes the window's page taller
  // (the class table's hidden labels once did, and the whole app scrolled away).
  await expect(page.getByRole('button', { name: 'Show Sniper on the soldier' })).toBeVisible()
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight),
  ).toBeLessThanOrEqual(0)

  // In words: the starting soldiers, the pistol slot, the sniper's color.
  await page.getByRole('spinbutton', { name: 'Soldiers at the start' }).fill('60')
  await page.getByRole('spinbutton', { name: 'Soldiers at the start' }).press('Enter')
  await page.getByLabel('In the pistol slot', { exact: true }).check()
  await page.getByRole('spinbutton', { name: 'Sniper color' }).fill('16')
  await page.getByRole('spinbutton', { name: 'Sniper color' }).press('Enter')
  // Long War's two point costs in one value: each its own setting, the
  // other half kept; a fraction as a percentage.
  const mobility = page.getByRole('spinbutton', { name: 'Point cost of mobility' })
  await expect(mobility).toHaveValue('4')
  await expect(page.getByRole('spinbutton', { name: 'Point cost of will' })).toHaveValue('5')
  await mobility.fill('6')
  await mobility.press('Enter')
  const gift = page.getByRole('spinbutton', { name: 'Chance of the psi gift' })
  await expect(gift).toHaveValue('45')
  await gift.fill('25')
  await gift.press('Enter')
  // Beside each of the player's values in the stats table, the version's own:
  // base HP's and the mobility cost's are both 4.
  await expect(page.getByText('was 4', { exact: true })).toHaveCount(2)
  await expect(
    page.getByRole('button', { name: 'Undo the change: Point cost of mobility' }),
  ).toHaveAttribute('title', 'Back to the original the app kept: 4')
  // An item's card: the arc thrower's cost to build, and its mobility carried.
  const items = page.locator('details[aria-label="Items"]')
  await items.evaluate((d) => ((d as HTMLDetailsElement).open = true))
  await items.getByRole('button', { name: 'Arc Thrower', exact: true }).click()
  const card = items.getByRole('article', { name: 'Arc Thrower' })
  await expect(card.getByRole('spinbutton', { name: 'Mobility', exact: true })).toHaveValue('-2')
  await card.getByRole('spinbutton', { name: 'Credits', exact: true }).fill('120')
  await card.getByRole('spinbutton', { name: 'Credits', exact: true }).press('Enter')
  await expect.poll(settings).toEqual({
    'soldier.hp': '5',
    'campaign.starting-soldiers': '60',
    'arcthrower.pistol': 'on',
    'class.sniper.color': '16',
    'rookie.cost-will': '5',
    'rookie.cost-mobility': '6',
    'psi.gift': '0.25',
    'item.73.cost': '120',
  })

  // Saved by name from the setup bar, changed, and back again (features/game-setups.md).
  const bar = page.getByRole('region', { name: 'Setup' })
  const pick = bar.getByRole('combobox', { name: 'Setup' })
  const saveAs = async (name: string) => {
    await pick.selectOption({ label: 'Save as a new setup…' })
    const field = bar.getByLabel('Name for this setup')
    // A name is offered: what is set (the setups are the version's own).
    await expect(field).toHaveValue(/^\d+ settings?$/)
    await field.fill(name)
    await bar.getByRole('button', { name: 'Save', exact: true }).click()
  }
  const start = page.getByRole('spinbutton', { name: 'Soldiers at the start' })
  await saveAs('Sixty')
  await expect(bar.getByText('in use')).toBeVisible()
  await start.fill('70')
  await start.press('Enter')
  await expect(bar.getByText('changed since saved')).toBeVisible()
  await saveAs('Seventy')
  await pick.selectOption('Sixty')
  await expect(start).toHaveValue('60')
  // Unsaved choices are not lost without asking.
  await start.fill('65')
  await start.press('Enter')
  await pick.selectOption('Seventy')
  await expect(bar).toContainText('The current choices are not saved.')
  await bar.getByRole('button', { name: 'Switch to Seventy' }).click()
  await expect(start).toHaveValue('70')
  await pick.selectOption('Sixty')
  await expect(start).toHaveValue('60')
  await expect(bar.getByText('in use')).toBeVisible()
  const saved = JSON.parse(readFileSync(join(library, 'settings.json'), 'utf8')).versions.lw.setups
  expect(Object.keys(saved).sort()).toEqual(['Seventy', 'Sixty'])
  expect(saved.Seventy.game['campaign.starting-soldiers']).toBe('70')

  await page.getByRole('button', { name: 'Apply the setup…' }).click()
  const plan = page.getByRole('region', { name: 'What will change' })
  await expect(plan).toContainText('8 game settings')
  await plan.getByRole('button', { name: 'Write these changes' }).click()
  await expect(page.getByRole('region', { name: 'What will change' })).toContainText(
    'Wrote Config/DefaultGameCore.ini',
  )
  expect(readFileSync(join(game, 'Config', 'DefaultGameCore.ini'), 'latin1')).toBe(
    ini('5', '16')
      .replace('NUM_STARTING_SOLDIERS=40', 'NUM_STARTING_SOLDIERS=60')
      .replace('ROOKIE_MOBILITY=104', 'ROOKIE_MOBILITY=106')
      .replace('ROOKIE_STARTING_WILL=301', 'ROOKIE_STARTING_WILL=305')
      .replace('iCash=100,', 'iCash=120,')
      .replace('PSI_GIFT_CHANCE=0.45', 'PSI_GIFT_CHANCE=0.25')
      .replace(
        '\nWeapons=( strName="", iType=eItem_ArcThrower,  Properties[5]=0,',
        '\n;Weapons=( strName="", iType=eItem_ArcThrower,  Properties[5]=0,',
      )
      .replace(
        ';Weapons=( strName="", iType=eItem_ArcThrower,  Properties[5]=eWP_Pistol',
        'Weapons=( strName="", iType=eItem_ArcThrower,  Properties[5]=eWP_Pistol',
      ),
  )

  // Played with, then back (features/game-setups.md): the changes to the
  // setup undone, or the choices set to what the game has, which then
  // changes nothing.
  await plan.getByRole('button', { name: 'Close' }).click()
  await start.fill('99')
  await start.press('Enter')
  await pick.selectOption({ label: 'Undo my changes to Sixty' })
  await expect(start).toHaveValue('60')
  await start.fill('99')
  await start.press('Enter')
  await pick.selectOption({ label: 'Back to what the game has now…' })
  await bar.getByRole('button', { name: 'Use what the game has' }).click()
  await expect(bar).toContainText('Now what the game has')
  await expect(start).toHaveValue('60')
  await page.getByRole('button', { name: 'Apply the setup…' }).click()
  await expect(plan).toContainText('Nothing to change')
})

test('in LWR the class colours are LWR’s own: shown, not edited; headgear stays yours', async () => {
  const work = mkdtempSync(join(tmpdir(), 'lwtree-gs-'))
  const steam = join(work, 'XCom-Enemy-Unknown')
  const game = join(steam, 'XEW', 'XComGame')
  for (const d of ['CookedPCConsole', 'Config']) mkdirSync(join(game, d), { recursive: true })
  writeFileSync(join(game, 'CookedPCConsole', 'LongWar.upk'), 'x')
  writeFileSync(join(game, 'CookedPCConsole', 'LWRebalance.u'), 'x')
  writeFileSync(
    join(game, 'Config', 'DefaultGameCore.ini'),
    [
      '[XComGame.XGTacticalGameCore]',
      'HQ_BASE_POWER = 32\t\t\t; Sniper Color',
      'HQ_BASE_POWER = 3\t\t\t; Sniper Headgear',
      'SOLDIER_COST_CLASSIC=1\t\t; (LWR Default = 1) Set to 1 to have the tint of armors change to hardcoded values on LCPL promotions, Set to 0 to use the SPEC armor tint changes defined in this dgc.ini only',
      '',
    ].join('\r\n'),
  )
  app = await electron.launch({
    executablePath: electronBin,
    args: [join(root, 'desktop'), `--game-dir=${steam}`],
    env: env({
      LWTREE_SITE: join(root, 'dist'),
      LWTREE_USER_DATA: join(work, 'userdata'),
      LWTREE_LIBRARY: join(work, 'library'),
      LWTREE_CACHE: join(work, 'cache'),
      LWTREE_SAVES: join(work, 'SaveData'),
      LWTREE_UPDATE_URL: '',
    }),
  })
  const page = await app.firstWindow()
  await page.evaluate(() => localStorage.setItem('lwtree.helpSeen.v1', '1'))
  await page.reload()
  await page.getByRole('button', { name: 'Tools' }).click()

  const looks = page.locator('details[aria-label="Class colors"]')
  await expect(looks.getByRole('button', { name: 'Show Sniper on the soldier' })).toBeVisible()
  await expect(looks).toContainText('LWR sets each class’s colour itself')
  // LWR's Sniper colour (6), not the INI's, and nothing to edit it with.
  await expect(looks.getByText('LWR’s own')).toBeVisible()
  await expect(looks.getByLabel('Sniper color', { exact: true })).toHaveCount(0)
  // A perk's colour on the soldier, on request.
  const perk = looks.getByRole('button', { name: 'Show Sniper with In The Zone on the soldier' })
  await perk.click()
  await expect(perk).toHaveAttribute('aria-pressed', 'true')
  // The option handing the colours back to the INI is not on the card.
  await expect(looks.getByText('Armor colors on promotion to Lance Corporal')).toHaveCount(0)
  // The headgear is still the player's.
  await expect(looks.getByRole('spinbutton', { name: 'Sniper headgear' })).toBeEditable()
})
