---
title: Starting, country and continent bonuses in the calculations
status: review
priority: 5
dependsOn: [progress-overlay]
---

## Purpose

Long War's bonuses change how long research takes. The estimates should
include the ones a campaign has, and the player should be able to see
which bonuses those are.

## Requirements

- Find a campaign's bonuses from its save: the starting bonus, country
  bonuses, continent bonuses.
- Apply those that touch research to the estimates, and say so where
  they apply.
- Values from the player's DefaultGameCore.ini when loaded, like costs.

## Facts

- `longwar_bonuses.json` (added by the person 2026-10-18): every bonus
  with id, value, description, and the country or continent it belongs
  to; countries with continents; notes on the save fields.

## Report (2026-10-18)

**What the save holds (found and verified on both campaigns).**
`XGHeadQuarters.m_iCountry` packs the starting bonus above the country:
`0x240000` = United States with starting bonus 36 (Special Warfare
School, campaign 55), `0x260000` = United States with 38 (We Have Ways,
campaign 56). Each `XGCountry` has `m_bSatellite` and its id in
`m_kTCountry.iEnum`.

**Which bonuses are active.** The starting bonus; a country bonus while
that country has a satellite, *except the starting country's*; a
continent bonus once every country on it has a satellite. The exception
comes from the data: campaign 55 started in the US with a US satellite
throughout, yet its autopsies and interrogations ran at the same points
per hour as the techs finished around them (from
`m_arrResearchedTimes`, `m_arrProgress`, `m_arrTimeSpent`) and cost
their full points, so the US "We Have Ways" was not in force. One
campaign is thin evidence; noted in `src/model/bonuses.ts`.

**What they do to research.**
- Expertise adds to the research credit reduction: campaign 55 (Brazil
  covered) gets 25 % + 10 % = 35 %, which is exactly what its current
  project, Plasma Weapons, costs. This replaces the earlier rule of
  measuring the reduction from the current project. The dates also show
  a project's credited cost is fixed when it starts: Brazil was covered
  by 5 Dec, yet Advanced Pulse Lasers (started 29 Nov) kept 25 %, and
  Plasma Weapons (started 7 Dec) got 35 %.
- We Have Ways shortens autopsies and interrogations (75 % as campaign
  56's starting bonus). Not yet seen at work in a save (campaign 56 has
  no autopsy done or in progress), so the panel says "not yet confirmed
  against a save" where it applies.
- Jai Vidwan (+5 % per lab adjacency) is assumed to be in the save's
  own adjacency bonus already, since the speed formula built on that
  figure reproduces the game's ETA; it is not added again.
- The current project's days are now taken from the game's ETA text, so
  they stay right whatever bonuses are behind them.

**UI.** The campaign bar says where the campaign started and opens a
list of its bonuses (starting, country, continent; descriptions from
the game; research-relevant ones first and tagged "in estimates" or
"in the save's lab bonus"). The detail panel's credit line shows the
sum ("35% off: 25% credit + 10% Expertise (Brazil)").

**INI.** Bonus values are read from the INI's `ItemBalance_Classic`
bonus lines (eItem 0/1/2, iTime = bonus id, iEng = value) and replace
the JSON's values, descriptions following.

**Verified.** Tests on the fixtures: both campaigns' start and starting
bonus, campaign 55's country and continent bonuses and its 35 %, equal
to Plasma Weapons' actual cost; campaign 56's 75 %; INI line parsing
and override; the sample INI agrees with the JSON for both campaigns.
In Chromium: the bonus list, the credit line, an autopsy in campaign 56.

**Left open.**
- The starting-country exception and We Have Ways' effect rest on one
  campaign each. A save with an autopsy in progress under We Have Ways
  would settle the second (its ETA text against our figure).
- Whether two credit sources (starting and country Expertise) add up is
  assumed, not seen.
- Other bonuses (costs of items, facilities, Foundry) are listed but not
  used; the Foundry one matters once the foundry-tree feature exists.
