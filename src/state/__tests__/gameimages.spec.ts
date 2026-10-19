import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import airwar from '../../../data/airwar.json'
import tree from '../../../data/techtree.json'
import foundry from '../../../longwar_foundry.json'
import type { GameFiles } from '../gamefiles'
import {
  gameImages,
  hasPicture,
  loadGameImages,
  pictureTable,
  picturePath,
  shipPicturePath,
} from '../gameimages'

describe('the game’s pictures (state/gameimages.ts)', () => {
  it('reads Long War’s picture table', () => {
    const t = pictureTable(
      [
        'MultiplayerLoadoutSlots=(strUnitName="UILibrary_StrategyImages.InventoryIcons.Inv_ArcThrower", \t\tiPointValue=0,\t\tiIconType=73)\t ; Arc Thrower',
        ';MultiplayerLoadoutSlots=(strUnitName="x.y.z", iPointValue=0, iIconType=1)',
        'MultiplayerLoadoutSlots=(strUnitName="gfxTacticalHUD.IC_Pistol|54", iPointValue=1, iIconType=2)',
        'MultiplayerLoadoutSlots=(strUnitName="LongWar.TechImages.TI_Gauss_Weapons",iPointValue=2,iIconType=28);',
      ].join('\r\n'),
    )
    expect([...t]).toEqual([
      ['0:73', 'UILibrary_StrategyImages.InventoryIcons.Inv_ArcThrower'],
      ['1:2', 'gfxTacticalHUD.IC_Pistol'],
      ['2:28', 'LongWar.TechImages.TI_Gauss_Weapons'],
    ])
  })
})

// The person's install, and Long War's own DefaultContent.ini (git-ignored samples/).
const S = resolve(import.meta.dirname, '../../../samples')
const CONTENT = `${S}/Long War Mod Manager 1.0d-620-1-0d/LongWarFiles/_Long War EW 1.0 for PC-88-1-0.exe/{app}/XComGame/Config/DefaultContent.ini`
describe.skipIf(!existsSync(`${S}/CookedPCConsole/XComShell.upk`) || !existsSync(CONTENT))(
  'on the real install',
  () => {
    it('every research, Foundry project and air war ship has its picture in the install', async () => {
      const files = {
        read: async (p: string) =>
          p === 'Config/DefaultContent.ini'
            ? new Uint8Array(readFileSync(CONTENT))
            : existsSync(`${S}/${p}`)
              ? new Uint8Array(readFileSync(`${S}/${p}`))
              : null,
      } as unknown as GameFiles
      await loadGameImages(files)
      expect(gameImages.ready).toBe(true)
      // Long War's own techs sit in the game's placeholder slots, with its own pictures.
      const real = (tree as { techs: { id: number; enum: string }[] }).techs
      const missing = [
        ...real.filter((t) => !hasPicture(picturePath('tech', t.id))).map((t) => t.enum),
        ...(foundry as { projects: { id: number; name: string }[] }).projects
          .filter((p) => !hasPicture(picturePath('foundry', p.id)))
          .map((p) => p.name),
        ...airwar.ships
          .filter((s) => s.image !== 67 && !hasPicture(shipPicturePath(s.image)))
          .map((s) => s.name),
      ]
      expect(missing).toEqual([])
    })
  },
)
