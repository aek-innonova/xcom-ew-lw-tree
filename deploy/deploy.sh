#!/usr/bin/env bash
# Build the site and publish it to xcom.innonova.ch (nginx on www, /srv/xcom).
# Usage: deploy/deploy.sh [--skip-build]
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "${1:-}" != "--skip-build" ]]; then
  npm run build
fi

# --delete-after keeps the old assets in place until the new index.html is up.
rsync -rlt --delete-after --chmod=D755,F644 dist/ www:/srv/xcom/
echo "published: https://xcom.innonova.ch"
