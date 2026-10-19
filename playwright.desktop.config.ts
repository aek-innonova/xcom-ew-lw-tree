import { defineConfig } from '@playwright/test'

// The desktop app (desktop/, features/desktop-app.md), driven through
// Playwright's Electron support. Needs the site built (npm run build) and the
// app compiled (cd desktop && npm run build).
export default defineConfig({
  testDir: './e2e-desktop',
  timeout: 60_000,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
})
