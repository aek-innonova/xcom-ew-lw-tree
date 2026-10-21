---
title: Soldiers in 3D in the app (a time-boxed try)
status: done
priority: 5
dependsOn:
  - game-images
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
  wherever the pose puts the head.
- **The pose:** the soldier stands at ease and breathes, in the game's own
  barracks idle (`Loadout_DressUniform_IdleA` in `Anim_Barracks.upk`, a
  3.3 s loop). Every key of its per-track compressed tracks is read, with
  each track's frame table (`src/model/anim.ts`), and sampled about 30
  times a second. Body, head and deco are skinned to it by bone name, each
  vertex by its bones' weights (`poseMesh`, about 2 ms a frame). The
  animation stores rotations conjugated relative to the skeleton's rest
  pose. The set is not rotation-only, so the animation's bone positions
  count too; without them the shoulder pads stood out like wings. It moves
  only while on screen, not when the system asks for reduced motion, and
  not without a GPU: drawn in software (SwiftShader, as on the Windows VM)
  it cost about 2.6 cores while visible, so there it stands still in the
  idle's first frame. Without the package the soldier keeps the rest
  pose, arms out.
- **Textures:** up to 1024 wide, from the package or `CharTextures.tfc`
  through ranged reads. Diffuse, the masks, and normal maps.

**Colors:**
- **Class colors:** Long War's color n is the armor tint palette's entry
  n − 1 (`UnitPalettes.ArmorTint`, `Startup.upk`); 0 is the armor's own,
  the vanilla default. Long War's Armor Kit list agrees entry by entry (5
  white with black is entry 4, 18 red with yellow 17, 32 black with black
  31). Its linked picture shows the palette in order (A1 is entry 0),
  which this report first misread as the numbers; the bench caught it.
- **Where they go:** the top color goes where the specular map's alpha
  says, the bottom where its blue says. The top has the say where they
  overlap (Titan, Ghost and Archangel lay one inside the other). Each
  masked part is scaled so its average is the color.
- **Skin:** the heads share one skin texture; each head's `SkinColor`
  colors it through the skin mask (the third channel of its specular
  map).
- **Hair:** colored from the `HairColor` palette.
- **Shading:** our own, not the game's. Diffuse, normal map, a highlight
  from the specular map's red, plain lights. Lights on the armor glow
  where the specular map's green says (about 2% of it), in the material's
  `EmsColor_EmsValue` (Carapace white, Ghost and Archangel light blue),
  else the texture's own color (Titan).

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
  placed on the head (`src/model/__tests__/material.spec.ts`); the body
  posed, arms at the sides at the same height, the head moving; every
  barracks clip's frame tables in order and its loop closing
  (`src/model/__tests__/skelmesh.spec.ts`).
- The idles compared by screenshots over time: the at-ease idle chosen
  over one that looks around and slouches, one that scratches its head,
  and one that holds a rifle that is not there. Female Kevlar and
  Carapace, male Titan, Archangel, Ghost and Psi in it.
