// Game settings in a player's words (features/game-settings.md): "soldier
// base HP", "arc thrower in the pistol slot", "mobility cost of the arc
// thrower", each found in DefaultGameCore.ini and changed there without
// touching anything else on its line.
//
// Long War and LWR reuse the game's keys for other things (in LWR,
// NUM_STARTING_SOLDIERS is the chance a soldier is male), so a setting is
// found by its key together with the comment the version's file gives it,
// never by the key alone. A setting the file does not have is not offered.

export type Place =
  /** A KEY=value line whose comment matches (an empty comment: /^$/). */
  | { kind: 'key'; key: string; comment: RegExp }
  /** A field of a struct line, the line picked by another field (iType=eChar_Soldier). */
  | { kind: 'field'; key: string; select: [string, string]; field: string }
  /**
   * Two versions of a line the file carries, one commented out: "on" is the
   * one matching `on` being in force.
   */
  | { kind: 'alt'; key: string; select: [string, string]; on: RegExp }

export interface SettingDef {
  /** Stable across versions and installs: kept in settings.json. */
  id: string
  group: string
  name: string
  /** Shown under the name; else the file's own comment. */
  help?: string
  type: 'number' | 'toggle' | 'color' | 'headgear'
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
): { line: Line; span?: [number, number]; value: string; other?: Line } | null {
  if (place.kind === 'key') {
    const line = ls.find((l) => !l.off && same(l.key, place.key) && place.comment.test(l.comment))
    if (!line) return null
    const v = line.raw.slice(line.start, line.end)
    const lead = /^\s*/.exec(v)![0].length
    const span: [number, number] = [line.start + lead, line.start + v.trimEnd().length]
    return { line, span, value: line.raw.slice(span[0], span[1]) }
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

const soldier = (field: string, name: string, help: string): SettingDef => ({
  id: `soldier.${field.toLowerCase()}`,
  group: 'Soldiers',
  name,
  help,
  type: 'number',
  place: { kind: 'field', key: 'Characters', select: ['iType', 'eChar_Soldier'], field },
})
const key = (
  id: string,
  group: string,
  name: string,
  k: string,
  comment: RegExp,
  extra: Partial<SettingDef> = {},
): SettingDef => ({
  id,
  group,
  name,
  type: 'number',
  place: { kind: 'key', key: k, comment },
  ...extra,
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
  ),
  key(
    'campaign.soldier-cost',
    'Campaign',
    'Cost of a new soldier',
    'SOLDIER_COST',
    /^All Difficulties$/,
  ),
  key('campaign.barracks', 'Campaign', 'Barracks capacity', 'BARRACKS_CAPACITY', /^$/),
  // Soldiers: the midpoints rookies are rolled around
  soldier(
    'HP',
    'Base HP',
    'The rookie midpoint; with balanced rookies, ranges run from the minimum below.',
  ),
  soldier('Mobility', 'Base mobility', 'The rookie midpoint.'),
  soldier('Offense', 'Base aim', 'The rookie midpoint.'),
  soldier('Will', 'Base will', 'The rookie midpoint.'),
  soldier('Defense', 'Base defense', ''),
  // Rookies
  key('rookie.min-hp', 'Rookies', 'Minimum starting HP', 'HIGH_WILL', /Minimum Starting hp/i, {
    help: 'Range: from this to (2 × base HP − this). The key is called HIGH_WILL; Long War uses it for HP.',
  }),
  key(
    'rookie.min-mobility',
    'Rookies',
    'Minimum starting mobility',
    'LOW_MOBILITY',
    /Minimum starting mobility/i,
  ),
  key('rookie.min-aim', 'Rookies', 'Minimum starting aim', 'LOW_AIM', /Minimum starting aim/i),
  key('rookie.min-will', 'Rookies', 'Minimum starting will', 'LOW_WILL', /Minimum Starting Will/i),
  key(
    'rookie.defense',
    'Rookies',
    'Starting defense (relative)',
    'HIGH_MOBILITY',
    /Relative starting defense/i,
  ),
  key('rookie.cost-aim', 'Rookies', 'Point cost of aim', 'ROOKIE_AIM', /Point cost for aim/i),
  key(
    'rookie.cost-defense-mobility',
    'Rookies',
    'Point costs: defense, mobility',
    'ROOKIE_MOBILITY',
    /xx = Point cost for defense/i,
    {
      help: 'Four digits, xxyy: xx is the cost of defense, yy of mobility (104: 1 and 4).',
    },
  ),
  key(
    'rookie.cost-hp-will',
    'Rookies',
    'Point costs: HP, will',
    'ROOKIE_STARTING_WILL',
    /xx = Point cost for hit points/i,
    {
      help: 'Four digits, xxyy: xx is the cost of HP, yy of will (301: 3 and 1).',
    },
  ),
  key(
    'rookie.armor-mobility',
    'Rookies',
    'Mobility for Tac Armor on recruits',
    'SOLDIER_COST_HARD',
    /auto-equip Tac Armor/i,
  ),
  key(
    'rookie.rifle-aim',
    'Rookies',
    'Aim for an Assault Rifle on recruits',
    'SOLDIER_COST_CLASSIC',
    /auto-equip Assault Rifle/i,
  ),
  key(
    'rookie.least-common-class',
    'Rookies',
    'Chance of the least common class',
    'LATE_UFO_CHANCE',
    /least common/i,
  ),
  // Psionics
  key(
    'psi.gift',
    'Psionics',
    'Chance of the psi gift',
    'PSI_GIFT_CHANCE',
    /Chance of successful training/i,
  ),
  key('psi.hours', 'Psionics', 'Psi training hours', 'PSI_TRAINING_HOURS', /^$/),
  key(
    'psi.slots',
    'Psionics',
    'Training slots (psi, gene, cybernetics)',
    'PSI_NUM_TRAINING_SLOTS',
    /Number of soldier slots/i,
  ),
  // Injuries and fatigue
  key(
    'injury.max-hours',
    'Injuries and fatigue',
    'Longest injury (hours)',
    'BASE_DAYS_INJURED',
    /max hours a soldier can be injured/i,
  ),
  key(
    'injury.fatigue-scale',
    'Injuries and fatigue',
    'Fatigue (% of normal)',
    'RAND_DAYS_INJURED_TANK',
    /scaler for fatigue/i,
  ),
  key(
    'injury.officer-fatigue',
    'Injuries and fatigue',
    'Fatigue hours per officer level',
    'SPECIES_POINT_LIMIT',
    /fatigue per officer level/i,
  ),
  // SHIVs
  key('shiv.repair-hours', 'SHIVs', 'Repair time (hours)', 'BASE_DAYS_INJURED_TANK', /^hours$/i),
  key('shiv.alloy-hp', 'SHIVs', 'Alloy SHIV HP bonus', 'ALLOY_SHIV_HP_BONUS', /hp bonuses/i),
  key('shiv.hover-hp', 'SHIVs', 'Hover SHIV HP bonus', 'HOVER_SHIV_HP_BONUS', /^$|hp bonuses/i),
  // The arc thrower
  {
    id: 'arcthrower.pistol',
    group: 'Arc thrower',
    name: 'In the pistol slot',
    help: 'The arc thrower takes the pistol slot instead of a small-item slot (Long War’s own alternative line; said to misbehave on a covert operative).',
    type: 'toggle',
    place: { kind: 'alt', key: 'Weapons', select: ['iType', 'eItem_ArcThrower'], on: /eWP_Pistol/ },
  },
  key(
    'arcthrower.stun',
    'Arc thrower',
    'Stun chance (× the game’s)',
    'UFO_PSI_LINK_SURVIVE',
    /(arc thrower|stun rifle) stun chances/i,
    {
      help: '1 is the game’s own stun chances; 0.5 half of them.',
    },
  ),
  // Appearance
  key(
    'look.rookie-color',
    'Appearance',
    'Rookie armor color',
    'DEFENDER_MEDIKIT',
    /Rookie armor color/i,
    { type: 'color' },
  ),
  key(
    'look.rookie-deco',
    'Appearance',
    'Rookie armor deco',
    'COUNCIL_STAT_BONUS',
    /Rookie armor deco/i,
  ),
  key(
    'look.rookie-headgear',
    'Appearance',
    'Rookie headgear',
    'ShowUFOsOnMission',
    /Rookie headgear/i,
    { type: 'headgear' },
  ),
]

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
      const what = optionName(lwr[2]!)
      out.push(
        key(`lwr.${l.key.toLowerCase()}`, 'LWR options', what || l.key, l.key, /^\(LWR Default/, {
          help: lwr[2],
        }),
      )
    }
  }
  // Item mobility: the BalanceMods_Classic line under a "; Name" comment.
  const raw = text.split(/\r?\n/)
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
    out.push({
      id: `item-mobility.${eType}`,
      group: 'Item mobility',
      name,
      help: 'Mobility while carried (negative slows the soldier).',
      type: 'number',
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
  let s = comment.split(' [')[0]!.split(/(?<=\w)\.\s|:\s/)[0]!.trim()
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
    rows[at.line.n] = at.line.raw.slice(0, s) + value + at.line.raw.slice(e)
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
