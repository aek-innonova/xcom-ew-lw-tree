import { copyFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'

// Firefox and Safari cannot follow a folder (File System Access); there the
// folder is picked through an ordinary file input, once. Runs in every
// browser: the API is taken away before the page starts.

const saves = resolve(import.meta.dirname, '../fixtures/saves')

test('loads the newest save from a folder picked once, and says why it cannot watch', async ({
  page,
}) => {
  const dir = mkdtempSync(join(tmpdir(), 'lwtree-'))
  const folder = join(dir, 'SaveData')
  mkdirSync(folder)
  ;['save1760', 'save1762', 'save1761'].forEach((name, i) => {
    copyFileSync(resolve(saves, name), join(folder, name))
    const t = new Date(2026, 0, 1, 12, i)
    utimesSync(join(folder, name), t, t)
  })
  writeFileSync(join(folder, 'profile.bin'), 'not a save')

  await page.addInitScript(() => {
    localStorage.setItem('lwtree.helpSeen.v1', '1')
    delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker
  })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Watch save folder' })).toHaveCount(0)
  await page.locator('input[webkitdirectory]').setInputFiles(folder)
  // save1761 is the newest by time, though not by number.
  await expect(page.locator('.loaded')).toContainText('save1761')
  await expect(page.locator('.message')).toContainText('cannot follow a folder')
  rmSync(dir, { recursive: true })
})
