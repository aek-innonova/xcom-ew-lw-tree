---
title: Load the player's DefaultGameCore.ini for costs
status: done
priority: 2
---

## Purpose

Costs and times in the tree match the player's own install, which may be
tweaked from stock Long War 1.0.

## Requirements

- Parse the `TechBalance=(eTech=…, iTime=…, iAlloys=…, iElerium=…,
  iNumFragments=…, iNumItems=…)` lines of a `DefaultGameCore.ini` in the
  browser. Ignore comments (`;` onwards), tolerate tabs and spacing.
- Resolve the tech by enum name, by bare number, and by `eTech_Placeholder`
  (= 60, Alien Biocybernetics). `tech.json`'s `config_key` is the key;
  correct its value for 60 so the data says what the INI says.
- Override `base_days`, alloys, elerium, fragments and the item count.
  The item *kind* ("Sectoid corpses") is not in the INI; keep it from
  tech.json with the count from the INI.
- Report what was found: how many techs were overridden, which changed
  from the default, any line that could not be matched. A player who
  loads the wrong file should be able to tell.
- Keep the loaded INI across reloads (browser storage), with a way to
  clear it.

## Facts

- `samples/DefaultGameCore.ini` has 75 TechBalance lines matching the 75
  techs; lines ~2978–3060. Other balance sections (`ItemBalance_*`,
  `FoundryBalance`, `LAB_BONUS=0.2`, `LAB_ADJACENCY_BONUS=0.1`) are there
  for later features.

## Worth

Small: an hour or two.

## Report (2026-10-18)

**What changed.** `src/model/ini.ts` parses `TechBalance` lines (comments
stripped, tabs and spacing tolerated) and applies them to the techs;
`src/state/store.ts` loads a picked or dropped file, decides by content
whether it is a save or an INI, keeps the parsed balance in
localStorage, and reports the outcome in a line under the header
("costs for 75 techs; 1 differs from stock Long War 1.0", unmatched
lines and missing techs counted). Nodes whose cost the INI changed carry
an "ini" badge; the detail panel says so too.

`tech.json`: tech 60's `config_key` is now `"eTech_Placeholder"`, which
is what the INI writes. Note the shape: `config_key` for 61–75 is a JSON
number, and `enum` for 60–75 is `eTech_Placeholder` (Long War's extended
enum, 60 + n). The parser resolves by config key, enum name, or number.

**Verified.** Unit tests for name/number/placeholder resolution, comment
handling, unmatched lines, and applying a cost with the item count
rewritten ("8 Sectoid corpses"). The sample INI covers all 75 techs and
matches tech.json exactly. In the browser (Playwright, built site): an
INI with Plasma Weapons changed to 60 days reports one difference, the
node shows the badge, and both survive a reload.

**Left open.** An INI line giving items to a tech whose tech.json item
text is null keeps the null (the INI has the count but not the kind); no
such case in Long War 1.0.
