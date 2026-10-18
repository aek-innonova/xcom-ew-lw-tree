---
title: The visual tech tree
status: planned
priority: 3
dependsOn: []
---

## Purpose

A player sees the whole Long War research tree at once and can read it:
what leads to what, what each tech costs, what it unlocks.

## Requirements

- All 75 techs as nodes, grouped in a lane per category (the 8 in
  `tech.json`), placed left to right by prerequisite depth.
- Each node shows name, base days, and alloys / elerium / fragments /
  items when non-zero.
- Prerequisite edges within a lane are always drawn; cross-lane edges
  appear when a tech is hovered or selected, so the tree does not turn
  into spaghetti. "Any one of" prerequisites (Alien Operations needs any
  interrogation) are drawn differently from "all of".
- Selecting a tech opens a detail panel: cost, prerequisites, what it
  leads to, what it unlocks, and its research credit.
- Pan and zoom; usable on a laptop screen; readable at 100 % zoom on a
  1920-wide display without panning vertically.
- Search box that finds and centres a tech.
- Note in the UI that prerequisites come from ufopaedia.

## Hard to verify

Readability is a judgement: look at the screen. Screenshot the full tree
and a selected tech with its cross-lane edges; the person decides.

## Worth

The largest piece of UI. If the simple lane layout is unreadable,
say so with a screenshot before reaching for a layout library.
