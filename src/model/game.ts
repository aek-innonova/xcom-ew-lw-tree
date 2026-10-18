// The game versions the site knows: Long War 1.0 and Long War Rebalanced
// (features/lw-rebalanced.md). Each brings its research tree, Foundry, rules
// and numbers; the store picks one (state.game) and everything else reads it
// from there.
//
// Long War 1.0's techs and Foundry projects are the hand-checked tech.json
// and longwar_foundry.json with the rules read from its script
// (data/techtree.json); LWR's are generated whole from its own files by
// scripts/game_data.py (data/lwr/).

import lwTechs from '../../tech.json'
import lwRules from '../../data/techtree.json'
import lwFoundry from '../../longwar_foundry.json'
import lwrTechs from '../../data/lwr/techs.json'
import lwrRules from '../../data/lwr/techtree.json'
import lwrFoundry from '../../data/lwr/foundry.json'
import lwrPrices from '../../data/lwr/prices.json'
import lwBonuses from '../../longwar_bonuses.json'
import lwrBonuses from '../../data/lwr/bonuses.json'
import lwAir from '../../data/airwar.json'
import lwrAir from '../../data/lwr/airwar.json'
import type { AirData, AirRules } from './airwar'
import type { BonusData } from './bonuses'
import { creditShares } from './credits'
import {
  buildFoundry,
  type FoundryData,
  type FoundryProject,
  type FoundryRule,
  type FoundryWorkFormula,
} from './foundry'
import { buildTechs, type Tech, type TechData, type TechRule } from './techs'
import type { ResearchFormula } from './research'

export type GameId = 'lw' | 'lwr'

export interface Game {
  id: GameId
  name: string
  /** Short label for the switch. */
  short: string
  techs: Tech[]
  categories: string[]
  foundry: FoundryProject[]
  foundryCategories: string[]
  foundryWork: FoundryWorkFormula
  /** Each research credit's share off. */
  creditShares: Record<string, number>
  /** Research points one INI day (TechBalance iTime) is worth (XGTechTree.TechCost). */
  iniPointsPerDay: number
  /** XGFacility_Labs.GetResearchPerHour's formula (research.ts pointsPerHour). */
  research: ResearchFormula
  /** Whether UFOpaedia's Long War pages describe this version (its links). */
  ufopaedia: boolean
  /** Grey market prices by item key, where they differ from Long War 1.0's built-in ones. */
  prices?: Record<string, number>
  /** Starting, country and continent bonuses. */
  bonuses: BonusData
  /** The air war: ships and weapons, and whose rules fight (airwar.ts, airwar-lwr.ts). */
  air: AirData
  airRules: AirRules
  /** The difficulty levels by m_iDifficulty, as the version's localization names them. */
  difficulties: string[]
}

function game(
  id: GameId,
  name: string,
  short: string,
  techData: TechData & { ini_points_per_day?: number; research_formula?: ResearchFormula },
  rules: { techs: TechRule[]; foundry: FoundryRule[]; credit_bonus: Record<string, number> },
  foundryData: FoundryData,
  ufopaedia: boolean,
  bonuses: BonusData,
  air: { data: AirData; rules: AirRules; difficulties: string[] },
  prices?: Record<string, number>,
): Game {
  return {
    id,
    name,
    short,
    techs: buildTechs(techData, rules.techs, !!air.data.analysis_on_shootdown),
    categories: techData.categories,
    foundry: buildFoundry(foundryData, rules.foundry),
    foundryCategories: foundryData.categories,
    foundryWork: foundryData.work ?? 'days*24*engineers',
    creditShares: creditShares(rules.credit_bonus),
    iniPointsPerDay: techData.ini_points_per_day ?? 720,
    research: techData.research_formula ?? 'lw',
    ufopaedia,
    prices,
    bonuses,
    air: air.data,
    airRules: air.rules,
    difficulties: air.difficulties,
  }
}

export const GAMES: Record<GameId, Game> = {
  lw: game(
    'lw',
    'Long War 1.0',
    'Long War 1.0',
    lwTechs as unknown as TechData,
    lwRules as never,
    lwFoundry as unknown as FoundryData,
    true,
    lwBonuses as unknown as BonusData,
    {
      data: lwAir as unknown as AirData,
      rules: 'lw',
      // Long War renames the four levels (the INI's per-difficulty lines say
      // so, and a save's journal records "Difficulty: Classic" where
      // m_iDifficulty is 1).
      difficulties: ['Normal', 'Classic', 'Brutal', 'Impossible'],
    },
  ),
  lwr: game(
    'lwr',
    'Long War Rebalanced 2.06',
    'LWR 2.06',
    lwrTechs as unknown as TechData,
    lwrRules as never,
    lwrFoundry as unknown as FoundryData,
    false,
    lwrBonuses as unknown as BonusData,
    {
      data: lwrAir as unknown as AirData,
      rules: 'lwr',
      // LWR's XComGame.int (m_arrDifficultyTypeStrings).
      difficulties: ['Easy', 'Classic', 'Brutal', 'Impossible'],
    },
    lwrPrices.prices,
  ),
}
