// The desktop app's updates as the page shows them (features/desktop-updates.md):
// the shell checks, downloads and verifies; the page says what is ready, in
// one place (Help, "This app", opened from the header's update mark), and
// says at once what a click does: downloading, installing, restarting. After
// a restart into something new, it says what changed.

import { computed, reactive } from 'vue'
import { desktop, type BundleState } from './desktop'
import { state } from './store'

export const updates = reactive({
  state: null as BundleState | null,
  /** What a click set going: the page says so until the app closes or reloads. */
  phase: 'idle' as 'idle' | 'restarting' | 'fetching-app' | 'installing-app',
  error: null as string | null,
})

/** Something to take: a newer site ready, or a newer app out. */
export const updateAvailable = computed(() => {
  const s = updates.state
  return s ? !!s.ready || !!s.shell : false
})

const SEEN = 'lwtree.versionsSeen.v1'

/** At start: tell the shell this bundle works, follow its update state, say what is new. */
export async function startUpdates(): Promise<void> {
  const b = desktop?.bundle
  if (!b) return
  b.onState((s) => (updates.state = s))
  updates.state = await b.state()
  sayWhatIsNew(updates.state)
  // The page came up: the bundle it runs is good (an update that never says
  // so is rolled back at the next start). Its tidying can fail on a file the
  // installer still holds (just after an update); that is no reason to stop.
  await b.good().catch(() => undefined)
}

/** "Updated to app 0.3.6", "Now on site 2026.1020…": once, after a restart into it. */
function sayWhatIsNew(s: BundleState | null) {
  if (!s) return
  let seen: { shell?: string; site?: string } = {}
  try {
    seen = JSON.parse(localStorage.getItem(SEEN) ?? '{}')
  } catch {
    // none yet
  }
  const parts: string[] = []
  if (seen.shell && seen.shell !== s.shellVersion) parts.push(`app ${s.shellVersion}`)
  if (seen.site && seen.site !== s.serving) parts.push(`site ${s.serving}`)
  if (parts.length)
    state.message = { kind: 'info', text: `Updated: now on ${parts.join(' and ')}.` }
  try {
    localStorage.setItem(SEEN, JSON.stringify({ shell: s.shellVersion, site: s.serving }))
  } catch {
    // private mode: said again next time
  }
}

export const checkForUpdates = async () => {
  const b = desktop?.bundle
  updates.error = null
  if (b) updates.state = await b.check()
}

/** Into the newer site: the page reloads into it. */
export async function restartIntoUpdate() {
  updates.phase = 'restarting'
  const ok = await desktop?.bundle?.restart()
  if (!ok) {
    updates.phase = 'idle'
    updates.error = 'The new site could not be started; the current one stays.'
  }
}

/**
 * Installs the newer app: fetched first if it is not yet (an older shell
 * fetches only now), then the app closes, installs and starts again.
 */
export async function installNewApp() {
  const s = updates.state?.shell
  if (!s || updates.phase !== 'idle') return
  updates.error = null
  updates.phase = s.downloaded ? 'installing-app' : 'fetching-app'
  try {
    const ok = await desktop?.bundle?.installShell()
    if (ok === false) throw new Error('the new app could not be fetched')
    updates.phase = 'installing-app'
  } catch (e) {
    updates.phase = 'idle'
    updates.error = `The new app could not be installed: ${(e as Error).message}`
  }
}
