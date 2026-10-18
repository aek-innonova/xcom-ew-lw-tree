// The app's state: the costs in force (defaults or the player's INI), the
// loaded campaign, and what is selected. Loaded files are kept in
// localStorage as their extracted results (a save is megabytes; what we take
// from it is a few kilobytes), so a reload does not lose them.

import { computed, reactive, watch } from 'vue'
import { activeBonuses, parseBonusValues, researchBonuses } from '@/model/bonuses'
import { applyTechBalance, parseTechBalance, type TechBalance } from '@/model/ini'
import {
  applyFoundryBalance,
  defaultFoundry,
  parseFoundryBalance,
  withCostReduction,
  type FoundryBalance,
  type FoundryProject,
} from '@/model/foundry'
import { changesBetween, checkSave, type SaveCheck } from '@/model/live'
import { peekGameNumber, snapshotOf, withSnapshot, type Snapshot } from '@/model/history'
import { researchContext } from '@/model/research'
import { planResearch, type Plan } from '@/model/plan'
import { defaultTechs, type Tech } from '@/model/techs'
import { readCampaign, type Campaign } from '@/save/campaign'
import { parseSave } from '@/save/parse'

const INI_KEY = 'lwtree.ini.v1'
const SAVE_KEY = 'lwtree.save.v1'
const GOALS_KEY = 'lwtree.goals.v1'
const CHECKS_KEY = 'lwtree.checks.v1'
const VIEW_KEY = 'lwtree.view.v1'
const HISTORY_KEY = 'lwtree.history.v1'
const FOUNDRY_GOALS_KEY = 'lwtree.foundryGoals.v1'
const MAX_CHECKS = 100

export interface LoadedIni {
  fileName: string
  balance: [number, TechBalance][]
  unmatched: string[]
  /** Starting, country and continent bonus values from the INI, by bonus key. */
  bonusValues?: [string, number][]
  /** FoundryBalance lines, by project id. */
  foundryBalance?: [number, FoundryBalance][]
}

export interface LoadedSave {
  fileName: string
  campaign: Campaign
  /** When it was loaded (wall clock, ms), shown beside its name. */
  loadedAt?: number
}

interface State {
  ini: LoadedIni | null
  save: LoadedSave | null
  selected: number | null
  hovered: number | null
  /** Which board is shown. */
  view: 'research' | 'foundry' | 'history'
  /** Snapshots of every save loaded, by campaign number. */
  history: Record<number, Snapshot[]>
  /** A bulk import in progress. */
  importing: { done: number; total: number } | null
  selectedFoundry: number | null
  hoveredFoundry: number | null
  /** Foundry projects the player wants; the plan adds the research they need. */
  foundryGoals: number[]
  /** Techs the player wants to reach; the plan is everything still needed for them. */
  goals: number[]
  /** Our figures against the game's, one entry per save loaded, newest first. */
  checks: SaveCheck[]
  /** The last load's outcome, shown to the player. */
  message: { kind: 'info' | 'error'; text: string } | null
}

function restore<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function persist(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage full or disabled: the files still work until the page is closed.
  }
}

export const state = reactive<State>({
  ini: restore<LoadedIni>(INI_KEY),
  save: restore<LoadedSave>(SAVE_KEY),
  selected: null,
  hovered: null,
  view: restore<'research' | 'foundry' | 'history'>(VIEW_KEY) ?? 'research',
  history: restore<Record<number, Snapshot[]>>(HISTORY_KEY) ?? {},
  importing: null,
  selectedFoundry: null,
  hoveredFoundry: null,
  foundryGoals: restore<number[]>(FOUNDRY_GOALS_KEY) ?? [],
  goals: restore<number[]>(GOALS_KEY) ?? [],
  checks: restore<SaveCheck[]>(CHECKS_KEY) ?? [],
  message: null,
})

watch(
  () => state.ini,
  (v) => persist(INI_KEY, v),
)
watch(
  () => state.save,
  (v) => persist(SAVE_KEY, v),
)
watch(
  () => state.history,
  (v) => persist(HISTORY_KEY, v),
  { deep: true },
)
watch(
  () => state.view,
  (v) => persist(VIEW_KEY, v),
)
watch(
  () => [...state.foundryGoals],
  (v) => persist(FOUNDRY_GOALS_KEY, v.length ? v : null),
)
watch(
  () => state.checks,
  (v) => persist(CHECKS_KEY, v.length ? v : null),
  { deep: true },
)
watch(
  () => [...state.goals],
  (v) => persist(GOALS_KEY, v.length ? v : null),
)

const applied = computed(() =>
  state.ini
    ? applyTechBalance(defaultTechs, {
        balance: new Map(state.ini.balance),
        unmatched: state.ini.unmatched,
      })
    : null,
)

