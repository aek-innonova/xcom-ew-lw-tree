---
title: "Items in the game settings: every item's numbers, not just its mobility"
status: done
priority: 3
dependsOn:
  - game-settings-ux
---

## Purpose

The game settings offered "item mobility" for some 150 items, because the
person's own edits changed the arc thrower's mobility. The person
(2026-10-20): "does it really make sense to just offer mobility of the
items randomly and not just full item configuration - the fact that i chose
to mod mobility on the arc thrower isn't really a strong signal that
mobility is something you generally want to fiddle with".

Long War's DefaultGameCore.ini holds much more per item, on up to four
lines: what it costs to build, its weapon line, its armor line, and the
extra stats it gives whoever carries it. This feature offers all of that,
item by item, in plain terms.

## What a player sees

**Items**, in place of "Item mobility":
- A list of the items under the file's own headings (grenades, armor,
  ballistic, laser … small items), with a search. An item with values of
  the player's is marked.
- The picked item's card, in parts. A part shows only where the item has
  that line in the file:
  - **To build:** credits, elerium, meld, alloys, days, engineers. Long War
    packs meld into the elerium number, and the perk granted into the
    alloys number (thousands and up). Each is shown on its own; the perk
    number stays as it is. "−1" is "not set here", shown as such.
  - **As a weapon:** damage, critical chance, aim, range, environmental
    damage, radius, and ammunition: shots with and without Ammo
    Conservation (Long War's `xxyy` in iSuppression).
  - **As armor:** HP, defense, will, mobility, large and small item slots,
    flight fuel.
  - **Carried:** mobility, defense (weapons and items), aim (armor),
    damage reduction (the file's 5 is 0.5), the chance the item is damaged
    after a mission in which its carrier went down.
- Values are written back in the file's own form, touching only their
  field.

## Rules

- An item is its `BalanceMods_Classic` line (eType, a number) and the
  `ItemBalance_Normal` line just above it. Its name is the comment above
  those. Its `Weapons=` and `Armors=` lines are found by its enum name
  (`eItem_…`), read from the game's XComGame.upk (`EItemType`). Long War
  reuses enum slots, so a number's name is the enum's, whatever it once
  meant. Without the enum, an item shows only its cost and carried parts.
- Packed numbers (thousands for meld and perk, hundreds for ammo, tenths
  for damage reduction) are taken apart for reading and put back for
  writing, keeping the other half.
- Settings saved as `item-mobility.<eType>` come back as the carried
  mobility of the same item.

## Verification

- Unit tests on Long War's and LWR's files: the arc thrower's, the
  medikit's, the assault rifle's and carapace armor's parts found, with
  their values. Packed values read and written. The old ids carried over.
- The desktop e2e: an item's value set in the card is written to the right
  field.
- The bench on the person's install: a weapon's damage, an armor's HP, a
  cost and a carried mobility applied, and the file differs only there.

## Report (2026-10-20)

- `itemSettings` in `src/model/gamesettings.ts` turns every
  `BalanceMods_Classic` line into an item card's settings (`item.<eType>.<field>`):
  - **To build:** credits, elerium, meld, alloys, days, engineers. Found
    by the build line's own way of naming the item, taken from the line
    above, or by number. −1 is "not set here", an empty field.
  - **As a weapon, as armor:** found by the enum's name. Damage, critical
    chance, aim, range, damage to cover, radius (in tiles: 96 units to a
    tile), shots with and without Ammo Conservation. HP, defense, will,
    mobility, item slots, flight fuel.
  - **Carried:** mobility, defense, aim, damage reduction (shown as 0.5
    for 5), chance of damage.
- **Packed numbers** are a general mechanism now (`Packed`: by 100 or
  1000, high or low part), on key lines and struct fields alike. Point
  costs, meld and elerium, alloys and the perk, and ammo all use it.
  Writing a part keeps the other.
- Struct lines are found through an index built once per file. Long War's
  file gives 2,158 item fields for 152 items, read in about 25 ms.
- `ItemsPanel.vue`: the list under the file's headings, with a search and
  the count of the player's values per item. The card shows the game's own
  picture of the item and its parts. Fields that are 0 and mean nothing
  for the item are hidden (ammo on a grenade, radius on a rifle). Armor
  shows its own mobility and defense; weapons and items show the carried
  ones.
- `item-mobility.<eType>` values come back as `item.<eType>.mobility`
  (settings.json and setups).

Verified:
- Unit tests on Long War's file:
  - The Mimic Beacon: cost 150, meld 25, elerium 25, alloys 2, 14 days.
  - Long War's assault rifle (enum slot ExaltAssaultRifle): damage 4,
    crit 8, 3 shots, 4 with Ammo Conservation.
  - Carapace: HP 5, mobility +1, 2 small slots.
  - Meld 30, 5 shots and HP 6 written as `iElerium=30025`,
    `iSuppression=405` and `iHPBonus=6`, three lines changed and nothing
    else. Without the enum, an item keeps its build and carried parts.
- Desktop e2e: the arc thrower's credits set on its card are written as
  `iCash=120`, and its mobility shows −2.
- Screenshots: the arc thrower's, the carapace's and the assault rifle's
  cards.
- On the bench (the person's install, site 2026.1020.172432):
  - The person's arc thrower mobility edit came through the rename, marked
    as theirs, and is still written.
  - Assault rifle damage 5, carapace HP 6, mimic beacon meld 30 and
    medikit mobility 0 were written as exactly those four fields, beside the
    person's 14 lines.
  - The stats table's ranges match 2 × base − lowest, and the female face
    looks right zoomed in. Nothing is cut off at 1280 × 752.
- From the bench's notes: the weapon line's part is "When used" (a
  medikit has one too). Build costs a version leaves to the game (−1) are
  said in one sentence ("Its cost, build time and engineers are not set in
  this file") instead of as empty fields.
