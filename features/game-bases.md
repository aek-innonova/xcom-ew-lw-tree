---
title: "The player's library folder, and Long War installed by the app"
status: review
priority: 3
dependsOn: [desktop-app, game-tools]
---

## Purpose

The app's Tools put the player's mods into the game and take them out
again (features/game-tools.md). Two things are still outside it:

- **The mods live where the player cannot see them**: inside the app's
  IndexedDB. They cannot be looked at, backed up or copied in by hand,
  and they go when the app's data is cleared.
- **Long War and LWR are installed by their own installers**, outside
  the app. Switching between them, or back to plain Enemy Within, means
  running installers by hand, and the app's originals are then whatever
  those left behind.

The person's old tool, eclipse666's Long War Mod Manager, did the second
part: it unpacked the Long War installer (with innounp) and, on every
update, put Long War's own files back before applying the ticked mods.
The person asked for the same, with the player dropping installers into
the library folder.

## The shape

1. **A library folder the player can see**:
   `Documents\Long War Tech Tree\`.
   - `Mods\` holds the mods: each folder is one mod, and a PatchUPK
     script on its own is one mod.
   - The rest of the folder is for what the player drops in: the Long War
     installer (`Long War EW 1.0 for PC-88-1-0.exe`), the LWR download
     (its zip, or the folder unpacked), anywhere in the library.
   - The player's choices are kept in `settings.json` beside them: which
     scripts are wanted, their option values, the mods' order, the INI
     settings and the chosen base.
   - The app reads the folder when it starts and when asked, so a mod
     copied in by hand turns up.
   - Mods kept in IndexedDB by earlier versions are written out to the
     folder once.
2. **The installers read by the app itself.**
   - The Long War installer is Inno Setup 5.5 with LZMA. The app reads
     its file list and files, in TypeScript, with no external tool. It
     also reads the two things the installer does after copying:
     - `run_init.bat`: delete the three `*.uncompressed_size` files;
     - `XCOMModHelper.exe` with `Long_War_EW_Config_exe.xml`: three byte
       replacements in `XComEW.exe`.
   - LWR is files to copy (`Config`, `CookedPCConsole`, `Localization`,
     `Movies` into `XEW\XComGame`), from its zip or its folder, over
     Long War 1.0.
   - What was unpacked is cached in the app's data, keyed by the
     installer's SHA-256, so it is read once.
3. **A base under the mods**: plain Enemy Within, Long War 1.0, or LWR
   (over Long War 1.0). The setup is built as: the game's own files, the
   base's files over them, then the mods' scripts, the INI settings and
   the mods' files. Changing the base is one more setup to apply, shown
   as a plan first like any other.
4. **The game's own files known by hash.** A table of plain Enemy
   Within's files (path, size, SHA-256, from a Steam-verified install)
   ships with the app.
   - With it the app knows, for every file a base touches, whether the
     game has it and which bytes are the game's own.
   - The game's own bytes come from wherever they are found intact:
     - the file itself;
     - the app's backups;
     - Long War's own `(LW Backup)` copies in `XEW\Long War Files`;
     - the exe patcher's `XEW\Backup\XComEW.exe`.
   - Where none has them (a mod installed by hand before the app),
     going back to plain Enemy Within for that file is refused, with
     the way out: have Steam verify the game's files.

## Requirements

- Nothing the player has is lost.
  - A file in a state the app does not recognise (not the game's own,
    not a base's, not something the app wrote) is copied to
    `lwtree-backup/` before it is replaced, and the plan says so.
  - A file is removed only when the game does not have it, and one the
    app does not recognise is kept aside first.
- The bridge reaches the game folder (`XEW`, for the exe) and the
  library, nothing else. The installers are read in the main process;
  the page sees the unpacked files only through the bridge.
- Nothing from the game or the mods goes into this repository. The
  hash table is names, sizes and hashes, which the person confirmed is
  fine (2026-10-19).
- Without installers in the library, Tools works as before (the base is
  what is installed, originals as found).
- A new bridge means a new shell: the bundle's `minShellVersion` goes up
  with it, and the page checks for the calls it needs.

## Verification

- The Inno reader against the person's copy of the Long War installer
  (git-ignored `samples/`). Every file it unpacks must be byte for byte
  what innounp unpacked for the Mod Manager (`LongWarFiles/_Long War EW
  1.0 for PC-88-1-0.exe/{app}`), and its file list must match that
  folder's `install_script.iss`.
- The planner with bases on fake installs:
  - EW → LW → LWR → LW → EW comes back byte for byte;
  - a hand-modded file is kept, not lost;
  - a missing original is refused, not guessed.
- On the Windows bench, starting from a Steam-verified plain Enemy
  Within, all through the app:
  - install Long War from the installer in the library, then the
    person's mods;
  - switch to LWR (zip), then back to Long War, then to plain EW;
  - compare against Steam's table and the bench's earlier LW and LWR
    baselines;
  - whether the game starts is worth a try (no GPU).

## Report (2026-10-19)

Built in three parts and verified on the Windows bench; app 0.3.0 and
its site are on staging.

**The library folder** (`src/state/library.ts`, bridge `library:*`):
- Mods are in `Documents\Long War Tech Tree\Mods`: a folder is one mod,
  and so is a lone PatchUPK script. The player's choices, INI settings
  and chosen version are in `settings.json`.
- Mods added in the app are written there. Mods copied in by hand turn
  up when the app comes back to the front. Removed mods go to the
  recycle bin.
- Mods kept in IndexedDB by 0.2 move into the folder once.
- The site now needs shell 0.3.0 (`lwtree.minShellVersion`).

**The installers, read by the app** (`desktop/src/inno.ts`, `lzma.ts`,
`zip.ts`): an Inno Setup 5.5 reader and an LZMA decoder of our own,
written from innoextract's format description and the LZMA
specification.
- Every file is checked by its SHA-1. The person's Long War installer
  gives 397 files byte for byte equal to innounp's unpacking for the
  Mod Manager, in about 13 s. The installer's 4 helper programs are not
  read (stored with Inno's exe filter, and not needed).
- From the installer's own scripts the app also takes:
  - `run_init.bat`: the 3 `*.uncompressed_size` files it deletes;
  - `Long_War_EW_Config_exe.xml`: the 3 byte patches to `XComEW.exe`.
- LWR's zip reads in 0.4 s, all 161 entries equal to its unpacked copy.
- `desktop/src/bases.ts` finds Long War and LWR anywhere in the library
  (installer, zip, or unpacked folder). It unpacks each once into the
  machine's local app data, keyed by SHA-256, with a manifest.

**The version in the game** (`src/state/baseplan.ts`, Tools' "Version in
the game"): leave it as installed, plain Enemy Within, Long War 1.0, or
LWR over Long War.
- The setup is built on the chosen base:
  - its files, else the game's own;
  - its deletions;
  - Long War's exe patches on or off;
  - then the mods, the INI settings and the mods' files, as before.
- Files are known by hash against `src/data/game-files.json`: plain
  Enemy Within's 5,058 files under XComGame, from a Steam-verified
  install (`scripts/game-files.mjs`).
- The game's own bytes are taken wherever they are intact: in the game,
  in `lwtree-backup/`, or in Long War's `(LW Backup)` copies.
- Before a file of the game's own is replaced it is copied to
  `lwtree-backup/`. A file the app does not recognise is kept in
  `lwtree-backup/found-<time>/` before it is replaced or removed.
- When the game's own copy is nowhere (LWR put in by hand), the plan
  says so, points to Steam's verify, and leaves the file as it is.
- The bridge reads XEW (for Long War's backups) and writes there only
  `XComEW.exe`. Copies and hashes run in the main process, so no large
  file passes through the page.
- **The exe is not known by hash.** Steam's DRM makes it different on
  every download (found on the bench), so it is recognised by Long
  War's three patterns and patched or unpatched in place.
- Without a version chosen, Tools works exactly as before.

Verified:
- Unit tests: 8 of the base planner, with a made-up game. Breaking the
  keep step fails 3 of them, as it should. They cover:
  - EW → LW → LWR → LW → EW byte for byte;
  - Long War's own backups used when Long War came first;
  - a missing original refused;
  - an unknown file kept aside;
  - settings on the base's INI;
  - an unknown exe left alone.
- Node tests: the LZMA fixture; the real installer against innounp's
  copy; the base store on a hand-made zip and folder and on the real
  installer and zip.
- Electron tests:
  - the library: added, copied in by hand, removed, moved from
    IndexedDB;
  - a version from the library chosen, planned and written, with an
    unknown file kept aside.
- Offline, before the bench: the game's table plus each base predicted
  the bench's earlier Long War and LWR installs exactly, for every file
  those snapshots cover (Config and CookedPCConsole).
- On the bench (a Steam-verified plain Enemy Within):
  - 0.2.1 took the new site's gate and installed 0.3.0 by itself.
  - The installer and the zip were dropped into the library and the
    person's mods copied in by hand.
  - By hand in the installed app, the first Long War plan took 24 s,
    unpacking included. Writing took 12.5 s; going back took 4.4 s to
    plan and 5.4 s to write.
  - `e2e-desktop/real-bases.spec.ts` (3.4 min) went EW → LW → LWR (the
    mods on) → LW → EW. Each step was byte for byte against the
    earlier installs: LWR against the whole of XComGame (5,453 files).
    The exe was patched on Long War and Steam's own at the end.
  - Run again with the stricter check (53d32c9; each ticked script must
    read exactly "installed", the person's five ticked): passed, 3.2
    min. The two copies of Sightlines_LW.txt (alone, and in the
    Sightlines-1.4 folder) read the same.
  - The game left at 5,059 files equal to Steam's.
  - With Long War put in by the app, `XComEW.exe` started, got past
    Steam's DRM, and stopped on the VM's missing DirectX runtime
    (`XINPUT1_3.dll`). How far it gets is not known.

Open:
- Unpacking Long War peaks at about 540 MB of memory: the installer is
  one solid 284 MB LZMA chunk, decoded whole. It happens once per
  installer.
- Only Inno Setup 5.5.0 to 5.5.6 installers are read (Long War 1.0's is
  5.5.0). Long War betas are not tried.
- The bench's game can be left as it is or taken back to the Long War
  install kept beside it; Steam logout and deauthorise when the bench
  is retired.
