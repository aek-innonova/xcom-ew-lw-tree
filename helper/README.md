# lwtree-helper

A small program that lets the Long War Tech Tree page's Tools
(<https://xcom.innonova.ch>, the Tools button) read and write the game's
files where the browser cannot by itself:

- an install under `Program Files`, which Chrome and Edge refuse to open
  (Steam's default library, `C:\Program Files (x86)\Steam`);
- Firefox and Safari, which cannot open folders at all.

See `features/game-tools.md` for the whole feature.

## Using it

1. Download it from the Tools page: the site serves its own builds
   (`/helper/`, put there by `scripts/build-helper.sh` on deploy), with
   `SHA256SUMS`. Windows SmartScreen may warn, as it does for any program
   that is not code-signed: "More info", then "Run anyway".
2. Start it. It finds a Steam install of the game by itself (the default
   library and any listed in Steam's `libraryfolders.vdf`, or the folder it
   is started from); otherwise start it from a command prompt with
   `lwtree-helper -dir "D:\Games\XCom-Enemy-Unknown"`.
3. It shows a pairing code. In the Tools page choose "Use the helper
   program" and enter it. The code is kept (on both sides), so next time the
   page reconnects by itself while the helper runs.
4. Chrome asks whether the site may reach apps on this computer: allow it.
5. Close the window when done.

## What it does and does not do

- It listens on `127.0.0.1:47801` only: nothing else on the network can
  reach it.
- It answers only pages from `https://xcom.innonova.ch` and
  `https://xcom.aek.dk` (`-origin` adds one, e.g. a local dev server), and
  only with the pairing code.
- It serves one folder, the game's `XComGame` folder: listing, reading,
  writing (to a temporary file, then put in place at once) and removing
  files in it. Paths outside it are refused.
- It does nothing by itself. Every change comes from the page, after you
  have seen the plan there and confirmed it; the page keeps the originals
  in `XComGame/lwtree-backup/`.

## Building

Go, standard library only:

    cd helper
    go test ./...
    GOOS=windows GOARCH=amd64 go build -o lwtree-helper.exe .

`scripts/build-helper.sh` builds the Windows, Linux and macOS programs into
`dist/helper/` for the site (the deploy runs it). A tag `helper-vX.Y.Z`
would also publish them as a GitHub release (`.github/workflows/helper.yml`);
not used yet.
