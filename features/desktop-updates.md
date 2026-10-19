---
title: "Desktop app updates: signed site bundles, and the shell when it must"
status: review
priority: 3
dependsOn: [desktop-app]
---

## Purpose

The desktop app (features/desktop-app.md) is the site plus a thin shell.
The site changes often; the shell rarely. A player should get the site's
changes without reinstalling anything, and a new shell only when a change
needs one. Reinstalling the app for every site change is what the person
wants to avoid. The person asked for the shape of Mimiri's update setup
(`~/projects/mimiri-client-electron`, `mimiri-client/src/services/update-manager.ts`),
which they like.

## The shape (as Mimiri does it)

- **Two version streams.** The shell (the installer: Electron, the bridge,
  `desktop/`) and the bundle (the built site). The installer carries a base
  bundle, so a fresh install works offline. A running app replaces its
  bundle with any newer signed bundle the update server offers, if that
  bundle's minimum shell version allows it. When the gate excludes the
  shell, the app offers a new shell instead.
- **Bundles on disk.** Bundles are kept in the app's user data, one folder
  per version, next to a record of the active and the previous one.
  - A download lands in a temporary folder and is checked, file by file,
    before it gets its real name.
  - A bundle that is not whole is never served; the base bundle is.
  - Once a bundle has started properly it is marked good. One that never
    reports good is rolled back at the next start.
  - Old bundles are cleaned up.
- **Activation is the player's call.** A downloaded update waits; the page
  says one is ready and offers to restart into it now or leave it for
  the next start.

## Where this differs from Mimiri

- **The shell checks signatures, not the page.** In Mimiri the client
  downloads and verifies, and the shell saves what it is given. Here the
  main process fetches, verifies against a public key compiled into the
  shell, and saves. A page that misbehaved could not install anything,
  and the page's security policy stays `connect-src 'self'`: it never talks
  to the update server.
- **Ed25519**, one key pair, in place of RSA.
- **The update server is the site itself**, under `/bundle/`: staging
  (xcom.innonova.ch) for now, as a "staging" channel. Production, and
  where its private key lives, wait for the person (prod is held).
- **A new shell is the NSIS installer**, the same file Help links,
  verified by the same key, then run silently; Mimiri uses
  Squirrel/autoUpdater.

## Requirements

- Nothing unsigned or older than the active bundle is ever installed. A
  bundle's version is inside what is signed.
- The private key never enters the repository, a log or a chat. For
  staging it lives on the machine that deploys (`~/.config/lwtree/`,
  mode 600).
- A broken or partial bundle never leaves the player with a blank window:
  the base bundle always works.
- Old app versions keep working with new bundles and the other way round,
  within the minimum-shell gate. The bridge (preload) is the contract:
  add to it, do not change it. The site checks for what it needs.

## Verification

- Node tests of the shell's bundle handling: signature (good, tampered,
  wrong key), version (older or equal refused), the shell gate, a
  partial bundle never served, rollback of a bundle that never reported
  good.
- Electron end to end: a local update server with a test key. The app
  finds the update, downloads it, says it is ready, and after a restart
  shows the new bundle. A tampered bundle is refused and the old one
  stays.
- On the Windows bench: an installed older version updates its bundle
  from staging, and a shell update runs the new installer and comes back.

## Report (2026-10-19)

Built and tested; on staging from this commit's deploy.

- **The format** (`desktop/src/bundle-format.ts`): the built site packed
  file by file (gzipped, each with its size and SHA-256) into a payload.
  The payload carries its version and the oldest shell it needs, and is
  signed with Ed25519 as JSON text (nothing is re-serialized to check it).
  Installers are signed the same way.
- **The shell** (`desktop/src/bundles.ts`, `main.ts`):
  - It serves the active bundle and checks the update server 10 s after
    start and every 6 h.
  - A newer bundle this shell can run is downloaded, its signature and
    announced version checked, unpacked into a temporary folder with every
    file checked, then renamed into place. It becomes active at the next
    start, or when the player restarts into it.
  - A bundle started twice without reporting good is rolled back, and
    never taken again.
  - A partial one is never served.
  - When a bundle needs a newer shell, the shell's installer is downloaded
    and checked (size, SHA-256, signature). "Install it and restart" runs
    it silently (NSIS `/S --force-run`) and quits.
