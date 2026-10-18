// What the tech tree needs from a parsed save, pulled out of the checkpoints
// by class name so the rest of the app never touches the raw property tree.

import type { Checkpoint, CheckpointChunk, Property, SaveFile } from './types'

export interface ResearchProject {
  /** Tech id (ETechType value). */
  tech: number
  /**
   * Research points still needed, after research credits. The game calls it
   * iActualHoursLeft, but it is points (verified against strETA).
   */
  pointsLeft: number
  /** The game's own ETA text for the project, e.g. "13 days". */
  eta: string
}

export interface FoundryInProgress {
  id: number
  engineers: number
  maxEngineers: number
  /**
   * The game's iHoursLeft. Not hours: in campaign 55 it fell by about 1.8 per
   * assigned engineer per hour, so it is closer to engineer-hours scaled by
   * something (workshops?) not yet known.
   */
  workLeft: number
}

export interface Campaign {
  description: string
  gameNumber: number
  saveNumber: number
  /** Saved during a mission; the research state is the one the mission started from. */
  tactical: boolean
  ironman: boolean
  date?: { year: number; month: number; day: number }
  /** Days since the campaign began (1 March 2016), with the time of day. */
  campaignDay?: number
  /** Per tech id: the campaign day it was finished, or undefined. */
  researchedOn: (number | undefined)[]
  difficulty?: number
  /** Index = tech id. Index 0 (eTech_None) is always set by the game. */
  researched: boolean[]
  /**
   * Research points put into each tech; a tech costs base days × 720 less any
   * research credit. For a finished tech this is what it actually cost.
   */
  progress: number[]
  /** Hours spent on each tech. */
  hoursSpent: number[]
  project?: ResearchProject
  scientists?: number
  engineers?: number
  labBonus?: number
  adjacentLabBonus?: number
  credits: number[]
  /** Index = Foundry project id; non-zero once done (index 0 is always set). */
  foundryHistory: number[]
  /** Foundry projects being built. */
  foundryInProgress: FoundryInProgress[]
  secondWave: number[]
  /** The country the campaign started in (config country id). */
  startCountry?: number
  /** Which starting bonus it got: an index into the INI's starting bonus lines. */
  startingBonusIndex?: number
  /** Country ids with a satellite over them. */
  satelliteCountries: number[]
  /** Council countries that have left XCOM (XGCountry.m_bSecretPact). */
  lostCountries: number[]
  /** Items in stores, by Enemy Within item index (XGStorage.m_arrItems; see model/inventory.ts). */
  stock: number[]
  /** The end-of-campaign statistics, by name without the eRecap_ prefix. */
  recap: Record<string, number>
}

export class NotACampaignError extends Error {}

// Long War renames the four levels (the INI's per-difficulty lines say so, and a
// save's journal records "Difficulty: Classic" where m_iDifficulty is 1).
const DIFFICULTY_NAMES = ['Normal', 'Classic', 'Brutal', 'Impossible']

export function difficultyName(d: number | undefined): string | undefined {
  return d === undefined ? undefined : (DIFFICULTY_NAMES[d] ?? `Difficulty ${d}`)
}

function prop(cp: Checkpoint | undefined, name: string): Property | undefined {
  return cp?.properties.find((p) => p.name === name)
}

function int(p: Property | undefined): number | undefined {
  return p?.kind === 'IntProperty' ? p.value : undefined
}

function float(p: Property | undefined): number | undefined {
  return p?.kind === 'FloatProperty' ? p.value : undefined
}

function numbers(p: Property | undefined): number[] {
  if (p?.kind === 'ArrayProperty' && 'elements' in p) return p.elements
  if (p?.kind === 'StaticArrayProperty' && 'int_values' in p) return p.int_values
  return []
}

/** XGRecapSaveData.m_aRecapStats: pairs of (ERecapStats name, value). */
function recapStats(save: SaveFile): Record<string, number> {
  const recap = save.checkpoints
    .flatMap((c) => c.checkpoint_table)
    .find((cp) => cp.class_name.endsWith('.XGRecapSaveData'))
  const stats = prop(recap, 'm_aRecapStats')
  const out: Record<string, number> = {}
  if (stats?.kind !== 'ArrayProperty' || !('structs' in stats)) return out
  for (const [stat, value] of stats.structs) {
    if (stat?.kind !== 'ByteProperty') continue
    out[stat.value.replace(/^eRecap_/, '')] = value?.kind === 'IntProperty' ? value.value : 0
  }
  return out
}

function foundryProjects(p: Property | undefined): FoundryInProgress[] {
  if (p?.kind !== 'ArrayProperty' || !('structs' in p)) return []
  return p.structs.flatMap((fields) => {
    const get = (n: string) => {
      const f = fields.find((x) => x.name === n)
      return f?.kind === 'IntProperty' ? f.value : undefined
    }
    const id = get('eTech')
    if (id === undefined) return []
    return [
      {
        id,
        engineers: get('iEngineers') ?? 0,
        maxEngineers: get('iMaxEngineers') ?? 0,
        workLeft: get('iHoursLeft') ?? 0,
      },
    ]
  })
}

function structField(p: Property | undefined, name: string): Property | undefined {
  return p?.kind === 'StructProperty' ? p.properties.find((f) => f.name === name) : undefined
}

/** The strategy chunk: the one holding the headquarters game's checkpoints. */
function strategyChunk(save: SaveFile): CheckpointChunk | undefined {
  return save.checkpoints.find((c) =>
    c.checkpoint_table.some((cp) => cp.class_name.endsWith('.XGFacility_Labs')),
  )
}

