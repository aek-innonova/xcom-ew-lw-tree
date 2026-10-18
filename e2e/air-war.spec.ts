import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'

const save = resolve(import.meta.dirname, '../fixtures/saves/save1762')

test('air war: odds for the hangar under each stance, then a fight played out', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('lwtree.helpSeen.v1', '1'))
  await page.goto('/')
  await page.locator('input[type=file]:not([accept]):not([multiple])').setInputFiles(save)
  await expect(page.locator('.campaign')).toBeVisible()
  await page.getByRole('tab', { name: 'Air war' }).click()

  // The odds come back from the worker.
  const headline = page.locator('.headline')
  await expect(headline).toContainText(/\d+%\s*UFO down/)
  const stances = page.getByRole('table', { name: 'Stances for jet 1' })
  await expect(stances.getByRole('row')).toHaveCount(3)

  // Clicking a stance row picks it.
  await stances.getByRole('row', { name: /Defensive/ }).click()
  await expect(
    page.getByRole('group', { name: 'Stance' }).getByRole('button', { name: /Defensive/ }),
  ).toHaveClass(/on/)

  // Free selection: a Firestorm with a Plasma Cannon.
  await page.getByRole('button', { name: 'Anything' }).click()
  await page.getByRole('combobox', { name: 'Jet type' }).selectOption({ label: 'Firestorm' })
  await page.getByRole('combobox', { name: 'Weapon' }).selectOption({ label: 'Plasma Cannon' })
  await expect(page.locator('.leg-odds h3').first()).toContainText('Firestorm, Plasma Cannon')

  // Fly it at double speed until it ends.
  await page.getByRole('button', { name: 'Fly it' }).click()
  const fight = page.getByRole('dialog', { name: 'Air fight' })
  await fight.getByRole('button', { name: '2×' }).click()
  await expect(fight.locator('.result')).toBeVisible({ timeout: 40_000 })
  await expect(fight.locator('.log li').first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(fight).toBeHidden()
})

test('air war in LWR: a squadron flies together, with a difficulty and a fight', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('lwtree.helpSeen.v1', '1'))
  await page.goto('/')
  await page.getByLabel('Game version').selectOption('lwr')
  await page.getByRole('tab', { name: 'Air war' }).click()
  await page.getByRole('button', { name: 'Anything' }).click()

  await expect(page.getByRole('heading', { name: /Squadron: up to 2 jets/ })).toBeVisible()
  await page.getByRole('button', { name: '+ Another jet' }).click()
  await page.getByRole('button', { name: '+ Another jet' }).click()
  // A third jet stays home until a pilot has 8 kills.
  await expect(page.getByText('Stays home: the squadron is 2 jets')).toBeVisible()
  await page.locator('.leg').first().getByLabel('kills').fill('8')
  await expect(page.getByRole('heading', { name: /Squadron: up to 3 jets/ })).toBeVisible()
  await expect(page.getByText(/Stays home/)).toHaveCount(0)

  await page.getByRole('combobox', { name: 'Difficulty' }).selectOption({ label: 'Impossible' })
  await expect(page.locator('.headline')).toContainText(/\d+%\s*UFO down/)
  await expect(page.getByRole('table', { name: 'Stances for jet 3' })).toBeVisible()
  await expect(page.locator('.ufo-card', { hasText: 'Scout' }).first()).toContainText('720 HP')

  await page.getByRole('button', { name: 'Fly it' }).click()
  const fight = page.getByRole('dialog', { name: 'Air fight' })
  await expect(fight.getByRole('heading', { name: /Squadron of 3/ })).toBeVisible()
  await fight.getByRole('button', { name: '2×' }).click()
  await expect(fight.locator('.result')).toBeVisible({ timeout: 40_000 })
  await page.keyboard.press('Escape')
  await expect(fight).toBeHidden()
})
