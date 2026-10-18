---
title: Load the player's DefaultGameCore.ini for costs
status: planned
priority: 2
dependsOn: []
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
