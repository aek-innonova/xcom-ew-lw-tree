---
title: The Foundry projects alongside the research tree
status: review
priority: 6
dependsOn: [progress-overlay]
---

## Purpose

Long War players plan Foundry projects with research: many need a tech,
and they compete for the same alloys, elerium and fragments. The site
should show them, with the campaign's progress, the way it shows
research.

## Facts

- `longwar_foundry.json` (added by the person, committed 2026-10-18): projects with id (EFoundryTech slot), config key, name,
  category, research credit, base days, engineers, cost (cash, alloys,
  elerium, fragments, meld, items), the tech each requires, and the
  effect. Its `tech_ids_refer_to` names `longwar_tech_tree.json`; in this
  repository that file is `tech.json`.
- In a save, `XGFacility_Engineering.m_arrFoundryHistory` is a 48-entry
  flag array indexed by foundry id, index 0 set (like
  `m_arrResearched`); `longwar_foundry.json`'s `save_fields` describes
  it as a list of ids, which is not what the saves hold.
  `m_arrFoundryProjects` holds projects in progress (empty in the
  samples' strategy chunks so far).
- The INI packs Meld into `iFragments` as thousands (40030 = 40 Meld +
  30 fragments), per the JSON's own notes; `[FoundryBalance]` lines.
- `campaign.ts` already reads `foundryHistory`.

## Requirements

- Foundry projects visible and selectable, linked to the tech each
  needs (in the tech's panel, and the project's own panel).
- States from a save: done, in progress, available (its tech
  researched), locked.
- The player's INI sets Foundry costs as it does research costs.
- The path planner can take a Foundry project as a goal.

## Worth

Half a day to a day, most of it deciding where the projects sit on the
screen; look at it before building it out.

## Report (2026-10-18)

**What changed.** `src/model/foundry.ts` (projects, INI FoundryBalance,
New Warfare, board layout, state), `FoundryTree.vue`, `FoundryDetail.vue`,
a Research / Foundry toggle in the header, Foundry goals in the store and
the plan panel, campaign readout of projects in progress. Pan and zoom
moved into `usePanZoom.ts` and the board styles into `board.css`, shared
by both boards.

- **Board:** a lane per Foundry category; each project one column right
  of the tech it needs (columns line up with the research tree), moving
  right into free space where a column is full: 12 rows. Boxes show base
  days, cash, alloys, elerium, fragments, Meld; the opened box adds
  engineers, items, the tech it needs (ticked when researched), credit,
  New Warfare and the effect.
- **State from a save:** done (`m_arrFoundryHistory`, a flag per id),
  being built (`m_arrFoundryProjects`), available (tech researched),
  locked.
- **Costs:** the INI's FoundryBalance lines (Meld unpacked from
  `iFragments` thousands), then Asia's New Warfare (−25 % cash, alloys,
  elerium) when the campaign has it.
- **Links:** a tech's Foundry unlocks open the project; a project's
  "Requires" opens the tech; search finds a project and opens it on the
  Foundry board.
- **Plan:** "Plan research to here" / "Add to plan" on a project; the plan
  researches its tech and lists the project after the research, its
  costs (cash and Meld too) in the totals.

**Verified.**
- Campaign 55 has 27 projects done, the game's own "Foundry techs"
  statistic. save1719 (a fixture) has Improved Arc Thrower being built
  with 30 engineers.
- New Warfare, against the game: the save's `kOriginalCost` for Improved
  Arc Thrower is 75 / 30 / 30 (base 100 / 40 / 40), for Advanced Repair
  375 / 75 (base 500 / 100): exactly 25 % off, which is what we show.
  This also exposed a bug in the bonus rules (next point).
- Unit tests: board invariants, done count, a project in progress, New
  Warfare, INI parsing with packed Meld; the sample INI agrees with the
  JSON for all 46 projects. In Chromium: empty board, campaign 55, an
  opened box, a project's panel, planning to a project, search to a
  project.

**Found and fixed along the way.**
- Continent bonuses counted every country on the continent; only council
  members can have satellites, so Asia, Europe and Africa could never
  qualify. Now council countries only (`bonuses.ts`).
- `longwar_foundry.json`'s `save_fields` calls `m_arrFoundryHistory` a
  list of ids; it is a flag per id.

**Left open.**
- Time for projects in progress: `iHoursLeft` is not hours. Across
  campaign 55's saves it fell by about 1.8 per assigned engineer per
  hour (two 35-engineer projects lost exactly the same amount), so it is
  something like engineer-hours times a factor, possibly from workshops.
  Not shown until the factor is understood.
- Foundry research credits (projects have a credit category) are listed,
  not applied.
