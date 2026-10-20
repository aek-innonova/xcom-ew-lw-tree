#!/usr/bin/env bash
# The files the desktop app needs from a server, for a channel other than
# staging (features/production.md), made here and uploaded nowhere:
#
#   deploy/publish-desktop.sh <channel>
#
# Writes desktop/release/<channel>/publish/ with
#   bundle/<channel>.json   what is new (signed): the app checks it
#   bundle/<version>.json   the site as a signed bundle
#   app/                    the newest installer built for the channel
#                           (scripts/build-desktop-win.sh <channel> <url>),
#                           LATEST and SHA256SUMS
# to be put, as they are, where that installer's update.json points
# (<url>/bundle/, <url>/app/). With LWTREE_APP_URL set, the channel file names
# the installer under that URL instead, for keeping it on another host.
#
# Staging needs none of this: deploy/deploy.sh does it on the way.
set -euo pipefail
cd "$(dirname "$0")/.."
channel=${1:-}
[[ "$channel" =~ ^[a-z]+$ && "$channel" != staging ]] || { echo "usage: $0 <channel other than staging>" >&2; exit 2; }
key=${LWTREE_BUNDLE_KEY:-$HOME/.config/lwtree/bundle-key.pem}
[[ -f "$key" ]] || { echo "no bundle key at $key" >&2; exit 1; }
# The bundle is the site at a commit: a released one, not a working tree.
[[ -z "$(git status --porcelain)" ]] || { echo "the working tree has changes: commit first" >&2; exit 1; }
release=desktop/release/$channel
installer=$(ls -t "$release"/LongWarTechTree-Setup-*.exe 2>/dev/null | head -1 || true)
[[ -n "$installer" ]] || { echo "no installer in $release (scripts/build-desktop-win.sh $channel <url>)" >&2; exit 1; }

npm run build
rm -rf dist/app dist/bundle
mkdir -p dist/app
cp "$installer" dist/app/
basename "$installer" > dist/app/LATEST
(cd dist/app && sha256sum "$(cat LATEST)" > SHA256SUMS)
(cd desktop && npm run build >/dev/null)
node scripts/publish-bundle.mjs "$channel"

out=$release/publish
rm -rf "$out"
mkdir -p "$out"
mv dist/app dist/bundle "$out/"
git rev-parse HEAD > "$out/COMMIT"
echo "ready to upload: $out ($(git describe --tags --always))"
