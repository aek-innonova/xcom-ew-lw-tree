<script setup lang="ts">
// Air war: a UFO against one jet or several in turn (Long War 1.0), or
// against a squadron flying together (LWR), with the odds under each stance,
// what every number does, and a playable fight. Rules and sources:
// model/airwar.ts, model/airwar-lwr.ts, features/air-war.md and
// features/lw-rebalanced.md.

import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import {
  AIR_FOUNDRY,
  craftWeapons,
  FIRESTORM,
  INTERCEPTOR,
  STANCES,
  STANCE_AIM,
  SIZES,
  SIZE_LABEL,
  ufoUpgrades,
  ufosBySize,
  air,
  analysisTech,
  categoryFor,
  campaignSetting,
  consumableAllowed,
  consumablesHeld,
  craftStats,
  escapeTime,
  exchanges,
  runJobs,
  shipName,
  ufoStats,
  weaponName,
  type AirSetting,
  type Engagement,
  type Leg,
  type ShipStats,
  type OddsJob,
  type OddsReply,
  type OddsRequest,
  type SequenceOdds,
  type Stance,
} from '@/model/airwar'
import {
  CONSUMABLE_STANCE,
  LWR_BONUS,
  LWR_FOUNDRY,
  canLaunch,
  consumableAllowed as squadAllowed,
  critChance,
  escapeTime as squadEscape,
  fireRate,
  jetToHit,
  runSquadJobs,
  sizeFactor,
  squadronSize,
  ufoToHit,
  type Jet,
  type SquadJob,
  type SquadReply,
  type SquadRequest,
  type SquadronFight,
  type SquadronOdds,
} from '@/model/airwar-lwr'
import { bonusIds, campaign, foundryById, game } from '@/state/store'
import AirFight from './AirFight.vue'
import AirSquadronFight from './AirSquadronFight.vue'
import ShipPicture from './ShipPicture.vue'
import { ufoNote } from '@/model/ufos'

type Use = 'aim' | 'dodge' | 'boost'
interface LegSetup {
  /** Hangar index (campaign) */
  jet: number
  type: number
  weapon: number
  kills: number
  hpPct: number
  stance: Stance
  aim: boolean
  dodge: boolean
  boost: boolean
}
interface Setup {
  mode: 'campaign' | 'free'
  ufo: number
  ufoHpPct: number
  category: number
  foundry: number[]
  friendlySkies: boolean
  analysis: boolean
  legs: LegSetup[]
  /** LWR: difficulty (UFO hulls), bonuses in effect, the squadron's consumables. */
  difficulty: number
  bonuses: number[]
  use: Record<Use, boolean>
}

const KEY = 'lwtree.air.v1'
const newLeg = (jet = 0): LegSetup => ({
  jet,
  type: INTERCEPTOR,
  weapon: 3,
  kills: 0,
  hpPct: 100,
  stance: 'balanced',
  aim: false,
  dodge: false,
  boost: false,
})
const DEFAULT: Setup = {
  mode: 'campaign',
  ufo: 4,
  ufoHpPct: 100,
  category: 0,
  foundry: [],
  friendlySkies: false,
  analysis: false,
  legs: [newLeg()],
  difficulty: 1,
  bonuses: [],
  use: { aim: false, dodge: false, boost: false },
}
function restore(): Setup | undefined {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Setup | null
    return s && Array.isArray(s.legs) ? { ...DEFAULT, ...s } : undefined
  } catch {
    return undefined
  }
}
const setup = reactive<Setup>(restore() ?? DEFAULT)
watch(setup, () => localStorage.setItem(KEY, JSON.stringify(setup)), { deep: true })

const STANCE_OF_CODE: Stance[] = ['balanced', 'aggressive', 'defensive']
/** The stance the jet last flew with (kept in the save). */
const savedStance = (jet: number): Stance =>
  STANCE_OF_CODE[campaign.value?.interceptors[jet]?.stance ?? 0] ?? 'balanced'
function addLeg() {
  const jet = Math.min(setup.legs.length, Math.max(0, hangar.value.length - 1))
  setup.legs.push({ ...newLeg(jet), stance: fromCampaign.value ? savedStance(jet) : 'balanced' })
}

/** The version's ships and weapons, and whether LWR's squadrons fight. */
const data = computed(() => game.value.air)
const lwr = computed(() => game.value.airRules === 'lwr')
const rules = computed(() => game.value.airRules)
const shipLabel = (id: number) => shipName(id, data.value)
const weaponLabel = (id: number) => weaponName(id, data.value)

/** Free selection sets alien research; UFOs grow per 30 of it (LWR: 50), the category. */
const alienResearch = computed({
  get: () => Math.min(setup.category, data.value.category.max) * data.value.category.per,
  set: (v: number) => (setup.category = categoryFor(Number(v) || 0, data.value.category)),
})

const fromCampaign = computed(() => setup.mode === 'campaign' && !!campaign.value)
const hangar = computed(() => campaign.value?.interceptors ?? [])

/** LWR's bonuses that change the air war, among those in effect. */
const AIR_BONUSES: number[] = Object.values(LWR_BONUS)
const setting = computed<AirSetting>(() =>
  fromCampaign.value
    ? campaignSetting(campaign.value!, data.value, bonusIds.value)
    : {
        foundry: new Set(setup.foundry),
        friendlySkies: setup.friendlySkies,
        category: Math.min(setup.category, data.value.category.max),
        air: data.value,
        difficulty: setup.difficulty,
        bonuses: new Set(setup.bonuses),
      },
)
const analysisOf = (type: number) => !!campaign.value?.researched[analysisTech(type, rules.value)]
const analysis = computed(() => (fromCampaign.value ? analysisOf(setup.ufo) : setup.analysis))
const held = computed(() =>
  fromCampaign.value ? consumablesHeld(campaign.value!, data.value) : null,
)
const boosters = computed(() => !!campaign.value?.foundryHistory[AIR_FOUNDRY.boosters])

