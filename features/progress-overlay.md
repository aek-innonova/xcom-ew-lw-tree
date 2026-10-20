---
title: Show the campaign's progress on the tree
status: done
priority: 4
dependsOn:
  - save-parser
  - tree-view
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

## Report (2026-10-18)

**What changed.** `src/model/research.ts` (speed, ETA, credits, states),
`CampaignBar.vue`, and the node and panel states in `TechTree.vue` and
`TechDetail.vue`.

- Node states: researched (green, tick), researching (amber, with a
  progress bar), available (cyan border), locked (dimmed). Partial
  progress on any tech shows as a bar.
- The bar under the header: in-game date, campaign number, difficulty,
  Ironman, researched out of 75, scientists and lab bonus (points/hour
  on hover), the current project with its days left, and a note on
  mid-mission saves. A legend for the states.
- Days on each node become days at the campaign's speed: exact for the
  current project ("13d", the game's own figure), "≈" for the rest.
- The panel shows progress and hours spent, or for a finished tech what
  it took.
- The extracted campaign persists in localStorage; the save itself is
  not stored.

**The formula, verified.** Speed = scientists × (1 + lab bonus +
adjacency bonus) points/hour; the current project's remaining points
come from the save; ETA = ceil(points / speed / 24). This reproduces the
game's own ETA text in all nine sample saves (a test). For other techs:
a credit is held once its interrogation is researched (from tech.json's
unlock texts; "Weapons" covers every weapon category, "All" everything),
and takes 25 % off unless the current project shows the campaign's
actual reduction (campaign 55 shows 35 %), in which case that is used
and the panel says "measured from your save".

**Verified.** Unit tests for credits, estimates, and states including
"any one of". In the browser with save1738 (late), save1762 (early) and
save1739 (mid-mission): states, bars, the campaign line, and the panel
match the saves; reload restores the campaign.

**Left open.**
- Which `m_arrCredits` slot is which credit is not needed now and not
  determined.
- The 35 % is attributed to the "Expertise" continent bonus by
  inference only. If the current project has no credit, other techs
  fall back to 25 % even in a campaign that gets 35 %. Reading the
  continent bonus from the save would close this.
- Estimates assume today's staffing; more scientists or labs later
  shorten them.
