---
title: Campaign statistics, including the aliens' hidden counters
status: review
priority: 6
dependsOn: [save-parser]
---

## Purpose

Show how the campaign stands beyond research: above all Long War's alien
counters (resources, XCOM threat, alien research), which the game does
not show.

## Report (2026-10-18)

**Where the counters are.** The person uploaded about 1,700 saves of 46
campaigns (`samples/savedata/`, git-ignored). A scan of every number in
every save's one-of-a-kind strategy objects, plus the end-of-campaign
statistics (`XGRecapSaveData.m_aRecapStats`), showed Long War reusing
those statistics for its own counters:
- "Score" starts at −90 in every campaign, which is the INI's "initial
  alien bonus research" (stored in a repurposed
  `INTERCEPTOR_REFUEL_HOURS=-90`), and climbs about a point every two
  days: **alien bonus research**.
- "FundingCountries" rises at each month start and falls by 5–6 with
  every UFO shot down or mission won: **alien resources**.
- "ContinentBonuses" resets to zero at each month start and climbs with
  each XCOM success: **XCOM threat this month**.
The names are inferred from that behaviour; the panel says so.

**What changed.** `campaign.ts` reads the recap statistics;
`src/model/stats.ts`; a "Stats" list in the campaign bar: the three alien
counters, then day of the campaign, missions won, aliens killed, UFOs
shot down, soldiers lost, satellites, Foundry projects done.

**Found on the way.**
- The parser now reads all 1,711 saves (17 failed before, in three runs
  of consecutive saves). The cause was inherited from xcomsave: to guess
  what an array holds it checks whether the bytes after the first element
  form a string, and Long War's `m_arrUnlockedFoundryProjects` (enum
  pairs such as `("eMPMECSTT_MECSuitTemplate8", 2)`) let the number 2 and
  the next length pass as a one-character string. The guess now requires
  text. The oracle comparison still matches.
- Difficulty names were vanilla's; Long War's are Normal, Classic,
  Brutal, Impossible. The fixture campaigns are Classic (their journal
  says so), not Normal as the bar showed.

**Verified.** Unit tests on the fixtures (save1738's counters and
figures; −84 bonus research on day 15 of campaign 56); the scan over all
1,711 saves; the panel on screen.

**Left open.** Alien research itself (as opposed to bonus research) is
said in the INI's comments to be "roughly days passed" plus bonus
research; how they combine is not confirmed, so the panel shows the
parts. A history across saves (a chart of these counters) would come
naturally from the folder watcher; not built.

## Report (2026-10-18, round 2: lost countries)

A council country that has left XCOM has `XGCountry.m_bSecretPact` set
(campaign 56: Australia, which the person confirms leaves in the first
month of most Long War campaigns). Stats lists the countries lost. The
bonus list gains "Out of reach": a continent bonus whose continent has
lost a council member, since that member can never have a satellite
again. The save history agrees, though thinly: Asia's New Warfare shows
in Foundry costs exactly when every Asian council country is covered,
and campaign 21, which lost all four, never had it. Tests on save1762.
