---
title: Publish at xcom.innonova.ch
status: in-progress
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
