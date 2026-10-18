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

export interface Campaign {
  description: string
  gameNumber: number
  saveNumber: number
  /** Saved during a mission; the research state is the one the mission started from. */
  tactical: boolean
  ironman: boolean
  date?: { year: number; month: number; day: number }
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
  foundryHistory: number[]
  secondWave: number[]
  /** The country the campaign started in (config country id). */
  startCountry?: number
  /** Which starting bonus it got: an index into the INI's starting bonus lines. */
  startingBonusIndex?: number
  /** Country ids with a satellite over them. */
  satelliteCountries: number[]
}

export class NotACampaignError extends Error {}

const DIFFICULTY_NAMES = ['Easy', 'Normal', 'Classic', 'Impossible']

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
    secondWave: numbers(prop(strategy, 'm_arrSecondWave')),
    startCountry: hqCountry === undefined ? undefined : hqCountry & 0xffff,
    startingBonusIndex: hqCountry === undefined ? undefined : hqCountry >>> 16,
    satelliteCountries,
  }
}
