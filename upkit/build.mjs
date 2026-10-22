// One file to hand around: the command line bundled (Vite's SSR build: Node's
// own modules stay imports, everything of upkit's goes in). node dist/upkit.mjs …
import { build } from 'vite'

await build({
  configFile: false,
  root: import.meta.dirname,
  logLevel: 'warn',
  build: {
    ssr: 'src/cli.ts',
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node24',
    minify: false,
    rollupOptions: { output: { entryFileNames: 'upkit.mjs' } },
  },
})

// What `natives` notes on natives (ours), beside the bundle.
const { copyFileSync } = await import('node:fs')
copyFileSync(new URL('./notes/natives.md', import.meta.url), new URL('./dist/natives.md', import.meta.url))
