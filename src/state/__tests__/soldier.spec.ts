import { describe, expect, it } from 'vitest'
import { kitWeapons, looksIn, weaponLabel } from '../soldier'

// DefaultContent.ini's kits as Long War and LWR have them (features/game-soldiers.md).
const LW = [
  'ArmorKitPackageInfo=(KitType=eKit_AssaultRifle_Kevlar,ArchetypeName="Kit_AssaultRifle_I_Medium.ARC_Kit_AssaultRifle_I_Medium")',
  'ArmorKitPackageInfo=(KitType=eKit_LMG_Kevlar,ArchetypeName="Kit_LMG_I_Medium.ARC_LMG_I_Medium")',
  'ArmorKits=(Armor=eItem_ArmorKevlar,Weapon=eItem_AssaultRifle,ArmorKit=eKit_AssaultRifle_Kevlar)',
  'ArmorKits=(Armor=eItem_ArmorKevlar,Weapon=eItem_ExaltAssaultRifle,ArmorKit=eKit_AssaultRifle_Kevlar)',
  'ArmorKits=(Armor=eItem_ArmorKevlar,Weapon=eItem_LMG,ArmorKit=eKit_LMG_Kevlar)',
  'ArmorKits=(Armor=eItem_ArmorKevlar,Weapon=226,ArmorKit=eKit_AssaultRifle_Kevlar)',
  'ArmorKits=(Armor=eItem_ArmorCarapace,Weapon=eItem_SniperRifle,ArmorKit=eKit_SniperRifle_Carapace)',
].join('\r\n')

describe('the soldier’s kit (state/soldier.ts)', () => {
  it('reads which kit each armor and weapon wear, and their packages', () => {
    const l = looksIn(LW)
    expect(l.kits.eKit_LMG_Kevlar).toBe('Kit_LMG_I_Medium')
    expect(l.armorKits).toContainEqual({
      armor: 'eItem_ArmorKevlar',
      weapon: 'eItem_AssaultRifle',
      kit: 'eKit_AssaultRifle_Kevlar',
    })
    // The player's weapons for an armor: not Exalt's, not the numbered ones.
    expect(kitWeapons(l, 'Kevlar')).toEqual(['eItem_AssaultRifle', 'eItem_LMG'])
    expect(kitWeapons(l, 'Carapace')).toEqual(['eItem_SniperRifle'])
  })

  it('LWR: a rifle on Kevlar wears the LMG kit', () => {
    const lwr = looksIn(
      'ArmorKits=(Armor=eItem_ArmorKevlar,Weapon=eItem_AssaultRifle,ArmorKit=eKit_LMG_Kevlar)',
    )
    expect(lwr.armorKits[0]!.kit).toBe('eKit_LMG_Kevlar')
  })

  it('names weapons as the player knows them', () => {
    expect(weaponLabel('eItem_LaserAssaultRifle')).toBe('Laser Assault Rifle')
    expect(weaponLabel('eItem_LMG')).toBe('LMG')
    expect(weaponLabel('eItem_SniperRifle')).toBe('Sniper Rifle')
  })
})