/** Switching to "Anything" starts from what the campaign has. */
function setMode(mode: Setup['mode']) {
  if (mode === 'free' && setup.mode === 'campaign' && campaign.value) {
    const s = campaignSetting(campaign.value, data.value, bonusIds.value)
    setup.foundry = [...s.foundry].filter((id) => FOUNDRY_TOGGLES.value.includes(id))
    setup.friendlySkies = s.friendlySkies
    setup.category = s.category
    setup.analysis = analysisOf(setup.ufo)
    setup.difficulty = Math.min(3, s.difficulty ?? 1)
    setup.bonuses = [...(s.bonuses ?? [])].filter((id) => AIR_BONUSES.includes(id))
    for (const leg of setup.legs) {
      const jet = hangar.value[leg.jet]
      if (!jet) continue
      leg.type = jet.type
      leg.weapon = jet.weapons[0] ?? 3
      leg.kills = jet.kills
      leg.hpPct = Math.round((jet.hp / Math.max(1, jet.maxHp)) * 100)
    }
  }
  setup.mode = mode
}

const ufo = computed(() => {
  const u = ufoStats(setup.ufo, setting.value)
  return { ...u, hp: Math.max(1, Math.round((u.maxHp * setup.ufoHpPct) / 100)) }
})

function craftFor(leg: LegSetup) {
  if (fromCampaign.value) {
    const jet = hangar.value[leg.jet]
    if (jet) {
      const c = craftStats(jet.type, jet.weapons[0] ?? 3, setting.value, jet.weapons)
      return { ...c, hp: jet.hp, kills: jet.kills, label: jet.callsign || c.name }
    }
  }
  const c = craftStats(leg.type, leg.weapon, setting.value)
  return {
    ...c,
    hp: Math.max(1, Math.round((c.maxHp * leg.hpPct) / 100)),
    kills: leg.kills,
    label: `${c.name}, ${weaponLabel(leg.weapon)}`,
  }
}

/** Why a consumable cannot be used on this leg, or '' if it can (Long War 1.0). */
function blocked(i: number, kind: Use): string {
  const leg = setup.legs[i]!
  if (!consumableAllowed(kind, leg.stance))
    return kind === 'aim' ? 'not in defensive stance' : 'not in aggressive stance'
  if (held.value) {
    const before = setup.legs.slice(0, i).filter((l) => l[kind] && !blockedStance(l, kind)).length
    if (held.value[kind] - before <= 0)
      return boosters.value ? 'none in stores' : 'needs Aircraft Boosters'
  }
  return ''
}
const blockedStance = (l: LegSetup, kind: Use) => !consumableAllowed(kind, l.stance)

const legs = computed<(Leg & { label: string })[]>(() =>
  setup.legs.map((l, i) => {
    const craft = craftFor(l)
    return {
      craft,
      label: craft.label,
      stance: l.stance,
      use: {
        aim: l.aim && !blocked(i, 'aim'),
        dodge: l.dodge && !blocked(i, 'dodge'),
        boost: l.boost && !blocked(i, 'boost'),
      },
    }
  }),
)

/**
 * A jet's weapons in numbers (am note cb07d): a shot's damage, the armor it
 * goes through (the weapon's and the jet's own), how often it fires, its aim
 * before kills and stance; with the UFO's analysis where it changes them
 * (Long War: damage × 1.1; LWR: the jets fire 30 % faster).
 */
function weaponFacts(craft: ShipStats) {
  const analysed = analysis.value
  return craft.weapons.map((w) => ({
    name: w.name,
    damage: !lwr.value && analysed ? Math.trunc(w.damage * 1.1) : w.damage,
    pen: w.ap + craft.ap,
    jetPen: craft.ap,
    every: lwr.value && analysed ? w.firingTime / 1.3 : w.firingTime,
    aim: w.toHit,
    note: analysed ? (lwr.value ? 'fires 30 % faster: analysed' : '+10 % damage: analysed') : '',
  }))
}

// --- LWR: the jets fly together ----------------------------------------------

/**
 * The squadron as it launches: jets under half health and a jet picked twice
 * stay home, and the list is cut to the size the best pilot's kills allow.
 */
const squadInfo = computed(() => {
  const why: string[] = []
  const flying: number[] = []
  const seen = new Set<number>()
  setup.legs.forEach((l, i) => {
    const c = legs.value[i]!.craft
    if (fromCampaign.value && seen.has(l.jet)) why[i] = 'already in the squadron'
    else if (!canLaunch(c)) why[i] = 'under half health: cannot launch'
    else flying.push(i)
    seen.add(l.jet)
  })
  const size = squadronSize(flying.map((i) => legs.value[i]!.craft.kills))
  for (const i of flying.splice(size)) why[i] = `the squadron is ${size} jets`
  return { flying, why, size }
})
const squadJets = computed<Jet[]>(() =>
  squadInfo.value.flying.map((i) => ({ ...legs.value[i]!.craft, stance: setup.legs[i]!.stance })),
)
const firstStance = computed<Stance>(() => squadJets.value[0]?.stance ?? 'balanced')
/** Why the squadron cannot use a consumable, or '' (by the first jet's stance; stores). */
function squadBlocked(kind: Use, stance = firstStance.value): string {
  if (!squadAllowed(kind, stance)) return `first jet not ${CONSUMABLE_STANCE[kind]}`
  if (held.value && held.value[kind] <= 0)
    return boosters.value ? 'none in stores' : 'needs Aircraft Boosters'
  return ''
}
const squadUse = (stance = firstStance.value) => ({
  aim: setup.use.aim && !squadBlocked('aim', stance),
  dodge: setup.use.dodge && !squadBlocked('dodge', stance),
  boost: setup.use.boost && !squadBlocked('boost', stance),
})
const squad = computed<SquadronFight>(() => ({
  ufo: { ...ufo.value },
  jets: squadJets.value,
  analysis: analysis.value,
  bonuses: [...(setting.value.bonuses ?? [])],
  foundry: [...setting.value.foundry],
}))
/** Odds for the squadron as set, and with each jet's stance changed in turn. */
const squadOdds = ref<SquadronOdds | null>(null)
const squadByStance = ref<Record<Stance, SquadronOdds>[]>([])
function receiveSquads(reply: SquadReply) {
  if (reply.id !== requestId) return
  const [main, ...rest] = reply.squads
  squadOdds.value = main!
  // By the jets the reply was asked for: a jet added since has none yet.
  squadByStance.value = Array.from(
    { length: Math.floor(rest.length / STANCES.length) },
    (_, i) =>
      Object.fromEntries(STANCES.map((st, k) => [st, rest[i * STANCES.length + k]!])) as Record<
        Stance,
        SquadronOdds
      >,
  )
}
function requestSquads() {
  const fight: SquadronFight = JSON.parse(JSON.stringify(squad.value))
  if (!fight.jets.length) {
    squadOdds.value = null
    squadByStance.value = []
    return
  }
  const jobs: SquadJob[] = [{ fight, use: squadUse(), runs: 2000, seed: 1 }]
  fight.jets.forEach((_, i) => {
    for (const st of STANCES) {
      const jets = fight.jets.map((j, k) => (k === i ? { ...j, stance: st } : j))
      jobs.push({ fight: { ...fight, jets }, use: squadUse(jets[0]!.stance), runs: 600, seed: 7 })
    }
  })
  const req: SquadRequest = { id: ++requestId, squads: jobs }
  if (worker) worker.postMessage(req)
  else receiveSquads(runSquadJobs(req))
}
/** Where squadron jet k sits in the list of legs. */
const legOfJet = (k: number) => squadInfo.value.flying[k]!

