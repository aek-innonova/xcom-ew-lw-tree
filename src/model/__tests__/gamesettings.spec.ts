import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applySettings,
  armorKitCodes,
  findSettings,
  settingsChanged,
  type SettingDef,
} from '../gamesettings'

const FILE = [
  '[XComGame.XGTacticalGameCore]',
  'Characters=( strName="", iType=eChar_Civilian,   HP=3,  Mobility=11, kInventory=( iArmor=eItem_NONE, HP=99 ) )',
  'Characters=( strName="", iType=eChar_Soldier,    HP=4,  Offense=65,  Mobility=13, ShieldHP=0, kInventory=( iArmor=eItem_NONE ), eClass=eSC_None )',
  'NUM_STARTING_SOLDIERS=40',
  'HIGH_WILL=3\t\t\t\t\t; Minimum Starting hp for rookie; midpoint set by soldier character entry',
  'HQ_BASE_POWER = 32\t\t\t; Sniper Color',
  'HQ_BASE_POWER = -1\t\t\t; Sniper Headgear',
  'Weapons=( strName="", iType=eItem_ArcThrower,  Properties[4]=eWP_Backpack,    Properties[5]=0,        iRange=27 )',
  ';Pistol slot arc thrower mod substitute line; comment out the line above and uncomment this one.',
  ';Weapons=( strName="", iType=eItem_ArcThrower,  Properties[4]=eWP_Backpack,    Properties[5]=eWP_Pistol,iRange=27 );',
  '; Arc Thrower',
  'Itembalance_Normal=(eItem=eItem_ArcThrower,\t\tiCash=100,\tiTime=10)',
  'BalanceMods_Classic=(eType=73,\t\t\t\tiDamage=0,\tiHP=0,\tiMobility=-2,\tiWill=40);',
  'NUM_STARTING_SOLDIERS=75   ; (LWR Default = 75) Male gender chance. Set to 100 to have all males.',
  '',
].join('\r\n')

const byId = (text: string) => new Map(findSettings(text).map((s) => [s.id, s]))
const def = (text: string, id: string): SettingDef => byId(text).get(id)!

describe('game settings in a player’s words (model/gamesettings.ts)', () => {
  it('finds each kind of setting, by key and comment, never by key alone', () => {
    const s = byId(FILE)
    expect(s.get('soldier.hp')?.value).toBe('4') // not the civilian's, not a nested HP
    expect(s.get('soldier.mobility')?.value).toBe('13')
    expect(s.get('campaign.starting-soldiers')?.value).toBe('40') // the uncommented one
    expect(s.get('lwr.num_starting_soldiers')?.name).toBe('Chance a recruit is male')
    expect(s.get('rookie.min-hp')?.value).toBe('3')
    expect(s.get('class.sniper.color')?.value).toBe('32')
    expect(s.get('class.sniper.headgear')?.type).toBe('headgear')
    expect(s.get('arcthrower.pistol')?.value).toBe('off')
    expect(s.get('item-mobility.73')).toMatchObject({ name: 'Arc Thrower', value: '-2' })
    expect(s.has('psi.gift')).toBe(false) // not in this file: not offered
  })

  it('writes a value and nothing else on its line', () => {
    const { text, missing } = applySettings(FILE, [
      { def: def(FILE, 'soldier.hp'), value: '5' },
      { def: def(FILE, 'rookie.min-hp'), value: '4' },
      { def: def(FILE, 'class.sniper.color'), value: '16' },
      { def: def(FILE, 'item-mobility.73'), value: '0' },
      { def: def(FILE, 'arcthrower.pistol'), value: 'on' },
    ])
    expect(missing).toEqual([])
    const want = FILE.replace('HP=4,  Offense', 'HP=5,  Offense')
      .replace('HIGH_WILL=3\t', 'HIGH_WILL=4\t')
      .replace('HQ_BASE_POWER = 32\t', 'HQ_BASE_POWER = 16\t')
      .replace('iMobility=-2,', 'iMobility=0,')
      .replace(
        'Weapons=( strName="", iType=eItem_ArcThrower,  Properties[4]=eWP_Backpack,    Properties[5]=0,',
        ';Weapons=( strName="", iType=eItem_ArcThrower,  Properties[4]=eWP_Backpack,    Properties[5]=0,',
      )
      .replace(
        ';Weapons=( strName="", iType=eItem_ArcThrower,  Properties[4]=eWP_Backpack,    Properties[5]=eWP_Pistol',
        'Weapons=( strName="", iType=eItem_ArcThrower,  Properties[4]=eWP_Backpack,    Properties[5]=eWP_Pistol',
      )
    expect(text).toBe(want)
    expect(byId(text).get('arcthrower.pistol')?.value).toBe('on')
    // And back.
    expect(applySettings(text, [{ def: def(FILE, 'arcthrower.pistol'), value: 'off' }]).text).toBe(
      want
        .replace(
          ';Weapons=( strName="", iType=eItem_ArcThrower,  Properties[4]=eWP_Backpack,    Properties[5]=0,',
          'Weapons=( strName="", iType=eItem_ArcThrower,  Properties[4]=eWP_Backpack,    Properties[5]=0,',
        )
        .replace(
          'Weapons=( strName="", iType=eItem_ArcThrower,  Properties[4]=eWP_Backpack,    Properties[5]=eWP_Pistol',
          ';Weapons=( strName="", iType=eItem_ArcThrower,  Properties[4]=eWP_Backpack,    Properties[5]=eWP_Pistol',
        ),
    )
  })

  it('reads the Armor Kit codes Long War ships', () => {
    const codes = armorKitCodes(
      'Colors (thanks)\n0    tan top with black bottom\n32    black with black\n\nHeadgear (thanks)\n200 - Motorcycle helmet, closed \t\t(Deco 18)\n460 - Fedora\t\t\t(Deco 41)\n\nArmor deco:\n1 x\n',
    )
    expect([...codes.colors]).toEqual([
      ['0', 'tan top with black bottom'],
      ['32', 'black with black'],
    ])
    expect([...codes.headgear]).toEqual([
      ['200', 'Motorcycle helmet, closed'],
      ['460', 'Fedora'],
    ])
  })
})

