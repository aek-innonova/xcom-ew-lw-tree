import { fileURLToPath } from 'node:url'
import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'
import viteConfig from './vite.config.ts'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      // (upkit has its own tests and config: npx vitest run in upkit/.)
      exclude: [...configDefaults.exclude, 'e2e/**', 'e2e-desktop/**', 'desktop/**', 'upkit/**'],
      root: fileURLToPath(new URL('./', import.meta.url)),
    },
  }),
)
