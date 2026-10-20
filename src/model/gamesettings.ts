// Game settings in a player's words (features/game-settings.md): "soldier
// base HP", "arc thrower in the pistol slot", "mobility cost of the arc
// thrower", each found in DefaultGameCore.ini and changed there without
// touching anything else on its line.
//
// Long War and LWR reuse the game's keys for other things (in LWR,
// NUM_STARTING_SOLDIERS is the chance a soldier is male), so a setting is
// found by its key together with the comment the version's file gives it,
// never by the key alone. A setting the file does not have is not offered.
//
// Each setting also says what kind of value it is (settingformat.ts), so it
// is edited and described in the player's terms (features/game-settings-ux.md).

import { type Format } from './settingformat'

export type Place =
  /**
   * A KEY=value line whose comment matches (an empty comment: /^$/).
   * "digits": one of two numbers Long War packs into one value as xxyy, the
   * first (xx) or the second (yy); written back without touching the other.
   */
  | { kind: 'key'; key: string; comment: RegExp; digits?: 'xx' | 'yy' }
  /** A field of a struct line, the line picked by another field (iType=eChar_Soldier). */
  | { kind: 'field'; key: string; select: [string, string]; field: string }
  /**
   * Two versions of a line the file carries, one commented out: "on" is the
   * one matching `on` being in force.
   */
  | { kind: 'alt'; key: string; select: [string, string]; on: RegExp }

export type Stat = 'HP' | 'Mobility' | 'Aim' | 'Will' | 'Defense'

export interface SettingDef {
  /** Stable across versions and installs: kept in settings.json. */
  id: string
  group: string
  name: string
  /** Shown beside it; else the file's own comment. "" for none: the group says it. */
  help?: string
  type: 'number' | 'toggle' | 'color' | 'headgear' | 'deco'
  /** How a number is edited and described (a plain number when not given). */
  format?: Format
  /** A part of its group (item mobility: the file's own heading, "Grenades"). */
  section?: string
  /** A soldier stat's part, for the stats table: its base, a rookie's lowest, the cost of a point. */
  stat?: { of: Stat; role: 'base' | 'lowest' | 'added' | 'cost' }
  place: Place
}

export interface FoundSetting extends SettingDef {
  /** The value in the file as given ("on"/"off" for a toggle). */
  value: string
  /** The file's own comment on it. */
  comment: string
}

// --- Lines ------------------------------------------------------------------------

interface Line {
  /** 0-based. */
  n: number
  raw: string
  /** Commented out with ";". */
  off: boolean
  key: string
  /** Where the value starts and ends in raw. */
  start: number
  end: number
  comment: string
}

/** Where a value ends: at a ";" outside quotes and parentheses. */
function valueEnd(s: string, from: number): number {
  let depth = 0
  let quoted = false
  for (let i = from; i < s.length; i++) {
    const ch = s[i]
    if (ch === '"') quoted = !quoted
    else if (!quoted && ch === '(') depth++
    else if (!quoted && ch === ')') depth = Math.max(0, depth - 1)
    else if (!quoted && depth === 0 && ch === ';') return i
  }
  return s.length
}

function lines(text: string): Line[] {
  const out: Line[] = []
  text.split(/\r?\n/).forEach((raw, n) => {
    const m = /^(\s*)(;?)\s*([A-Za-z_][\w]*(?:\[\d+\])?)\s*=/.exec(raw)
    if (!m) return
    const start = m[0].length
    const end = valueEnd(raw, start)
    out.push({
      n,
      raw,
      off: m[2] === ';',
      key: m[3]!,
      start,
      end,
      comment: raw
        .slice(end)
        .replace(/^;+\s?/, '')
        .trim(),
    })
  })
  return out
}

