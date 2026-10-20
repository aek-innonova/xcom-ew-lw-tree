---
title: Plan the research path to a goal
status: done
priority: 5
dependsOn:
  - progress-overlay
---

## Purpose

A player picks a goal ("Advanced Plasma Weapons") and sees everything
they still have to research to get there and what it will cost in total.

## Requirements

- Choose one or more goal techs. Highlight the minimal set of
  unresearched techs needed; for "any one of" groups, pick the cheapest
  and say that a choice was made.
- Totals: base days (and estimated days if the overlay has an
  estimate), alloys, elerium, fragments, and the item list.
- A suggested order that respects prerequisites.
- Works without a save (from scratch) and with one (from where the
  campaign stands).

## Worth

A few hours.

## Report (2026-10-18)

**What changed.** `src/model/plan.ts` (the plan and its totals),
`PlanPanel.vue`, plan buttons in `TechDetail.vue`, plan marks in
`TechTree.vue`, goals in the store (persisted). The right-hand column now
holds the selected tech and the plan together.

- From a tech's panel: "Plan research to here", or with a plan already
  open "Add to plan" / "Plan only this" / "Remove from plan".
- The plan: the goals (★, removable), the number of techs, the time
  (≈ days at the campaign's speed, as one project after another, or base
  days without a save), alloys, elerium, fragments, items summed by kind,
  and the steps in order with each one's days. Steps that are available
  now have a filled number.
- "Any one of" groups that nothing in the plan or the campaign already
  covers get the member that adds the fewest base days, and the panel
  says so ("Alien Operations needs any one of 9: picked Interrogate
  Sectoid, the quickest"). All goals are added before groups are closed,
  so a group one goal opens can be closed by another goal.
- Order: prerequisites first; among techs ready together, the one being
  researched now, then the quicker.
- On the tree: plan steps get a dashed outline and their step number,
  goals a ★, and the edges between steps are drawn while nothing is
  hovered.

**Verified.** Unit tests: closure and order, researched techs left out,
the any-one-of pick and its absence when a goal covers it, in-progress
first, item sums, totals. In Chromium: a plan from scratch to Alien
Operations (7 techs, 71 base days) and, with save1738, to Fusion Weapons
plus Alien Command and Control (9 techs, ≈112 days, Plasma Weapons
first); goals survive a reload; no console errors. Looked at both on
screen.

**Left open.** The time total assumes one lab working through the list
at today's staffing. The pick is by base days, not by what a campaign
has in hand (captives, corpses).