// Odds: the sequence as set, and each leg under each stance (the rest as set),
// worked out in a worker so the page stays responsive.
const odds = ref<SequenceOdds | null>(null)
const byStance = ref<Record<Stance, SequenceOdds>[]>([])
const worker =
  typeof Worker === 'undefined'
    ? null
    : new Worker(new URL('../model/airwar.worker.ts', import.meta.url), { type: 'module' })
let requestId = 0
function receive(reply: OddsReply) {
  if (reply.id !== requestId) return
  const [main, ...rest] = reply.results
  odds.value = main!
  byStance.value = legs.value.map(
    (_, i) =>
      Object.fromEntries(STANCES.map((st, k) => [st, rest[i * STANCES.length + k]!])) as Record<
        Stance,
        SequenceOdds
      >,
  )
}
if (worker)
  worker.onmessage = (e: MessageEvent<OddsReply | SquadReply>) =>
    'squads' in e.data ? receiveSquads(e.data) : receive(e.data)
onBeforeUnmount(() => worker?.terminate())

let timer: ReturnType<typeof setTimeout> | undefined
watch(
  [ufo, legs, analysis, lwr, squad, () => setup.use],
  () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (lwr.value) return requestSquads()
      const ls: Leg[] = legs.value.map((l) => ({ craft: l.craft, stance: l.stance, use: l.use }))
      const jobs: OddsJob[] = [{ legs: ls, runs: 3000, seed: 1 }]
      ls.forEach((_, i) => {
        for (const st of STANCES) {
          jobs.push({
            runs: 1500,
            seed: 7,
            legs: ls.map((l, j) =>
              j === i
                ? {
                    ...l,
                    stance: st,
                    use: {
                      aim:
                        setup.legs[j]!.aim &&
                        consumableAllowed('aim', st) &&
                        !blockedStock(j, 'aim'),
                      dodge:
                        setup.legs[j]!.dodge &&
                        consumableAllowed('dodge', st) &&
                        !blockedStock(j, 'dodge'),
                      boost: l.use.boost,
                    },
                  }
                : l,
            ),
          })
        }
      })
      const req: OddsRequest = {
        id: ++requestId,
        ufo: JSON.parse(JSON.stringify(ufo.value)),
        analysis: analysis.value,
        jobs: JSON.parse(JSON.stringify(jobs)),
      }
      if (worker) worker.postMessage(req)
      else receive(runJobs(req))
    }, 120)
  },
  { immediate: true, deep: true },
)
/** Out of stock (campaign) regardless of stance. */
function blockedStock(i: number, kind: Use): boolean {
  if (!held.value) return false
  const before = setup.legs.slice(0, i).filter((l) => l[kind] && !blockedStance(l, kind)).length
  return held.value[kind] - before <= 0
}

/** The UFO going down by leg i under each stance: the sum of the legs up to it. */
const downBy = (o: SequenceOdds, i: number) =>
  o.legs.slice(0, i + 1).reduce((n, l) => n + l.reached * (l.crashed + l.destroyed), 0)

const jetLabel = (k: number) => legs.value[legOfJet(k)]?.label ?? ''

const engagementFor = (i: number): Engagement => ({
  craft: { ...legs.value[i]!.craft },
  ufo: { ...ufo.value },
  stance: legs.value[i]!.stance,
  analysis: analysis.value,
})

