---
title: "Game settings a player can read: soldiers, the arc thrower, class colours"
status: done
priority: 3
dependsOn:
  - game-tools
  - game-bases
---

## Purpose

Tools' Settings box (features/game-tools.md) sets any `KEY=value` in
DefaultGameCore.ini, found by searching the file. That suits someone who
knows the file. The person kept a text file of the changes they make by
hand after every install (`manual.changes.txt`). Compared with Long
War's own file, those changes are:

- the soldier's base HP 4 → 5 and mobility 13 → 14 (fields inside the
  `Characters=(… iType=eChar_Soldier …)` line);
- rookie ranges: `LOW_MOBILITY` 11 → 13, `HIGH_WILL` 3 → 4 (despite its
  name, the minimum starting HP), `ROOKIE_MOBILITY` 104 → 103;
- `NUM_STARTING_SOLDIERS` 40 → 60;
- `PSI_GIFT_CHANCE` 0.45 → 0.65;
- `UFO_PSI_LINK_SURVIVE` 0.61 → 0.85 (despite its name, the arc
  thrower's stun chance);
- the arc thrower in the pistol slot: the file carries a second
  `Weapons=` line for it, with a comment saying how to switch;
- the arc thrower's mobility cost: `BalanceMods_Classic=(eType=73, …
  iMobility=-2 …)` → 0;
- class colours: the `HQ_BASE_POWER` lines labelled "Sniper Color",
  "Scout Color", and so on.

The person wants a UI for settings like these, not a way to edit the INI
better: "arc thrower as pistol" as a checkbox, "soldier base HP" as a
number, the arc thrower's movement cost, and most such values, in words a
player uses.

## The shape

- **A catalogue of named settings**, grouped as a player thinks of them:
  - soldiers;
  - rookies;
  - the campaign;
  - psionics;
  - the arc thrower and other items;
  - class colours.

  Each setting has a name, a line of help (from the file's own comment
  where it has one), the version's own value, and the player's. Each
  knows where it lives in the file:
  - a plain key, or one occurrence of a repeated key, told apart by its
    comment;
  - a field inside a struct line picked by its `iType` or `eType`
    (`Characters`, `Weapons`, `Armors`, `BalanceMods_*`);
  - a choice between alternative lines the file carries, one commented
    out, as for the pistol-slot arc thrower.
- A setting the chosen version's file does not have is not shown. LWR's
  file differs from Long War's.
- **Adopting the player's hand edits.** The app knows the version's own
  file: the base's, or the original kept in `lwtree-backup/`. It lists
  where the game's file now differs, by setting where the catalogue
  knows the line, and offers to keep them as the player's settings. After
  that a reinstall or another version keeps them.
- The search over the whole file stays, for everything else.
- Settings are kept in `settings.json` (features/game-bases.md) and
  written when the setup is applied, like the INI settings today.

## Requirements

- Every catalogue entry is checked against Long War's and LWR's own
  files: it finds its line, its version value reads right, and writing a
  value changes only that field.
- A struct-field write keeps the rest of the line byte for byte (spacing,
  comments).
- The settings the player has today (key, occurrence, value) keep
  working.

## Verification

- Unit tests:
  - each kind of setting (plain, labelled repeat, struct field,
    alternative line) on Long War's and LWR's real files (git-ignored
    samples, skipped without);
  - adopting the person's own edited file gives exactly the changes
    listed above.
- An Electron test through Tools.
- On the bench, with Long War put in by the app: the person's changes
  set through the UI, applied, then compared with their hand-edited
  file (ignoring whitespace).

## Report (2026-10-19)

Built and verified on the bench. App 0.3.1 and its site are on staging.

- **The catalogue** (`src/model/gamesettings.ts`) finds each setting by
  its key together with the comment the version's file gives it:
  - plain keys, and labelled repeats (class colors);
  - fields inside struct lines (the soldier's HP and mobility, each item's
    mobility in `BalanceMods_Classic`);
  - Long War's alternative lines (the arc thrower in the pistol slot, a
    checkbox).

  LWR reuses Long War's keys for other things (its
  `NUM_STARTING_SOLDIERS` is the male gender chance), so key and comment
  together keep each version's meaning. LWR's own options are listed from
  their "(LWR Default = …)" comments. Writing a value changes that value
  only; the rest of the line stays byte for byte.
- **Colors and headgear** are named from Long War's own Armor Kit codes.
  The app reads them from the game folder (where Long War's installer
  puts them) or from the Long War installer's notes (`bases:doc`, new in
  shell 0.3.1).
- **Hand edits.** Where the game's file differs from the version's own
  (the base's, else the original the app kept), the edits are listed
  and can be kept as the player's settings. On the person's own file
  that is exactly the 14 changes of their manual.changes.txt.
- **By version.** Each version keeps its own settings. The bench found
  the first cut applying Long War values to plain Enemy Within as
  absolute numbers, and handling missing settings unevenly between LWR
  and EW. A kept setting the version's file lacks is now named in the
  plan.

Verified:
- **Unit tests** on Long War's, LWR's and the person's real files:
  - each kind of setting;
  - LWR's reused keys not offered as Long War's;
  - the person's hand edits read back as exactly their list;
  - setting those 14 on Long War's own file gives the person's file but
    for spacing.
- **An Electron test**: hand edits kept, then a number, a checkbox and a
  color set and written.
- **On the bench:**
  - with Long War put in by the app and the person's file copied over
    it, the 14 edits were found, kept and applied;
  - the result equals the person's file ignoring whitespace (2,984
    lines);
  - the color dropdowns are named;
  - on LWR and plain EW, after the per-version fix, nothing of Long
    War's is applied and nothing is reported.
