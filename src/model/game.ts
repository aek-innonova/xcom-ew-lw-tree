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
import { creditShares } from './credits'
import {
  buildFoundry,
  type FoundryData,
  type FoundryProject,
  type FoundryRule,
  type FoundryWorkFormula,
} from './foundry'
import { buildTechs, type Tech, type TechData, type TechRule } from './techs'

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
  /** Whether UFOpaedia's Long War pages describe this version (its links). */
  ufopaedia: boolean
  /** Grey market prices by item key, where they differ from Long War 1.0's built-in ones. */
  prices?: Record<string, number>
}

function game(
  id: GameId,
  name: string,
  short: string,
  techData: TechData & { ini_points_per_day?: number },
  rules: { techs: TechRule[]; foundry: FoundryRule[]; credit_bonus: Record<string, number> },
  foundryData: FoundryData,
  ufopaedia: boolean,
  prices?: Record<string, number>,
): Game {
  return {
    id,
    name,
    short,
    techs: buildTechs(techData, rules.techs),
    categories: techData.categories,
    foundry: buildFoundry(foundryData, rules.foundry),
    foundryCategories: foundryData.categories,
    foundryWork: foundryData.work ?? 'days*24*engineers',
    creditShares: creditShares(rules.credit_bonus),
    iniPointsPerDay: techData.ini_points_per_day ?? 720,
    ufopaedia,
    prices,
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
  ),
  lwr: game(
    'lwr',
    'Long War Rebalanced 2.06',
    'LWR 2.06',
    lwrTechs as unknown as TechData,
    lwrRules as never,
    lwrFoundry as unknown as FoundryData,
    false,
    lwrPrices.prices,
  ),
}
