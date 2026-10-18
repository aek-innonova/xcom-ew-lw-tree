import { test, expect } from '@playwright/test'

test('shows the tree and the privacy note', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('h1')).toContainText('Long War')
  await expect(page.locator('[data-tech]')).toHaveCount(75)
  await expect(page.getByText('never uploaded')).toBeVisible()
})
