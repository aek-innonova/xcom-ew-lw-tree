---
title: The game's own pictures in the app (a time-boxed try first)
status: done
priority: 4
dependsOn:
  - desktop-app
---

## Purpose

The desktop app reads a real install. The game carries the pictures a
player knows: research and Foundry icons, items, UFOs and interceptors,
even soldiers. The person asked whether the app could borrow them. The
website stays as it is: it has no install to read, and nothing of the
game is ever served from it or put in this repository.

## What is known

- The strategy screens name their pictures as
  `img:///UILibrary_StrategyImages.ScienceIcons.…` (in
  XComStrategyGame.upk). No package of that name is in CookedPCConsole,
  so the pictures are cooked into another package, likely a compressed
  one (UICollection_Strategy_SF.upk is LZO-compressed).
- Pictures in UE3 are `Texture2D` objects. Their pixels are often not in
  the package but in `Textures.tfc` (1.7 GB), in DXT1/DXT5, with each
  piece LZO-compressed.
- The air war's ships are in `gfxInterception_SF.upk` (Flash/Scaleform
  movies, whose images may be inside the movie or textures beside it).

## The try (time-boxed: about two hours)

Find where one research icon really lives and show it in the app from
the person's install. That means:
- LZO-decompressed packages;
- a `Texture2D` read: its size, format and where its pixels are;
- the pixels taken from the package or the `.tfc`;
- DXT decoded to an image.

If that works, the same for one UFO and one interceptor. Then report: what
worked, what it would take to cover the tree, the Foundry, the items and
the air war, and a recommendation. Soldiers are 3D models and out of
scope for the try.

## If it goes ahead (after the report)

- The app shows the game's pictures where the site has its own: research
  nodes, Foundry projects, items, the air war's ships.
- Read from the install on demand, cached on this machine only.
- The website unchanged.
- Never uploaded, never in the repository.

## Report (2026-10-19): the try worked

About an hour, against the person's install in `samples/`. Code in
`src/model/lzo.ts`, `src/model/texture.ts` and `decompressPackage` in
`src/model/upk.ts`.

- **Where the pictures are.** The cooker's own index
  (`GlobalPersistentCookerData.upk`) names the packages that carry
  `UILibrary_StrategyImages`: `XComShell.upk` and `Command1.upk`, both
  LZO-compressed. They unpack in about 60 to 140 ms (XComShell 9.3 MB to
  21.6 MB) and read as ordinary packages.
- **What they hold**, all with the full-size picture inside the package
  (none in `Textures.tfc`), DXT1/DXT5:
  - `UILibrary_StrategyImages`:
    - 90 research images (ScienceIcons);
    - 89 inventory items (InventoryIcons, `Inv_ArcThrower`…);
    - 25 facility cards, 11 gene mods, 21 medals;
    - 6 interceptor weapons;
    - captives, corpses, artifacts and credits.
  - `gfxInterception_SF.upk` (the air war's screen): six UFOs side on at
    1024×256 (Small and Large Scout, Abductor, Supply Ship, Battleship,
    Ethereal), the Interceptor's and Firestorm's frames, and the battle's
    icons.
  - `UICollection_Strategy_SF.upk`: `interceptor_hi`, `firestorm_hi`, and
    the soldier class and rank icons used in the barracks.
- **Checked by eye**: research images, items, interceptor weapons, both
  craft and two UFOs decode right, alpha included. A test keeps one
  research image's hash (from the person's files) and hand-made LZO and
  DXT cases.
- Not needed for these: the `.tfc` caches. The reader knows where a mip
  in a cache is, but does not yet fetch it.

What it would take to use them:
- In the app's main process: index the pictures once per install (open
  the few packages, list the textures by name), and serve one as PNG on
  request, cached on the machine.
