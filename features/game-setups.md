---
title: "Setups saved by name"
status: review
priority: 3
dependsOn: [game-settings, game-bases]
---

## Purpose

The person: "it would be kind of neat if there was a way to save
configurations with a name so you could always go back to a particular
config without having to go through all the numbers again."

## The shape

- Tools' "Saved setups" saves the setup as it is under a name: the
  version in the game, which mods' scripts are ticked, their option
  values and "files" choice, the INI settings, and the game settings
  (all versions').
- **Use it** puts those choices back, ready to apply. Mods added since
  are left out, and nothing in the game changes until the player
  applies, as always.
- The setup the choices match is marked "in use". A name already taken
  is replaced ("Replace it").
- Kept in `settings.json` (`setups`), beside the choices themselves.

## Report (2026-10-20)

Built as above (`src/state/tools.ts`: `saveSetup`, `useSetup`,
`deleteSetup`; `src/state/library.ts`: `SavedSetup`).

"In use" compares what was chosen, not how it is stored: a mod never
ticked counts the same as one unticked, and empty option sets as none.

Verified: an Electron test (`e2e-desktop/game-settings.spec.ts`).
- Saving "Sixty" marks it in use.
- Changing starting soldiers to 70 clears the mark; that is saved as
  "Seventy".
- Using "Sixty" brings back 60, and both are in settings.json with
  their values.

## Response (2026-10-20)

"the saved setups i think maybe it should be at the top and be more of a
dropdown and maybe ask for a name when you pick create new from the
dropdown and offer a suggestion … and maybe the apply my setup is also a too
hidden at the bottom people might never realize the tool can do something"

## Report (2026-10-20): the setup bar

- A bar at the top of Tools (`SetupBar.vue`), staying in view while the
  page scrolls:
  - A list of the saved setups, showing the one in use, or "Sixty,
    changed" when the choices came from Sixty and have changed since. The
    setup they came from is kept in settings.json (`setupFrom`).
  - Picking a setup switches to it. With choices that are in no saved
    setup, the bar asks first: save them first, switch anyway, or cancel.
  - "Save as a new setup…" opens a name field with a name offered and
    selected: the version, the mods ticked and the settings set ("Long War
    1.0 · 2 mods · 14 settings"), made unique. "Save the changes to Sixty"
    and "Delete Sixty…" are there too.
  - **Apply my setup…** is in the bar, always in view. It makes the plan
    and scrolls to it. The section at the bottom keeps its explanation and
    the "no mods" alternative, and points to the bar.
- The old "Saved setups" section is gone.

Verified: the desktop e2e saves "Sixty" from the bar (with the offered name
checked), sees it marked changed, saves "Seventy", switches back, and is
asked before switching away from unsaved choices. Screenshots of the bar at
the top, while naming, and while scrolled.
