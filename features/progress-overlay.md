---
title: Show the campaign's progress on the tree
status: planned
priority: 4
dependsOn: [save-parser, tree-view]
---

## Purpose

With a save loaded, the tree answers "where am I": done, in progress,
available now, locked, and how long the current research has left.

## Requirements

- Node states: researched; in progress (partial bar from
  `m_arrProgress` against base days × 720); available (all
  prerequisites, or any one of the "any one of", researched); locked.
- The current project (`m_kProject.iTech`) is marked, with time left.
- A summary bar: campaign date, difficulty, scientists, techs
  researched out of 75, the save's name.
- Time estimates at the campaign's current staffing, labelled as
  estimates. Calibrate the formula against `iActualHoursLeft` in the
  saves we have; show the estimate only where it reproduces those.
- Loading a different save replaces the overlay; the save persists
  across reloads like the INI, with a way to clear it.

## Hard to verify

The time formula (labs, adjacency, research credits). The save holds
`iActualHoursLeft` for the current project: use it as ground truth.

## Worth

Half a day once the parser and the tree exist.