- **The page** (`src/state/updates.ts`): it reports good once it is up,
  and shows a notice when a new site is ready ("Restart into it" / "At
  the next start"), or when the next site needs a newer app. The app's
  Help shows the app and site versions, "Check for updates", and a newer
  app when one is out. Shells before 0.2.0 have no `bundle` bridge; the
  page checks for it.
- **Publishing**:
  - `scripts/publish-bundle.mjs <channel>` writes
    `dist/bundle/<version>.json` and `dist/bundle/<channel>.json`;
    `deploy/deploy.sh` runs it for "staging" when the machine holds the key.
  - The version is the commit's time (UTC, `2026.1019.172020`), so the
    same commit always builds the same version.
  - The base bundle in the installer carries it in `.bundle-info.json`
    (`scripts/copy-site.mjs`).
  - `package.json` `lwtree.minShellVersion` (0.2.0) is what the site needs
    from the bridge; raise it when the site starts using a new call.
- **The key**: Ed25519 "lwtree-1". Its private half is in
  `~/.config/lwtree/bundle-key.pem` on this machine only (mode 600;
  `scripts/make-bundle-key.mjs`), its public half in `desktop/src/keys.ts`.
  Production's key, and where it would live, wait for the person.

Verified:
- 8 Node tests of the shell's handling:
  - signatures: good, tampered, another key, unknown key;
  - damaged files and paths out of the bundle;
  - nothing older, equal, forged or needing a newer shell installed;
  - a bundle announced as one version and signed as another refused;
  - a needed shell downloaded and checked, a forged installer refused;
  - rollback of a bundle that never reports good, and no second take;
  - a partial bundle never served.
- 2 Electron tests against a local update server: a newer signed site is
  offered and served after "Restart into it"; one signed with another key
  is refused and the app keeps its own.

Open: the Windows bench (an installed 0.2.0 taking a new site from
staging, and a shell update coming back by itself); production.

## Report (2026-10-19): Windows bench, step 1 — a base-version bug

Installed the published 0.2.0 from staging (SHA-256 checked) and opened
Help. It read **App 0.2.0 · site 0.0.0**, with staging's identical bundle
(2026.1019.173515) already downloaded and "ready at the next start" — not
"up to date" as expected. A fresh install re-downloads the same site at
once.

Cause: the published installer's base bundle has no `.bundle-info.json`,
so `baseInfo()` falls back to `0.0.0` and every real bundle looks newer.
`scripts/build-desktop-win.sh` made the base bundle with
`rm -rf site && cp -r ../dist site`, which skips `copy-site.mjs` and so
never stamps `.bundle-info.json` (nor leaves out the staging `app/`,
`bundle/` extras). Confirmed: the published app.asar has `site/index.html`
but no `site/.bundle-info.json`; an installer built with `npm run dist:win`
(which uses `copy-site.mjs`) does include it, with the right version.

Fixed `build-desktop-win.sh` to build the base bundle with
`npm run site`. The published 0.2.0 needs rebuilding and republishing for
step 1 to read "up to date"; steps 2–3 wait on that.

## Report (2026-10-19): Windows bench, the update round passed

Republished 0.2.0 with the fixed build script and ran the three steps on
the bench, as a player meets them: the published installer from staging
(SHA-256 checked), started normally, driven through the app's own UI.

1. **A fresh install is up to date.** Help read "App 0.2.0 · site
   2026.1019.174630" and, after a check, up to date; nothing downloaded.
2. **A new site arrives.** Staging got 2026.1019.175330 (a Help text
   change). "Check for updates" downloaded it and showed the banner;
   "Restart into it" reloaded the window into it, the page reported good,
   and two clean starts later it still served 175330 (config: active
   175330, previous base; no unproven, no bad).
3. **A new app arrives.** Staging got 0.2.1 and site 2026.1019.175756
   (the same commit, so also 0.2.1's base). Help offered both; "Install it
   and restart" downloaded the 111 MB installer, checked it, quit, ran it
   silently, and 0.2.1 came back by itself: 30 s from the click (17 s
   download and quit, 13 s install and relaunch). It read "App 0.2.1 ·
   site 2026.1019.175756", up to date, and stayed so over another start.
   The downloaded installer was cleaned up; Apps & features shows 0.2.1.

Also: plain `npx vitest run` collected the desktop's Node tests and the
Playwright specs and reported them as failed files; vitest now leaves them
to their own runners (`npm run test:desktop`).

Open, for the person:
- Production: its channel, its key (separate from staging's "lwtree-1")
  and where that key lives. Prod is held.
- Code signing: the installer is unsigned, so SmartScreen warns on the
  first install; the silent self-update does not show it.
