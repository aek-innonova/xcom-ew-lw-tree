---
title: Settle the open questions with the person's save history
status: done
priority: 3
dependsOn:
  - campaign-bonuses
  - foundry-tree
  - campaign-stats
---

## Purpose

Several rules in the estimates rested on one campaign or none. The
person's save history (1,711 saves, 46 campaigns, in `samples/savedata/`,
git-ignored) can confirm or correct them without waiting for new play.

## Report (2026-10-18)

**How.** A scan (kept out of the repository; it reads `samples/`)
recorded per save the campaign readout, its date to the hour, completion
dates, base facilities, Foundry projects and facility builds; analysis
in Python over that. Campaigns 1–13 are from 2015 on an older Long War
(costs and timing differ) and are left out of the conclusions below.

**Research time — confirmed, with one refinement.** Our formula matches
the game's own ETA in 1,609 of 1,637 saves (98.3 %). Every other case is
the game one day higher with our hours within six hours of a day
boundary, inconsistently: the game's ETA text lags its points by a few
hours. The check log now treats that as agreement.

**We Have Ways — confirmed, mechanism corrected.** It takes its share
off the *cost*, not the speed: campaigns 36–38 (started with it) pay
25 % of base for autopsies and interrogations, and the game's ETA agrees
with our formula on that reduced cost. The US country bonus (25 %):
campaigns 21, 22, 29, 31 (started elsewhere) pay 75 % once the US has a
satellite, 100 % before.

**Starting country's own bonus — confirmed inactive.** Campaign 55 (US
start, Special Warfare School) pays full cost for autopsies throughout
with a US satellite; so does every US-start campaign without We Have
Ways as its starting bonus.

**Research credits — corrected: they stack.** 1,198 of 1,225 credited
projects agree with: each credit that covers a tech multiplies its cost
by (1 − 25 % − Expertise). A weapon tech with its own credit and the
Muton Elite's Weapons credit pays 0.75 × 0.75 = 56 % (0.65 × 0.65 = 42 %
with Brazil's Expertise); all 53 two-credit cases agree. The rest are
projects started before a bonus changed (cost fixed at start) and two
techs in 2015-era-cost campaigns (18, 20). Before this, the app applied
one credit at most.

**Expertise stacking (starting + country) — not testable.** No campaign
started in Brazil with Expertise. The code adds them; unconfirmed.

**Foundry — total work confirmed, speed not modelled.** A project's work
is base days × 24 × required engineers: several projects first appear at
exactly that (e.g. 14 × 24 × 30 = 10,080). So progress is exact, and the
board now shows a progress bar and percentage, with days left at base
speed. The speed varies: about proportional to engineers when short of
the requirement, up to about 1.6× with many spare, but not consistently
(engineers on item builds are probably not available; not in the scan).
The panel says spare engineers make it faster.

**Facility types** (`XGBase.m_arrFacilities[].iFacility`), recovered by
matching construction projects to the tiles they became: AccessLift 6,
ScienceLab 7, Workshop 8, SmallRadar 9, Power 10, Foundry 11, OTS 12,
AlienContain 13, LargeRadar 14, ThermalPower 15, EleriumGenerator 16,
PsiLabs 17, HyperwaveRadar 18, CyberneticsLab 22, GeneticsLab 23.
Not used yet; recorded for later (e.g. lab and workshop counts).

**Alien research — no stored total.** No number in any save matches
days + bonus research or variants, so the game computes it. Stats shows
"≈ days + bonus research above zero", the INI's description.

**Changed in code.** `research.ts` (credits stack: `applicableCredits`,
`creditReductionFor`), `bonuses.ts` (comments now cite the evidence),
`live.ts` (stacked credits and We Have Ways in the expected cost; ETA lag
tolerance; finished projects 0 days), `foundry.ts` (`foundryWork`,
`foundryProgress`), the Foundry board, card and panel, Stats (alien
research), the detail panel's credit line ("58% off: Plasma Weapons and
Weapons credits, 35% each"). Tests for stacking, the lag tolerance and
Foundry progress.

**Left open.** Foundry speed; Expertise from two sources; whether a lost
council country blocks its continent's bonus (next item in the plan).
