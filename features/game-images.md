---
title: "The game's own pictures in the app (a time-boxed try first)"
status: review
priority: 4
dependsOn: [desktop-app]
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
