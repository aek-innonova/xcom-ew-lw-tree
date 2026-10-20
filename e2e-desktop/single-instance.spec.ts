import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

// One app at a time per profile: a second start on the same profile ends at
// once, and the first window carries on (the bench had two windows on one
// profile disagreeing about which save was loaded).

const root = resolve(import.meta.dirname, '..')
const electronBin = join(
  root,
  'desktop/node_modules/electron/dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron',
)

test('a second start on the same profile leaves the first window alone', async () => {
  const work = mkdtempSync(join(tmpdir(), 'lwtree-one-'))
  const env: Record<string, string | undefined> = {
    ...process.env,
    LWTREE_SITE: join(root, 'dist'),
    LWTREE_USER_DATA: join(work, 'userdata'),
    LWTREE_LIBRARY: join(work, 'library'),
    LWTREE_CACHE: join(work, 'cache'),
    LWTREE_SAVES: join(work, 'SaveData'),
    LWTREE_UPDATE_URL: '',
  }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({
    executablePath: electronBin,
    args: [join(root, 'desktop')],
    env: env as Record<string, string>,
  })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('h1')).toContainText('Long War')

    const second = spawn(electronBin, [join(root, 'desktop')], { env, stdio: 'ignore' })
    const code = await new Promise<number | null>((done, fail) => {
      const timer = setTimeout(() => {
        second.kill()
        fail(new Error('the second start did not end'))
      }, 15_000)
      second.on('exit', (c) => {
        clearTimeout(timer)
        done(c)
      })
    })
    expect(code).toBe(0)
    expect(app.windows()).toHaveLength(1)
    await expect(page.locator('h1')).toContainText('Long War')
  } finally {
    await app.close()
  }
})
