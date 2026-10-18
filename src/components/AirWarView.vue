<script setup lang="ts">
// Air war: a UFO against one jet or several in turn, with the odds under each
// stance, what every number does, and a playable fight. Rules and sources:
// model/airwar.ts and features/air-war.md.

import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import {
  AIR_FOUNDRY,
  CRAFT_WEAPONS,
  FIRESTORM,
  INTERCEPTOR,
  STANCES,
  STANCE_AIM,
  SIZES,
  SIZE_LABEL,
  changesAfter,
  ufosBySize,
  air,
  analysisTech,
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
  type OddsJob,
  type OddsReply,
  type OddsRequest,
  type SequenceOdds,
  type Stance,
} from '@/model/airwar'
import { campaign, foundryById } from '@/state/store'
import AirFight from './AirFight.vue'
import UfoPicture from './UfoPicture.vue'
import { UFO_NOTES } from '@/model/ufos'

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
function restore(): Setup | undefined {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Setup | null
    return s && Array.isArray(s.legs) ? s : undefined
  } catch {
    return undefined
  }
}
const setup = reactive<Setup>(
  restore() ?? {
    mode: 'campaign',
    ufo: 4,
    ufoHpPct: 100,
    category: 0,
    foundry: [],
    friendlySkies: false,
    analysis: false,
    legs: [newLeg()],
  },
)
watch(setup, () => localStorage.setItem(KEY, JSON.stringify(setup)), { deep: true })

const STANCE_OF_CODE: Stance[] = ['balanced', 'aggressive', 'defensive']
/** The stance the jet last flew with (kept in the save). */
const savedStance = (jet: number): Stance =>
  STANCE_OF_CODE[campaign.value?.interceptors[jet]?.stance ?? 0] ?? 'balanced'
function addLeg() {
  const jet = Math.min(setup.legs.length, Math.max(0, hangar.value.length - 1))
  setup.legs.push({ ...newLeg(jet), stance: fromCampaign.value ? savedStance(jet) : 'balanced' })
}

const fromCampaign = computed(() => setup.mode === 'campaign' && !!campaign.value)
const hangar = computed(() => campaign.value?.interceptors ?? [])

const setting = computed<AirSetting>(() =>
  fromCampaign.value
    ? campaignSetting(campaign.value!)
    : {
        foundry: new Set(setup.foundry),
        friendlySkies: setup.friendlySkies,
        category: setup.category,
      },
)
const analysis = computed(() =>
  fromCampaign.value ? !!campaign.value!.researched[analysisTech(setup.ufo)] : setup.analysis,
)
const held = computed(() => (fromCampaign.value ? consumablesHeld(campaign.value!) : null))
const boosters = computed(() => !!campaign.value?.foundryHistory[AIR_FOUNDRY.boosters])

/** Switching to "Anything" starts from what the campaign has. */
function setMode(mode: Setup['mode']) {
  if (mode === 'free' && setup.mode === 'campaign' && campaign.value) {
    const s = campaignSetting(campaign.value)
    setup.foundry = [...s.foundry].filter((id) =>
      (Object.values(AIR_FOUNDRY) as number[]).includes(id),
    )
    setup.friendlySkies = s.friendlySkies
    setup.category = s.category
    setup.analysis = !!campaign.value.researched[analysisTech(setup.ufo)]
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
    label: `${c.name}, ${weaponName(leg.weapon)}`,
  }
}

/** Why a consumable cannot be used on this leg, or '' if it can. */
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
if (worker) worker.onmessage = (e: MessageEvent<OddsReply>) => receive(e.data)
onBeforeUnmount(() => worker?.terminate())

