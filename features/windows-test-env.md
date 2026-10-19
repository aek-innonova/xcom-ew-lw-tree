---
title: "A real Windows test bench: Steam, the game, Long War, and the app against them"
status: review
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
  `…\Uninstall\Steam App 200510` (InstallLocation; in the 32- or 64-bit
  view — see the report), else the library in Steam's `libraryfolders.vdf` that
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

## Report (2026-10-19): the bench stands, Long War 1.0 verified end to end

The real bench exists and the core question is answered: on a real Steam
+ Long War 1.0 install the app finds the game by itself, the player's
mods apply and read installed, and the originals come back byte for byte.

**The machine.** Fresh Steam (Valve's installer), XCOM: Enemy Unknown +
Enemy Within installed into a second library `C:\SteamLibrary` — on C:,
but not under Steam's own folder, which is the condition that matters
(the finder keys on the path, not the drive). Both Enemy Unknown's
`XComGame` and Enemy Within's `XEW\XComGame` are present, the real layout
that first broke the finder. Long War EW 1.0 installed by its own
installer into the second library's `XEW` (silent, with an explicit
`/DIR=` — the installer defaults to `{SteamPath}\…\XEW`, i.e. the
*default* library, so it too would miss a non-default-library game; its
`run_init.bat` and `XCOMModHelper.exe` both exited 0).