export function readCampaign(save: SaveFile): Campaign {
  const chunk = strategyChunk(save)
  if (!chunk) throw new NotACampaignError('No research data found in this save.')
  const table = chunk.checkpoint_table
  const byClass = (cls: string) => table.find((cp) => cp.class_name.endsWith(`.${cls}`))
  // Object references index the chunk's actor table ("Command1.XGDateTime_0");
  // checkpoints are named by full path ending in the same instance name.
  const deref = (p: Property | undefined): Checkpoint | undefined => {
    if (p?.kind !== 'ObjectProperty' || p.actor < 0) return undefined
    const actor = chunk.actor_table[p.actor]
    const instance = actor?.slice(actor.indexOf('.') + 1)
    return instance ? table.find((cp) => cp.instance_name === instance) : undefined
  }

  const labs = byClass('XGFacility_Labs')
  // Long War packs the starting bonus into XGHeadQuarters.m_iCountry above the
  // country: 0x260000 is the United States (0) with starting bonus 38 (We Have
  // Ways). Verified against both sample campaigns.
  const hqCountry = int(prop(byClass('XGHeadQuarters'), 'm_iCountry'))
  const countryId = (cp: Checkpoint) => int(structField(prop(cp, 'm_kTCountry'), 'iEnum'))
  const lostCountries = table
    .filter((cp) => cp.class_name.endsWith('.XGCountry'))
    .filter((cp) => {
      const pact = prop(cp, 'm_bSecretPact')
      return pact?.kind === 'BoolProperty' && pact.value
    })
    .map(countryId)
    .filter((id): id is number => id !== undefined)
  const satelliteCountries = table
    .filter((cp) => cp.class_name.endsWith('.XGCountry'))
    .filter((cp) => {
      const sat = prop(cp, 'm_bSatellite')
      return sat?.kind === 'BoolProperty' && sat.value
    })
    .map((cp) => int(structField(prop(cp, 'm_kTCountry'), 'iEnum')))
    .filter((id): id is number => id !== undefined)
  const engineering = byClass('XGFacility_Engineering')
  const strategy = byClass('XGStrategy')
  const dateTime = deref(prop(byClass('XGGeoscape'), 'm_kDateTime'))

  // XGDateTime actors: year, month, day and seconds into the day.
  const START = Date.UTC(2016, 2, 1)
  const dayOf = (dt: Checkpoint | undefined): number | undefined => {
    const y = int(prop(dt, 'm_iYear'))
    const m = int(prop(dt, 'm_iMonth'))
    const d = int(prop(dt, 'm_iDay'))
    if (y === undefined || m === undefined || d === undefined) return undefined
    return (Date.UTC(y, m - 1, d) - START) / 86_400_000 + (float(prop(dt, 'm_fTime')) ?? 0) / 86_400
  }
  const times = prop(labs, 'm_arrResearchedTimes')
  const researchedOn =
    times?.kind === 'ArrayProperty' && 'actors' in times
      ? times.actors.map((a) =>
          a < 0 ? undefined : dayOf(deref({ name: '', kind: 'ObjectProperty', actor: a })),
        )
      : []

  const year = int(prop(dateTime, 'm_iYear'))
  const month = int(prop(dateTime, 'm_iMonth'))
  const day = int(prop(dateTime, 'm_iDay'))

  const researched = numbers(prop(labs, 'm_arrResearched')).map((v) => v !== 0)
  const projectProp = prop(labs, 'm_kProject')
  const projectTech = int(structField(projectProp, 'iTech'))
  const etaProp = structField(projectProp, 'strETA')

  return {
    description: save.header.save_description.str,
    gameNumber: save.header.game_number,
    saveNumber: save.header.save_number,
    tactical: save.header.tactical_save,
    ironman: save.header.ironman,
    date:
      year !== undefined && month !== undefined && day !== undefined
        ? { year, month, day }
        : undefined,
    campaignDay: dayOf(dateTime),
    researchedOn,
    difficulty: int(prop(strategy, 'm_iDifficulty')),
    researched,
    // The game allocates m_arrProgress at twice the tech count; the tail is unused.
    progress: numbers(prop(labs, 'm_arrProgress')).slice(0, researched.length),
    hoursSpent: numbers(prop(labs, 'm_arrTimeSpent')),
    project:
      projectTech !== undefined && projectTech > 0
        ? {
            tech: projectTech,
            pointsLeft: int(structField(projectProp, 'iActualHoursLeft')) ?? 0,
            eta: etaProp?.kind === 'StrProperty' ? etaProp.value.str : '',
          }
        : undefined,
    scientists: int(prop(labs, 'm_iNumScientists')),
    engineers: int(prop(engineering, 'm_iNumEngineers')),
    labBonus: float(prop(labs, 'm_fLabBonus')),
    adjacentLabBonus: float(prop(labs, 'm_fAdjLabBonus')),
    credits: numbers(prop(labs, 'm_arrCredits')),
    foundryHistory: numbers(prop(engineering, 'm_arrFoundryHistory')),
    foundryInProgress: foundryProjects(prop(engineering, 'm_arrFoundryProjects')),
    secondWave: numbers(prop(strategy, 'm_arrSecondWave')),
    startCountry: hqCountry === undefined ? undefined : hqCountry & 0xffff,
    startingBonusIndex: hqCountry === undefined ? undefined : hqCountry >>> 16,
    satelliteCountries,
    lostCountries,
    recap: recapStats(save),
    stock: numbers(prop(byClass('XGStorage'), 'm_arrItems')),
  }
}
