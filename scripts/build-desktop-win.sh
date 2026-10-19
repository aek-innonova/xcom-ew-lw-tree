#!/usr/bin/env bash
# Build the desktop app's Windows installer (features/desktop-app.md): the
# site and the app here, the installer on the Windows VM (ssh win), the
# result copied back to desktop/release/. Only the app's build inputs go to
# the VM (compiled code, the built site, config, icons), not the working tree.
set -euo pipefail
cd "$(dirname "$0")/.."

# The base bundle must be made with copy-site.mjs (npm run site), not a plain
# copy: it stamps site/.bundle-info.json with the bundle version and leaves out
# the staging extras. A `cp -r` here shipped a base bundle with no version, so
# installed apps read their site as 0.0.0 and re-downloaded the same bundle.
(cd desktop && npm run site && npm run build)
version=$(node -p "require('./desktop/package.json').version")
tar czf /tmp/lwtree-desktop.tgz -C desktop package.json package-lock.json electron-builder.yml build dist site
scp -q /tmp/lwtree-desktop.tgz win:lwtree-desktop.tgz
ssh win 'Remove-Item -Recurse -Force lwtree-desktop -ErrorAction SilentlyContinue;
  New-Item -ItemType Directory lwtree-desktop | Out-Null;
  tar -xzf lwtree-desktop.tgz -C lwtree-desktop; cd lwtree-desktop;
  npm ci --no-audit --no-fund *> npm.log;
  npx electron-builder --win nsis *> build.log; if ($LASTEXITCODE) { Get-Content build.log -Tail 20; exit 1 }'
mkdir -p desktop/release
scp -q "win:lwtree-desktop/release/LongWarTechTree-Setup-$version.exe" desktop/release/
echo "built desktop/release/LongWarTechTree-Setup-$version.exe"