/** The techs with the costs in force. */
export const techs = computed<Tech[]>(() => applied.value?.techs ?? defaultTechs)
export const techById = computed(() => new Map(techs.value.map((t) => [t.id, t])))
/** Ids whose cost the loaded INI changed from stock Long War 1.0. */
export const changedByIni = computed(() => new Set(applied.value?.changed ?? []))
export const campaign = computed(() => state.save?.campaign ?? null)

/** The campaign's starting, country and continent bonuses, with the INI's values if loaded. */
export const bonuses = computed(() =>
  campaign.value
    ? activeBonuses(
        campaign.value,
        state.ini?.bonusValues ? new Map(state.ini.bonusValues) : undefined,
      )
    : null,
)

/** Research speed, credits and bonuses for estimates; undefined without a save. */
export const research = computed(() =>
  campaign.value
    ? researchContext(
        campaign.value,
        techs.value,
        bonuses.value ? researchBonuses(bonuses.value) : undefined,
      )
    : undefined,
)

// --- Foundry ------------------------------------------------------------------

const NEW_WARFARE = 4

const foundryApplied = computed(() =>
  state.ini?.foundryBalance
    ? applyFoundryBalance(defaultFoundry, new Map(state.ini.foundryBalance))
    : { projects: defaultFoundry, changed: [] as number[] },
)

/** Asia's New Warfare bonus, if the campaign has it: the fraction off Foundry cash, alloys and elerium. */
export const foundryReduction = computed(() => {
  const b = bonuses.value?.all.find((x) => x.bonus_id === NEW_WARFARE)
  return b ? b.value / 100 : 0
})

/** Foundry projects with the costs in force (the INI's, less New Warfare). */
export const foundry = computed<FoundryProject[]>(() =>
  foundryApplied.value.projects.map((p) => withCostReduction(p, foundryReduction.value)),
)
export const foundryById = computed(() => new Map(foundry.value.map((p) => [p.id, p])))
export const changedFoundryByIni = computed(() => new Set(foundryApplied.value.changed))

/** Shows a Foundry project: switches to the Foundry board and selects it. */
export function showFoundry(id: number) {
  state.view = 'foundry'
  state.selectedFoundry = id
}

/** Shows a tech: switches to the research tree and selects it. */
export function showTech(id: number) {
  state.view = 'research'
  state.selected = id
}

// --- Plan ---------------------------------------------------------------------

/** What is still needed for the goals (techs, and the techs Foundry goals need). */
export const plan = computed<Plan | null>(() => {
  const goals = state.goals.filter((g) => techById.value.has(g))
  const foundryTechs = state.foundryGoals
    .map((f) => foundryById.value.get(f)?.requires_tech?.id)
    .filter((id): id is number => id !== undefined && !goals.includes(id))
  if (!goals.length && !state.foundryGoals.length) return null
  return planResearch(
    [...goals, ...foundryTechs],
    techs.value,
    campaign.value?.researched ?? [true],
    campaign.value?.project?.tech,
  )
})
export const planSteps = computed(
  () => new Map((plan.value?.steps ?? []).map((id, i) => [id, i + 1])),
)

export function planTo(id: number) {
  state.goals = [id]
  state.foundryGoals = []
}

export function toggleGoal(id: number) {
  state.goals = state.goals.includes(id)
    ? state.goals.filter((g) => g !== id)
    : [...state.goals, id]
}

export function planToFoundry(id: number) {
  state.goals = []
  state.foundryGoals = [id]
}

export function toggleFoundryGoal(id: number) {
  state.foundryGoals = state.foundryGoals.includes(id)
    ? state.foundryGoals.filter((g) => g !== id)
    : [...state.foundryGoals, id]
}

export function clearPlan() {
  state.goals = []
  state.foundryGoals = []
}

/** Loads a dropped or picked file, deciding by content whether it is a save or an INI. */
export async function loadFile(file: File): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  // A save starts with its version as a little-endian int (0x10 for EW); an INI starts with text.
  const looksLikeSave =
    bytes.length > 1024 && bytes[0]! <= 0x20 && bytes[1] === 0 && bytes[2] === 0 && bytes[3] === 0
  if (looksLikeSave) {
    loadSave(file.name, bytes)
    return
  }
  const text = new TextDecoder('utf-8').decode(bytes)
  if (/^\s*TechBalance\s*=/m.test(text)) return loadIni(file.name, text)
  state.message = {
    kind: 'error',
    text: `${file.name} is neither an XCOM save nor a DefaultGameCore.ini with TechBalance lines.`,
  }
}