let timer: ReturnType<typeof setTimeout> | undefined
watch(
  [ufo, legs, analysis],
  () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
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
    const next = changesAfter(ship.type, setting.value.category)[0]
    return {
      ship,
      note: UFO_NOTES[ship.type],
      captured: c ? (c.craftEncounters[ship.type] ?? 0) : undefined,
      analysed: c ? !!c.researched[analysisTech(ship.type)] : false,
      next: next
        ? `From category ${next.above_category + 1}: ${
            next.weapons ? weaponList(next.weapons.map(weaponName)) : 'tougher hull'
          }${next.weapons && next.stats ? ', tougher hull' : ''}`
        : '',
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
const FOUNDRY_TOGGLES = [
  AIR_FOUNDRY.armoredFighters,
  AIR_FOUNDRY.afterburners,
  AIR_FOUNDRY.penetrator,
  AIR_FOUNDRY.avionics,
  AIR_FOUNDRY.coilguns,
  AIR_FOUNDRY.supercapacitors,
  AIR_FOUNDRY.sparrowhawks,
  AIR_FOUNDRY.countermeasures,
]
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
        Your hangar, Foundry projects and this month's UFOs (category {{ setting.category }}).
      </span>
    </div>

    <div class="cols">
      <div class="setup">
        <h3>UFO</h3>
        <div class="row">
          <strong class="ufo-name">{{ shipName(setup.ufo) }}</strong>
          <label class="field">
            starts at
            <input v-model.number="setup.ufoHpPct" type="number" min="1" max="100" class="num" />%
            HP<span v-if="ufo.hp !== ufo.maxHp" class="muted">
              ({{ num(ufo.hp) }} of {{ num(ufo.maxHp) }})</span
            >
          </label>
          <label v-if="!fromCampaign" class="field">
            category
            <input v-model.number="setup.category" type="number" min="0" max="32" class="num" />
          </label>
          <label v-if="!fromCampaign" class="field">
            <input v-model="setup.analysis" type="checkbox" /> analysis done
          </label>
          <span v-else-if="analysis" class="muted">analysed: +10 % damage</span>
        </div>

        <h3>Jets, one after another</h3>
        <ol class="legs">
          <li v-for="(l, i) in setup.legs" :key="i" class="leg">
            <div class="row">
              <span class="n">{{ i + 1 }}</span>
              <template v-if="fromCampaign">
                <select
                  v-model.number="l.jet"
                  aria-label="Jet"
                  @change="l.stance = savedStance(l.jet)"
                >
                  <option v-for="(j, k) in hangar" :key="k" :value="k">
                    {{ j.callsign }} · {{ shipName(j.type) }}, {{ weaponName(j.weapons[0] ?? 0) }} ·
                    {{ num(j.hp) }} HP{{ j.kills ? ` · ${j.kills} kills` : '' }}
                  </option>
                </select>
              </template>
              <template v-else>
                <select v-model.number="l.type" aria-label="Jet type">
                  <option :value="INTERCEPTOR">Interceptor</option>
                  <option :value="FIRESTORM">Firestorm</option>
                </select>
                <select v-model.number="l.weapon" aria-label="Weapon">
                  <option v-for="w in CRAFT_WEAPONS" :key="w" :value="w">
                    {{ weaponName(w) }}
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
                  <span v-if="STANCE_AIM[st]" class="aim">{{ signed(STANCE_AIM[st]) }}</span>
                </button>
              </div>
              <label
                v-for="u in ['aim', 'dodge', 'boost'] as const"
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
        <button
          type="button"
          class="add"
          :disabled="fromCampaign && !hangar.length"
          @click="addLeg()"
        >
          + Another jet
        </button>
        <p class="muted small">
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
          </div>
        </template>
      </div>

      <div class="results" aria-live="polite">
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
                <strong>{{ shipName(setup.ufo) }}, {{ m.x.weapon.name }}:</strong> to hit
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
            <span class="pic"><UfoPicture :type="u.ship.type" :size="u.ship.size" /></span>
            <span class="txt">
              <span class="name">
                {{ u.ship.name }}
                <span v-if="u.captured !== undefined" class="tag" :class="{ dim: !u.captured }">{{
                  u.captured ? `captured ${u.captured}×` : 'not yet captured'
                }}</span>
                <span v-if="u.analysed" class="tag done">analysed</span>
              </span>
              <span class="nums">
                {{ num(u.ship.maxHp) }} HP · armor {{ u.ship.armor }}
                <span class="muted">({{ u.note?.armor.toLowerCase() }})</span> · speed
                {{ u.ship.battleSpeed }} ·
                <span class="nowrap">{{ weaponList(u.ship.weapons.map((w) => w.name)) }}</span>
              </span>
              <span class="about">{{ u.note?.about }}</span>
              <span v-if="u.next" class="about next">{{ u.next }}</span>
            </span>
          </button>
        </template>
      </div>
    </div>

    <AirFight
      v-if="fighting"
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
.about.next {
  color: var(--progress);
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
.leg .n {
  font-weight: 700;
  color: var(--accent);
}
.use.off {
  color: var(--muted);
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
