---
title: "Soldiers in 3D in the app (a time-boxed try)"
status: review
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
