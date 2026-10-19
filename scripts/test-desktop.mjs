// Run the desktop app's tests (features/windows-test-env.md): the Node tests
// of desktop/src, then the Playwright Electron tests. One launcher so the
// suite runs the same on Windows and on Linux. The only platform difference is
// the display: Linux has no screen, so Playwright's Electron run goes under
// xvfb-run; Windows (and the VM's desktop session) has one.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const win = process.platform === 'win32'

// shell:true so Windows can run npm.cmd / npx.cmd (Node refuses to spawn .cmd
// files directly), and so xvfb-run is found on Linux.
function run(command, cwd) {
  const r = spawnSync(command, { cwd, stdio: 'inherit', shell: true })
  if (r.status !== 0) {
    if (r.error) console.error(r.error.message)
    process.exit(r.status ?? 1)
  }
}

// The app's own Node tests (finder, vdf/registry parsing, confinement, writes).
run('npm run build', path.join(root, 'desktop'))
run('npm test', path.join(root, 'desktop'))

// The Playwright Electron tests, over a built site and the compiled app.
const pw = 'playwright test -c playwright.desktop.config.ts'
run(win ? `npx ${pw}` : `xvfb-run -a npx ${pw}`, root)
