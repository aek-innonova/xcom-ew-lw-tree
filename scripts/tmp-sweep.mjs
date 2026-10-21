// The tests' scratch folders (mkdtemp "lwtree-…" in the system's temp
// folder) are left behind by the tests themselves; some hold an unpacked Long
// War (400 MB). A run notes what is there when it starts and removes what it
// added when it ends: 39 GB had piled up by 2026-10-21 and filled the disk.
// Two runs at once would sweep each other's; this box runs one at a time.
import { readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const ours = () => new Set(readdirSync(tmpdir()).filter((n) => n.startsWith('lwtree-')))

/** Notes the scratch folders there now; the function returned removes any added since. */
export function sweepLater() {
  const before = ours()
  return () => {
    for (const n of ours())
      if (!before.has(n)) rmSync(path.join(tmpdir(), n), { recursive: true, force: true })
  }
}
