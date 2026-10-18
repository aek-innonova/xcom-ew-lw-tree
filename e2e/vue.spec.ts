import { test, expect } from '@playwright/test'

test('shows the tree and the privacy note', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('lwtree.helpSeen.v1', '1'))
  await page.goto('/')
  await expect(page.locator('h1')).toContainText('Long War')
  await expect(page.locator('[data-tech]')).toHaveCount(75)
  await expect(page.locator('.privacy')).toContainText('never uploaded')
})

test('help opens on a first visit, closes, and stays closed after a reload', async ({ page }) => {
  await page.goto('/')
  const help = page.getByRole('dialog', { name: 'How this works' })
  await expect(help).toBeVisible()
  await expect(help).toContainText('XComGame\\SaveData')
  await page.keyboard.press('Escape')
  await expect(help).toBeHidden()
  await page.reload()
  await expect(page.locator('[data-tech]')).toHaveCount(75)
  await expect(help).toBeHidden()
  await page.getByRole('button', { name: 'Help', exact: true }).click()
  await expect(help).toBeVisible()
})
