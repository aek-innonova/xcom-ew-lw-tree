// Removes the scratch folders this run's tests leave in the temp folder
// (scripts/tmp-sweep.mjs), when the run ends.
// @ts-expect-error a plain .mjs script, no types
import { sweepLater } from '../scripts/tmp-sweep.mjs'

export default function setup(): () => void {
  return sweepLater()
}