// Long War's and LWR's own files, and the person's hand-edited one (git-ignored samples/).
const S = resolve(import.meta.dirname, '../../../samples')
const LW = `${S}/Long War Mod Manager 1.0d-620-1-0d/LongWarFiles/_Long War EW 1.0 for PC-88-1-0.exe/{app}/XComGame/Config/DefaultGameCore.ini`
const LWR = `${S}/lwr/LW Rebalance v2.06.00/Config/DefaultGameCore.ini`
const MINE = `${S}/DefaultGameCore.ini`
const read = (p: string) => readFileSync(p, 'latin1')

describe.skipIf(![LW, LWR, MINE].every(existsSync))('on the real files', () => {
  it('Long War: the catalogue finds its lines, with Long War’s values', () => {
    const s = byId(read(LW))
    expect(
      Object.fromEntries(
        [
          'campaign.starting-soldiers',
          'soldier.hp',
          'soldier.mobility',
          'rookie.min-hp',
          'psi.gift',
          'arcthrower.pistol',
          'arcthrower.stun',
          'class.sniper.color',
          'item-mobility.73',
        ].map((id) => [id, s.get(id)?.value]),
      ),
    ).toEqual({
      'campaign.starting-soldiers': '40',
      'soldier.hp': '4',
      'soldier.mobility': '13',
      'rookie.min-hp': '3',
      'psi.gift': '0.45',
      'arcthrower.pistol': 'off',
      'arcthrower.stun': '0.61',
      'class.sniper.color': '32',
      'item-mobility.73': '-2',
    })
  })

  it('LWR: keys Long War uses for other things are not offered as Long War’s', () => {
    const s = byId(read(LWR))
    expect(s.has('campaign.starting-soldiers')).toBe(false)
    expect(s.has('psi.gift')).toBe(false)
    expect(s.get('lwr.num_starting_soldiers')).toMatchObject({
      name: 'Chance a recruit is male',
      value: '75',
    })
    expect(s.has('arcthrower.pistol')).toBe(false) // LWR has no alternative line
    expect(s.get('soldier.hp')?.value).toBe('6')
  })

  it('LWR: every option named and placed by hand, none left to its comment', () => {
    const s = findSettings(read(LWR))
    const lwr = s.filter((d) => d.id.startsWith('lwr.'))
    expect(lwr.length).toBe(22)
    expect(lwr.filter((d) => d.group === 'LWR options').map((d) => d.name)).toEqual([])
    expect(byId(read(LWR)).get('lwr.species_point_limit')).toMatchObject({
      name: 'Barracks order',
      group: 'Interface',
      format: { kind: 'choice' },
    })
  })

  it('item mobility by the file’s own headings, the small items together', () => {
    for (const file of [LW, LWR]) {
      const items = findSettings(read(file)).filter((d) => d.group === 'Item mobility')
      const of = (name: string) => items.find((d) => d.name === name)?.section
      expect(items.every((d) => d.section)).toBe(true)
      expect(of('HE Grenade')).toBe('Grenades')
      expect(of('Carapace Armor')).toBe('Armor')
      expect(of('Laser Rifle')).toBe('Laser weapons')
      expect(of('Plasma Rifle')).toBe('Plasma weapons')
      expect(of('Medikit')).toBe('Small items')
      expect(of('Alien Trophy')).toBe('Small items')
      expect(of(file === LW ? 'MEC-1 Paladin' : 'MEC1 Paladin')).toBe('MEC suits')
    }
  })

  it('the person’s hand edits, read back as settings: exactly their list', () => {
    expect(
      settingsChanged(read(LW), read(MINE)).map((c) => `${c.def.id}: ${c.own} → ${c.now}`),
    ).toEqual([
      'campaign.starting-soldiers: 40 → 60',
      'soldier.hp: 4 → 5',
      'soldier.mobility: 13 → 14',
      'rookie.min-hp: 3 → 4',
      'rookie.min-mobility: 11 → 13',
      'rookie.cost-defense-mobility: 104 → 103',
      'psi.gift: 0.45 → 0.65',
      'arcthrower.pistol: off → on',
      'arcthrower.stun: 0.61 → 0.85',
      'class.sniper.color: 32 → 16',
      'class.scout.color: 15 → 4',
      'class.rocketeer.color: 12 → 13',
      'class.assault.color: 21 → 18',
      'item-mobility.73: -2 → 0',
    ])
  })

  it('setting them on Long War’s own file gives the person’s file, but for spacing', () => {
    const own = read(LW)
    const s = byId(own)
    const { text, missing } = applySettings(
      own,
      settingsChanged(own, read(MINE)).map((c) => ({ def: s.get(c.def.id)!, value: c.now })),
    )
    expect(missing).toEqual([])
    const norm = (t: string) =>
      t
        .split(/\r?\n/)
        .map((l) => l.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
    expect(norm(text)).toEqual(norm(read(MINE)))
  })
})
