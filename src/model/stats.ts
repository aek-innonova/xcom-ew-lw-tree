// Campaign statistics, including Long War's hidden counters.
//
// Long War keeps three counters the game does not show in reused
// end-of-campaign statistics (XGRecapSaveData). Their meaning is inferred from
// how they move across about 1,700 saves of 46 campaigns:
// - "Score" starts at −90 in every campaign, the INI's "initial alien bonus
//   research", and climbs about a point every two days: alien bonus research,
//   which starts to count once it is above zero.
// - "FundingCountries" rises at each month start and drops by 5–6 with every
//   UFO shot down or mission won: alien resources.
// - "ContinentBonuses" resets to zero at each month start and climbs with each
//   XCOM success: XCOM's threat level this month.

import type { Campaign } from '@/save/campaign'

export interface CampaignStats {
  days?: number
  alienResources?: number
  xcomThreat?: number
  alienBonusResearch?: number
  missions?: number
  missionsWon?: number
  aliensKilled?: number
  ufosShotDown?: number
  soldiersLost?: number
  satellites: number
  foundryDone: number
}

export function campaignStats(c: Campaign): CampaignStats {
  const r = c.recap ?? {}
  return {
    days: r.Days,
    alienResources: r.FundingCountries,
    xcomThreat: r.ContinentBonuses,
    alienBonusResearch: r.Score,
    missions: r.Missions,
    missionsWon: r.MissionsWon,
    aliensKilled: r.AliensKilled,
    ufosShotDown: r.UFOsShotDown,
    soldiersLost: r.SoldiersLost,
    satellites: (c.satelliteCountries ?? []).length,
    foundryDone: (c.foundryHistory ?? []).filter((v, i) => i > 0 && v).length,
  }
}
