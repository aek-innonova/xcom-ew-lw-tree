# Proposal: the trust service (trust.innonova.ch)

For the estate (`innonova/iac` and its process), from the lwtree project,
2026-10-23. Nothing of it is built or requested yet; the person decides
whether, when and how it goes into the estate.

## What it is for

Products the estate builds or ships update themselves on machines we do
not control: the lwtree desktop app first, later perhaps others (Mimiri's
clients). Each must take only what we released. Today each would solve
that alone, with a signing key somewhere: a file on a laptop, or a secret
in GitHub. Either way, whoever holds the key can run code on every user's
machine.

The trust service gives every product the same answer, with no key anyone
holds:
- a product's releases are built and attested by its own workflow (cosign
  keyless, as decision 18 already has every release do);
- the service checks the attestation against the product's registration;
- it signs a statement over the release's hashes with a key that never
  leaves OpenBao;
- for production, only after a person approves it in the console.
- What it signed is public at `trust.innonova.ch/<product>/`, beside the
  keys to check it with and a list of what was withdrawn.

A compromised GitHub account can get a build attested, but not signed for
users. A stolen laptop holds nothing.

The design keeps the estate's rule: nothing "hands the estate's keys to
GitHub, to a build step, or to a single leaked file".

## Registration: one declaration per product

`trust/<product>.yml` in `innonova/iac`, beside `services/` and `sites/`:

```yaml
product: lwtree
repository: aek-innonova/xcom-ew-lw-tree
artifacts:                          # release assets that count, by name
  - "LongWarTechTree-Setup-*.exe"
  - "bundle-*.json"
channels:
  staging:
    workflow: .github/workflows/desktop.yml
    ref: refs/heads/main
    approval: none                  # signed as soon as it is attested
  production:
    workflow: .github/workflows/desktop.yml
    ref: refs/tags/v*
    approval: person                # a request in the console
valid: 30d                          # how long a signed channel file holds
resign: 7d                          # re-signed this often, changed or not
recovery_key: ed25519:…             # public half; the private half is escrowed offline
```

Keyed by product, not repository: a repository can move or be renamed, and
one can hold several products.

The converge creates, per product and channel, an Ed25519 key in OpenBao
Transit (`trust-<product>-<channel>`, not exportable) and the policy that
lets only the trust service sign with it.

## How it works

1. **It hears of a release** on the bus: `github.<owner>.<repo>.release`
   (type `release.published`), for a registered repository. The inlet takes
   the innonova organisation's webhook. A repository outside it (lwtree is
   under `aek-innonova`) gets its own webhook to the inlet; the service also
   polls registered repositories hourly, in case an event was missed.
2. **It checks** each release asset matching the product's artifact names.
   For each it takes the cosign bundle published beside it and verifies it:
   - the certificate's identity is the registered workflow, in the
     registered repository, at a ref the channel allows;
   - the bundle's digest is the asset's.
   The asset itself is read only to confirm the digest; the hash it signs
   is the attested one. A release with any artifact failing is not signed,
   and the reason goes to `alerts.prod.trust.warning`.
3. **It decides by the channel's policy.** `approval: none`: signed at
   once. `approval: person`: a request `trust-release` opens in the console,
   showing:
   - the product, the channel and the version;
   - the commit, the workflow run and the attested hashes;
   - the changes since the last release.
   The person's approval lets the service sign that release once.
   Rejected or not acted on: nothing is signed.
4. **It signs** the channel's new statements with the channel's key
   (OpenBao Transit) and publishes the files below. It announces
   `estate.prod.trust.<product>.signed` on the bus.
5. **It re-signs** every channel's current statements every `resign`, so a
   channel file is never older than that. Expiry tells users when they are
   no longer getting fresh answers (a frozen channel, or a service down).

## What it publishes: trust.innonova.ch/<product>/

Static JSON, small, cacheable for minutes, served by the service (a site of
kind `service` behind the public ingress). Every file is a signed document:

```json
{ "body": "<the JSON below, as a string>", "key": "<key id>", "signature": "<Ed25519, base64>" }
```

The signature is over `body`'s bytes exactly as they stand, so no
canonical JSON is needed: a client verifies the string, then parses it.

- **`keys.json`**: signed by the recovery key.
  `{ "product", "version", "issued", "keys": { "<channel>": [ { "id", "ed25519": "<public key>" } ] } }`.
  Version only grows. A client keeps the highest it has seen and refuses a
  lower one: that is how a signing key is replaced or revoked.
- **`<channel>.json`**: signed by that channel's key.
  `{ "product", "channel", "issued", "expires", "artifacts": [ { "kind", "version", "name", "url", "size", "sha256" } ] }`.
  `kind` is the product's own (lwtree: `bundle`, `shell`); `url` is where to
  download it (the GitHub release asset).
- **`revoked.json`**: signed by the production channel's key.
  `{ "product", "issued", "revoked": [ { "kind", "version", "sha256", "reason" } ] }`.
  Changed by a request in the console, like a release.
- **`history/`**: every signed document, never removed, so nothing signed
  can be quietly taken back.

## What a client does

Fetch a URL, check a signature, check a hash. In full:
1. Fetch `keys.json`; verify it with the built-in recovery key; refuse it if
   its version is below the highest seen; keep it.
2. Fetch `<channel>.json`; verify it with a key `keys.json` lists for that
   channel; refuse it if it is expired (with a day's tolerance for clocks),
   for another product or channel, or offers nothing newer.
3. Fetch `revoked.json`; refuse what it lists.
4. Download from `url`; compare size and SHA-256.

Each product writes this in its own language. It is a page of code; lwtree's
lives in its desktop shell.

## What the estate gets, and what it costs

- **New:** the service (its own repository, `innonova/trust`, released like
  every service with a cosign bundle). Its tokens in `kv`: a GitHub read
  token, and nothing that can write to any repository. Its bus publisher
  key. An OpenBao Transit mount, with a key and policy per product channel.
  A request type, `trust-release`, in the console. A public name,
  `trust.innonova.ch`.
- **Per product:** one declaration; the recovery key, generated offline,
  its private half escrowed with the estate's other escrowed keys.
- **Not:** any key or secret in GitHub; any write access to a repository
  from the estate.

## Open questions

- Whether the console's approval should show a diff of the source between
  releases, or link to GitHub's compare view (simpler).
- Whether the service should also keep a copy of the artifacts it signed,
  so a product survives its GitHub release being deleted.
- Whether the estate's own deploys (decision 18) should come to check
  against the trust service too, so one place answers "was this released".