/** The top-level fields of a struct value "( a=1, b=( … ), c="x" )": name → [start, end] of its value. */
function fields(raw: string, from: number, to: number): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>()
  let depth = 0
  let quoted = false
  let i = from
  while (i < to && raw[i] !== '(') i++
  for (let p = i + 1; p < to; p++) {
    const ch = raw[p]!
    if (ch === '"') quoted = !quoted
    if (quoted) continue
    if (ch === '(') depth++
    else if (ch === ')') {
      if (depth === 0) break
      depth--
    } else if (depth === 0 && /[A-Za-z_]/.test(ch) && /[(,\s]/.test(raw[p - 1]!)) {
      const m = /^([A-Za-z_]\w*(?:\[\d+\])?)\s*=\s*/.exec(raw.slice(p, to))
      if (!m) continue
      const vs = p + m[0].length
      // The value runs to the next "," or ")" at this depth.
      let q = vs
      let d = 0
      let qq = false
      for (; q < to; q++) {
        const c = raw[q]!
        if (c === '"') qq = !qq
        if (qq) continue
        if (c === '(') d++
        else if (c === ')') {
          if (d === 0) break
          d--
        } else if (c === ',' && d === 0) break
      }
      let ve = q
      while (ve > vs && /\s/.test(raw[ve - 1]!)) ve--
      out.set(m[1]!.toLowerCase(), [vs, ve])
      p = q - 1
    }
  }
  return out
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

function selected(ls: Line[], key: string, select: [string, string]): Line[] {
  return ls.filter((l) => {
    if (!same(l.key, key)) return false
    const f = fields(l.raw, l.start, l.end).get(select[0].toLowerCase())
    return !!f && same(l.raw.slice(f[0], f[1]), select[1])
  })
}

/** Where a setting is in a file, and its value there; null if the file does not have it. */
function locate(
  ls: Line[],
  place: Place,
): { line: Line; span?: [number, number]; value: string; whole?: string; other?: Line } | null {
  if (place.kind === 'key') {
    const line = ls.find((l) => !l.off && same(l.key, place.key) && place.comment.test(l.comment))
    if (!line) return null
    const v = line.raw.slice(line.start, line.end)
    const lead = /^\s*/.exec(v)![0].length
    const span: [number, number] = [line.start + lead, line.start + v.trimEnd().length]
    const whole = line.raw.slice(span[0], span[1])
    if (!place.digits) return { line, span, value: whole }
    const n = Number(whole)
    if (!Number.isInteger(n) || n < 0) return null
    return {
      line,
      span,
      whole,
      value: String(place.digits === 'xx' ? Math.trunc(n / 100) : n % 100),
    }
  }
  if (place.kind === 'field') {
    const line = selected(ls, place.key, place.select).find((l) => !l.off)
    const span = line && fields(line.raw, line.start, line.end).get(place.field.toLowerCase())
    if (!line || !span) return null
    return { line, span, value: line.raw.slice(span[0], span[1]) }
  }
  const both = selected(ls, place.key, place.select)
  const on = both.filter((l) => place.on.test(l.raw.slice(l.start, l.end)))
  const off = both.filter((l) => !place.on.test(l.raw.slice(l.start, l.end)))
  if (on.length !== 1 || off.length !== 1 || on[0]!.off === off[0]!.off) return null
  return { line: on[0]!, other: off[0]!, value: on[0]!.off ? 'off' : 'on' }
}

// --- The catalogue ----------------------------------------------------------------

const soldier = (field: string, of: Stat): SettingDef => ({
  id: `soldier.${field.toLowerCase()}`,
  group: 'Soldier stats',
  name: `Base ${of === 'HP' ? 'HP' : of.toLowerCase()}`,
  help: '',
  type: 'number',
  stat: { of, role: 'base' },
  place: { kind: 'field', key: 'Characters', select: ['iType', 'eChar_Soldier'], field },
})
const key = (
  id: string,
  group: string,
  name: string,
  k: string,
  comment: RegExp,
  { digits, ...extra }: Partial<SettingDef> & { digits?: 'xx' | 'yy' } = {},
): SettingDef => ({
  id,
  group,
  name,
  type: 'number',
  place: { kind: 'key', key: k, comment, ...(digits ? { digits } : {}) },
  ...extra,
})

const hours: Format = { kind: 'hours', min: 0 }
/** One of two point costs Long War keeps in one value (xxyy). */
const cost = (digits: 'xx' | 'yy'): Partial<SettingDef> & { digits: 'xx' | 'yy' } => ({
  digits,
  format: { kind: 'number', min: 0, max: 99 },
  help: '',
})

/** Settings named by hand, each tied to its key and the comment that says what it is. */
export const CATALOGUE: SettingDef[] = [
  // The campaign
  key(
    'campaign.starting-soldiers',
    'Campaign',
    'Soldiers at the start',
    'NUM_STARTING_SOLDIERS',
    /^$/,
    { format: { kind: 'number', min: 1 } },
  ),
  key(
    'campaign.soldier-cost',
    'Campaign',
    'Cost of a new soldier',
    'SOLDIER_COST',
    /^All Difficulties$/,
    { format: { kind: 'number', unit: 'credits', min: 0 } },
  ),
  key('campaign.barracks', 'Campaign', 'Barracks capacity', 'BARRACKS_CAPACITY', /^$/, {
    format: { kind: 'number', min: 1 },
  }),
  // Soldier stats: the base every soldier starts from, how rookies are rolled
  // around it (from the lowest to as far above), what a point costs.
  soldier('HP', 'HP'),
  soldier('Mobility', 'Mobility'),
  soldier('Offense', 'Aim'),
  soldier('Will', 'Will'),
  soldier('Defense', 'Defense'),
  key('rookie.min-hp', 'Soldier stats', 'Lowest starting HP', 'HIGH_WILL', /Minimum Starting hp/i, {
    stat: { of: 'HP', role: 'lowest' },
  }),
  key(
    'rookie.min-mobility',
    'Soldier stats',
    'Lowest starting mobility',
    'LOW_MOBILITY',
    /Minimum starting mobility/i,
    { stat: { of: 'Mobility', role: 'lowest' } },
  ),
  key(
    'rookie.min-aim',
    'Soldier stats',
    'Lowest starting aim',
    'LOW_AIM',
    /Minimum starting aim/i,
    { stat: { of: 'Aim', role: 'lowest' } },
  ),
  key(
    'rookie.min-will',
    'Soldier stats',
    'Lowest starting will',
    'LOW_WILL',
    /Minimum Starting Will/i,
    { stat: { of: 'Will', role: 'lowest' } },
  ),
  key(
    'rookie.defense',
    'Soldier stats',
    'Defense added for rookies',
    'HIGH_MOBILITY',
    /Relative starting defense/i,
    { stat: { of: 'Defense', role: 'added' } },
  ),
  key(
    'rookie.cost-aim',
    'Soldier stats',
    'Point cost of aim',
    'ROOKIE_AIM',
    /Point cost for aim/i,
    { stat: { of: 'Aim', role: 'cost' } },
  ),
  key(
    'rookie.cost-hp',
    'Soldier stats',
    'Point cost of HP',
    'ROOKIE_STARTING_WILL',
    /xx = Point cost for hit points/i,
    { ...cost('xx'), stat: { of: 'HP', role: 'cost' } },
  ),
  key(
    'rookie.cost-will',
    'Soldier stats',
    'Point cost of will',
    'ROOKIE_STARTING_WILL',
    /xx = Point cost for hit points/i,
    { ...cost('yy'), stat: { of: 'Will', role: 'cost' } },
  ),
  key(
    'rookie.cost-defense',
    'Soldier stats',
    'Point cost of defense',
    'ROOKIE_MOBILITY',
    /xx = Point cost for defense/i,
    { ...cost('xx'), stat: { of: 'Defense', role: 'cost' } },
  ),
  key(
    'rookie.cost-mobility',
    'Soldier stats',
    'Point cost of mobility',
    'ROOKIE_MOBILITY',
    /xx = Point cost for defense/i,
    { ...cost('yy'), stat: { of: 'Mobility', role: 'cost' } },
  ),
  // Recruits
  key(
    'rookie.armor-mobility',
    'Recruits',
    'Tac Armor from mobility',
    'SOLDIER_COST_HARD',
    /auto-equip Tac Armor/i,
    { help: 'A recruit with at least this mobility comes in Tac Armor rather than a Tac Vest.' },
  ),
  key(
    'rookie.rifle-aim',
    'Recruits',
    'Assault Rifle from aim',
    'SOLDIER_COST_CLASSIC',
    /auto-equip Assault Rifle/i,
    { help: 'A recruit with at least this aim comes with an Assault Rifle rather than a Carbine.' },
  ),
  key(
    'rookie.least-common-class',
    'Recruits',
    'Leaning to the least common class',
    'LATE_UFO_CHANCE',
    /least common/i,
    {
      format: { kind: 'number', min: 0, max: 100 },
      help: '0: classes at random; 100: always the class the barracks has least of. 33 gives it about half the time, 10 about a third.',
    },
  ),
  // Psionics
  key(
    'psi.gift',
    'Psionics',
    'Chance of the psi gift',
    'PSI_GIFT_CHANCE',
    /Chance of successful training/i,
    {
      format: { kind: 'percent', fraction: true },
      help: 'For a soldier whose will equals the target; Long War suggests 25 % for More Than Human.',
    },
  ),
  key('psi.hours', 'Psionics', 'Psi training', 'PSI_TRAINING_HOURS', /^$/, { format: hours }),
  key(
    'psi.slots',
    'Psionics',
    'Training slots',
    'PSI_NUM_TRAINING_SLOTS',
    /Number of soldier slots/i,
    {
      format: { kind: 'number', min: 1 },
      help: 'Soldiers training at once in the Psionic Labs, the Genetics Lab and the Cybernetics Lab.',
    },
  ),
  // Injuries and fatigue
  key(
    'injury.max-hours',
    'Injuries and fatigue',
    'Longest injury',
    'BASE_DAYS_INJURED',
    /max hours a soldier can be injured/i,
    { format: hours },
  ),
  key(
    'injury.fatigue-scale',
    'Injuries and fatigue',
    'Fatigue',
    'RAND_DAYS_INJURED_TANK',
    /scaler for fatigue/i,
    {
      format: { kind: 'percent', max: 1000 },
      help: '100 % is Long War’s own; 0 % leaves only the fixed additions.',
    },
  ),
  key(
    'injury.officer-fatigue',
    'Injuries and fatigue',
    'Fatigue per officer rank',
    'SPECIES_POINT_LIMIT',
    /fatigue per officer level/i,
    { format: hours },
  ),
  // SHIVs
  key('shiv.repair-hours', 'SHIVs', 'Repair time', 'BASE_DAYS_INJURED_TANK', /^hours$/i, {
    format: hours,
  }),
  key('shiv.alloy-hp', 'SHIVs', 'Alloy SHIV HP bonus', 'ALLOY_SHIV_HP_BONUS', /hp bonuses/i),
  key('shiv.hover-hp', 'SHIVs', 'Hover SHIV HP bonus', 'HOVER_SHIV_HP_BONUS', /^$|hp bonuses/i),
  // The arc thrower
  {
    id: 'arcthrower.pistol',
    group: 'Arc thrower',
    name: 'In the pistol slot',
    help: 'Instead of a small-item slot. Long War says it can misbehave on a covert operative.',
    type: 'toggle',
    place: { kind: 'alt', key: 'Weapons', select: ['iType', 'eItem_ArcThrower'], on: /eWP_Pistol/ },
  },
  key(
    'arcthrower.stun',
    'Arc thrower',
    'Stun chance',
    'UFO_PSI_LINK_SURVIVE',
    /(arc thrower|stun rifle) stun chances/i,
    { format: { kind: 'times', min: 0 }, help: 'Times the game’s own stun chances.' },
  ),
  // The rookie's look, with the classes'
  key(
    'look.rookie-color',
    'Class colors',
    'Rookie armor color',
    'DEFENDER_MEDIKIT',
    /Rookie armor color/i,
    { type: 'color' },
  ),
  key(
    'look.rookie-deco',
    'Class colors',
    'Rookie armor deco',
    'COUNCIL_STAT_BONUS',
    /Rookie armor deco/i,
    { type: 'deco' },
  ),
  key(
    'look.rookie-headgear',
    'Class colors',
    'Rookie headgear',
    'ShowUFOsOnMission',
    /Rookie headgear/i,
    { type: 'headgear' },
  ),
]

/** What each group's numbers mean, said once at its top; and the order groups come in. */
export const GROUPS: { name: string; help: string }[] = [
  { name: 'Campaign', help: '' },
  {
    name: 'Soldier stats',
    help: 'Every soldier’s base stats, and how a rookie’s are rolled: from the lowest to as far above the base. A point cost is the build points a rookie spends on one point of the stat.',
  },
  { name: 'Recruits', help: '' },
  { name: 'Soldiers', help: '' },
  { name: 'Psionics', help: '' },
  { name: 'Injuries and fatigue', help: '' },
  { name: 'SHIVs', help: '' },
  { name: 'Arc thrower', help: '' },
  { name: 'Combat', help: '' },
  { name: 'Second wave', help: 'Numbers for second wave options, when they are on.' },
  { name: 'Interface', help: '' },
  {
    name: 'Class colors',
    help: 'Each class’s armor color and headgear, numbered as in Long War’s Armor Kit list, and the rookie’s look. Pick a row to see it on the soldier.',
  },
  {
    name: 'Item mobility',
    help: 'What carrying each item does to a soldier’s mobility: below 0 slows them down.',
  },
  { name: 'LWR options', help: 'Options LWR’s file lists that the app has no place for yet.' },
]

/**
 * LWR's options, each on a key that means something else in Long War, told
 * apart by its "(LWR Default = …)" comment; named and placed by hand. `about`
 * must match the comment too, so a key that changes meaning falls back to
 * the comment's own words.
 */
const LWR: Record<string, Partial<SettingDef> & { about: RegExp; name: string; group: string }> = {
  NUM_STARTING_SOLDIERS: {
    about: /gender chance/i,
    name: 'Chance a recruit is male',
    group: 'Recruits',
    format: { kind: 'percent' },
    help: '',
  },
  EXALT_LOOT3: {
    about: /post-mission stats/i,
    name: 'Stat gains after missions',
    group: 'Soldiers',
    format: { kind: 'number', min: 1, max: 255 },
    help: 'Lower makes them less likely.',
  },
  LAB_MINIMUM: {
    about: /quirk/i,
    name: 'Chance of quirks after missions',
    group: 'Soldiers',
    format: { kind: 'percent', max: 50 },
    help: 'Divided by a modifier for the campaign’s length.',
  },
  BARRACKS_CAPACITY: {
    about: /extra fatigue/i,
    name: 'Extra fatigue per mission done',
    group: 'Injuries and fatigue',
    format: { kind: 'percent', max: 1000 },
    help: 'For each mission the soldier has completed.',
  },
  HIGH_AIM: {
    about: /guard rails/i,
    name: 'Panic guard rails',
    group: 'Campaign',
    format: { kind: 'switch', on: 1, off: 0 },
    help: 'At the end of each month panic rises with the months passed and falls with the countries lost.',
  },
  WORKSHOP_MINIMUM: {
    about: /alien levels/i,
    name: 'Alien levels to double alien growth',
    group: 'Campaign',
    format: { kind: 'number', min: 1 },
    help: 'Brutal and Impossible only; Brutal takes half as many again.',
  },
  BASE_DAYS_INJURED: {
    about: /Psychic Tether/i,
    name: 'Psychic Tether strength',
    group: 'Combat',
    format: { kind: 'percent' },
    help: '100 % stops all movement away; 0 % all but turns it off.',
  },
  RAND_DAYS_INJURED_TANK: {
    about: /panic when they take damage/i,
    name: 'Panic from damage over',
    group: 'Combat',
    format: { kind: 'percent' },
    help: 'A soldier rolls for panic on losing more than this share of the HP left; 100 % never.',
  },
  DASHING_REACTION_MODIFIER: {
    about: /environmental damage/i,
    name: 'Environmental damage',
    group: 'Combat',
    format: { kind: 'times', min: 0, max: 10 },
    help: '× 0: none ever; × 1: LWR’s own; × 10: all cover is paper.',
  },
  REFLECT_DMG: {
    about: /Blitzkrieg/i,
    name: 'Blitzkrieg: seconds per unit',
    group: 'Second wave',
    format: { kind: 'number', unit: 'seconds', min: 1, max: 60 },
    help: 'A turn lasts this times the units in play; the reserve timer starts at this many minutes.',
  },
  MIND_CONTROL_DIFFICULTY: {
    about: /Wild West/i,
    name: 'Wild West: damage',
    group: 'Second wave',
    format: { kind: 'times', min: 1, max: 100 },
    help: 'Every shot does this many times its damage.',
  },
  SW_MORE_POWER: {
    about: /Wolverine Blood/i,
    name: 'Wolverine Blood: fatigue and injury time',
    group: 'Second wave',
    format: { kind: 'times', min: 0, max: 1 },
    help: '× 0: none at all; × 1: Wolverine Blood changes nothing.',
  },
  REACTION_PENALTY: {
    about: /game speed/i,
    name: 'Game speed',
    group: 'Interface',
    format: { kind: 'number', min: 1, max: 10 },
    help: 'In the game, Alt-F7 slows it by 1, Alt-F8 speeds it up, Alt-F9 resets it.',
  },
  PSI_GIFT_CHANCE: {
    about: /reveal cinematic/i,
    name: 'Pod reveal cinematics',
    group: 'Interface',
    format: { kind: 'percent' },
    help: 'Chance one plays when a pod is revealed.',
  },
  PSI_TRAINING_HOURS: {
    about: /shot cinematic/i,
    name: 'Shot cinematics',
    group: 'Interface',
    format: { kind: 'percent' },
    help: 'Chance one plays when a shot triggers it; few shots do, so even 100 % shows few.',
  },
  SPECIES_POINT_LIMIT: {
    about: /barracks sorted/i,
    name: 'Barracks order',
    group: 'Interface',
    format: {
      kind: 'choice',
      options: [
        [1, 'by class'],
        [0, 'by rank, as in Long War'],
      ],
    },
    help: 'A change shows after the next mission.',
  },
  HQ_STARTING_MONEY: {
    about: /Mouse Buttons/i,
    name: 'Mouse buttons in combat',
    group: 'Interface',
    format: {
      kind: 'choice',
      options: [
        [1, 'shown'],
        [2, 'hidden'],
      ],
    },
    help: '',
  },
  SW_COVER_INCREASE: {
    about: /unit stats/i,
    name: 'Unit stats shown and recorded',
    group: 'Interface',
    format: { kind: 'switch', on: 1, off: 0 },
    help: 'Bottom left in combat, after a mission and in the barracks.',
  },
  CB_AIRANDSPACE_BONUS: {
    about: /War Record/i,
    name: 'War Record popups',
    group: 'Interface',
    format: { kind: 'switch', on: 0, off: 1 },
    help: '',
  },
  SW_RARE_PSI: {
    about: /popup message/i,
    name: 'Popup messages last',
    group: 'Interface',
    format: { kind: 'number', unit: 'seconds', min: 0 },
    help: 'Over a unit, in combat.',
  },
  RAND_DAYS_INJURED: {
    about: /bradford/i,
    name: 'Bradford’s objective briefings',
    group: 'Interface',
    format: { kind: 'number', unit: 'missions', min: 0 },
    help: 'He stops after this many covert extractions or data recoveries.',
  },
  SOLDIER_COST_CLASSIC: {
    about: /tint of armors/i,
    name: 'Armor colors on promotion to Lance Corporal',
    group: 'Class colors',
    format: {
      kind: 'choice',
      options: [
        [1, 'LWR’s own'],
        [0, 'the class colors here only'],
      ],
    },
    help: '',
  },
}

/** The file's heading over each line of its item list ("; Grenades", ";Ballistic Weapons"). */
function itemHeadings(raw: string[]): (string | undefined)[] {
  const out: (string | undefined)[] = []
  let at: string | undefined
  let inList = false
  const item = /^\s*(ItemBalance_Normal|BalanceMods_Classic)\s*=/i
  raw.forEach((l, i) => {
    if (/extra weapon and armor stat configuration/i.test(l)) inList = true
    const c = /^\s*;\s*([A-Za-z][\w '&/-]{1,40}?)\s*$/.exec(l)
    // A heading: a short comment not over an item (an item's name is), not a field's notes.
    if (inList && c && !item.test(raw[i + 1] ?? '') && !/^i[A-Z]/.test(c[1]!)) at = c[1]
    out.push(inList ? at : undefined)
  })
  return out
}

/** Item names as a file spells them wrongly. */
const SPELLING: Record<string, string> = { 'Leater Jacket': 'Leather Jacket' }

const SECTIONS: Record<string, string> = {
  'beam lasers': 'Laser weapons',
  'gauss weaponry': 'Gauss weapons',
  'pulse laser weaponry': 'Pulse weapons',
  'plasma weaponry': 'Plasma weapons',
  arc: 'Arc weapons',
  'shiv small items': 'SHIV items',
  'anti-armor module': 'SHIV items',
  'mec armors': 'MEC suits',
  'mec large items': 'MEC weapons',
  'mec small items': 'MEC items',
  'joint mec/shiv small items': 'MEC and SHIV items',
}
/** The file's heading as a section: its own words, but small items are small items whoever carries them. */
const sectionName = (h: string) =>
  SECTIONS[h.toLowerCase()] ??
  (/small items/i.test(h) ? 'Small items' : h.charAt(0).toUpperCase() + h.slice(1).toLowerCase())

/**
 * Settings the file lists itself:
 * - every class's color and headgear (HQ_BASE_POWER, by comment);
 * - every item's mobility cost (BalanceMods_Classic by item, named by the
 *   comment above it);
 * - LWR's own options, each line saying "(LWR Default = …) what it does".
 */
export function listedSettings(text: string): SettingDef[] {
  const ls = lines(text)
  const out: SettingDef[] = []
  for (const l of ls) {
    if (l.off) continue
    const deco = /^(\w+) (Color|Headgear)$/i.exec(l.comment)
    if (same(l.key, 'HQ_BASE_POWER') && deco)
      out.push(
        key(
          `class.${deco[1]!.toLowerCase()}.${deco[2]!.toLowerCase()}`,
          'Class colors',
          `${deco[1]} ${deco[2]!.toLowerCase()}`,
          l.key,
          new RegExp(`^${deco[1]} ${deco[2]}$`, 'i'),
          {
            type: deco[2]!.toLowerCase() === 'color' ? 'color' : 'headgear',
          },
        ),
      )
    const lwr = /^\(LWR Default = ([^)]*)\)\s*(.*)$/.exec(l.comment)
    if (lwr) {
      const known = LWR[l.key.toUpperCase()]
      const id = `lwr.${l.key.toLowerCase()}`
      if (known && known.about.test(lwr[2]!)) {
        const { about: _about, name, group, ...extra } = known
        out.push(key(id, group, name, l.key, /^\(LWR Default/, extra))
      } else {
        const what = optionName(lwr[2]!)
        out.push(key(id, 'LWR options', what || l.key, l.key, /^\(LWR Default/, { help: lwr[2] }))
      }
    }
  }
  // Item mobility: the BalanceMods_Classic line under a "; Name" comment.
  const raw = text.split(/\r?\n/)
  const headings = itemHeadings(raw)
  for (const l of ls) {
    if (l.off || !same(l.key, 'BalanceMods_Classic')) continue
    const f = fields(l.raw, l.start, l.end)
    const type = f.get('etype')
    if (!type || !f.has('imobility')) continue
    const eType = l.raw.slice(type[0], type[1])
    if (!/^\d+$/.test(eType)) continue
    let name = ''
    for (let i = l.n - 1; i >= Math.max(0, l.n - 3); i--) {
      const c = /^\s*;\s*(.+?)\s*$/.exec(raw[i]!)
      if (c) {
        name = c[1]!
        break
      }
    }
    if (!name) continue
    name = SPELLING[name] ?? name
    out.push({
      id: `item-mobility.${eType}`,
      group: 'Item mobility',
      name,
      help: '',
      type: 'number',
      section: headings[l.n] ? sectionName(headings[l.n]!) : undefined,
      place: {
        kind: 'field',
        key: 'BalanceMods_Classic',
        select: ['eType', eType],
        field: 'iMobility',
      },
    })
  }
  return out
}

/** A short name out of an LWR option's comment: its first clause, plainly. */
export function optionName(comment: string): string {
  let s = comment
    .split(' [')[0]!
    .split(/(?<=\w)\.\s|:\s/)[0]!
    .trim()
  if (/^Float for /i.test(s)) s = s.replace(/^Float for (the )?/i, '').split(' (')[0]!
  s = s.replace(/\s*\((?:min|max|minimum|maximum)[^)]*\)/gi, '').replace(/\.$/, '')
  s = s.charAt(0).toUpperCase() + s.slice(1)
  if (s.length > 72) s = `${s.slice(0, 72).replace(/\s+\S*$/, '')}…`
  return s
}

/** Every setting this file has, catalogue first, with its value in the file. */
export function findSettings(text: string): FoundSetting[] {
  const ls = lines(text)
  const seen = new Set<string>()
  const out: FoundSetting[] = []
  for (const def of [...CATALOGUE, ...listedSettings(text)]) {
    if (seen.has(def.id)) continue
    const at = locate(ls, def.place)
    if (!at) continue
    seen.add(def.id)
    out.push({ ...def, value: at.value, comment: at.line.comment })
  }
  return out
}

/** Writes values; settings the file does not have are reported, not added. */
export function applySettings(
  text: string,
  values: { def: SettingDef; value: string }[],
): { text: string; missing: SettingDef[] } {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const rows = text.split(/\r?\n/)
  const missing: SettingDef[] = []
  for (const { def, value } of values) {
    const at = locate(lines(rows.join(eol)), def.place)
    if (!at) {
      missing.push(def)
      continue
    }
    if (def.place.kind === 'alt') {
      if (at.value === value) continue
      const [on, off] = value === 'on' ? [at.line, at.other!] : [at.other!, at.line]
      rows[on.n] = on.raw.replace(/^(\s*);\s?/, '$1')
      rows[off.n] = off.raw.replace(/^(\s*)/, '$1;')
      continue
    }
    const [s, e] = at.span!
    let text = value
    if (def.place.kind === 'key' && def.place.digits) {
      // One half of xxyy: the other half as the line has it now.
      const n = Number(at.whole)
      const part = Number(value)
      if (!Number.isInteger(part) || part < 0 || part > 99) {
        missing.push(def)
        continue
      }
      text = String(
        def.place.digits === 'xx' ? part * 100 + (n % 100) : Math.trunc(n / 100) * 100 + part,
      )
    }
    rows[at.line.n] = at.line.raw.slice(0, s) + text + at.line.raw.slice(e)
  }
  return { text: rows.join(eol), missing }
}

/** Where a file differs from the version's own, setting by setting. */
export function settingsChanged(
  own: string,
  now: string,
): { def: FoundSetting; own: string; now: string }[] {
  const mine = new Map(findSettings(now).map((s) => [s.id, s]))
  return findSettings(own)
    .filter((s) => mine.has(s.id) && mine.get(s.id)!.value !== s.value)
    .map((s) => ({ def: s, own: s.value, now: mine.get(s.id)!.value }))
}

/** The Armor Kit codes Long War ships: color and headgear numbers with what they look like. */
export function armorKitCodes(text: string): {
  colors: Map<string, string>
  headgear: Map<string, string>
} {
  const colors = new Map<string, string>()
  const headgear = new Map<string, string>()
  let part: 'colors' | 'headgear' | null = null
  for (const raw of text.split(/\r?\n/)) {
    const s = raw.trim()
    if (/^Colors\b/i.test(s)) part = 'colors'
    else if (/^Headgear\b/i.test(s)) part = 'headgear'
    else if (/^Armor deco/i.test(s)) part = null
    else if (part === 'colors') {
      const m = /^(\d+)\s+(.+)$/.exec(s)
      if (m) colors.set(m[1]!, m[2]!)
    } else if (part === 'headgear') {
      const m = /^(\d+)\s*-\s*(.+?)(?:\s*\(Deco \d+\))?$/.exec(s)
      if (m) headgear.set(m[1]!, m[2]!.trim())
    }
  }
  return { colors, headgear }
}

/**
 * Values saved before a setting was split: Long War's two point costs in one
 * value (xxyy) were one setting until 2026-10-20, and are one setting each now.
 */
const SPLIT: Record<string, [string, string]> = {
  'rookie.cost-defense-mobility': ['rookie.cost-defense', 'rookie.cost-mobility'],
  'rookie.cost-hp-will': ['rookie.cost-hp', 'rookie.cost-will'],
}
/** The settings that came out of a split one. */
export const SPLIT_PARTS = new Set(Object.values(SPLIT).flat())

export function splitOldValues(values: Record<string, string>): Record<string, string> {
  const out = { ...values }
  for (const [old, [xx, yy]] of Object.entries(SPLIT)) {
    if (!(old in out)) continue
    const n = Number(out[old])
    delete out[old]
    if (!Number.isInteger(n) || n < 0) continue
    out[xx] ??= String(Math.trunc(n / 100))
    out[yy] ??= String(n % 100)
  }
  return out
}
