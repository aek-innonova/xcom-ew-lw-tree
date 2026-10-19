---
title: "Desktop app: the site with the game's files in reach"
status: review
priority: 3
dependsOn: [game-tools]
---

## Purpose

Tools (features/game-tools.md) works on the game's own files, and a web page
cannot do that well. Chrome hides `.ini` files from pages on Windows,
refuses folders under Program Files, and other browsers have no folder
access at all. The helper program got round that, at the price of two
programs, a pairing code, a local-network permission prompt and a CSP
exception. A player willing to install something should get one program
that simply works. Decided with the person on 2026-10-19.

What the player sees:
- A Windows app holding the whole site.
- In the app, the Tools page finds the game by itself, reads and writes its
  files (INIs included, wherever it is installed), and follows the save
  folder as they play.
- The website keeps everything that does not touch the game's files (tree,
  air war, history, saves loaded by hand or watched in Chrome). It has no
  Tools at all.

## Requirements

- One codebase: the app shows the same Vue site, bundled (not loaded from
  the web), with the file-touching parts (GameFiles, the save folder)
  backed by the app.
- Locked down as Electron apps should be:
  - context isolation, sandboxed renderer, no Node in the page;
  - a narrow preload bridge whose file operations main confines to the
    game folder or the save folder the player chose or the app found;
  - links to the web open in the browser;
  - nothing leaves the machine, as on the site.
- Tools appears only in the app. The helper program retires: its code,
  build, workflow and CSP exception go.
- Windows first. Signing and notarization later: the person checks with
  their business partner about using the existing certificate. No public
  download until the person says so; staging may host a test build.

## Facts

- Electron 44 is current (2026-10-19); the person's Mimiri app uses
  Electron 42 with Forge/Squirrel on Windows.
- Finding the game as installers do: the uninstall entry Steam App 200510
  (InstallLocation), else the Steam library whose libraryfolders.vdf lists
  app 200510; Long War is in its XEW/XComGame. This was worked out and
  tested on the Windows VM for the helper.
- Saves: `Documents\My Games\XCOM - Enemy Within\XComGame\SaveData`.

## Verification

- Electron end to end with Playwright's Electron driver on Linux: the
  app, a temporary game folder, the Tools flow including an INI.
- The game finder in Node, unit-tested; on the Windows VM with the
  registry and library cases.
- The Windows installer built and started on the Windows VM.

## Report (2026-10-19)

A first Windows build works end to end. A test installer is on staging;
there is no public download.

**`desktop/`** (Electron 44, TypeScript):
- `main.ts` serves the built site from a private `app://lwtree` scheme
  with the site's CSP (connect-src 'self').
- The window is locked down: context isolation, sandboxed renderer, no
  Node in the page. Navigation stays on the app; web links open in the
  browser.
- The bridge answers only the app's own page. A custom scheme's URL has
  the origin "null", so scheme and host are compared; the first test
  caught that.
- `game.ts` finds the game the way installers do: Steam's uninstall entry
  for app 200510, else the library in Steam's libraryfolders.vdf that
  holds it. XEW/XComGame comes before Enemy Unknown's XComGame.
- Every path is confined to the game folder or the save folder, names are
  matched whatever their case, and writes go through a temporary file and
  a rename. Each look at the disk has a time limit.
- `preload.ts` is the bridge: game read, list, write, remove, find,
  choose, forget; saves list, read, choose, the default folder. The
  settings (which folders) live in the app's user data.

**The site**:
- `state/desktop.ts` types the bridge and adapts it to what the site
  already uses: GameFiles for Tools, a folder handle for the save-folder
  watcher, so neither changed beyond choosing the source.
- Tools exists only in the app. The website has no Tools button or page,
  and its Help has a "Desktop app" section linking the installer when
  the copy of the site has one.
- In the app the Game folder section offers "Find the game", "Choose the
  folder…" and "Forget it". It shows the full path, and the folders Steam's
  records led to when they did not lead to the game.
- "Watch save folder" in the app takes the game's usual SaveData if it is
  there.

**Retired**: the helper program (code, build, release workflow, browser
test), the web Tools route through Chrome's folder access, the "refused
.ini" handling, and the CSP exception for 127.0.0.1 (staging's vhost
needs reinstalling to drop it; the committed config already has).

**Building**: `scripts/build-desktop-win.sh` builds the site and the app
here, then the NSIS installer on the Windows VM. Linux would need 32-bit
Wine, and signing will be on Windows anyway. The exe carries its name,
version and icon (rendered from the favicon at 256 px); signing is
skipped (`signExecutable: false`) until the certificate question is
settled. The deploy copies the newest installer to staging's `/app/`.

**Verified**:
- `npm run test:desktop`: the app's Node tests (finder, registry and
  vdf parsing, confinement, writes). Then two Electron tests under xvfb
  on Linux:
  1. the app finds the game from its folder with both XComGame folders,
     reads and writes an INI setting with its backup, follows a save folder
     into an LWR campaign, and puts the original back;
  2. a window without the bridge has no Tools.
- On the Windows VM: the installer installed per user (silent). The
  installed app, started over SSH with a debugging port, found
  `XEW\XComGame`, read the INI Chrome had refused, wrote a setting with its
  original kept, and followed the save folder (screenshot looked right).
- The site's unit and browser suites, all green.

**Open**:
- Code signing, with the person's business partner's agreement; then
  signing in the Windows build.
- Updates (electron-updater needs somewhere to publish) once a public
  download is wanted.
- The person's own install has not been tried with the app yet.
