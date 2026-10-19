---
title: "A real Windows test bench: Steam, the game, Long War, and the app against them"
status: in-progress
priority: 3
dependsOn: [desktop-app]
---

## Purpose

The desktop app (features/desktop-app.md) has so far been tested on Windows
against folders made to look like an install, and against a registry entry
written by hand. The person's first real run turned up faults no fake had
shown: Enemy Unknown's own XComGame beside XEW, a Steam library on another
drive, Chrome hiding .ini files. The app should be tried where those things
are real: Steam installed by its own installer, the game installed by Steam
into a library that is not Steam's own folder, Long War installed by its
installer, and the person's own mods.

The result the person sees: a Windows machine where "Find the game" in the
installed app finds a real Steam install by itself, and where the app's
mod and settings flows have been run against real game files and checked
(installed, removed, originals restored byte for byte). Plus a way to run
that again after the next change.

## Requirements

- The machine is the disposable Windows 11 VM (`win`), yours to install on.
  This agent runs in its logged-in desktop session, so GUI apps, dialogs
  and installers can be driven there.
- Steam from Valve's own installer. The game (XCOM: Enemy Unknown, Steam
  app 200510, with Enemy Within, DLC 225340) from the person's account,
  into a second Steam library on a path other than Steam's own folder,
  as on the person's machine. The person logs in to Steam: ask (through
  the session that started you) when that is needed, say what you need
  them to do, and wait.
- Long War 1.0 by its installer, then LWR 2.06 over it, or whichever of the
  two the person prefers to start with. Their files come from the person:
  ask for what you need. The LWR 2.06 zip and the person's mods are on the
  Linux machine (git-ignored `samples/`) and can be copied over.
- No changes to the person's real machine. No public uploads. Nothing from
  the game or its mods goes into the repository; `samples/` stays ignored.
- The app is tested as a player gets it: the installer built from this
  repository (`desktop/`, `npm run dist:win` there, or
  `scripts/build-desktop-win.sh` from the Linux side), installed per user.

## Facts and pointers

- Read first: `docs/design.md`, `README.md`, `features/desktop-app.md`,
  `features/game-tools.md` (its reports are the history of what went
  wrong where), `src/state/tools.ts`, `src/state/setup.ts`,
  `desktop/src/main.ts`, `desktop/src/game.ts`.
- How the app finds the game: the uninstall entry
  `…\Uninstall\Steam App 200510` (InstallLocation, Steam writes it in the
  32-bit view), else the library in Steam's `libraryfolders.vdf` that
  lists app 200510; then `XEW\XComGame` inside it.
- Saves live in `Documents\My Games\XCOM - Enemy Within\XComGame\SaveData`.
  "Watch save folder" and "Load save" in the app start there.
- The app's tests: `npm run test:desktop` (Node tests of `desktop/src`,
  then Playwright's Electron driver over `e2e-desktop/`). They were
  written on Linux (xvfb, `electron` without `.exe`); making them run on
  Windows is part of this.
- The VM: PowerShell 7, Node 24, git; C: has about 66 GB free, which is
  enough for the game (about 20 GB). D: and E: are empty drives with no
  space. Earlier test folders are under `%TEMP%\lwtree-*` and can go.
- The patch engine was verified byte for byte against PatchUPK on Linux
  (`src/model/__tests__/modpatch.spec.ts`). On the real install the
  questions are about the app and the install, not the engine.

## What will be hard to verify, and how

- "Find the game" against a real Steam: start the installed app with no
  `--game-dir` and no test settings, and it should name the second
  library's `XEW\XComGame`. Then the same with Steam's uninstall entry
  removed, to exercise the library-list path.
- Mods against real files: apply the person's mods through the app's
  Tools, check each reads installed, then put the originals back and
  compare SHA-256 of every changed file with the files as Steam and the
  Long War installer left them (take those hashes before the first
  apply).
- Whether the game still starts after a setup is applied is worth a try.
  The VM may not run XCOM's renderer; if it cannot, say so and do not
  spend long on it.

## Worth

About a day of agent time, most of it waiting on downloads and the
person. Stop and report if the person's login or a download blocks you,
and do not work round it.