- On the bench (Windows VM, the person's install, site 2026.1020.063255):
  every male armor, female Kevlar and Titan, a helmet staying on the head
  as it moves; frames 1.5 s apart differ around the head and shoulders.
  CPU while visible about 2.6 cores (software WebGL), 0.2% scrolled away,
  1.7% minimized, 0.2–0.9% with Windows' animation effects off. Hence
  still without a GPU; still, it measured 0.0%.
- Standing still showed a fault the animation had hidden: making a texture
  binds it, and the normal map was made after the tint masks were bound,
  so the first frame tinted by the normal map. Each later frame was
  right; a still soldier would have kept the wrong one. All of a
  section's textures are now made before any is bound. Confirmed on the
  bench (site 2026.1020.070349): the first, still frame shows color 16
  right on six soldiers, and the lights are small and bright.

Not done:
- The game's own lighting and reflections (cube maps).
- Animation: the one idle; no fidgets, poses or salutes to choose.
- Weapons and the MEC suits.

## Response (2026-10-20)

"do the class colors actually make sense and map properly to LWR, the
models seemed different when i tried it"

## Report (2026-10-20): LWR's own class colours

- **Long War:** class colours are the INI's (HQ_BASE_POWER), applied when
  a soldier gets their class.
- **LWR:** with its option SOLDIER_COST_CLASSIC at 1 (LWR's own, the
  default), its mutator sets each class's tint itself at the promotion to
  Lance Corporal, and again for some perks chosen later
  (RebalanceMutator.ChangeArmorTint in LWRebalance.u). The INI's class
  colours are not used then. With the option at 0 the mutator does nothing
  and the INI's colours apply.
- The class table showed the INI's colours in LWR, so the soldier wore
  colours LWR never gives. That is the likely difference seen.
- `scripts/lwr_class_tints.py` reads LWR's colours from its script into
  `data/lwr/class-tints.json`:
  - The class from EnergyToClass. Sniper 6, Scout 3, Rocketeer 23, Gunner
    2, Medic 4, Engineer 21, Assault 5, Infantry 11; the MEC classes too.
  - The perks by their names in the game (through EPerkType and the INT),
    e.g. Sniper with In The Zone 15, with Mayhem 22.
- In LWR at its own setting, the table shows those colours, marked "LWR's
  own", with the perk colours beneath, and the soldier wears them. A note
  says the INI's colours apply with the option set to "the class colors
  here only".
- LWR's DefaultContent.ini (heads, hair, armor kits, decos) is the same as
  Long War's but for one light armor's deco (Kestrel: Skeleton's, not
  Ghost's).

## Report (2026-10-21, notes 987c7 and aad7d)

The person's note: "does LWR use a different armor model, because i feel
like the rookies in the first mission had a different look from LW? and we
don't have it in our tool".

**Yes.** LWR's DefaultContent.ini swaps the kits soldiers wear by armour
and weapon (`ArmorKits`). Long War gives a Kevlar soldier the kit of the
weapon carried: an assault rifle's light vest, an LMG's heavy plates and so
on. LWR gives Kevlar the LMG kit with any rifle, shotgun or sniper rifle,
and the heavy laser or heavy plasma kit with laser or plasma weapons. So
LWR's rookies look bulkier.

**Why the tool missed it.** The game puts exactly one kit on a soldier
(`XComHumanPawn.AddKitRequests`, read from XComGame.upk):
- the deco, when one is set;
- otherwise, at −1 (Long War's own setting for rookies), the kit for the
  armour and the primary weapon.

A promotion keeps the deco, so every class wears the rookie's. The tool
called −1 "the armor's own" and drew the armour's `ArmorDeco` kit, which
the game never uses in that case.

What changed:
- **`state/soldier.ts`:** reads the `ArmorKits` lines. With no deco, it
  draws the kit for the armour and weapon, picking the kit's mesh by
  gender (the names carry "Male" or "Fem" anywhere: `SM_Lv1FemHeavyKit`).
- **The preview's file:** it reads the chosen version's own
  DefaultContent.ini (`versionContent`, `contentKey` in `tools.ts`): the
  library's unpacked copy for another version than the one in the game,
  or the kept original for plain Enemy Within. Choosing a version now
  unpacks its download at once, so its own settings and soldiers are at
  hand without a plan first.
- **The preview's controls:** a Weapon picker, listing the version's kits
  for the armour. It defaults by class: sniper rifle for snipers, LMG for
  gunners, assault rifle otherwise. It is disabled while a deco is set,
  since a deco is worn whatever the weapon.
- **Every class wears the rookie's deco.** The class table's deco column
  says "the weapon's kit", or "the rookie's, Kevlar n"; the rookie's −1
  reads "the weapon's kit".
- **Note aad7d:** the LWR card's sentence is no longer addressed to the
  reader. It now ends "The rookie's colour and the class headgear remain
  settings."

Verified:
- Unit tests for reading the kits: LWR's rifle → LMG kit, the player's
  weapons for an armour (not Exalt's, not the numbered ones), weapon names.
- Gate green: 238 unit, 26 site e2e, 13 desktop.
- `scripts/site-shots.sh` on the real packages (it now links the Kevlar
  kit packages too), looked at: Long War's rookie wears the assault rifle's
  light vest; with LWR chosen, the same rifle gives the heavy LMG kit, as
  in the person's first LWR mission.

Open: the colours on LWR's heavy kit (an olive-brown under "cyan with
brown") have not been compared with the game.

## Report (2026-10-21, the LWR rookie questioned)

The person, with our LWR rookie in view: "are you sure about the LWR armor
because this is not what i saw in game maybe they replaced some models?"

Checked from four sides:
- **The script:** LWR ships its own XComGame.upk, and its
  `AddKitRequests`/`RequestKitPostArmor` are Long War's.
- **The deco:** `CreateTSoldier` sets the colour to `DEFENDER_MEDIKIT − 1`,
  and the deco to `COUNCIL_STAT_BONUS − 1` only when that setting is 0 or
  more. LWR (and Long War) ship −1.
- **The person's LWR saves** (lwr-save1740, lwr-save1779): every soldier's
  `iArmorDeco` is −1 and the tint 7. So they wear the weapon's kit, the LMG
  kit in LWR.
- **The packages:** LWR replaces no soldier or kit package. Its
  CookedPCConsole has XComGame, the UI, scripts, the Furies DLC patches and
  EU2EW_Textures, which is only streamed by commented-out map lines.
  CharacterColorizer recolours aliens only. The kit's package lines are
  Long War's.

**What was wrong: the tint on weapon kits.** Their material is
`CHH_WeaponKits`, which the game colours like armour (`UpdateMeshMaterials`
sends it to `UpdateArmorMaterial`). The tool drew it untinted. Its mask
`Spc_Ems_Ref_CMod` carries the colour in alpha, with reflection in blue,
not a second colour. It covers only the kit's pads, so the plates keep the
kit's own olive. Now the pads take the armour's colour: LWR's rookie wears
olive LMG plates with cyan pads, Long War's rookie red ones.

Open: compared with the game only through the person's eye; a screenshot
from the game would settle the rest.