- In the site, only in the app: show them where the site has its own. The
  site's ids map to the game's names:
  - techs to `IC_*` (the game's own `img:///` paths are in
    XComStrategyGame's defaults and LW's INI);
  - items to `Inv_*`;
  - Foundry projects to their images;
  - UFOs and craft in the air war.
- Soldiers are 3D models (meshes, materials, armor tints) and are not
  pictures; the barracks' class icons are.

Recommendation: go ahead with research, items, Foundry, facilities, the
air war's UFOs and craft, and class icons. Leave soldiers out unless the
person wants to spend real time there.

## Response (2026-10-19)

The person: go ahead with the full feature; the website stays as it is.

## Report (2026-10-19): the pictures in the app

What the app shows, from the player's install
(`src/state/gameimages.ts`):

- **Research**: each tech's picture at the top of its panel.
- **Foundry**: each project's picture at the top of its panel.
- **Grey market**: each item's picture beside its name.
- **Air war**: the game's interception pictures for the UFOs and the
  Interceptor. The Firestorm uses its research picture, as the
  interception screen has no matching view of it. The Skyranger keeps
  our render; the game has no picture of it.

How it works:

- **Which picture is whose** is the game's own table, not ours. Long War
  moved it out of code: `UIUtilities.GetTechImagePath` and its siblings
  read `MultiplayerLoadoutSlots` from `DefaultContent.ini` by category
  (0 items by item id, 2 research, 3 Foundry, 4 research credits). The
  app reads that table from the install, so a version that changes it
  is followed.
- **The air war's ships** carry the game's image numbers (`image` in
  `data/airwar.json`): 80 to 85, where Long War's extra UFOs share their
  parent's. These map to the interception screen's
  `gfxInterception.alien_*` in code. Those numbers are not in the table.
- **The packages read** are `XComShell.upk`
  (`UILibrary_StrategyImages`), `LongWar.upk` (Long War's own `TechImages`,
  `FoundryImages`, `InventoryImages`, class icons, flags),
  `gfxInterception_SF.upk` and `UICollection_Strategy_SF.upk`. They are
  read when the app reads the install, in the background, and decoded
  only when a picture is first shown (DXT to a canvas, a data URL: the
  page's security policy allows `data:` images and nothing from
  outside).
- Without an install, and on the website, nothing changes.

Verified:
- On the person's files: every one of the 75 techs, the 46 Foundry
  projects and the 13 ships but the Skyranger have their picture in the
  install (`src/state/__tests__/gameimages.spec.ts`; skipped without
  `samples/`).
- Looked at in the app (a small game folder with the person's packages
  and Long War's Config): Xenobiology's and Enhanced Ballistics' panels,
  the grey market's corpses, the air war's UFOs and Interceptor.

Not done:
- The tree's hover cards, which have a fixed height in the SVG layout.
- Medals and class icons, which the site has no place for yet.
- Soldiers (3D): a separate try, to judge first.

## Report (2026-10-19): on the Windows bench

Through the installed app (0.3.1, which took the new site by itself):
- **Long War 1.0, put in by the app:** every place right and decoded
  clean.
  - Research: Xenobiology, and Long War's own Gauss Weapons.
  - Foundry: SHIV Suppression.
  - Grey market: 45 of 50 rows with a picture. The other 5 have none in
    the table, and show none rather than a broken box.
  - Air war: the game's Interceptor and the 12 UFO cards; Long War's
    extras share their parent's picture, as in the game.
  - The first picture is up 5 to 7 s after the app starts.
- **LWR 2.06, with its own DefaultContent.ini:** the same places all
  match their names.
- **Plain Enemy Within:** no table, so no research, Foundry or item
  pictures, and the panels show none cleanly. The air war still has the
  game's ships (gfxInterception is the game's own).

Fixed on the way: on the LWR tree a panel's category line ended in a
bare "·" (the separator before the UFOpaedia link, which only Long War
has).

Left open:
- A fallback by name (`Inv_*`, `IC_*`) for plain EW, which has the
  pictures but not Long War's table. The site models Long War only.
