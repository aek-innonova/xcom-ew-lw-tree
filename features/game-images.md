---
title: "The game's own pictures in the app (a time-boxed try first)"
status: in-progress
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