const pct = (x: number) => `${Math.round(x * 100)}%`
const num = (x: number) => Math.round(x).toLocaleString('en-US')
const sec = (x: number) => `${x.toFixed(1)} s`
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`)

/** The sums behind one leg, in words. */
function explain(i: number) {
  const e = engagementFor(i)
  const mine = exchanges(e, 1)
  const theirs = exchanges(e, 0)
  const stanceAim = STANCE_AIM[e.stance]
  const kills = Math.min(30, 3 * e.craft.kills)
  const k = air.destroy_divisor[String(e.ufo.type)]
  return {
    escape: escapeTime(e),
    boost: escapeTime(e, 1),
    mine: mine.map((x) => ({
      x,
      parts: [
        `${x.weapon.toHit}`,
        kills ? `${signed(kills)} kills` : '',
        stanceAim ? `${signed(stanceAim)} ${e.stance}` : '',
      ].filter(Boolean),
    })),
    theirs: theirs.map((x) => ({
      x,
      parts: [`${x.weapon.toHit}`, stanceAim ? `${signed(stanceAim)} ${e.stance}` : ''].filter(
        Boolean,
      ),
    })),
    destroy: air.always_crash.includes(e.ufo.type)
      ? 'An Overseer always crashes.'
      : k
        ? `Down, it crashes, or is destroyed with chance (overkill damage ÷ ${k}) %.`
        : '',
  }
}

/** The UFO types, smallest first, as this setting makes them. */
const gallery = computed(() =>
  ufosBySize(setting.value).map((ship) => {
    const c = fromCampaign.value ? campaign.value! : undefined
    return {
      ship,
      note: ufoNote(ship.type, rules.value),
      captured: c ? (c.craftEncounters[ship.type] ?? 0) : undefined,
      analysed: c ? analysisOf(ship.type) : false,
      // Upgrades already made at this alien research, and those still to come.
      upgrades: ufoUpgrades(ship.type, setting.value).map((u) => ({
        at: u.at,
        done: setting.value.category >= u.category,
        // Non-breaking spaces keep "UFO Weapon I" on one line.
        what: [
          u.weapons ? weaponList(u.weapons.map((w) => weaponLabel(w).replace(/ /g, '\u00a0'))) : '',
          u.hull ? 'tougher hull' : '',
        ]
          .filter(Boolean)
          .join(', '),
      })),
    }
  }),
)
/** "2 × UFO Weapon I" rather than the name twice. */
function weaponList(names: string[]): string {
  const counts = new Map<string, number>()
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1)
  return [...counts].map(([n, k]) => (k > 1 ? `${k} × ${n}` : n)).join(' + ')
}

const fighting = ref(false)
const foundryName = (id: number) => foundryById.value.get(id)?.name ?? `Foundry ${id}`
const FOUNDRY_TOGGLES = computed<number[]>(() =>
  lwr.value
    ? [
        LWR_FOUNDRY.armoredFighters,
        LWR_FOUNDRY.afterburners,
        LWR_FOUNDRY.coolingCoils,
        LWR_FOUNDRY.avionics,
        LWR_FOUNDRY.coilguns,
        LWR_FOUNDRY.supercapacitors,
        LWR_FOUNDRY.countermeasures,
        LWR_FOUNDRY.scanners,
        LWR_FOUNDRY.tracking,
      ]
    : [
        AIR_FOUNDRY.armoredFighters,
        AIR_FOUNDRY.afterburners,
        AIR_FOUNDRY.penetrator,
        AIR_FOUNDRY.avionics,
        AIR_FOUNDRY.coilguns,
        AIR_FOUNDRY.supercapacitors,
        AIR_FOUNDRY.sparrowhawks,
        AIR_FOUNDRY.countermeasures,
      ],
)
/** LWR's air war bonuses, named as the version names them. */
const bonusName = (id: number) =>
  [...game.value.bonuses.starting_bonuses, ...game.value.bonuses.continent_bonuses].find(
    (b) => b.bonus_id === id,
  )?.name ?? `Bonus ${id}`
function toggleBonus(id: number) {
  const i = setup.bonuses.indexOf(id)
  if (i >= 0) setup.bonuses.splice(i, 1)
  else setup.bonuses.push(id)
}
function toggleFoundry(id: number) {
  const i = setup.foundry.indexOf(id)
  if (i >= 0) setup.foundry.splice(i, 1)
  else setup.foundry.push(id)
}
const STANCE_LABEL: Record<Stance, string> = {
  aggressive: 'Aggressive',
  balanced: 'Balanced',
  defensive: 'Defensive',
}
const USE_LABEL: Record<Use, string> = { aim: 'Aim', dodge: 'Dodge', boost: 'Boost' }
const USE_HELP: Record<Use, string> = {
  aim: 'next 2 misses hit',
  dodge: 'next 2 hits on you cancelled',
  boost: '+50 % speed: the UFO escapes later',
}
const SQUAD_USE_HELP: Record<Use, string> = {
  aim: 'the lead’s next 2 misses hit; and a Boost',
  dodge: 'the next 2 hits on the squadron cancelled; and a Boost',
  boost: '+50 % speed: the UFO escapes later',
}
/** What a stance does in LWR, beside its button. */
const LWR_STANCE_NOTE: Record<Stance, string> = {
  defensive: '−10',
  balanced: '',
  aggressive: '+10',
}

/** LWR: the sums behind one squadron jet, in words. */
function explainJet(k: number) {
  const f = squad.value
  const j = f.jets[k]!
  const perKill = f.bonuses.includes(LWR_BONUS.bornToFly) ? 5 : 1
  const kills = Math.min(100, Math.trunc((perKill * j.kills) / 4))
  const size = sizeFactor(f.ufo.type)
  const rate = fireRate(f, j)
  const mine = j.weapons.map((w) => {
    const mit = Math.max(0, Math.min(0.95, 0.05 * (f.ufo.armor - (w.ap + j.ap))))
    return {
      w,
      parts: [
        `${w.toHit}`,
        kills ? `+${kills} kills` : '',
        j.stance === 'aggressive'
          ? '+10 aggressive'
          : j.stance === 'defensive'
            ? '−10 defensive'
            : '',
        j.hp !== j.maxHp && !f.bonuses.includes(LWR_BONUS.theirFinestHour) ? '−10 damaged' : '',
        size !== 1 ? `× ${size} ${SIZE_LABEL[f.ufo.size]?.toLowerCase()} UFO` : '',
      ].filter(Boolean),
      hit: jetToHit(f, j, w),
      mit,
      damage: Math.trunc(w.damage * (1 - mit)),
      crit: critChance(f, w, j, f.ufo, true),
      every: w.firingTime / rate,
      rate,
    }
  })
  const theirs = f.ufo.weapons.map((w) => {
    const mit = Math.max(0, Math.min(0.95, 0.05 * (j.armor - (w.ap + f.ufo.ap))))
    return {
      w,
      hit: Math.min(100, ufoToHit(w, j.stance)),
      mit,
      damage: Math.trunc(w.damage * (1 - mit)),
      crit: critChance(f, w, f.ufo, j, false),
    }
  })
  return { mine, theirs }
}
const squadEscapes = computed(() => ({
  escape: squadEscape(squad.value),
  boost: squadEscape(squad.value, true),
}))
const DIFFICULTIES = computed(() => game.value.difficulties)
</script>

<template>
  <section class="air" aria-label="Air war">
    <div class="bar">
      <h2>Air war</h2>
      <div class="seg" role="group" aria-label="Ships and upgrades from">
        <button
          type="button"
          :class="{ on: fromCampaign }"
          :disabled="!campaign"
          @click="setMode('campaign')"
        >
          Your campaign
        </button>
        <button type="button" :class="{ on: !fromCampaign }" @click="setMode('free')">
          Anything
        </button>
      </div>
      <span v-if="!campaign" class="muted">Load a save to fly your own hangar.</span>
      <span v-else-if="fromCampaign" class="muted">
        Your hangar, Foundry projects and the UFOs at your alien research ({{
          campaign?.recap.Days ?? 0
        }}).
      </span>
    </div>

    <div class="cols">
      <div class="setup">
        <h3>UFO</h3>
        <div class="row">
          <strong class="ufo-name">{{ shipLabel(setup.ufo) }}</strong>
          <label class="field">
            starts at
            <input v-model.number="setup.ufoHpPct" type="number" min="1" max="100" class="num" />%
            HP<span v-if="ufo.hp !== ufo.maxHp" class="muted">
              ({{ num(ufo.hp) }} of {{ num(ufo.maxHp) }})</span
            >
          </label>
          <label v-if="!fromCampaign" class="field">
            alien research
            <input
              v-model.number="alienResearch"
              type="number"
              min="0"
              :max="data.category.per * data.category.max"
              :step="data.category.per"
              class="num wide"
            />
          </label>
          <label v-if="!fromCampaign && lwr" class="field">
            difficulty
            <select v-model.number="setup.difficulty" aria-label="Difficulty">
              <option v-for="(d, k) in DIFFICULTIES" :key="k" :value="k">{{ d }}</option>
            </select>
          </label>
          <label v-if="!fromCampaign" class="field">
            <input v-model="setup.analysis" type="checkbox" /> analysis done
          </label>
          <span v-else-if="analysis" class="muted">{{
            lwr ? 'analysed: jets fire 30 % faster' : 'analysed: +10 % damage'
          }}</span>
        </div>

        <h3 v-if="lwr">Squadron: up to {{ squadInfo.size }} jets, flying together</h3>
        <h3 v-else>Jets, one after another</h3>
        <ol class="legs">
          <li
            v-for="(l, i) in setup.legs"
            :key="i"
            class="leg"
            :class="{ home: lwr && squadInfo.why[i] }"
          >
            <div class="row">
              <span class="n">{{ i + 1 }}</span>
              <span class="jet-pic"><ShipPicture :type="legs[i]?.craft.type ?? l.type" /></span>
              <template v-if="fromCampaign">
                <select
                  v-model.number="l.jet"
                  aria-label="Jet"
                  @change="l.stance = savedStance(l.jet)"
                >
                  <option v-for="(j, k) in hangar" :key="k" :value="k">
                    {{ j.callsign }} · {{ shipLabel(j.type) }},
                    {{ weaponLabel(j.weapons[0] ?? 0) }} · {{ num(j.hp) }} HP{{
                      j.kills ? ` · ${j.kills} kills` : ''
                    }}
                  </option>
                </select>
              </template>
              <template v-else>
                <select v-model.number="l.type" aria-label="Jet type">
                  <option :value="INTERCEPTOR">Interceptor</option>
                  <option :value="FIRESTORM">Firestorm</option>
                </select>
                <select v-model.number="l.weapon" aria-label="Weapon">
                  <option v-for="w in craftWeapons(data)" :key="w" :value="w">
                    {{ weaponLabel(w) }}
                  </option>
                </select>
                <label class="field"
                  >kills <input v-model.number="l.kills" type="number" min="0" max="99" class="num"
                /></label>
                <label class="field"
                  >HP
                  <input
                    v-model.number="l.hpPct"
                    type="number"
                    min="1"
                    max="100"
                    class="num"
                  />%</label
                >
              </template>
              <button
                v-if="setup.legs.length > 1"
                type="button"
                class="remove"
                aria-label="Remove this jet"
                @click="setup.legs.splice(i, 1)"
              >
                ×
              </button>
            </div>
            <ul v-if="legs[i]" class="weapon-facts" :aria-label="`Jet ${i + 1}'s weapons`">
              <li v-for="w in weaponFacts(legs[i].craft)" :key="w.name">
                <span class="w-name">{{ w.name }}</span>
                <span class="fact"
                  ><b>{{ num(w.damage) }}</b> damage</span
                >
                <span class="fact" :title="w.jetPen ? `${w.jetPen} of it the jet's own` : undefined"
                  ><b>{{ w.pen }}</b> armor penetration</span
                >
                <span class="fact"
                  >fires every <b>{{ +w.every.toFixed(2) }}</b> s</span
                >
                <span class="fact"
                  ><b>{{ w.aim }}</b> aim</span
                >
                <span v-if="w.note" class="muted">{{ w.note }}</span>
              </li>
            </ul>
            <div class="row">
              <div class="seg stance" role="group" aria-label="Stance">
                <button
                  v-for="st in STANCES"
                  :key="st"
                  type="button"
                  :class="{ on: l.stance === st }"
                  @click="l.stance = st"
                >
                  {{ STANCE_LABEL[st] }}
                  <span v-if="lwr && LWR_STANCE_NOTE[st]" class="aim">{{
                    LWR_STANCE_NOTE[st]
                  }}</span>
                  <span v-else-if="!lwr && STANCE_AIM[st]" class="aim">{{
                    signed(STANCE_AIM[st])
                  }}</span>
                </button>
              </div>
              <span v-if="lwr && squadInfo.why[i]" class="muted small">
                Stays home: {{ squadInfo.why[i] }}
              </span>
              <label
                v-for="u in lwr ? [] : (['aim', 'dodge', 'boost'] as const)"
                :key="u"
                class="field use"
                :class="{ off: !!blocked(i, u) }"
                :aria-label="`${USE_LABEL[u]}: ${blocked(i, u) || USE_HELP[u]}`"
              >
                <input v-model="l[u]" type="checkbox" :disabled="!!blocked(i, u)" />
                {{ USE_LABEL[u] }}
                <span class="muted small">{{ blocked(i, u) || USE_HELP[u] }}</span>
              </label>
            </div>
          </li>
        </ol>
        <div v-if="lwr" class="row">
          <label
            v-for="u in ['aim', 'dodge', 'boost'] as const"
            :key="u"
            class="field use"
            :class="{ off: !!squadBlocked(u) }"
            :aria-label="`${USE_LABEL[u]}: ${squadBlocked(u) || SQUAD_USE_HELP[u]}`"
          >
            <input v-model="setup.use[u]" type="checkbox" :disabled="!!squadBlocked(u)" />
            {{ USE_LABEL[u] }}
            <span class="muted small">{{ squadBlocked(u) || SQUAD_USE_HELP[u] }}</span>
          </label>
        </div>
        <button
          type="button"
          class="add"
          :disabled="(fromCampaign && !hangar.length) || (lwr && setup.legs.length >= 5)"
          @click="addLeg()"
        >
          + Another jet
        </button>
        <p v-if="lwr" class="muted small">
          Two jets fly together, three once one of them has 8 kills, four at 16, five at 32. The
          first jet's stance decides which consumable the squadron can use: Aim when aggressive,
          Boost balanced, Dodge defensive; each once.
          <template v-if="held"
            >In stores: Aim {{ held.aim }}, Dodge {{ held.dodge }}, Boost
            {{ held.boost }}.</template
          >
        </p>
        <p v-else class="muted small">
          One jet per engagement; the UFO keeps its damage for the next.
          <template v-if="held"
            >In stores: Aim {{ held.aim }}, Dodge {{ held.dodge }}, Boost
            {{ held.boost }}.</template
          >
        </p>

        <template v-if="!fromCampaign">
          <h3>Upgrades</h3>
          <div class="toggles">
            <label v-for="id in FOUNDRY_TOGGLES" :key="id" class="field">
              <input
                type="checkbox"
                :checked="setup.foundry.includes(id)"
                @change="toggleFoundry(id)"
              />
              {{ foundryName(id) }}
            </label>
            <label class="field"
              ><input v-model="setup.friendlySkies" type="checkbox" /> Friendly Skies (second
              wave)</label
            >
            <template v-if="lwr">
              <label v-for="id in AIR_BONUSES" :key="`b${id}`" class="field">
                <input
                  type="checkbox"
                  :checked="setup.bonuses.includes(id)"
                  @change="toggleBonus(id)"
                />
                {{ bonusName(id) }} (bonus)
              </label>
            </template>
          </div>
        </template>
      </div>

      <div v-if="lwr" class="results" aria-live="polite">
        <div v-if="squadOdds" class="headline">
          <span class="big">{{ pct(squadOdds.down) }}</span>
          <span>UFO down</span>
          <span class="muted"
            >crashed {{ pct(squadOdds.crashed) }} · destroyed {{ pct(squadOdds.destroyed) }} ·
            escapes {{ pct(squadOdds.escaped)
            }}<template v-if="squadOdds.disengaged">
              · break off {{ pct(squadOdds.disengaged) }}</template
            ></span
          >
          <button type="button" class="fight" @click="fighting = true">Fly it</button>
        </div>
        <p v-else class="muted">No jet can fly.</p>

        <section v-for="(j, k) in squadJets" :key="k" class="leg-odds">
          <h3>
            {{ legOfJet(k) + 1 }}. {{ jetLabel(k) }}
            <span v-if="squadOdds" class="muted"
              >· the UFO's first target {{ pct(squadOdds.firstLead[k] ?? 0) }} of the time</span
            >
          </h3>
          <p v-if="squadOdds" class="line">
            shot down {{ pct(squadOdds.lost[k] ?? 0) }} · deals {{ num(squadOdds.dealt[k] ?? 0) }} ·
            takes {{ num(squadOdds.taken[k] ?? 0) }}
          </p>
          <table
            v-if="squadByStance[k]"
            class="stances"
            :aria-label="`Stances for jet ${legOfJet(k) + 1}`"
          >
            <tbody>
              <tr
                v-for="st in STANCES"
                :key="st"
                :class="{ on: j.stance === st }"
                @click="setup.legs[legOfJet(k)]!.stance = st"
              >
                <th>{{ STANCE_LABEL[st] }}</th>
                <td class="bars">
                  <div class="bar-row">
                    <span class="track"
                      ><span class="fill down" :style="{ width: pct(squadByStance[k]![st].down) }"
                    /></span>
                    <span class="v">{{ pct(squadByStance[k]![st].down) }} down</span>
                  </div>
                  <div class="bar-row">
                    <span class="track"
                      ><span
                        class="fill lost"
                        :style="{ width: pct(squadByStance[k]![st].lost[k] ?? 0) }"
                    /></span>
                    <span class="v">{{ pct(squadByStance[k]![st].lost[k] ?? 0) }} jet lost</span>
                  </div>
                </td>
                <td class="v small muted">takes {{ num(squadByStance[k]![st].taken[k] ?? 0) }}</td>
              </tr>
            </tbody>
          </table>

          <details class="explain">
            <summary>What the numbers do</summary>
            <ul>
              <li v-for="m in explainJet(k).mine" :key="`m${m.w.id}`">
                <strong>{{ m.w.name }}:</strong> to hit {{ m.parts.join(' ') }} → {{ m.hit }}% a
                shot · {{ num(m.w.damage) }} damage<template v-if="m.mit > 0"
                  >, armor takes {{ pct(m.mit) }} → {{ num(m.damage) }}</template
                >, ± 20 %; {{ m.crit }}% crits × 1.5 · every {{ m.w.firingTime
                }}<template v-if="m.rate !== 1"> ÷ {{ m.rate.toFixed(2) }}</template> =
                {{ sec(m.every) }}
              </li>
              <li v-for="m in explainJet(k).theirs" :key="`t${m.w.id}${m.w.firingTime}`">
                <strong>{{ shipLabel(setup.ufo) }}, {{ m.w.name }}</strong
                >, at this jet: to hit {{ m.w.toHit
                }}<template v-if="j.stance === 'defensive'"> × 2/3 (defensive)</template
                ><template v-else-if="j.stance === 'aggressive'"> × 3/2 (aggressive)</template> →
                {{ m.hit }}% · {{ num(m.w.damage) }} damage<template v-if="m.mit > 0"
                  >, armor takes {{ pct(m.mit) }} → {{ num(m.damage) }}</template
                >, ± 20 %; {{ m.crit }}% crits · every {{ m.w.firingTime }} s
              </li>
            </ul>
          </details>
        </section>

        <details v-if="squadJets.length" class="explain">
          <summary>How LWR's air war works</summary>
          <ul>
            <li>
              The UFO goes for one jet, the lead: each jet scores 2, +1 per weapon when aggressive,
              −1 when defensive; the highest leads (all equal: a random one). Each UFO shot then has
              a 49 % chance to go to a jet behind the lead instead, drawn 1 : 2 : 3 for defensive,
              balanced, aggressive; it is rolled again against that jet's stance.
            </li>
            <li>
              Escapes after 30 × the squadron's average speed ÷ {{ ufo.battleSpeed }} =
              {{ sec(squadEscapes.escape) }} (with Boost {{ sec(squadEscapes.boost) }}). A hit lands
              0.3 s after the shot.
            </li>
            <li>
              A wingman under a quarter of its hull leaves. When the lead goes down the next jet
              takes over, if the game still counts one as chasing; it often does not, because the
              wingman draw overwrites the list it checks, and then the UFO gets away. Break off
              sends the lead home in the same way.
            </li>
            <li>
              Down, a Fighter or a Destroyer is destroyed, any other UFO crashes; either way it
              counts towards its analysis.
            </li>
          </ul>
        </details>
      </div>

      <div v-else class="results" aria-live="polite">
        <div v-if="odds" class="headline">
          <span class="big">{{ pct(odds.down) }}</span>
          <span>UFO down</span>
          <span class="muted"
            >crashed {{ pct(odds.crashed) }} · destroyed {{ pct(odds.destroyed) }}</span
          >
          <button type="button" class="fight" @click="fighting = true">Fly it</button>
        </div>

        <section v-for="(l, i) in legs" :key="i" class="leg-odds">
          <h3>
            {{ i + 1 }}. {{ l.label }}
            <span v-if="odds?.legs[i] && i > 0" class="muted"
              >flies {{ pct(odds.legs[i]!.reached) }} of the time</span
            >
          </h3>
          <p v-if="odds?.legs[i]" class="line">
            UFO down {{ pct(odds.legs[i]!.crashed + odds.legs[i]!.destroyed) }} · escapes
            {{ pct(odds.legs[i]!.escaped) }} · jet lost {{ pct(odds.legs[i]!.craftLost) }} · deals
            {{ num(odds.legs[i]!.ufoDamage) }} · takes {{ num(odds.legs[i]!.craftDamage) }}
          </p>
          <table
            v-if="byStance[i]?.balanced.legs[i]"
            class="stances"
            :aria-label="`Stances for jet ${i + 1}`"
          >
            <tbody>
              <tr
                v-for="st in STANCES"
                :key="st"
                :class="{ on: setup.legs[i]!.stance === st }"
                @click="setup.legs[i]!.stance = st"
              >
                <th>{{ STANCE_LABEL[st] }}</th>
                <td class="bars">
                  <div class="bar-row">
                    <span class="track"
                      ><span class="fill down" :style="{ width: pct(downBy(byStance[i]![st], i)) }"
                    /></span>
                    <span class="v">{{ pct(downBy(byStance[i]![st], i)) }} down</span>
                  </div>
                  <div class="bar-row">
                    <span class="track"
                      ><span
                        class="fill lost"
                        :style="{ width: pct(byStance[i]![st].legs[i]!.craftLost) }"
                    /></span>
                    <span class="v">{{ pct(byStance[i]![st].legs[i]!.craftLost) }} jet lost</span>
                  </div>
                </td>
                <td class="v small muted">
                  takes {{ num(byStance[i]![st].legs[i]!.craftDamage) }}
                </td>
              </tr>
            </tbody>
          </table>

          <details class="explain">
            <summary>What the numbers do</summary>
            <ul>
              <li v-for="m in explain(i).mine" :key="`m${m.x.weapon.id}`">
                <strong>{{ m.x.weapon.name }}:</strong> to hit {{ m.parts.join(' ') }} →
                {{ pct(m.x.hitChance) }} a shot · {{ num(m.x.weapon.damage) }} damage<template
                  v-if="m.x.mitigation > 0"
                  >, armor takes {{ pct(m.x.mitigation) }} → {{ num(m.x.damage) }}</template
                >, then +0–50 %; {{ pct(m.x.critChance) }} crits double it · every
                {{ m.x.weapon.firingTime }} s, about {{ m.x.shots }} shots before it escapes
              </li>
              <li v-for="m in explain(i).theirs" :key="`t${m.x.weapon.id}${m.x.weapon.firingTime}`">
                <strong>{{ shipLabel(setup.ufo) }}, {{ m.x.weapon.name }}:</strong> to hit
                {{ m.parts.join(' ') }} → {{ pct(m.x.hitChance) }} ·
                {{ num(m.x.weapon.damage) }} damage<template v-if="m.x.mitigation > 0"
                  >, your armor takes {{ pct(m.x.mitigation) }} → {{ num(m.x.damage) }}</template
                >; {{ pct(m.x.critChance) }} crits · every {{ m.x.weapon.firingTime }} s
              </li>
              <li>
                Escapes after 30 × {{ l.craft.battleSpeed }} ÷ {{ ufo.battleSpeed }} =
                {{ sec(explain(i).escape) }} (with Boost {{ sec(explain(i).boost) }}). A hit lands
                0.3 s after the shot.
              </li>
              <li>
                Stance: aggressive gives both sides +15 to hit, defensive −15; aggressive rules out
                Dodge, defensive Aim.
              </li>
              <li v-if="explain(i).destroy">{{ explain(i).destroy }}</li>
            </ul>
          </details>
        </section>
      </div>

      <div class="gallery" role="listbox" aria-label="UFO type">
        <template v-for="size in SIZES" :key="size">
          <h3>{{ SIZE_LABEL[size] }}</h3>
          <button
            v-for="u in gallery.filter((x) => x.ship.size === size)"
            :key="u.ship.type"
            type="button"
            role="option"
            class="ufo-card"
            :class="{ on: setup.ufo === u.ship.type }"
            :aria-selected="setup.ufo === u.ship.type"
            @click="setup.ufo = u.ship.type"
          >
            <span class="pic"><ShipPicture :type="u.ship.type" :size="u.ship.size" /></span>
            <span class="txt">
              <span class="name">
                {{ u.ship.name }}
                <span v-if="u.captured !== undefined" class="tag" :class="{ dim: !u.captured }">{{
                  lwr
                    ? u.captured
                      ? `downed ${u.captured}×`
                      : 'not yet downed'
                    : u.captured
                      ? `captured ${u.captured}×`
                      : 'not yet captured'
                }}</span>
                <span v-if="u.analysed" class="tag done">analysed</span>
              </span>
              <span class="nums">
                {{ num(u.ship.maxHp) }} HP · armor {{ u.ship.armor }}
                <span v-if="u.note?.armor" class="muted">({{ u.note.armor.toLowerCase() }})</span>
                · speed
                {{ u.ship.battleSpeed }} ·
                <span class="nowrap">{{ weaponList(u.ship.weapons.map((w) => w.name)) }}</span>
              </span>
              <span class="about">{{ u.note?.about }}</span>
              <span
                v-for="g in u.upgrades"
                :key="g.at"
                class="about upgrade"
                :class="{ later: !g.done }"
                >{{ g.done ? 'Upgraded' : 'Upgrade' }} at alien research {{ g.at }}:
                {{ g.what }}</span
              >
            </span>
          </button>
        </template>
      </div>
    </div>

    <AirSquadronFight
      v-if="fighting && lwr && squadJets.length"
      :fight="squad"
      :labels="squadJets.map((_, k) => `${legOfJet(k) + 1}. ${jetLabel(k)}`)"
      :held="held"
      :none-reason="boosters ? 'none in stores' : 'needs Aircraft Boosters'"
      @close="fighting = false"
    />
    <AirFight
      v-else-if="fighting && !lwr"
      :legs="legs"
      :ufo="ufo"
      :analysis="analysis"
      :held="held"
      :none-reason="boosters ? 'none in stores' : 'needs Aircraft Boosters'"
      @close="fighting = false"
    />
  </section>
