---
title: "Game settings in the player's terms: rules per version, not the INI passed through"
status: review
priority: 3
dependsOn: [game-settings, game-soldiers]
---

## Purpose

The game settings section (features/game-settings.md) finds the right lines
and writes them safely, but it still shows the file's own shapes: a point
cost as "xxyy" to be typed as one number, the same comment ("Mobility while
carried…") under every one of 150 items, LWR options named by the first
clause of their comment, a fraction where a percentage is meant. The person,
on trying it (2026-10-20): "we could solve that for the user instead of just
passing it through verbatim … worth just creating a set of rules for each
game type instead of just passing through what's in the ini file". Also: the
page's scrollbar sits in the middle of a wide window, and the soldier would
sit better beside the class colors, with a class picked by clicking its row.

## What a player sees

**Each setting in its own terms.** A setting knows what kind of value it is,
and is edited and described that way; the file's form is only how it is
written:

- **Two numbers in one** (Long War's `xxyy` point costs): two fields,
  "Defense 1, Mobility 4", written back as `104`.
- **A percentage stored as a fraction** (psi gift 0.45): edited as 45 %.
- **A multiplier** (arc thrower stun 0.61): "× 0.61".
- **Hours**: with days beside them where it helps ("1320 hours, 55 days").
- **On/off** where the file uses 0 and 1 (LWR's "Set to 1 to …"): a
  checkbox, written in the file's own form (`1`, `1.0f`).
- **A choice** where the file lists meanings (LWR barracks order: by class or
  by rank; mouse buttons: shown or hidden): a list of those meanings.
- **Limits** the file states (LWR "min 1, max 255") are kept to.
- **The version's own value** is said in the same terms ("Long War: 1 and
  4", "LWR: 45 %"), not as the raw number.
- **Floats keep their form**: LWR writes `4f`, `0.5f`; a new value is written
  the same way.

**Explanations once.** A group says what its numbers mean once, at its top
(item mobility: "what carrying the item does to mobility; negative slows
the soldier"); a row carries only what is particular to it. The file's
comment stays available but is not the text.

**LWR's options named and placed by hand.** LWR's 22 options (keyed by its
"(LWR Default = …)" comments, on keys that mean other things elsewhere) get
names and places: interface (cinematics, barracks order, mouse buttons,
popups, game speed, stats display), combat (Psychic Tether, panic from
damage, environmental damage), soldiers (gender chance, stat gains, quirks,
fatigue per mission), campaign (panic guard rails, alien level growth),
second wave (Blitzkrieg, Wild West, Wolverine Blood). An LWR option this
table does not know still shows, named from its comment as today.

**Item mobility by kind.** Grouped under the file's own headings (grenades,
armor, ballistic, laser, gauss, pulse, plasma, SHIV and MEC items, small
items), as a compact grid of name and value, with a search.

**The soldier's looks as one table.** Class colors and the rookie's
appearance become one group: a row per class (the rookie first, with its
deco), columns for color and headgear, the colors with a swatch of the
armor tint. Clicking a row puts that class on the soldier and marks the
row. The soldier stands beside the table when the window is wide enough,
above it when not. LWR's "armor tint on promotion" option sits here too.

**The page scrolls at the window's edge**, not at the middle of a wide
window; the content keeps a readable width.

## Rules per version

The rules are data, next to the catalogue (`src/model/gamesettings.ts`):
each catalogue entry and each listed kind (class colors, item mobility, LWR
options) carries its format, its group's explanation, and, for LWR, a
table by key. Plain EW finds only a few settings today; that stays as it
is unless a setting is easy to tie to an EW line.

## Verification

- Unit tests: each format read and written back to the file's exact form
  (`104` ↔ 1 and 4; `0.45` ↔ 45 %; `4f` ↔ 4 → `5f`; `1.0f` on/off; limits);
  the LWR table finds every option in LWR 2.06 by its comment, and an
  unknown one falls back; item mobility gets its kind from the headings in
  LW 1.0 and LWR.
- The desktop e2e for game settings keeps passing, rewritten where the
  inputs changed (point costs as two fields, colors as a list).
- Screenshots of Long War and LWR in a wide and a narrow window, every group
  open.
- The bench on the person's install: values written by the new fields equal
  what the old ones wrote for the same choices.

## Report (2026-10-20)

**Rules, as data** (`src/model/gamesettings.ts`, `src/model/settingformat.ts`):
- Every catalogue entry says what kind of value it is: plain number (with
  a unit and limits), hours, percentage (the psi gift kept as a fraction in
  the file), multiplier, two-in-one (`xxyy`), on/off, a choice. One module
  turns the file's value into fields and back, keeping the file's form
  (`4f` stays `5f`, `1.0f` becomes `0.0f`), and says a value in words
  ("Defense 1, mobility 4", "45 %", "× 0.61", "1320 hours (55 days)").
- Groups have an order and say what their numbers mean once (`GROUPS`).
  Rows carry the app's own help only; the file's comments are no longer
  shown as help (they repeated the name, or said "hours").
- LWR's 22 options are named and placed by hand: Soldiers, Campaign,
  Combat, Second wave, Interface, and the promotion colors under Class
  colors. Each is tied to its key and to words in its comment, so a key
  that changes meaning falls back to the comment's words in an "LWR
  options" group. All 22 of LWR 2.06 are matched.
- Item mobility gets its section from the file's own headings in the item
  list. The small-item headings ("Human-mec small items", "Humanmec-shiv
  small items" and so on) are folded into "Small items", and MEC and SHIV
  items keep their own sections.

**The page** (`ToolsView.vue`, new `SettingRow.vue`, `SettingField.vue`,
`SoldierLooks.vue`):
- The Tools page scrolls at the window's edge. Text keeps 980 px; game
  settings get up to 1400 px.
- Rows line up in a grid: name, editor, what is particular to it. A value
  of yours is marked, with the version's own in words beneath and × to go
  back. Below 1000 px wide the help goes under the editor.
- Item mobility is a compact grid per section, with a search.
- Class colors is one table: a row per class (the rookie first, with its
  deco as a list of the Kevlar decos named from the game's enum), a swatch
  of each color's tint, the headgear by name. Clicking a row or using its
  fields shows that class on the soldier; the soldier stands beside the
  table, or above it when the group is narrower than 860 px.
- The soldier's own controls (armor, gender, face, hair) sit under it,
  styled like the rest; its "Color of" list went, since the table picks.

Verified:
- Unit tests: each format both ways, limits, the LWR table finds all 22
  options, item sections in LW 1.0 and LWR (`settingformat.spec.ts`,
  `gamesettings.spec.ts`).
- Desktop e2e: the point cost entered as Mobility 6 is written as
  `ROOKIE_MOBILITY=106`, the psi gift as 25 % is written as `0.25`, and the
  version's own value is said in words.
- Screenshots of Long War and LWR at 1900, 1100 and 900 px wide, every
  group open.

Not done:
- Plain EW still finds only the eight settings it found before; its file
  has few comments to tie a setting to.
- The "Any line of DefaultGameCore.ini" section is unchanged.
- On the bench (the person's install, site 2026.1020.163521):
  - **Long War:** Mobility 6, psi gift 25 %, Scout 18 from the table's
    list and Medikit 0 were written as `ROOKIE_MOBILITY=106`,
    `PSI_GIFT_CHANCE=0.25`, `HQ_BASE_POWER = 18` and `iMobility=0`. Only
    the value token changed on each line, beside the person's own 14.
  - **LWR:** game speed 5, unit stats off and War Record popups off were
    written as `5f`, `0.0f` and `1`, and nothing else changed.
  - Class rows, × and the limits behave as meant.
- The bench found that the class table's hidden labels, placed against the
  page rather than the Tools scroller, made the whole window scrollable:
  wheel far enough and the app scrolled off into a blank window. The
  scroller is now their positioned ancestor. The desktop e2e checks that
  the page is no taller than the window; without the fix it fails by 575
  px.
- Also from that round: an emptied field goes back to the version's
  value; a refused value says what was kept ("At most 10; kept 4"); LWR's
  "Leater Jacket" is spelled right.
