---
title: "Tools: the game install, mods and settings"
status: review
priority: 3
dependsOn: [lw-rebalanced]
---

## Purpose

Players who run Long War (or LWR) with a handful of extra mods and their
own INI tweaks redo all of it by hand after every reinstall: run the Long
War installer, apply each PatcherGUI script, copy mod files, edit
`DefaultGameCore.ini` again. The site should let them keep their mods and
settings in the browser and put them into the game in one go, with each
mod's options as plain fields, and show at any time what is installed.

Seen by the person: a **Tools** button beside Help (not another board tab:
this works on the game's files, not on a campaign) opens a page about their
install: which game version it is, their INI, their mod library with each
mod's options and whether it is installed, and later the buttons to
install, uninstall and apply a whole setup.

## Requirements

- Nothing leaves the browser, as everywhere on the site. Mod files the
  person adds are kept in the browser (IndexedDB), never on our server;
  the site does not host other people's mods.
- Never leave the game broken: copy every file before its first change,
  check before patching that the bytes are what the mod expects (refuse
  otherwise, e.g. a mod for Long War 1.0 on a function LWR changed),
  re-read after writing, uninstall by restoring. The game must be closed.
- Works for Long War 1.0 and LWR (the person will run the same mods on
  both).
- Clearly a different kind of thing from the tree: its own page, reached
  from the Tools button.

## Facts

- The person's mods (`samples/additional_mods/`, git-ignored):
  - four PatcherGUI scripts (EXALT Reminder, Enhanced Tactical Info,
    Lightning Reflexes, Soldier Gender) patching compiled code in
    `XComGame.upk`, `XComStrategyGame.upk` and, for Enhanced Tactical
    Info, `UICollection_Tactical_SF.upk` (possibly compressed in the
    install);
  - Sightlines 1.4: a PatcherGUI script, `Sightlines.u` copied into
    `CookedPCConsole`, a line added to `DefaultMutatorLoader.ini`,
    `DefaultSightlines.ini` copied into `Config` (its README; Long War
    already has the mutator loader);
  - `manual.changes.txt`: the person's own INI values.
- What the scripts use of PatchUPK's format: `OBJECT=… : AUTO` with
  `[REPLACEMENT_CODE]` (54 of 59 patches), `[BEFORE_HEX]`/`[AFTER_HEX]`,
  `[BEFORE_CODE]`/`[AFTER_CODE]`, `ALIAS` (the user's options, with a
  comment each), `[ADD_NAME_ENTRY]`, one `REL_OFFSET` + `[MODDED_CODE]`,
  one `FIND_CODE`/`MODDED_CODE`. The pseudo-code names objects
  (`<Class.X>`, `<.local>`, `<@member>`), literals (`<%f>`, `<%b>`,
  `<%t>`, `<%i>`, `<%u>`), labels (`[@label]`, `[#label]`) and
  in-memory sizes (`[@]`): our disassembler (`scripts/upk_script.py`)
  already computes the memory offsets this needs.
- **Chromium will not open a folder under Program Files** (nor Windows,
  AppData): `chrome_file_system_access_permission_context.cc` blocks
  `DIR_PROGRAM_FILES`, `DIR_PROGRAM_FILESX86` and `DIR_PROGRAM_FILES6432`
  with `kBlockAllChildren` (read 2026-10-18). Steam's default library
  (`C:\Program Files (x86)\Steam`) is therefore out of reach of the page
  itself; a library on another drive (the person's `I:\Steam`) works.
  Firefox and Safari have no folder access at all.

## Shape (phases)

1. **Read-only.** The Tools page; pick the game folder (remembered, like
   the save folder); tell Long War 1.0 from LWR from the installed files
   and switch the site to it; load the install's INI; a mod library kept
   in the browser, each mod's description, targets and options (ALIAS
   values, editable and remembered); whether its targets exist in this
   install.
2. **The patch engine, checking only.** Assemble PatchUPK pseudo-code
   against the install's packages; per mod: installed, not installed,
   or not matching this version.
3. **Writing.** Back up, patch (including AUTO's relocation of a grown
   function and new name entries), verify, uninstall; the INI settings
   as named options.
4. **Whole setups.** Mods that bring files (Sightlines), and "apply my
   setup" after a reinstall.

**Program Files and other browsers** (to decide before phase 3): a
small local helper (Go or Rust, one binary) that serves the game folder
to the page on `localhost`, would reach any install and work in every
browser. Costs: a download people must trust (signing, or at least
published checksums), the site's Content-Security-Policy opened to
`http://localhost:<port>`, and a second thing to maintain. The page's own
folder access remains the zero-install route where it works.

## Verification

- The patch engine byte for byte against PatcherGUI: run PatcherGUI on
  the Windows VM (`ssh win`) on the same packages and scripts, compare
  the resulting files. This needs no game run.
- Version detection and INI loading against both installs in `samples/`.
- Install, uninstall and restore against copies in the browser's private
  file system (Playwright), as the save-folder tests do.

## Worth

Phases 1–2 are a few days' work and useful alone (what is installed,
auto-detecting LWR). Phase 3 is the risky one; if byte-exact agreement
with PatcherGUI proves elusive for AUTO relocation, stop and report
rather than ship a writer that might corrupt a package.

## Report (2026-10-18): phase 1

On staging (https://xcom.innonova.ch), not in production.

- A **Tools** button beside Help opens the Tools page (not a board tab; its
  heading says it works on the game's files).
- **Game folder** (Chromium): pick the Steam game folder, `XEW` or
  `XComGame`; the handle is remembered (reconnect after a reload, as with
  the save folder). The page finds `XComGame`, tells the install apart by
  its files (`LWRebalance.u`: LWR; `LongWar.upk`: Long War 1.0; neither:
  plain Enemy Within, which the site does not model), switches the site to
  that version and loads its `DefaultGameCore.ini`. The note about
  Program Files is on the page.
- **Mods**: "Add mod scripts" (PatcherGUI `.txt` files, each a mod) and
  "Add a mod folder" (one mod with all its files, e.g. Sightlines) are kept
  whole in IndexedDB. Per mod: name, author, description (from the script,
  its leading comment, or a README), each script tagged "for Long War" /
  "for plain Enemy Within" by its name, whether every object it patches
  exists in the install's packages, the options (ALIAS values) as fields
  with the script's own comment, remembered per script; a mod's packages
  that the install already has are marked (LWR ships `Sightlines.u` and
  lists it in `DefaultMutatorLoader.ini`, so Sightlines is already part of
  LWR).
- New code: `model/upk.ts` (package tables in TypeScript, reading only the
  header part of a package), `model/patchupk.ts` (script metadata, targets,
  options), `state/tools.ts`, `state/idb.ts` (one IndexedDB for the save
  folder, the game folder and the mods), `components/ToolsView.vue`. The
  Air war and Tools pages now load on demand (main bundle 454 kB).

Verified:
- The person's five scripts and the Sightlines folder parse: names,
  authors, descriptions, options with their help text; every target is
  found in both LW 1.0's and LWR's packages (screenshot against LWR's real
  packages).
- Unit tests for parsing, detection and the package reader (on the sample
  package where present).
- A Chromium browser test: a fake install in the browser's private file
  system, version followed, INI loaded, a mod added, an option set and
  kept across a reload, the mod removed.
- All suites green in Chromium, Firefox and WebKit.

Next: phase 2 (assemble the scripts' code against the install's packages:
installed / not installed / not matching). Before phase 3 the question of
the local helper for Program Files and other browsers wants deciding.