</template>

<style scoped>
.air {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px 24px;
}
.bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
  margin-bottom: 12px;
}
h2 {
  margin: 0;
  font-size: 16px;
}
h3 {
  margin: 16px 0 6px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  font-weight: 600;
}
.muted {
  color: var(--muted);
}
.small {
  font-size: 12px;
}
.cols {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
  align-items: flex-start;
}
.setup {
  flex: 1 1 480px;
  max-width: 620px;
}
.results {
  flex: 1 1 440px;
  max-width: 640px;
}
.gallery {
  flex: 1 1 340px;
  max-width: 430px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  position: sticky;
  top: 0;
  max-height: calc(100vh - 200px);
  overflow-y: auto;
  padding-right: 4px;
}
.gallery h3 {
  margin: 8px 0 2px;
}
.gallery h3:first-child {
  margin-top: 0;
}
.ufo-card {
  display: flex;
  gap: 10px;
  align-items: center;
  text-align: left;
  width: 100%;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-left: 3px solid var(--node-border);
  border-radius: 4px;
  background: var(--panel);
  color: var(--text);
  font: inherit;
  cursor: pointer;
}
.ufo-card:hover {
  border-color: var(--node-border);
}
.ufo-card.on {
  border-color: var(--accent);
  border-left-color: var(--accent);
  background: var(--node);
}
.pic {
  flex: 0 0 112px;
  height: 56px;
}
.txt {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.name {
  font-weight: 600;
  font-size: 13px;
}
.tag {
  font-weight: 400;
  font-size: 11px;
  color: var(--progress);
  margin-left: 4px;
}
.tag.dim {
  color: var(--muted);
}
.tag.done {
  color: var(--done-text);
}
.nums {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.about {
  font-size: 11.5px;
  color: var(--muted);
  line-height: 1.35;
}
.about.upgrade {
  color: var(--progress);
}
.about.upgrade.later {
  color: var(--muted);
  opacity: 0.7;
}
.nowrap {
  white-space: nowrap;
}
.ufo-name {
  font-size: 15px;
}
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
  margin: 4px 0;
}
.field {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
}
.num {
  width: 56px;
}
.num.wide {
  width: 68px;
}
select,
input.num {
  background: var(--node);
  color: var(--text);
  border: 1px solid var(--node-border);
  border-radius: 4px;
  padding: 3px 6px;
  font: inherit;
  font-size: 13px;
}
.stats {
  font-size: 13px;
  margin: 6px 0;
  line-height: 1.5;
}
.seg {
  display: inline-flex;
  border: 1px solid var(--node-border);
  border-radius: 5px;
  overflow: hidden;
}
.seg button {
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--text);
  padding: 4px 10px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.seg button + button {
  border-left: 1px solid var(--node-border);
}
.seg button.on {
  background: var(--node-border);
  color: #fff;
}
.seg button:disabled {
  color: var(--muted);
  cursor: default;
}
.aim {
  font-size: 11px;
  color: var(--muted);
  margin-left: 2px;
}
.seg button.on .aim {
  color: var(--text);
}
.legs {
  list-style: none;
  margin: 0;
  padding: 0;
}
.leg {
  border: 1px solid var(--border);
  border-left: 3px solid var(--node-border);
  border-radius: 4px;
  padding: 6px 10px;
  margin-bottom: 8px;
  background: var(--panel);
}
.weapon-facts {
  list-style: none;
  margin: 2px 0 4px 22px;
  padding: 0;
  font-size: 12px;
}
.weapon-facts li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 12px;
}
.w-name {
  font-weight: 600;
  color: var(--accent);
}
.fact {
  color: var(--muted);
}
.fact b {
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.jet-pic {
  width: 64px;
  height: 32px;
}
.leg .n {
  font-weight: 700;
  color: var(--accent);
}
.use.off {
  color: var(--muted);
}
.leg.home {
  opacity: 0.6;
}
.remove {
  margin-left: auto;
  border: none;
  background: none;
  color: var(--muted);
  font-size: 16px;
  cursor: pointer;
}
.add {
  font-size: 13px;
  padding: 4px 10px;
}
.toggles {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 4px 12px;
}
.headline {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 10px;
  margin-top: 8px;
}
.big {
  font-size: 34px;
  font-weight: 700;
  color: var(--done-text);
  font-variant-numeric: tabular-nums;
}
.fight {
  margin-left: auto;
  align-self: center;
  font-size: 14px;
  padding: 6px 16px;
  background: var(--accent);
  color: #04131f;
  border: none;
  border-radius: 5px;
  font-weight: 600;
  cursor: pointer;
}
.line {
  font-size: 13px;
  margin: 2px 0 6px;
}
.stances {
  border-collapse: collapse;
  width: 100%;
  font-size: 12.5px;
}
.stances tr {
  cursor: pointer;
}
.stances tr.on th {
  color: var(--accent);
}
.stances th {
  text-align: left;
  font-weight: 600;
  width: 92px;
  padding: 3px 6px 3px 0;
}
.stances tr.on {
  background: var(--lane-alt);
}
.bars {
  padding: 3px 0;
}
.bar-row {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 14px;
}
.track {
  flex: 1;
  height: 6px;
  background: var(--lane);
  border-radius: 3px;
  overflow: hidden;
}
.fill {
  display: block;
  height: 100%;
  border-radius: 0 3px 3px 0;
}
.fill.down {
  background: var(--done-text);
}
.fill.lost {
  background: var(--progress);
}
.v {
  min-width: 92px;
  font-variant-numeric: tabular-nums;
}
td.v {
  text-align: right;
  padding-left: 10px;
  white-space: nowrap;
}
.explain {
  margin: 6px 0 4px;
  font-size: 12.5px;
}
.explain summary {
  cursor: pointer;
  color: var(--accent);
}
.explain ul {
  margin: 6px 0 0;
  padding-left: 18px;
  line-height: 1.5;
}
.leg-odds {
  border-top: 1px solid var(--border);
  padding-top: 4px;
  margin-top: 10px;
}
</style>