export function loadIni(fileName: string, text: string) {
  const parsed = parseTechBalance(text, defaultTechs)
  if (parsed.balance.size === 0) {
    state.message = { kind: 'error', text: `${fileName} has no TechBalance lines.` }
    return
  }
  state.ini = {
    fileName,
    balance: [...parsed.balance],
    unmatched: parsed.unmatched,
    bonusValues: [...parseBonusValues(text)],
    foundryBalance: [...parseFoundryBalance(text, defaultFoundry)],
  }
  const changed = changedByIni.value.size
  const missing = applied.value?.missing.length ?? 0
  const parts = [`${fileName}: costs for ${parsed.balance.size} techs`]
  if (changed === 1) parts.push('1 differs from stock Long War 1.0')
  else
    parts.push(
      changed ? `${changed} differ from stock Long War 1.0` : 'all match stock Long War 1.0',
    )
  if (missing) parts.push(`${missing} techs not in the file keep their default cost`)
  if (parsed.unmatched.length) parts.push(`${parsed.unmatched.length} lines did not match a tech`)
  state.message = { kind: 'info', text: parts.join('; ') + '.' }
}

/**
 * Loads a save. Throws nothing; a save that cannot be read is reported in the
 * message line. A good one shows no message: the header shows its name and
 * when it was loaded, and what changed since the previous save goes into the
 * check log. Returns whether it worked, so the folder watcher can retry a save
 * the game is still writing. `live` marks a save picked up from the watched
 * folder.
 */
export function loadSave(fileName: string, bytes: Uint8Array, live = false): boolean {
  let next: Campaign
  try {
    next = readCampaign(parseSave(bytes))
  } catch (e) {
    if (!live) state.message = { kind: 'error', text: `${fileName}: ${(e as Error).message}` }
    return false
  }
  const prev = state.save?.campaign
  state.save = { fileName, campaign: next, loadedAt: Date.now() }
  recordCheck(fileName, changeText(next, prev))
  recordSnapshot(next, fileName)
  if (state.message?.kind === 'error') state.message = null
  return true
}

/** "researched Alien Weaponry; started Xenobiology", or undefined if nothing changed. */
function changeText(next: Campaign, prev: Campaign | undefined): string | undefined {
  const change = prev && changesBetween(prev, next)
  const name = (id: number) => techById.value.get(id)?.name ?? `#${id}`
  const parts: string[] = []
  if (change?.researched.length) parts.push(`researched ${change.researched.map(name).join(', ')}`)
  if (change?.started !== undefined) parts.push(`started ${name(change.started)}`)
  return parts.length ? parts.join('; ') : undefined
}

function recordSnapshot(c: Campaign, fileName: string) {
  const snap = snapshotOf(c, fileName)
  if (!snap) return
  state.history = {
    ...state.history,
    [snap.game]: withSnapshot(state.history[snap.game] ?? [], snap),
  }
}

/** The loaded campaign's history, in campaign order. */
export const campaignHistory = computed<Snapshot[]>(() =>
  campaign.value ? (state.history[campaign.value.gameNumber] ?? []) : [],
)

export interface SaveSource {
  name: string
  /** The first bytes, enough to read the campaign number. */
  head(): Promise<Uint8Array>
  bytes(): Promise<Uint8Array>
}

/**
 * Adds saves to the history without changing the loaded campaign. With `game`
 * set, only that campaign's saves are read (picked by their header). Yields to
 * the page between saves so it stays responsive.
 */
export async function importSaves(sources: SaveSource[], game?: number): Promise<number> {
  const wanted: SaveSource[] = []
  for (const s of sources) {
    if (game === undefined || peekGameNumber(await s.head()) === game) wanted.push(s)
  }
  state.importing = { done: 0, total: wanted.length }
  let added = 0
  const history = { ...state.history }
  for (const s of wanted) {
    try {
      const c = readCampaign(parseSave(await s.bytes()))
      const snap = snapshotOf(c, s.name)
      if (snap) {
        history[snap.game] = withSnapshot(history[snap.game] ?? [], snap)
        added++
      }
    } catch {
      // Not a readable save; skip it.
    }
    state.importing = { done: state.importing!.done + 1, total: wanted.length }
    await new Promise((r) => setTimeout(r, 0))
  }
  state.history = history
  state.importing = null
  state.message = {
    kind: 'info',
    text: `Added ${added} save${added === 1 ? '' : 's'} to the history.`,
  }
  return added
}

export function clearHistory(game: number) {
  const next = { ...state.history }
  delete next[game]
  state.history = next
}

function recordCheck(fileName: string, changes?: string) {
  const c = campaign.value
  const check = c && checkSave(c, techs.value, research.value, fileName)
  if (!check) return
  if (changes) check.changes = changes
  const others = state.checks.filter(
    (k) => !(k.fileName === fileName && k.saveNumber === check.saveNumber),
  )
  state.checks = [check, ...others].slice(0, MAX_CHECKS)
}

export function clearIni() {
  state.ini = null
  state.message = null
}

export function clearSave() {
  state.save = null
  state.message = null
}
