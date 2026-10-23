---
title: "Signing the desktop app's updates without a key anyone holds: attested builds, signed statements, a signer in the estate"
status: planned
priority: 2
dependsOn: [production, desktop-updates]
---

## Purpose

The person, 2026-10-23, on putting the desktop app into production: "the
electron app could download from github but what about the electron
updates, and the bundle updates?". Then, on the update key:
- "would it make sense to have it as a secret on github so the build can
  happen on push to main or some such?";
- "if a push to main signs then it signs where the key is seems not to
  matter much?";
- "if we want to take this seriously we need some signing infrastructure,
  also would it make sense to put github attestation into play?";
- "we could put the signature on a hash in the update information file
  keeping the attested bytes clean" (agreed: "go for it").

Every installed app runs whatever our update key signs: a bundle is site
code with the game's files and the player's library in reach, and a shell
update is an installer it executes. Whoever can get something signed can
run code on every player's PC. Players should be able to rely on this:
- an update reaches them only if it was built from this repository by its
  workflow, and a person released it;
- no copy of the key exists anywhere to be stolen;
- a compromised GitHub account cannot ship to them;
- anyone can check where a download came from.

Releasing should still be easy: staging on every push to main, production
on one approval.

## Facts (2026-10-23)

- **The channel file.** The app asks `<update URL>/bundle/<channel>.json`
  every six hours (`desktop/src/bundles.ts`). It names the latest bundle
  and shell installer; since shell 0.3.7, by full URL on any host. The
  update URL and channel are built into each installer (`update.json`).
- **The installer** is code-signed by Azure Artifact Signing in
  `.github/workflows/desktop.yml`. Our Ed25519 signature over its bytes is
  detached: in the channel file, with its size and SHA-256
  (`scripts/publish-bundle.mjs`). Its bytes are what the build made.
- **The bundle** is a wrapper, `{ format, key, payload, signature }`
  (`desktop/src/bundle-format.ts`): the published file is not the bytes the
  build made.
- **The channel file itself is not signed.** Whoever can change it can
  point an app at another channel's or an older validly signed bundle.
  How far the app refuses an older one rests on its own version check, not
  on a signature.
- **The key** (`lwtree-1`, Ed25519) is a file on the agent machine
  (`~/.config/lwtree/bundle-key.pem`). The apps trust it by name
  (`desktop/src/keys.ts`), with no way to replace it but a new installer.
- **The site's own release** (`.github/workflows/release.yml`, tags `v*`)
  already signs keylessly with cosign under the workflow's identity. The
  estate's web host verifies that bundle before serving xcom.aek.dk.
- **The estate** (`~/projects/iac`; docs.int.innonova.ch):
  - its design holds that the estate is run "in a way that does not hand
    the estate's keys to GitHub, to a build step, or to a single leaked
    file";
  - decision 18 makes cosign keyless bundles the provenance of every
    release, checked against repository and workflow before deploy;
  - OpenBao holds its secrets and PKI;
  - production actions are requests a person approves in its console.

## Requirements

- **Attested builds.** The workflow that builds the bundle and the installer
  attests each with the workflow's identity (Sigstore keyless, as the
  estate's decision 18 and the site's release already do). The attested
  file is the published file, byte for byte.
- **Signed statements, not signed files.** What we sign is a statement per
  artifact: channel, kind (bundle or shell), version, size, SHA-256, file
  name. The bundle becomes a plain file, no wrapper. The channel file
  carries the statements and their signatures. The app checks, in order:
  1. the signature, against the keys built into it;
  2. the downloaded file against the statement's size and hash;
  3. the statement's channel is its own and its version newer than what
     it has.
- **No key anyone holds.** The signing key is an Ed25519 key in the estate's
  OpenBao (Transit), not exportable. Signing is an API call by one service.
  The apps' current Ed25519 verification stays.
- **The signer** (a small service in the estate):
  - watches the repository's releases (outbound only: nothing on GitHub
    reaches into the estate, and GitHub holds no key or secret for it);
  - verifies each artifact's attestation: this repository, the expected
    workflow, the ref (main for staging, a release tag for production);
  - takes the hash from the attestation, signs the statement, and
    publishes the channel file.
  It never needs the artifacts themselves.
- **Staging** is signed without a person, for every attested build from
  main, under a staging key that only staging apps trust.
- **Production** is signed only when the person approves it as a request
  in the estate's console: an approval outside GitHub, so a compromised
  GitHub account can get a build attested but not signed for players.
- **A recovery key.** Built into the apps beside the signing key, kept
  offline (escrowed with the estate's other keys), never in CI or OpenBao.
  Its one use: a signed statement naming a new signing key, which apps
  then trust. A lost or leaked signing key is replaced without anyone
  reinstalling.
- **Hosting.** The installer, the bundles and the channel file are on
  GitHub Releases. The channel file is on a fixed release (a tag such as
  `channel-production`, the asset replaced at each publish). The app's built-in
  update target becomes the channel file's full URL rather than a base
  with `bundle/<channel>.json`. The website's desktop page links to the
  installer's release (its CSP does not let it read another origin's
  `LATEST`).
- **One new shell carries it.** All of the above that the app verifies (the
  statement format, the recovery key, the channel URL) ships in the first
  production shell, 0.4.0. Staging moves to it first; shells up to 0.3.7
  keep reading today's channel file until replaced.
- **Anyone can check a download**: `gh attestation verify <file> --repo
  aek-innonova/xcom-ew-lw-tree`, said on the website and in the README.

## What the estate would need (for the estate's own process)

Changes to `innonova/iac`. Held until the person decides: production work
on this project is on hold, and estate changes go through its pipeline and
its requests.
- An OpenBao Transit mount with two Ed25519 keys (`lwtree-staging`,
  `lwtree-production`), not exportable, a policy each.
- The signer as a service of the estate (its own repository, released with
  a cosign bundle like every service):
  - a GitHub read token, and a token to upload the channel file's asset,
    in `kv`;
  - an AppRole that may sign with the staging key at will and with the
    production key only for an approved request.
- A request type, `lwtree-release`, in the console: shows the build
  (commit, workflow run, the attested hashes, the changes since the last
  release) for the person to approve; approval lets the signer sign that
  release's statements once.
- The recovery key: generated offline, its private half escrowed with the
  estate's other escrowed keys, its public half given to this repository.

## Verification

- An app built with the new format refuses each of these:
  - a bundle whose bytes differ from its statement;
  - a statement signed by an unknown key;
  - another channel's statement;
  - an older version;
  - an unsigned channel file.
  It takes a new signing key only from a statement signed by the recovery
  key (tests, as the update tests do today).
- The signer refuses an artifact with no attestation, with another
  repository's or workflow's, or from a branch not allowed; it signs
  production only after an approved request.
- On staging, end to end: push to main → attested build → signed
  statements → the bench's staging app updates to it.
- `gh attestation verify` passes on a downloaded installer and bundle.

## Open questions

- Whether the app should also verify the attestation itself, as a second
  proof independent of our key. It would carry Sigstore's verification and
  trust roots into the app. Proposed: not now; the signer and anyone by
  hand do it.
- Freeze attacks: a channel file held back to stop updates. A statement
  could carry an expiry, so an app warns when its channel has not been
  re-signed within, say, a month. The signer would then re-sign on a
  schedule.
- The staging key's protection. It lives in OpenBao like production's, but
  is signed without a person: a staging app runs whatever main builds.
  That is acceptable, as only test installs follow staging.
