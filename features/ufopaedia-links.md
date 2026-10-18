---
title: Links to UFOpaedia
status: review
priority: 6
dependsOn: []
---

## Purpose

From a tech or Foundry project, get to the wiki's write-up of it and of
what it unlocks.

## Report (2026-10-18)

UFOpaedia has no page per Long War tech, Foundry project or item (checked:
"Xenobiology (Long War)" and the like are empty); it has category pages
with a section each, and its "Research (Long War)" table links every
unlock to such a section.

- `scripts/ufopaedia_links.py` reads the Research and Foundry pages and
  writes `ufopaedia.json`: 347 names → links, as the wiki links them.
- A tech's panel links to its category's section of Research (Long War)
  (all eight categories have one); a Foundry project's to its category's
  section of Foundry (Long War). Unlocks the wiki links (139 of 166; the
  rest are descriptions like "+20% salvage") become links. All open in a
  new tab.
- Tests: every category maps to a section, a Foundry link, an item link
  and a description without one. Checked in Chromium.

Left open: tech-level anchors do not exist on the wiki, so a link lands
on the category's table, not the tech's row.
