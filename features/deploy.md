---
title: Publish at xcom.innonova.ch
status: review
priority: 0
dependsOn: []
---

## Purpose

The site is reachable at `https://xcom.innonova.ch` from the start, so
each feature can be seen where players will see it.

## Requirements

- The name registered through the estate's names door (iac-api, see the
  machine notes), routed to nginx on `www`.
- A vhost on `www` serving the built `dist/` as static files, with a SPA
  fallback to `index.html`.
- A repeatable deploy: one script in this repository that builds and
  rsyncs `dist/`. No secrets in the repository.

## Worth

Under an hour.

## Report (2026-10-18)

**What changed.** `deploy/nginx-xcom.conf` (the vhost, installed on `www`
as `/etc/nginx/sites-available/xcom.innonova.ch`, linked from
`sites-enabled`), `deploy/deploy.sh` (build, then rsync `dist/` to
`www:/srv/xcom/`, owned by `inno`). The name `xcom.innonova.ch` is
registered through iac-api (201, certificate issued 2026-10-18).

The vhost sends a Content-Security-Policy with `connect-src 'self'`,
which backs the page's promise that files are not uploaded: the page
cannot send anything elsewhere. Hashed assets are cached as immutable,
`index.html` is revalidated. Cache-Control is set through a `map`,
because an `add_header` inside a `location` silently drops the
server-level headers (the first version lost its CSP that way).

**Verified.** `https://xcom.innonova.ch` serves the built site; headers
checked with curl; the Playwright run against the live URL loads a save,
selects a tech, and logs no console or CSP errors.

**Left open.** The vhost file in the repository and the one on `www` are
kept in step by hand (scp + `nginx -t` + reload); `deploy.sh` publishes
only the site.

## Report (2026-10-18, xcom.aek.dk)

The estate serves the site as `xcom.aek.dk`, a site of kind `release` in
`innonova/iac` (`sites/xcom.aek.dk.yml`): signed releases of this public
repository, verified (cosign, this repository's release workflow at the tag)
and unpacked by the estate's nginx role. Placed on `iac-nginx` in production
beside aek.dk, rehearsed in dev on `inno-iacsb-app2`; `v1.0.0` in both
`versions.yml`. The vhost carries the app's own headers (`nginx_extra`): the
Content-Security-Policy with `connect-src 'self'`, immutable hashed assets,
everything else revalidated, the single-page fallback. DNS needed nothing
(`*.aek.dk` points at the ingress).

Verified in dev from the seat: headers, an immutable asset, a picture, the
fallback, and in a browser through the seat a save loaded and the air war's
odds from the worker, no errors. Production is asked for in change request innonova/iac#179
(`scripts/change-request.sh`, approved in the estate console).

Found on the way: dev's scoped converge for a new site (`--tags sites`)
does not touch dev's resolver (the resolver role carries no tag), so dev's
DNS kept answering the new name with the public ingress until the resolver
host was converged by hand (`scripts/converge-dev.sh --full --limit
inno-iacsb-ingress-int`). Production resolves through public DNS and is not
affected.

xcom.innonova.ch (the dev box, `deploy/deploy.sh`) stays as a staging copy.

Applied in production 2026-10-18 (innonova/iac#179, run 39146278937):
https://xcom.aek.dk answers 200 under a Let's Encrypt certificate with the
app's headers; checked from outside in a browser (a save, the air war's
odds and a fight, no errors).
