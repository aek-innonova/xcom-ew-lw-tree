// The desktop app's installer as the website offers it (deploy/deploy.sh puts
// the newest one in app/, its name in app/LATEST and its checksum in
// app/SHA256SUMS). Asked for once, on the website only.

import { reactive } from 'vue'
import { desktop } from './desktop'

export const APP_DIR = `${import.meta.env.BASE_URL}app/`

export const installer = reactive({
  /** "LongWarTechTree-Setup-0.3.6.exe", or null where there is none to offer. */
  name: null as string | null,
  /** "0.3.6" */
  version: null as string | null,
})

let asked = false
export function findInstaller(): void {
  if (asked || desktop) return
  asked = true
  fetch(`${APP_DIR}LATEST`)
    .then(async (r) => {
      const name = r.ok ? (await r.text()).trim() : ''
      const ok = /^LongWarTechTree-Setup-([\w.-]+)\.exe$/.exec(name)
      installer.name = ok ? name : null
      installer.version = ok ? ok[1]! : null
    })
    .catch(() => (installer.name = null))
}
