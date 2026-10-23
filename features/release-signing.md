---
title: "Signing the desktop app's updates without a key anyone holds: attested builds, signed statements from the estate's trust service"
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
  keeping the attested bytes clean" (agreed: "go for it");
- "do we actually want to host the channel file on github?" (no: in the
  estate, under a name the person owns);
- "how do we actually design the signer so that we might reuse it for other
  apps and not as bespoke for this one, do we register repos with it and
  have it listen for something on the bus and then host something for each
  repo perhaps like trust.innonova.ch/reponame/something, it could also
  expose public keys and a revocation list";
- on TUF: "i think i prefer our own, taking on a complex dependency for
  something that critical, and the whole client thing is overrated it is
  literally fetch a url check a signature not rocket science". Decided: our
  own format, kept small.

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

The signing itself is the estate's trust service, a general service for
any product (`docs/trust-service.md`: the proposal for the estate). This
app is its first product, `lwtree`. What this repository and the app need:

- **Attested builds.** The workflow that builds the bundle and the installer
  attests each with the workflow's identity (cosign keyless, a bundle as a
  release asset, as the estate's decision 18 and the site's release already
  do), and publishes them as a GitHub release. The attested file is the
  published file, byte for byte: the bundle becomes a plain file, no
  wrapper.
- **The big files on GitHub, the trust in the estate.** Installers and
  bundles are downloaded from GitHub Releases (GitHub's CDN; the office
  line carries none of it). What the app trusts comes from
  `https://trust.innonova.ch/lwtree/`, a name the person owns:
  - `<channel>.json`: the signed statements for the channel's current bundle
    and shell, each with its download URL;
  - `keys.json`: which keys sign which channel, signed by the recovery key;
  - `revoked.json`: releases withdrawn.
- **The app** (shell 0.4.0, the first production shell; staging moves to it
  first) knows the product's address, its channel and the recovery key's
  public half, and nothing else about trust. On each check it:
  1. fetches `keys.json` and checks it with the recovery key (a newer one
     replaces what it knew; an older one is refused);
  2. fetches `<channel>.json` and checks its signature with the channel's
     key from `keys.json`;
  3. refuses it if it has expired, names another product or channel, or
     offers a version not newer than what it has;
  4. fetches `revoked.json` and refuses what is listed (moving off a
     revoked bundle it runs, to the newest good one);
  5. downloads the file from the statement's URL and checks size and
     SHA-256.
  A check that cannot complete, or keeps finding an expired channel file,
  is said in the app ("couldn't confirm this app is up to date"), not
  hidden.
- **Shells up to 0.3.7** keep reading today's channel file, until their
  players have installed 0.4.0. Nothing moves an app between channels.
- **Anyone can check a download**: `gh attestation verify <file> --repo
  aek-innonova/xcom-ew-lw-tree` or cosign against the release's bundle.
  Said on the website and in the README.
- **The website's desktop page** links to the installer's release (its CSP
  does not let it read another origin's files).
- **Releasing:** staging from every push to main, signed by the trust
  service on its own; production from a release tag, signed when the
  person approves the request in the estate's console. No key or signing
  secret in GitHub, and none on any agent machine. (`lwtree-1`, the key
  staging signs with today, is retired once staging is on 0.4.0.)

## Verification

- The app's checks, each refused in a test as the update tests do today:
  - a `keys.json` not signed by the recovery key, or older than the one it
    has;
  - a channel file signed by a key `keys.json` does not give that channel;
  - an expired channel file, another product's or channel's, an older
    version;
  - a revoked release (and one it runs: it moves off);
  - a download whose size or hash differs.
  A new signing key is taken from a `keys.json` the recovery key signed.
- On staging, end to end: push to main → attested release → the trust
  service signs → the bench's staging app (0.4.0) updates to it.
- `gh attestation verify` passes on a downloaded installer and bundle.
- The trust service's own verification: its proposal's.

## Open questions

- Whether the app should also verify the attestation itself, as a second
  proof independent of the trust service. Proposed: not now; the trust
  service and anyone by hand do it.
- How often the trust service re-signs, and how long a channel file is
  valid. Proposed: weekly, valid a month; the app warns, never blocks.
