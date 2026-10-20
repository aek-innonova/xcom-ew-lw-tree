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
