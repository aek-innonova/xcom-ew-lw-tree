import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'

test('shows the tree and the privacy note', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('lwtree.helpSeen.v1', '1'))
  await page.goto('/')
  await expect(page.locator('h1')).toContainText('Long War')
  await expect(page.locator('[data-tech]')).toHaveCount(75)
  await expect(page.locator('.privacy')).toContainText('Nothing is uploaded')
})

test('help waits on a first visit: its button glows until it is opened once', async ({ page }) => {
  await page.goto('/')
  const help = page.getByRole('dialog', { name: 'How this works' })
  const button = page.getByRole('button', { name: 'Help', exact: true })
  await expect(page.locator('[data-tech]')).toHaveCount(75)
  await expect(help).toBeHidden()
  await expect(button).toHaveClass(/\bnew\b/)
  await button.click()
  await expect(help).toBeVisible()
  await expect(help).toContainText('XComGame\\SaveData')
  await page.keyboard.press('Escape')
  await expect(help).toBeHidden()
  await expect(button).not.toHaveClass(/\bnew\b/)
  await page.reload()
  await expect(page.locator('[data-tech]')).toHaveCount(75)
  await expect(button).not.toHaveClass(/\bnew\b/)
})

test('switches to Long War Rebalanced: its tree, and back', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('lwtree.helpSeen.v1', '1'))
  await page.goto('/')
  await expect(page.locator('[data-tech]')).toHaveCount(75)
  await page.getByLabel('Game version').selectOption('lwr')
  await expect(page.locator('[data-tech]')).toHaveCount(68)
  await expect(page.getByText('Light Plasma Weapons')).toBeVisible()
  await expect(page.locator('footer')).toContainText('Long War Rebalanced')
  await page.reload()
  await expect(page.locator('[data-tech]')).toHaveCount(68)
  await page.getByLabel('Game version').selectOption('lw')
  await expect(page.locator('[data-tech]')).toHaveCount(75)
})

test('the researching link shows the tech, and leaves a view alone that already shows it', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('lwtree.helpSeen.v1', '1'))
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/')
  await page
    .locator('input[type=file]:not([accept]):not([multiple]):not([webkitdirectory])')
    .setInputFiles(resolve(import.meta.dirname, '../fixtures/saves/save1762'))
  const board = page.locator('svg.canvas > g').first()
  await expect(board).toHaveAttribute('transform', /translate/)
  const link = page.locator('.campaign button[title="Show it on the research tree"]')
  // From another view: back on the tree, the tech selected.
  await page.getByRole('tab', { name: 'Foundry' }).click()
  await link.click()
  await expect(page.getByRole('tab', { name: 'Research' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('region', { name: 'Selected tech' })).toContainText('Xenobiology')
  // The fitted tree showed it already: still fitted (to the space beside the
  // detail), not scrolled to centre it.
  const shown = await board.getAttribute('transform')
  await page.getByRole('button', { name: 'Fit', exact: true }).click()
  await expect(board).toHaveAttribute('transform', shown!)
})

test('the desktop app page: what it adds in screenshots, the download, the credits', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('lwtree.helpSeen.v1', '1'))
  await page.goto('/')
  await page.getByRole('button', { name: 'Desktop app' }).click()
  const app = page.getByRole('region', { name: 'The desktop app' })
  await expect(app.getByRole('heading', { name: 'The desktop app' })).toBeVisible()
  // Every screenshot is there and loads.
  const shots = app.locator('img')
  await expect(shots).toHaveCount(7)
  for (const img of await shots.all()) {
    await img.scrollIntoViewIfNeeded()
    await expect
      .poll(() => img.evaluate((i) => (i as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0)
  }
  // Credits, with links; and the disclaimer.
  await expect(app.getByRole('link', { name: 'Long War', exact: true })).toHaveAttribute(
    'href',
    'https://www.nexusmods.com/xcom/mods/88',
  )
  await expect(app.getByRole('link', { name: 'Long War Rebalance' })).toHaveAttribute(
    'href',
    'https://www.nexusmods.com/xcom/mods/686',
  )
  await expect(app).toContainText('not affiliated with or endorsed by Firaxis Games or 2K')
  await expect(page.locator('footer')).toContainText('not affiliated with Firaxis or 2K')
  // Help points to it.
  await page.getByRole('button', { name: 'Help', exact: true }).click()
  await page.getByRole('button', { name: 'What it does, and the download' }).click()
  await expect(app).toBeVisible()
})
