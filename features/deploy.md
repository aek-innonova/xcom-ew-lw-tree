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
