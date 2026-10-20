---
title: Grey market inventory
status: done
priority: 5
dependsOn:
  - save-parser
---

## Purpose

What could be sold on the grey market, how many of each are in stores,
and how many remaining research and Foundry projects still need, so the
spare can be sold without starving them.

## Report (2026-10-18)

**Data.** Prices: the INI's loot `ItemBalance_Normal` lines (and the
player's INI if loaded); China's Xenological Remedies raises corpse and
wreck prices when the campaign has it. Stock: `XGStorage.m_arrItems`,
indexed by Enemy Within's item enum, for which no published list exists
(searched); the slots were found in the save history:
- Foundry `kOriginalCost.arrItems` against the INI's required item:
  e.g. Drone wreck 147, Meld 164, UFO Flight Computer 168.
- research starts removing a tech's items from stock: corpses 134–147,
  captives 150–157, elerium 161, alloys 162, fragments 163, UFO Power
  Source 170, Outsider Shard 159, Hyperwave Beacon 171.
- Heavy Floater, Muton Elite and Ethereal captives (153, 156, 158)
  follow the INI's captive order between confirmed slots.
- Not found: Alien Entertainment, Alien Food, the damaged artifacts, the
  Fusion Core, the alien heavy weapon. Nothing consumes most of them, so
  research starts cannot reveal them; matching grey market sales to cash
  changes was tried and is too noisy (funding and purchases). They are
  listed with their price and needs, stock shown as "–".

**What changed.** `src/model/inventory.ts` (catalog, needs, INI prices),
the campaign readout's `stock`, a **Grey market** tab: grouped table of
item, in stores, needed, spare, price, spare value, and what needs it
(links to the tech or Foundry project). Techs already started and
Foundry projects being built have paid and do not count. The header's
privacy note is shortened to fit the extra tab (the help has the full
text).

Also in this round: the Ethereal's "everything" credit is no longer
listed out; its panel says it in one line, and Stats calls it "All
research".

**Verified.** Unit tests (matching similar names, needs from scratch and
for save1738, stock read, the sample INI's prices). Checked on screen
with save1738.

**Left open.** The unmapped artifacts; item builds (weapons, armour) are
not counted in "needed" for resources.

## Report (2026-10-18, round 2)

The person added their install's Config, CookedPCConsole and engine INT
folders to `samples/` (git-ignored). The game's localization (.int under
XComGame) was not among them and turned out not to be needed.

`scripts/upk.py` reads uncompressed Unreal Engine 3 packages (Long War
ships its script packages decompressed); `scripts/upk_enums.py` writes
`data/enums.json` with EItemType, ETechType, EFoundryTech, EFacilityType
and EResearchCredits from XComGame.upk. Results:
- Every slot found from the save history matched EItemType; the rest are
  now known (Alien Entertainment 165, Food 166, damaged artifacts
  172–178, Fusion Core 179, alien heavy weapon 47). The catalog takes its
  slots from the enum by name; no item is left without a stock count.
- ETechType and EFoundryTech match tech.json's and longwar_foundry.json's
  ids; EFacilityType matches the facility numbers recovered earlier.
- EResearchCredits has the ten credit slots under vanilla names; slot 9
  (AllTech) is the Ethereal's credit, closing that question.
- Fusion Core now counts as needed for Fusion Weapons (kept, not
  consumed, but selling it would block the research).

Tests: enum slots agree with the history-derived ones; credit slot 9.
