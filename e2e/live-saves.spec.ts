import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

// The folder picker is a native dialog, so the page is handed a directory from
// its origin-private file system instead: a real FileSystemDirectoryHandle,
// which the test fills with saves the way the game would.

const saves = resolve(import.meta.dirname, '../fixtures/saves')

async function writeSave(page: Page, name: string, bytes: Buffer) {
  await page.evaluate(
    async ({ name, b64 }) => {
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle('SaveData', { create: true })
      const file = await dir.getFileHandle(name, { create: true })
      const w = await file.createWritable()
      await w.write(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))
      await w.close()
    },
    { name, b64: bytes.toString('base64') },
  )
}

// eslint-disable-next-line playwright/no-skipped-test -- the API exists only in Chromium browsers
test.skip(({ browserName }) => browserName !== 'chromium', 'File System Access is Chromium-only')

test('follows the save folder: new saves, a half-written one, and a reload', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lwtree.helpSeen.v1', '1')
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      return (await root.getDirectoryHandle('SaveData', { create: true })) as never
    }
  })
  await page.goto('/')
  await writeSave(page, 'save1760', readFileSync(resolve(saves, 'save1760')))

  await page.getByRole('button', { name: 'Watch save folder' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Watching SaveData' })).toBeVisible()
  await expect(page.locator('.campaign')).toContainText('16 Mar 2016')

  // The game writes the next save.
  await writeSave(page, 'save1761', readFileSync(resolve(saves, 'save1761')))
  await expect(page.locator('.campaign')).toContainText('24 Mar 2016', { timeout: 10_000 })
  // No banner: the header shows the save and when it came in.
  await expect(page.locator('.message')).toHaveCount(0)
  await expect(page.locator('.loaded')).toContainText(/save1761 · \d{2}:\d{2}/)

  // A save caught half-written changes nothing; once complete it loads.
  const full = readFileSync(resolve(saves, 'save1762'))
  await writeSave(page, 'save1762', full.subarray(0, full.length / 2))
  // Nothing to wait for but time: at least one look at the folder must pass.
  // eslint-disable-next-line playwright/no-wait-for-timeout
  await page.waitForTimeout(4000)
  await expect(page.locator('.campaign')).toContainText('24 Mar 2016')
  await writeSave(page, 'save1762', full)
  await expect(page.locator('.campaign')).toContainText('25 Mar 2016', { timeout: 10_000 })

  // The check log has an entry per save, all agreeing with the game.
  await page.getByRole('button', { name: 'Checks' }).click()
  const log = page.getByRole('dialog', { name: 'Checks against the game' })
  await expect(log.locator('tbody tr')).toHaveCount(3)
  // What changed between saves is kept in the log.
  await expect(log).toContainText('researched Alien Weaponry; started Xenobiology')

  // After a reload the folder is picked up again without asking.
  await page.reload()
  await expect(page.getByRole('status').filter({ hasText: 'Watching SaveData' })).toBeVisible()
  await expect(page.locator('.campaign')).toContainText('25 Mar 2016')
})
