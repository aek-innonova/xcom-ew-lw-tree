---
title: "The player's library folder, and Long War installed by the app"
status: in-progress
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
  - A file is never removed unless the app knows the game does not have
    it and it is a base's or the app's own.
- The bridge reaches the game folder (`XEW`, for the exe) and the
  library, nothing else. The installers are read in the main process;
  the page sees the unpacked files only through the bridge.
- Nothing from the game or the mods goes into this repository. The
  hash table is names, sizes and hashes; flagged to the person.
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
