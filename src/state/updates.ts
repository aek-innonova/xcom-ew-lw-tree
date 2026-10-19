// The desktop app's updates as the page shows them (features/desktop-updates.md):
// the shell checks, downloads and verifies; the page says when something is
// ready and lets the player restart into it, or install a newer app.

import { reactive } from 'vue'
import { desktop, type BundleState } from './desktop'

export const updates = reactive({
  state: null as BundleState | null,
  /** The player said "later" to this one. */
  dismissed: null as string | null,
})

/** At start: tell the shell this bundle works, and follow its update state. */
export async function startUpdates(): Promise<void> {
  const b = desktop?.bundle
  if (!b) return
  b.onState((s) => (updates.state = s))
  updates.state = await b.state()
  // The page came up: the bundle it runs is good (an update that never says
  // so is rolled back at the next start).
  await b.good()
}

export const checkForUpdates = async () => {
  const b = desktop?.bundle
  if (b) updates.state = await b.check()
}
export const restartIntoUpdate = () => desktop?.bundle?.restart()
export const installNewApp = () => desktop?.bundle?.installShell()
