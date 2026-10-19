#!/usr/bin/env bash
# Build the helper program (helper/) into dist/helper/, so the Tools page can
# offer it from the site itself: lwtree-helper.exe (Windows), Linux and macOS
# builds, and SHA256SUMS. Needs Go (PATH, or ~/.local/go). The version is the
# commit it was built from.
set -euo pipefail
cd "$(dirname "$0")/.."

GO=$(command -v go || true)
[[ -z "$GO" && -x "$HOME/.local/go/bin/go" ]] && GO="$HOME/.local/go/bin/go"
if [[ -z "$GO" ]]; then
  echo "build-helper: no Go toolchain; the Tools page will say the helper is not available here" >&2
  exit 0
fi

version="$(git describe --always --dirty --exclude "*" 2>/dev/null || echo dev)"
out=dist/helper
rm -rf "$out" && mkdir -p "$out"
build() { # os arch file
  (cd helper && GOOS=$1 GOARCH=$2 CGO_ENABLED=0 "$GO" build -trimpath \
    -ldflags "-s -w -X main.version=$version" -o "../$out/$3" .)
}
build windows amd64 lwtree-helper.exe
build linux amd64 lwtree-helper-linux
build darwin arm64 lwtree-helper-macos
(cd "$out" && sha256sum lwtree-helper* > SHA256SUMS && printf '%s\n' "$version" > VERSION)
echo "build-helper: $version into $out/"
