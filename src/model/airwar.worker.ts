// Runs air war odds off the page's thread (AirWarView): thousands of simulated
// fights per change would otherwise stall the screen for a moment.

import { runJobs, type OddsRequest } from './airwar'
import { runSquadJobs, type SquadRequest } from './airwar-lwr'

self.onmessage = (e: MessageEvent<OddsRequest | SquadRequest>) => {
  self.postMessage('squads' in e.data ? runSquadJobs(e.data) : runJobs(e.data))
}
