// The app's state: the costs in force (defaults or the player's INI), the
// loaded campaign, and what is selected. Loaded files are kept in
// localStorage as their extracted results (a save is megabytes; what we take
// from it is a few kilobytes), so a reload does not lose them.

import { computed, reactive, watch } from 'vue'
import { applyTechBalance, parseTechBalance, type TechBalance } from '@/model/ini'
import { defaultTechs, type Tech } from '@/model/techs'
import { readCampaign, type Campaign } from '@/save/campaign'
import { parseSave } from '@/save/parse'

const INI_KEY = 'lwtree.ini.v1'
const SAVE_KEY = 'lwtree.save.v1'

export interface LoadedIni {
  fileName: string
  balance: [number, TechBalance][]
  unmatched: string[]
}

export interface LoadedSave {
  fileName: string
  campaign: Campaign
}

interface State {
  ini: LoadedIni | null
  save: LoadedSave | null
  selected: number | null
  hovered: number | null
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

/** Loads a dropped or picked file, deciding by content whether it is a save or an INI. */
export async function loadFile(file: File): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  // A save starts with its version as a little-endian int (0x10 for EW); an INI starts with text.
  const looksLikeSave =
    bytes.length > 1024 && bytes[0]! <= 0x20 && bytes[1] === 0 && bytes[2] === 0 && bytes[3] === 0
  if (looksLikeSave) return loadSave(file.name, bytes)
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
  state.ini = { fileName, balance: [...parsed.balance], unmatched: parsed.unmatched }
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

export function loadSave(fileName: string, bytes: Uint8Array) {
  try {
    const campaign = readCampaign(parseSave(bytes))
    state.save = { fileName, campaign }
    state.message = campaign.tactical
      ? {
          kind: 'info',
          text: `${fileName} is a mid-mission save; showing the research state the mission started from.`,
        }
      : null
  } catch (e) {
    state.message = { kind: 'error', text: `${fileName}: ${(e as Error).message}` }
  }
}

export function clearIni() {
  state.ini = null
  state.message = null
}

export function clearSave() {
  state.save = null
  state.message = null
}