**Tests and build on Windows (commit 1738be5).** `npm run test:desktop`
is green on the VM (5 Node + 3 Electron). Four real cross-platform
faults fixed along the way; the two that would have bitten anyone:
`ELECTRON_RUN_AS_NODE=''` counts as *set* on Windows (Electron ran as
Node, Playwright couldn't attach), and `inside()` returned the wrong
case because NTFS's case-insensitive `lstat` skipped the correcting
path. `npm run dist:win` builds the NSIS installer on the VM (a Node
copy script replaced `rm -rf`/`cp -r`); I built it, installed it
per-user, and confirmed it launches and loads the site.

**The bench (commit 4844aa3).** `e2e-desktop/real-install.spec.ts` drives
the real app end to end (add the PatcherGUI scripts, tick them, set an
INI value, apply, assert each reads installed, put the originals back,
assert byte-for-byte); env-guarded so the normal suite skips it.
`scripts/win-test-bench/restore-check.mjs` is the same byte check by
hand. Both are the "run it again" the feature asked for.

**Finder.**
- *Uninstall-entry path:* the installed app's own `findGame()` returned
  `C:\SteamLibrary\…\XCom-Enemy-Unknown\XEW\XComGame` — correctly XEW over
  Enemy Unknown's `XComGame` — looking only at the registered path.
- *Library-list path:* proven against the real `libraryfolders.vdf`
  (both `config\` and `steamapps\` copies) through the shipped
  `librariesWithApp` + `gameDirUnder`, which resolve to the same XEW
  path. The one thing not run literally end to end is `findGame()` with
  the uninstall entry deleted: deleting an `HKLM` key needs an elevated
  (UAC) action, i.e. the person. Offered; the logic is otherwise fully
  evidenced.
- *Noticed:* on this machine the uninstall entry is in the **64-bit**
  registry view, not the 32-bit one the code comment and this feature's
  facts assumed. The finder only coped because it queries both views;
  comment and fact corrected.

**Mods and restore (the core).** Through Tools, all **five** of the
person's mods (EXALT Reminder, Enhanced Tactical Info, Lightning
Reflexes, Soldier Gender, Sightlines_LW) applied and read **installed**
on this real LW 1.0 install, plus an INI setting
(`NUM_STARTING_SOLDIERS`). "Put the originals back" then left **all 5057
baselined files identical** — the Playwright assertion and the
independent `restore-check` agree. The app touched three packages
(`XComGame.upk`, `XComStrategyGame.upk`, `UICollection_Tactical_SF.upk`)
and `DefaultGameCore.ini`, backed up in `lwtree-backup/`. None of the
mod-targeted packages were stored compressed in this install, so none
hit the "compressed in your install" refusal.

**Prior art (LWModManager) and where our approach differs.** LWModManager
restores by re-extracting the pristine files from the Long War installer
with innounp on every update, then reapplying the ticked mods — its
"original" is authoritative installer content, so it can never inherit a
dirty baseline. Ours is "the file as it was the first time Tools touched
it," kept in `lwtree-backup/`. I checked whether the app *could* take its
originals from the installer: the LW installer (InnoSetup) carries the
pristine, **uncompressed** `XComGame.upk`, `XComStrategyGame.upk`,
`UICollection_Tactical_SF.upk` etc. under its `{app}\XComGame\` payload,
so in principle yes — but only via an InnoSetup extractor (innounp is a
dedicated C tool; the format is LZMA-compressed and versioned), which our
Electron app would have to bundle or shell out to, against the "our own
implementation, no external binaries" line it has held. And in normal use
the distinction is moot: point Tools at a freshly LW-installed folder — as
here — and our first-touch baseline *equals* the installer's pristine
state, which is exactly what the byte-for-byte restore above confirms.
The gap is real only if a file was already modified by another tool
before Tools first saw it; `setup.ts` guards that case (a backup without a
record is treated as the original and never overwritten on a guess), but
it cannot recover a pristine original it never had. Taking originals from
the installer would close that gap and would also sidestep compressed
packages; it is a genuine option to weigh, not something this run needs.

**Open / not done (by plan):**
- `findGame()` literally through the fallback with the uninstall entry
  removed — one admin/UAC action from the person.
- The "mods' files" flow (a mod that brings a package + merges an INI,
  e.g. Sightlines' `.u` and mutator line) was not run on the real LW 1.0
  install through the app; it is covered on fake installs and on LWR's
  real files elsewhere (game-tools.md). A worthwhile follow-up.
- LWR 2.06 not installed (started with LW 1.0 as asked).
- The game was not launched (no GPU on the VM, as agreed).
- `scripts/build-desktop-win.sh` left as is; it ships built artifacts and
  runs electron-builder on the VM, unaffected by the script changes, and
  `npm run dist:win` is now the simpler VM-local path.

## Report (2026-10-19): the finder fallback, and LWR 2.06

The three items held over are done: the finder's library-list fallback
run literally, LWR 2.06 on the bench over Long War 1.0, and the
mods'-files flow on a real install. All through the installed app.

**The finder fallback, literally.** The "needs a person" caveat was
wrong. UAC on this VM is `EnableLUA=1` with `ConsentPromptBehaviorAdmin=0`
and `PromptOnSecureDesktop=0`: token filtering is on (a normal process is
Medium integrity, so the `HKLM` write got Access denied), but elevation
is *silent* — no prompt. So `Start-Process -Verb RunAs` elevates with no
UI. The person's "UAC is off" meant "no prompts," not "no filtering." I
exported the uninstall entry, deleted it elevated (silent), confirmed it
was gone from HKLM and absent from HKCU, and ran the installed app's
`findGame()`: it still returned `C:\SteamLibrary\…\XEW\XComGame`, reaching
it through `libraryfolders.vdf` (the `looked` path was the library). Then
I imported the export back and confirmed the entry and `findGame()` were
as before. Both finder paths are now proven end to end on real data.

**LWR 2.06 over Long War 1.0.** Installed by the UFOpaedia manual method
(its own installer's readme says odd/non-Steam setups should copy by
hand): `Config`, `Localization`, `CookedPCConsole`, `Movies` copied into
`XEW\XComGame`. The app then read the install as **LWR** (`LWRebalance.u`
present). A fresh baseline was taken (5081 files). Through Tools, the
person's five scripts: **Enhanced Tactical Info does not fit** —
"UICollection_Tactical_SF.upk: gfxUnitGermanMode.UnitGermanMode (line
3885): neither the original code nor the modded code is there", left out
of the plan with that reason (as on Linux); **EXALT Reminder, Lightning
Reflexes, Sightlines_LW and Soldier Gender read installed**. The restore
left all 5081 files byte-for-byte.

**The mods'-files flow (Sightlines-1.4 folder, "Put its files into the
game"), on LWR.** The app did the right thing for a version that already
ships Sightlines: it did **not** copy `Sightlines.u` (the game has LWR's),
did **not** touch `DefaultMutatorLoader.ini` (LWR already lists
`Sightlines.SightlineMutator`), and **did** merge the mod's lines into
`DefaultSightlines.ini` (original kept first). Restore reverted it
byte-for-byte.

**A bug the LWR round found — in the bench spec, not the app.** The spec
closed the app as soon as the log showed "Wrote", which matched the first
file and raced the rest of `applyPlan`; LWR's restore writes more files,
so two were left unwritten and the byte check failed. The app writes
atomically (temp file then rename), so the files were simply not
rewritten, not corrupted — a second restore reverted them cleanly, which
is how I told a test race from a real defect. The spec now waits for the
plan to clear (every write done) before closing, and for a script's final
status before reading it. `planSetup`/`applyPlan` are correct.

**Still not done:** launching the game (no GPU, as agreed) and
`scripts/build-desktop-win.sh` (unchanged; `dist:win` is the VM path).
The Steam login is left in place, to be logged out and deauthorized when
the bench is retired.
