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

## Report (2026-10-18): phases 2–4

On staging, not in production. The page now checks, installs and removes
mods, sets INI values, and brings mods' files, all on the player's say-so.

**The patch engine** (`model/modpatch.ts`, `model/pseudocode.ts`,
`model/upk.ts`). It is our own implementation of PatchUPK's script format,
written from its documentation and its observed behaviour: keys and
sections, `//`/`/* */`/`{ }` comments, ALIAS (global and per object),
OBJECT with KEEP/AUTO/MOVE, REL_OFFSET, FIND_CODE/HEX, MODDED_CODE/HEX,
REPLACEMENT_CODE, BEFORE/AFTER_CODE/HEX (script sizes adjusted),
ADD_NAME_ENTRY, UPDATE_REL. Pseudo-code covers literals, object references
(`Class.`, `.local`, `@member`), names, aliases, labels and `[@]`
sizes, counted as memory bytes. Grown objects move to the end of the
package with PatchUPK's marker, so PatchUPK can still undo them. Unsupported
commands (INSERT_CODE, EXPAND_FUNCTION, the ADD_IMPORT/EXPORT entries …)
make a mod "does not fit" rather than half-apply. UPKUtils is GPL v2, so
none of its code is in the site. I built PatchUPK from its source on this
machine as the oracle.

- Verified byte for byte: four of the person's mods on LWR 2.06's
  packages, and a script that adds names and moves a function, give
  exactly PatchUPK's output. SHA-256 of PatchUPK's files are in
  `modpatch.spec.ts`; the test runs where `samples/` exists.
- On the person's own Long War 1.0 install all five mods read as
  installed. On LWR, Enhanced Tactical Info does not fit: its patch to the
  tactical UI movie expects bytes LWR's movie lacks, and PatchUPK fails
  there too. Sightlines reads "partly installed", because LWR carries its
  own version of some of the same functions.

**Checking** runs every script on copies of the install's packages. Each
write is compared with what is there: installed, not installed, partly (n
of m changes), installed with other option values than the player's, or
does not fit (where and why). A mod first seen installed is ticked as
wanted.

**Applying** (`state/setup.ts`, "Apply my setup…"):
1. Write access is asked for on that click.
2. A plan is worked out and shown: which files change and why, with any
   mods left out and the reason.
3. Only "Write these changes" writes.
4. The first time a file changes, its original goes to
   `XComGame/lwtree-backup/` (read back to check).
5. The setup is always built from the originals: wanted scripts in library
   order with the player's option values, INI settings, mods' files. So
   unticking a mod takes it out of the game.
6. A file that is neither its original nor what the page last wrote (a
   reinstall, another tool) becomes the new original. After reinstalling,
   "Apply my setup" again restores everything.
7. Each written file is read back and compared.

"Put the originals back…" plans the empty setup.

**Settings** (`model/inifile.ts`): DefaultGameCore.ini's key=value lines
are searchable by key and by the file's own comments. The player's values
are kept in the browser and set in place when applied; every other byte is
kept (round trip on the real INI is byte-identical). Repeated keys (the
HQ_BASE_POWER colours) are told apart by position.

**Mods' files** ("Put its files into the game"):
- packages the game lacks are copied into CookedPCConsole; ones the game
  has are left alone (LWR ships Sightlines.u);
- new INI files go into Config;
- INI files the game has get the mod's missing lines merged in under their
  sections (Sightlines' mutator line into DefaultMutatorLoader.ini);
- removing the mod removes what it added and restores the merged INIs.

Tests:
- engine against PatchUPK (14);
- the planner on LWR's real files in a memory folder (install, again,
  removal, reinstall, mod files, a mod that does not fit);
- the INI editor;
- a browser test of the whole flow in Chromium on a fake install (a
  setting and a mod's file in, originals kept, nothing to do the second
  time, everything back).

All suites green in Chromium, Firefox and WebKit.

Not done yet:
- Phase 5, the local helper for installs under Program Files and for other
  browsers.
- A run against the person's real install. Applying on a copy of the game
  folder first is the cautious way.

## Report (2026-10-18): phase 5, the helper program

On staging. The helper's release is not published yet; the Tools page
links where it will be.

**`helper/`** is one Go program, standard library only.
- It serves the game's XComGame folder on `127.0.0.1:47801`: hello, info,
  list, read, write (temporary file, then renamed into place), remove.
- It answers only pages from xcom.innonova.ch and xcom.aek.dk (`-origin`
  adds a dev server), and only with a pairing code it prints and keeps
  between runs.
- Paths outside the folder are refused.
- It finds a Steam install by itself: the default library, libraries in
  `libraryfolders.vdf`, or the folder it was started from. `-dir` points
  it elsewhere.
- Preflights answer Chrome's private-network check.
- `helper/README.md` says what it does and does not do.
- `.github/workflows/helper.yml` builds Windows, Linux and macOS binaries
  on a `helper-v*` tag. It signs SHA256SUMS keyless with cosign as the
  site's release does, and publishes a release not marked latest, so the
  site's `v*` releases stay "latest".

