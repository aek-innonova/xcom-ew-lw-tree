---
title: The Foundry projects alongside the research tree
status: planned
priority: 6
dependsOn: [progress-overlay]
---

## Purpose

Long War players plan Foundry projects with research: many need a tech,
and they compete for the same alloys, elerium and fragments. The site
should show them, with the campaign's progress, the way it shows
research.

## Facts

- `longwar_foundry.json` (added by the person, 2026-10-18, not yet
  committed): projects with id (EFoundryTech slot), config key, name,
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
