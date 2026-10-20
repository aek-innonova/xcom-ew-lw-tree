---
title: "Soldiers in 3D in the app (a time-boxed try)"
status: in-progress
priority: 5
dependsOn: [game-images]
---

## Purpose

The person asked whether showing the game's soldiers in 3D (WebGL) in the
desktop app, for example while choosing class colors, would be absurd. A
try first, about two hours, to judge from something real.

## Report (2026-10-19): the try

Done against the person's install (`samples/`), rendered offline to
check, no WebGL yet. Code: `src/model/skelmesh.ts`, whole-file package
decompression in `src/model/upk.ts`, `unchunk` in `src/model/lzo.ts`;
tests in `src/model/__tests__/skelmesh.spec.ts` (skipped without
`samples/`).

What works:
- **The body mesh.** The Kevlar soldier's body
  (`Soldier_MaleKevlar_SF.upk`, `SM_Lv1MedMale`) reads whole: 109 bones,
  two sections (body, shoulder flag), 4,856 triangles and 3,091 vertices
  in the rest pose (position, normal, UVs). Skinning is not needed for a
  standing soldier. The layout follows UE Viewer's description (MIT) with
  one field more in this game's vertex buffer header; it differs from
  UE Viewer's "XCOM" branch, which is The Bureau's.
- **Its textures.** Diffuse, normal and specular, 2048², are in
  `CharTextures.tfc` (568 MB), LZO-compressed. The texture reader already
  found where; reading the slice and `unchunk` gives DXT that decodes
  right (rendered at 1024²).
- **The class colors.** `UnitPalettes.ArmorTint` is in `Startup.upk`,
  a package compressed whole, which the reader now opens. It holds 32
  entries of a primary and a secondary color; entry 0 is Long War's "tan
  top with black bottom". The material's default `CMOD`/`CMODB` are the
  same kind of pair.
- **Tinting.** The cooked material keeps only its parameters; the cooker
  stripped the expression graph, and the maths is in compiled shaders.
  The specular texture's alpha channel is plainly the primary tint's mask
  (chest plates, shoulder pads): tinting through it in the render gives
  the plates the palette's color (tried: tan, red, black). The blue
  channel looks like the secondary mask, but tinting through it changed
  less than expected: the thigh panels stayed tan. Where the rest of the
  secondary tint comes from is not found yet.

What it would take:
1. A WebGL view in the app (no library needed for this much: one mesh,
   one shader): the body, textured, turnable, lit simply. **About a day.**
2. A soldier put together. Heads, hair, helmets and decos are separate
   meshes in other packages, attached by bone or socket. Each armor
   (Kevlar, Carapace, Skeleton, Titan, Ghost, Archangel, Psi, the MEC
   suits; male and female) is its own package. Skin and hair colors come
   from the other palettes in `Startup.upk`. **One to three days**,
   depending on how the attachments read.
3. Colors right: our own shader approximating the game's. The primary
   tint looks right already; the secondary needs finding, and lighting
   will differ from the game's. Close, not identical.

Recommendation: worth it as a preview for the class colors and
appearance settings (features/game-settings.md), starting with step 1
and the primary tint: a soldier in each class's color beside the
setting. Steps 2 and 3 only if step 1 looks worth having. The person
decides.

## Response (2026-10-20)

The person: try going further, as long as it makes progress, until 2 pm.

## Report (2026-10-20): the soldier in the app

In Tools, Game settings, "Class colors" has a 3D soldier beside the
settings (`src/components/SoldierPreview.vue`, `SoldierView.vue`,
`src/state/soldier.ts`).

**How it is put together**, all from the player's install:
- **The armor:** the armor's body (`Soldier_<Gender><Armor>_SF.upk`) and
  its deco over it. The deco is the armor's own from `ArmorDeco` in
  `DefaultContent.ini`, through `ArmorKitPackageInfo`; for the rookie it
  is the rookie deco setting. Long War's deco numbers are `EArmorKit`
  values (67 is `eKit_Deco_Kevlar0`), read from XComGame.upk
  (`readEnum`).
- **Head and hair:** heads, hair and helmets are the game's own lists
  (`HeadPackageInfo`, `HairPackageInfo`). A class's headgear setting puts
  its helmet on: Long War's headgear numbers are hair ids marked
  `bIsHelmet`. Hair and helmets hang on the head's socket (`RigHead`),
  placed by the bones' rest pose.
- **Textures:** up to 1024 wide, from the package or `CharTextures.tfc`
  through ranged reads. Diffuse, the masks, and normal maps.

**Colors:**
- **Class colors:** Long War's color n is the armor tint palette's entry
  n (`UnitPalettes.ArmorTint`, `Startup.upk`), as Long War's own picture
  of the colors shows; its text list is one off in places. Checked
  against that picture: 1 grey-cyan, 2 olive, 3 orange, 5 red, 17 red
  with yellow side panels and crotch piece.
- **Where they go:** the top color goes where the specular map's alpha
  says, the bottom where its blue says. The top has the say where they
  overlap (Titan, Ghost and Archangel lay one inside the other). Each
  masked part is scaled so its average is the color.
- **Skin:** the heads share one skin texture; each head's `SkinColor`
  colors it through the skin mask (the third channel of its specular
  map).
- **Hair:** colored from the `HairColor` palette.
- **Shading:** our own, not the game's. Diffuse, normal map, a highlight
  from the specular map's red, plain lights.

**In the app:**
- **Choices:** whose color (each class, or the rookie with the rookie's
  headgear and deco), armor (all seven), gender, face, hair, hair color.
  Drag to turn, wheel to zoom.
- **No GPU:** the app allows Chromium's software WebGL (desktop 0.3.4),
  as Chromium no longer falls back to it on its own. The window only
  loads the app's own site.

Verified:
- In the app on this machine, on the person's packages (software WebGL
  under xvfb): every armor, male and female, colors, headgear, faces,
  hair and its colors, by screenshot.
- Unit tests: the material, the palette (17 red with yellow), the hair
  placed on the head (`src/model/__tests__/material.spec.ts`).

Not done:
- The game's own lighting and reflections (cube maps).
- Animation: a standing rest pose only.
- Weapons and the MEC suits.
