---
title: Long War Rebalanced (LWR) alongside Long War 1.0
status: planned
priority: 3
dependsOn: [game-script-rules, air-war]
---

## Purpose

Long War Rebalanced is a mod on top of Long War 1.0 that many people play
instead of it. It changes research, costs, Foundry projects, facilities,
items and the air war (its change log on UFOpaedia lists, among much else,
Harpoon Missiles, Phoenix Cannons firing every 1.5 s, a Skunkworks, a removed
Repair Bay, new second-wave options, interrogation costs). The site should
work for an LWR campaign as well as for a Long War 1.0 one.

## What is known (2026-10-18)

- Installed over Long War 1.0 (UFOpaedia, "Installation (LWR)"): LWR's
  `Config`, `Localization` (INT and others), `CookedPCConsole` and
  `Movies` folders are copied into `XEW/XComGame/`. These are exactly the
  files this site's extractors read (`scripts/upk_enums.py`,
  `upk_techtree.py`, `upk_airwar.py`), so most of LWR's rules can be read
  the way Long War 1.0's were.
- LWR only works with campaigns started under LWR, so a save belongs to one
  or the other.
- Its own UFOpaedia section (Research (LWR), Key Changes, Change Log)
  describes the changes; the change log runs to v2.06.00.

## Shape (to be confirmed against the files)

1. **Data per game version.** Run the extractors on an LWR install into
   `data/lwr/` beside today's data. tech.json and longwar_foundry.json hold
   texts gathered by hand (unlocks, effects); for LWR these come from its
   localization where possible, and what cannot be read is shown as
   missing rather than borrowed from Long War 1.0.
2. **A version switch** in the header (Long War 1.0 / LWR), and detection
   from a save where something in it tells them apart (to be found: enum
   sizes, items or techs only LWR has, a version field).
3. **The extractors** stop on rules they do not recognise; LWR's changed
   rules (air war timing, new items) will show where the code needs to
   learn something.
4. Tests against an LWR save.

## Needed from the person

- LWR's files as installed (or its zip): `CookedPCConsole`, `Config`,
  `Localization/INT`, into `samples/lwr/` (git-ignored like the rest).
- One or more LWR saves, ideally from more than one point in a campaign.
- Which LWR version is played.

## Findings from the LWR v2.06.00 zip (2026-10-18)

The zip ships whole `XComGame.upk` and `XComStrategyGame.upk`, its
`DefaultGameCore.ini` and localization; unpacked into `samples/lwr/` (with
`samples/lwr/root/` linking the layout the extractors expect).

- The enums are identical to Long War 1.0's (items, techs, Foundry,
  facilities, credits, ships): saves read the same way; LWR changes what
  the slots mean through its INI and localization.
- The research tree is a different tree: 68 techs (the seven UFO analyses
  65–71 are gone; 61–64 are now Small, Medium, Large and Very Large UFOs,
  each needing any one of its types captured); prerequisites differ for
  about 30 techs (most autopsies need only Xenobiology; Plasma Weapons needs
  EMP Weapons, Interrogate Muton Elite and the Sectopod autopsy's line …);
  every research credit is 20 %.
- Of the strategy functions this site models, LWR changed 132, among them
  research speed (GetResearchPerHour, UpdateLabBonus), tech cost (TechCost),
  the credit rules, Foundry hours and requirements, and nearly all of the
  air combat (UpdateWeapons, GetTimeUntilOutrun, the playback,
  consumables, UpdateEngagementResult), and UpdateShips (UFOs grow per 50
  alien research up to category 14, hull points times a factor by
  difficulty, other upgrade thresholds).
- `scripts/upk_techtree.py` reads LWR's grouped UFO analyses now; LW 1.0's
  output is unchanged. `scripts/upk_airwar.py` stops on LWR's per-difficulty
  ship building, as it should.

So LWR support means a second, generated data set and, for research timing,
credits and the air war, LWR's own formulas decoded beside Long War 1.0's.