**The page** connects with the pairing code ("Use the helper program"),
remembers it, and reconnects by itself on later visits while the helper
runs. All of Tools works the same through it: `GameFiles` behind both
routes. The staging vhost's CSP allows `http://127.0.0.1:47801` (installed
on www; `deploy/nginx-xcom.conf`); nothing can leave the machine.

**Found on the way, and fixed**: the bookkeeping (each file's original and
what was last written) lived in the browser. Reaching the same install
another way (the helper, another browser) would have taken the modded file
for the original and overwritten the real backup. It now lives in
`lwtree-backup/manifest.json` beside the backups, and a backup without a
record is taken as the original, never overwritten on a guess (tested).

Verified:
- Go tests: origin and code checks, paths outside the folder, atomic write,
  case-insensitive names, finding the game under any of its folders.
- A browser test that builds and runs the helper on a temporary install:
  wrong code refused, install read, a setting written to disk with its
  backup and manifest, reconnect after a reload, put back. Passes in
  Chromium, Firefox and WebKit, so Firefox and Safari players can manage
  mods this way.
- The Windows build on the Windows VM: finds the folder under a
  "Program Files (x86)" path, reads, replaces a file in place with no
  temporary file left, refuses `..\` (400) and another origin (403).
- The real HTTPS staging page against a local helper in Chromium 156.
  Chrome blocks loopback until the site is allowed to reach the local
  network; once allowed, it connects. A real Chrome asks the player; the
  page's message says to allow it.

Open, for the person:
- **Publishing the helper**: pushing a `helper-v1.0.0` tag publishes a
  public download. Not done without the go-ahead. The binaries are not
  code-signed, so Windows SmartScreen will warn (the README explains).
  Signing would need a certificate.
- **Production**: xcom.aek.dk's CSP (in the estate's site config) would
  need the same `connect-src` addition. Held, with everything else.
- **A first real run** on the person's install, ideally on a copy of the
  game folder first.

## Report (2026-10-19): the first real install

The person pointed the page at their install, and it showed three faults:

- **The example path was the person's own** (`I:\Steam\…`), taken from
  our conversation. It is now a neutral `…\steamapps\common\XCom-Enemy-Unknown`.
- **Picking XCom-Enemy-Unknown found "Enemy Within without Long War".**
  The game folder holds Enemy Unknown's own `XComGame` next to `XEW`, and
  the search tried that first. `XEW/XComGame` now comes first; the browser
  test's fake install has both, so the old order would fail it.
- **"No DefaultGameCore.ini found"**: Chrome on Windows does not let web
  pages open `.ini` files at all. Safe Browsing's file types rate `ini`
  DANGEROUS on Windows, and File System Access refuses such names
  (`IsSafePathComponent`) and leaves them out of folder listings
  (read in Chromium's source 2026-10-19). On Linux they are allowed, which
  is why no test saw it. The page now tells "refused" from "missing"
  (TypeError against NotFoundError) and says so:
  - settings cannot be read or set that way, and the page suggests "Load
    DefaultGameCore.ini" for the costs, or the helper;
  - a plan that needs an INI (settings, a mod's INI files) leaves those
    parts out with the reason and writes the rest (tested).

  So on Windows the browser's folder access covers the package patching
  only, and the helper program is the way to INI settings and mods' INI
  files. That makes publishing the helper more worthwhile.
- The folder line shows only the names below the picked folder: browsers
  never give pages a full path. The page now says so; through the helper
  it shows the full path.

## Report (2026-10-19): the helper on the person's machine

- **It took Enemy Unknown's XComGame**, the same lookup-order fault as the
  page's. `XEW/XComGame` now comes first in the helper too (Go test).
- **It did not find the game by itself.** It only looked under Program
  Files. Steam can be installed anywhere, and the person's game is in a
  library on another drive. Now it:
  - asks Windows where Steam is (`reg query` of Steam's SteamPath and
    InstallPath);
  - reads Steam's library list from both `steamapps\` and `config\`;
  - checks the usual Steam folders on every drive;
  - if it still fails, lists the libraries it looked in.

  Tested on the Windows VM: Steam registered at an odd place, the game in a
  second library with both XComGame folders, the helper started without
  `-dir`: it found `XEW\XComGame`.
- The page now says, when it finds plain Enemy Within, that Long War lives
  in `XEW\XComGame`.

- **Then it hung with no output** on the person's machine. Most likely the
  drive scan: it touched every drive letter before anything else, and an
  offline network drive or an empty card reader can block for long. It
  also printed nothing until the search was done. Now:
  - it says it is looking and names each library as it checks it;
  - it tries the Steam Windows knows about first;
  - only then does it look at the computer's own fixed drives (Windows'
    drive type, which does not touch the media);
  - every look at the disk has a 3-second limit.

  Re-tested on the VM.
