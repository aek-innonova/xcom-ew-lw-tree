#!/usr/bin/env bash
# Build the site and publish it to xcom.innonova.ch (nginx on www, /srv/xcom).
# Usage: deploy/deploy.sh [--skip-build]
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "${1:-}" != "--skip-build" ]]; then
  npm run build
fi

# The desktop app's installer, if one has been built (scripts/build-desktop-win.sh):
# a test copy for staging, offered from Help.
installer=$(ls -t desktop/release/LongWarTechTree-Setup-*.exe 2>/dev/null | head -1 || true)
if [[ -n "$installer" ]]; then
  mkdir -p dist/app
  cp "$installer" dist/app/
  basename "$installer" > dist/app/LATEST
  (cd dist/app && sha256sum "$(cat LATEST)" > SHA256SUMS)
fi

# --delete-after keeps the old assets in place until the new index.html is up.
rsync -rlt --delete-after --chmod=D755,F644 dist/ www:/srv/xcom/
echo "published: https://xcom.innonova.ch"
