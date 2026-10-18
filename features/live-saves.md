---
title: Follow the save folder live
status: review
priority: 4
dependsOn: [save-parser, progress-overlay]
---

## Purpose

While playing, the tree keeps up by itself: the player points the page at
their SaveData folder once, and every new save shows up without loading
it by hand. Still entirely in the browser.

## Requirements

- "Watch save folder" (File System Access API, Chromium browsers): pick
  the folder once; the page checks it every few seconds and loads the
  newest save when one appears. Shown only where the browser supports it.
- The folder is remembered across reloads; resuming takes at most one
  click (the browser's permission prompt).
- A save the game is still writing must not break anything: a parse
  failure keeps the last good state and retries on the next check.
- After a new save: say what changed since the previous one in the same
  campaign (researched, started).
- A check log: for each save, compare our formula with the game's own
  ETA for the current project, and the credited cost we predict with
  what the project actually costs. Mismatches are what the person wants
  to catch while playing (We Have Ways, Expertise stacking).

## Hard to verify

The folder picker is a native dialog. An end-to-end test can hand the
page a directory from the origin-private file system instead, which is a
real directory handle, and drop saves into it.

## Worth

Half a day.

## Report (2026-10-18)

**What changed.** `src/state/watch.ts` (the folder: picked with
`showDirectoryPicker`, its handle kept in IndexedDB, checked every 3 s,
the newest `save…` file loaded when its name, time or size changes),
`src/model/live.ts` (newest save, changes between saves, the checks),
`loadSave` in the store (reports changes, records a check for every save
loaded, manual or watched), the header controls and the campaign bar's
check log.

- Header: "Watch save folder" where the browser supports it; then a
  pulsing "Watching SaveData" with × to stop; after a reload, if the
  browser wants permission again, "Resume watching SaveData" (one click).
- A new save says what happened: "New save save1761: researched Alien
  Weaponry; started Xenobiology".
- A save that fails to read (half-written) keeps the last good state and
  is retried on the next look, up to five times for the same version of
  the file.
- Check log ("Checks" in the campaign bar, "n checks differ" in orange
  when any do): per save, the game's ETA against our formula, and the
  project's actual credited cost against the credit we expect, with
  notes like "We Have Ways 75% should apply". Kept in localStorage, the
  last 100.

**Verified.**
- Unit tests: picking the newest save among other files, changes between
  save1760 and save1761, no changes across campaigns, the checks agreeing
  on three fixture saves.
- End to end (`e2e/live-saves.spec.ts`, Chromium): the page is handed an
  origin-private-file-system directory in place of the native picker
  (a real directory handle); the test writes saves into it as the game
  would. Covers picking, a new save with its message, a half-written
  save ignored then loaded once complete, three check-log rows, and the
  folder picked up again after a reload. Passes against the built site.
- Looked at the header and the check log on screen.

**Left open.**
- Chromium only (Chrome, Edge, Brave, Opera); elsewhere the button does
  not appear and loading by hand works as before.
- Background tabs: browsers slow timers in hidden tabs, so a save may
  show up a little later there; it catches up when the tab is visible.
- Not tried against the real game folder on Windows (only the test
  directory). The first real session is the check: does the newest
  save the game writes show up, Ironman's single save included.
- Campaign history (a timeline across saves) is the natural next step;
  not built.
