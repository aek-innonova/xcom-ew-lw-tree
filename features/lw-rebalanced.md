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
  EMP Weapons, Interrogate Muton Elite and Advanced Pulse Lasers; many
  techs need an interrogation …);
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

## LWR's air war, as its script has it (2026-10-18)

Read from LWR's XGInterceptionEngagement, UIInterceptionEngagement,
XGInterception and XGItemTree; ships and weapons in `data/lwr/airwar.json`.

- **Squadrons.** Up to 2 jets, 3 once a jet in it has 8 kills, 4 at 16, 5
  at 32 (× SW_MARATHON, 1 in LWR). Jets under half health or not ready
  cannot launch (ToggleInterceptor).
- **The UFO's target** (Init): each jet scores 2, plus 1 per weapon if
  aggressive, minus 1 if defensive; the highest is the target (the "lead");
  on a tie a random jet leads. During the fight each UFO shot has a 49 %
  chance to go to a wingman instead (one behind the lead), drawn with
  weights 1 defensive, 2 balanced, 3 aggressive.
- **Shooting** (GetCombat, 120 s; UpdateWeapons): after each shot a jet's
  weapon waits its firing time ÷ 1.35 with Jai Jawan (bonus 11), ÷ 1.5 on a
  Firestorm, ÷ 1.2 with Air Superiority (2), ÷ 1.3 with Foundry 28, ÷ 1.3
  once the UFO's size-class analysis (61–64) is done. A jet's aim: its
  weapon's + kills ÷ 4 (× 5 with bonus 40), + 10 aggressive, − 10
  defensive, − 10 if damaged (not with bonus 26), × 1.5 against medium UFOs,
  × 2 against large and very large, 0–100; a hit is Rand(100) < aim. The
  UFO's shots are rolled again at playback against the target's stance:
  its weapon's aim as is against balanced, × 2/3 against defensive, × 3/2
  against aggressive. Damage: armor as in Long War 1.0, then ± 20 %
  (4/5 + Rand(2/5)); a critical (× 1.5) with chance (penetration − armor) ×
  2, + 25 against the UFO with bonus 40 or 45, 1–100.
- **Escape** (GetTimeUntilOutrun): 30 × the squadron's average battle speed
  (a damaged jet's × 0.8, not with bonus 26) ÷ the UFO's, + 50 % while a
  Boost is on, × 1.1 with Foundry 45, × 1.3 with bonus 26, × 1.1 with
  Foundry 35.
- **Consumables**, by the first jet's stance: Aim only aggressive, Dodge only
  defensive, Boost only balanced; Aim and Dodge each also give a Boost. Two
  charges each as in Long War 1.0 (Aim: the lead's misses; Dodge: hits on
  any jet). Not at the very start.
- **Breaking off** (TryAbort): the lead leaves and the next jet leads (Aim
  and Dodge end); only with none left does the squadron disengage. A
  wingman below 25 % health leaves by itself; when the lead goes down or
  leaves and no jet is still chasing, the UFO has escaped.
- **Outcome**: a UFO down is destroyed if it is a Fighter or a Destroyer,
  otherwise it crashes; either way it counts towards its analysis
  (m_arrCraftEncounters, which Long War 1.0 raises only for a crash site
  won).
- **UFOs** grow per 50 alien research (at most category 14); their hull
  points are multiplied by difficulty (4×, 7×, 10×, 12×, 13× the INI's
  value); UFO weapons get − 10 aim with bonus 26.
