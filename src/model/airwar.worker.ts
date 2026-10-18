// Runs air war odds off the page's thread (AirWarView): thousands of simulated
// fights per change would otherwise stall the screen for a moment.

import { runJobs, type OddsRequest } from './airwar'

self.onmessage = (e: MessageEvent<OddsRequest>) => {
  self.postMessage(runJobs(e.data))
}
