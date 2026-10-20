#!/usr/bin/env bash
# The website's screenshots of the desktop app (features/desktop-app-page.md):
# made from the app here (e2e-desktop/site-shots.spec.ts, against a game
# folder and library of the person's own files), then scaled and saved as
# WebP in public/desktop/.
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build >/dev/null
(cd desktop && npm run build >/dev/null)
rm -rf /tmp/lwtree-shots

# A stand-in game with Long War 1.0 installed, and a library with the two
# downloads, made fresh from samples/ (this machine's copies, not in git):
# the packages the views read, linked; the INIs copied, as the app writes them.
game=/tmp/shotgame lib=/tmp/shotlib s="$PWD/samples"
lw="$s/Long War Mod Manager 1.0d-620-1-0d/LongWarFiles/_Long War EW 1.0 for PC-88-1-0.exe/{app}"
rm -rf "$game" "$lib"
mkdir -p "$game/XEW/XComGame/CookedPCConsole" "$game/XEW/XComGame/Config" "$lib"
for p in Startup XComGame XComShell LongWar Anim_Barracks gfxInterception_SF UICollection_Strategy_SF \
  Soldier_{Male,Female}{Kevlar,Carapace}_SF Soldier_Male{Skeleton,Ghost,Titan,Archangel,Psi}_SF \
  Deco_{Kevlar0,Kevlar1,Carapace0,Skeleton0,Ghost0,Titan0,Archangel0,Psi0}_SF \
  Helmet_Kevlar{0,9}_SF Head_{CaucMale_A,CaucFem_A,AfrMale_B}_SF Hair_{MaleHair_A,MaleHair_C,FemHair_A}_SF; do
  ln -s "$s/CookedPCConsole/$p.upk" "$game/XEW/XComGame/CookedPCConsole/"
done
ln -s "$s/CookedPCConsole/"{CharTextures,Textures}.tfc "$game/XEW/XComGame/CookedPCConsole/"
ln -s "$lw/Long_War_EW_Armor_Kit_Codes.txt" "$game/XEW/"
cp "$lw/XComGame/Config/"{DefaultGameCore,DefaultContent}.ini "$game/XEW/XComGame/Config/"
ln -s "$s/Long War Mod Manager 1.0d-620-1-0d/Long War EW 1.0 for PC-88-1-0.exe" "$lib/"
ln -s "$s/LW Rebalance V2.06.00 - Perkicon 686 2.06.00 2026-10-18T00-20Z IYVlw8ZX.zip" "$lib/LW Rebalance V2.06.00.zip"

LWTREE_SHOTS=1 xvfb-run -a npx playwright test -c playwright.desktop.config.ts e2e-desktop/site-shots.spec.ts
mkdir -p public/desktop
for f in /tmp/lwtree-shots/*.png; do
  ffmpeg -nostdin -loglevel error -y -i "$f" -vf "scale='min(1440,iw)':-2" -quality 82 "public/desktop/$(basename "${f%.png}").webp"
done
ls -la public/desktop
