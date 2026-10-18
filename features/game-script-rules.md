---
title: Research rules from the game's own script
status: review
priority: 5
dependsOn: [research-credits, grey-market]
---

## Purpose

Prerequisites came from UFOpaedia and credit coverage from category names,
and both had been seen to disagree with the game. Long War's compiled
UnrealScript is in the person's install (`XComStrategyGame.upk`); read the
rules from there instead, and commit only what is read.

## Report (2026-10-18)

**Tooling.** `scripts/upk_script.py` turns compiled UnrealScript back into
rough expressions (the tokens Enemy Within's strategy code uses; anything
else stops with `??`). `scripts/upk_techtree.py samples > data/techtree.json`
reads `XGTechTree` (BuildTechs, HasPrereqs, BuildResearchCredits,
CreditAppliesToTech, CreditAppliesToFoundryTech, HasFoundryPrereqs), the
INI's FoundryBalance lines and the INT item and UFO names. It stops on any
requirement it does not recognise, so a changed rule is noticed.

**What the game says, and what changed here.**

- Prerequisites: four differed from tech.json.
  - Alien Communications needs Xenoneurology and a Hyperwave Beacon ever
    held, not Alien Operations. Alien Operations stays in the tree as the
    way to the beacon (marked "for the Hyperwave Beacon"): the beacon
    comes from the alien base, the game's research screen hints at it
    once Alien Operations is done, and in all six campaigns of the
    person's history that had one, it arrived after Alien Operations.
  - Alien Command and Control needs Interrogate Ethereal and an Ethereal
    Device ever held; Alien Communications is not a requirement.
  - Alien Power Systems also needs Alien Computers.
  - Advanced Aerospace Concepts does not need Alien Computers.
- Item and UFO checks (new): most techs need their item ever held
  (`XGStorage.m_arrItemArchives`, now read from the save); Xenobiology
  any alien corpse in stores; Alien Operations an Outsider Shard in
  stores and any interrogation; each UFO analysis that UFO type
  encountered (`XGGeoscape.m_arrCraftEncounters`). A Foundry project
  needs its INI item in stores (any number), Alien Grenades also an
  Alien Grenade ever held. Long War jumps over vanilla's two other
  Foundry checks. With a save, a tech or project whose research is done
  but whose check is not met shows as locked, its panel saying what it
  needs ("Locked: needs Battleship UFO encountered"); checks the cost
  does not already say are listed under "Requires all of".
- Credits: every credit is 25 %, the Ethereal's "All" 20 % (it was 25 %
  here). Each item now carries the game's list of covering credits.
  For techs the lists equal what tech.json implied; for the Foundry they
  fix Alien Grenades (Weapons), Mag Pistols (Weapons and Gauss), UFO
  Scanners (Aerospace), Aircraft Boosters and Wingtip Sparrowhawks
  (Aerospace only), and the six two-credit projects (Armored Fighters,
  Enhanced Lasers and Plasma, Rail and Reflex Pistols, Quenchguns),
  whose combined labels had never matched a held credit, so they were
  shown uncredited. This also settles a question left open in
  research-credits: the Weapons credit does cover the Foundry's weapon
  projects, alongside their own field's.
- The formula (GetCreditAdjustedTechHours), per covering credit in slot
  order: saved = (share + Expertise) × hours, at least 24; hours −= the
  saved amount, whole; research never below 24. We Have Ways comes after
  the credits (GetTech), kept whole. A tech's hours are days × 72 ×
  TECH_TIME_BALANCE (10 in the INI), the 720 points a day found from
  the saves; Long War jumps over vanilla's Marathon factor there.
  Foundry work is days × 24 × engineers (FoundryDaysToHours), as found
  from the saves. New Warfare's cut of Foundry cash, alloys and elerium
  is in GetFoundryTech, as modelled.

**Verified.** The exact formula gives the cost of 371 of the 380
credited projects running in the person's 1,711 saves, the same as the
old one; the other nine, in early saves, fit no setting. None held the
"All" credit, so the 20 % comes from the script alone. Unit tests:
tech.json and longwar_foundry.json against data/techtree.json
(prerequisites, any-of groups, Foundry requirements, credit sources);
the formula's floors and shares; gates read from save1762 (a Scout met,
no Battleship). Type-check, lint and Playwright pass; the changed panels
were checked on screen.

**Left open.**

- Where the Ethereal Device comes from is not given a tech: the game
  adds Overseer UFOs every month until one is held, but which of them
  can be seen was not decoded.
- The planner plans research only; it does not say which items or UFOs
  a plan will need.
- GetFoundryTech also has a rush option (engineers and costs × 1.5);
  not shown.

## Correction (2026-10-18)

The UFO analysis check is not "that UFO type encountered":
XGGeoscape.m_arrCraftEncounters is raised only by a won crash-site or
landed-UFO mission (XGStrategy.PostCombat), never by a sighting or an
interception. The gate is now "captured" (`data/techtree.json`), and a
locked analysis reads "Locked: needs a Battleship captured".
