---
title: The visual tech tree
status: review
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

## Report (2026-10-18)

**What changed.** `src/model/layout.ts`, `src/components/geometry.ts`,
`TechTree.vue`, `TechDetail.vue`, `AppHeader.vue`, `App.vue`. The
scaffold's router is removed (one screen, no routes).

**Layout, and how it got there.** The first version compacted lanes by
letting a tech move right freely: 14 rows, but edges into Plasma Weapons
ran right to left, and in one-row lanes a skipping edge passed behind the
node in between (Advanced Beam Lasers → Pulse Lasers read as a chain
through Gauss Weapons). Now every prerequisite sits strictly left of the
tech that needs it, across lanes (for "any one of", the earliest
member). Each lane starts with rows enough for every tech at its depth
and gives rows back while everything still fits in nine columns: 15
rows. Nine columns rather than eight because the result's proportions
then match a 1920×1080 screen (fit scale about 0.85 instead of 0.72).
Rows follow same-lane prerequisites so chains run along one track.
Edges are routed through the column gutters and the gaps between rows,
so none passes behind a node.

**Behaviour.** Pan by dragging, zoom with the wheel or the buttons, Fit.
The tree refits to its space until the player pans or zooms. Hover or
select a tech: its edges to and from other lanes are drawn, related
nodes highlighted, the rest faded. "Any one of" edges are dashed. Search
finds by name and centres the tech in the space left by the panel.
Escape or a click on empty space closes the panel. The footer says where
prerequisites come from and that they may contain errors.

**Verified.** Layout invariants in unit tests (every tech once, no
overlap, every prerequisite to the left). Mount tests (75 nodes, the
privacy note, the panel opening on Enter). Looked at the screen in
Chromium at 1920×1080 and 1366×768: empty, with a late and an early
campaign loaded, with Plasma Weapons selected, after a search. No
console errors.

**Left open.**
- Long names are truncated with an ellipsis (full name on hover and in
  the panel), notably "Interrogate Sectoid Commander".
- At 1366×768 the fitted tree is small (about 0.7); readable, and zoom
  is there.
- Touch: drag-to-pan works through pointer events, pinch zoom does not.

## Response (2026-10-18)

The person: fading everything else on hover flickers wildly while the
mouse moves over the tree; the blue outlining is enough, keep the rest
unchanged. The lanes are liked: the first tree they have seen that fits
on one screen.

## Report (2026-10-18, round 2)

Hover and selection no longer fade other techs or dim the edges, and the
plan's edges no longer disappear while something is hovered (the same
flicker). What remains on focus: the focused tech's edges drawn in blue
across lanes, and a blue outline on the techs they connect. Checked in
Chromium with save1738 and a plan open, hovering Plasma Weapons.

## Response (2026-10-18, round 2)

The person: hover only highlights the step immediately before and after;
it could highlight, more subtly, all requirements back to what the
campaign has, and what the tech enables in a different colour. The
resource markers would help in the detail view too, so they map
mentally.

## Report (2026-10-18, round 3)

- On focus (hover, else selection) the tree shows what the tech still
  needs in blue: the chain the planner would research for it, so it
  stops at researched techs and "any one of" groups take the planner's
  pick. Direct prerequisites glow strongest, the rest of the chain more
  softly; edges from researched techs into the chain show where it
  joins what the campaign has. Without a save the chain runs to the
  start. What it leads to (direct dependents) is pink.
- The highlight is a glow around the box, not a border colour: the
  border already carries the tech's state, and "available" is blue.
- Resource markers (coloured squares) are shared styles now, used in the
  tree, the detail panel and the plan totals.
- The footer explains the colours.

Checked in Chromium: Plasma Weapons hovered with no save, Fusion Weapons
hovered with save1738, and the detail panel.

Noticed: an edge that crosses columns runs along the strip above the
target's row, which in a lane's top row is 5 px above the boxes it
passes, so it can read as an outline on them (Xenobiology → Xenogenetics
passes over Xenoneurology). More padding would fix it at the cost of
about 10 % scale.

## Response (2026-10-18, round 3)

The person: the glow is too subtle; stronger, or tint the border too.
Resting on a tech could expand its card, without moving anything, to
show its unlocks. The edge-over-top-row quirk is not a problem.

## Report (2026-10-18, round 4)

- Highlights: direct prerequisites and enabled techs get a tinted,
  thicker border and a double glow; the rest of the chain a softer
  tinted border and glow.
- Hover card: resting on a tech for 280 ms opens a 270 px card over it
  with name, cost, full item text, research credit and unlocks. It is a
  layer above the tree that ignores the pointer, so nothing moves and the
  tech underneath keeps the hover; it grows upwards in the lower part of
  the tree and stays inside it horizontally; it closes on leave and
  while panning. The delay is there so a mouse passing through does not
  pop cards, the same reason the fading went.

Checked in Chromium with save1738: a quick sweep opens no card, resting
does; cards in the top lane (Advanced Aerospace Concepts, long unlock
list), the middle (Plasma Weapons) and the bottom lane (grows up).

## Response (2026-10-18, round 4)

The person: the glow on direct prerequisites and next steps is a bit
much now. The hover card should not be wider than the box; it should
look like the box just opened up. As it was, it felt in the way.

## Report (2026-10-18, round 5)

- Direct prerequisites and enabled techs: 2 px tinted border and one
  4 px glow; the chain: softer border and a 3 px glow.
- The hover card is now the tech's own box opened: same position, width,
  fill and border as the box (drawn as an outline so it sits where the
  SVG stroke is), its top row identical to the box's, and below it the
  day figure in words, the full item text, the credit and the unlocks.
  In the lower part of the tree it opens upwards, with the box's row
  staying in place at the bottom.
- "1 days" fixed in the day wording.

Checked in Chromium with save1738: top lane, middle (Plasma Weapons),
bottom lane opening upwards.

## Response (2026-10-18, round 5)

The person: the hover card shows the border of a tech that is not
hovered; it should have the hover border.

## Report (2026-10-18, round 6)

The card's border is now the hover border (2 px, accent) on every state;
its fill still follows the state. Found on the way: the hover and
selection borders were declared before the state rules, so on
researched, researching and available techs they never showed. They
now come after the state rules, so hovering or selecting any tech shows
the accent border. Checked in Chromium on a researched tech (top lane)
and an available one (bottom lane).
