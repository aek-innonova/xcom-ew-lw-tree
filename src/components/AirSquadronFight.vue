<script setup lang="ts">
// A playable LWR engagement: the squadron's rolled shots shown as they happen,
// with Aim, Dodge, Boost and Break off at the moment you press them. The fight
// itself is model/airwar-lwr.ts (rollSquadron, then playSquadron with your
// actions); the UFO's target, the wingman draws and the criticals are rolled
// in the playback, as the game does.

import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { seeded, shipName, weaponName } from '@/model/airwar'
import { interceptionArt } from '@/state/interception'
import {
  CONSUMABLE_STANCE,
  consumableAllowed,
  escapeTime,
  playSquadron,
  rollSquadron,
  type Rolled,
  type SquadronActions,
  type SquadronEvent,
  type SquadronFight,
  type Use,
} from '@/model/airwar-lwr'
import { game } from '@/state/store'

const props = defineProps<{
  fight: SquadronFight
  /** A name per jet, in fight.jets order. */
  labels: string[]
  /** Consumables in stores (campaign); null for any number. */
  held: Record<Use, number> | null
  /** Why none can be used when stores are empty. */
  noneReason?: string
}>()
const emit = defineEmits<{ close: [] }>()

const data = computed(() => game.value.air)
const ufoName = computed(() => shipName(props.fight.ufo.type, data.value))
const t = ref(0)
const speed = ref(1)
const running = ref(true)
let seed = (Date.now() & 0x7fffffff) >>> 0
const rollSeed = ref(0)
const rolled = ref<Rolled | null>(null)
const actions = reactive<SquadronActions>({ aborts: [] })

function start() {
  seed = (seed * 1103515245 + 12345) >>> 0
  rollSeed.value = seed
  rolled.value = rollSquadron(props.fight, seeded(seed))
  delete actions.aim
  delete actions.dodge
  delete actions.boost
  actions.aborts = []
  t.value = 0
  running.value = true
}
start()

const result = computed(() =>
  playSquadron(
    props.fight,
    rolled.value!,
    { ...actions, aborts: [...(actions.aborts ?? [])] },
    seeded(rollSeed.value ^ 0x5bd1e995),
  ),
)
const over = computed(() => t.value >= result.value.time)
const seen = computed(() => result.value.events.filter((e) => e.time <= t.value))
const n = computed(() => props.fight.jets.length)

function hpAt(jet: number): number {
  const hits = seen.value.filter((e) => e.kind === 'hit' && e.to === jet)
  if (hits.length) return hits[hits.length - 1]!.hp!
  return jet < 0 ? props.fight.ufo.hp : props.fight.jets[jet]!.hp
}
const maxHp = (jet: number) => (jet < 0 ? props.fight.ufo.maxHp : props.fight.jets[jet]!.maxHp)
/** The jet the UFO is after now. */
const lead = computed(() => {
  const changes = seen.value.filter((e) => e.kind === 'lead')
  return changes.length ? changes[changes.length - 1]!.from! : result.value.firstLead
})
function status(jet: number): string {
  if (hpAt(jet) <= 0) return 'down'
  const left = seen.value.find((e) => e.kind === 'leaves' && e.from === jet)
  if (left) return left.why === 'ordered' ? 'sent home' : 'turned for home'
  return jet === lead.value ? 'lead' : ''
}
const breakingOff = computed(() => seen.value.some((e) => e.kind === 'breaking-off'))
const boosted = computed(() =>
  seen.value.some((e) => e.kind === 'aim' || e.kind === 'dodge' || e.kind === 'boost'),
)
const escapeAt = computed(() => escapeTime(props.fight, boosted.value))

/** CanUseConsumable reads the first jet in the fight: all score alike or it is the first picked. */
const firstStance = computed(() => props.fight.jets[0]!.stance)
function why(kind: Use): string {
  if (!consumableAllowed(kind, firstStance.value)) return `first jet not ${CONSUMABLE_STANCE[kind]}`
  if (props.held && props.held[kind] <= 0) return props.noneReason ?? 'none left'
  if (actions[kind] !== undefined) return 'used'
  return ''
}
function canUse(kind: Use): boolean {
  return !over.value && !breakingOff.value && t.value > 0 && !why(kind)
}
function use(kind: Use) {
  if (canUse(kind)) actions[kind] = t.value
}
function breakOff() {
  if (!over.value && !breakingOff.value) actions.aborts = [...(actions.aborts ?? []), t.value]
}
/** Charges left on Aim and Dodge (two each; a new lead ends them). */
function charges(kind: 'aim' | 'dodge'): number {
  const at = seen.value.find((e) => e.kind === kind)
  if (!at) return 0
  if (seen.value.some((e) => e.kind === 'lead' && e.time >= at.time)) return 0
  const spent = seen.value.filter((e) =>
    kind === 'aim' ? e.kind === 'shot' && e.aimed : e.kind === 'dodged',
  ).length
  return Math.max(0, 2 - spent)
}

// Playback clock.
let frame = 0
let last = 0
function tick(now: number) {
  const dt = last ? (now - last) / 1000 : 0
  last = now
  if (running.value && !over.value)
    t.value = Math.min(result.value.time, t.value + dt * speed.value)
  frame = requestAnimationFrame(tick)
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
  else if (e.key === ' ') {
    running.value = !running.value
    e.preventDefault()
  } else if (e.key === 'a') use('aim')
  else if (e.key === 'd') use('dodge')
  else if (e.key === 'b') use('boost')
}
onMounted(() => {
  frame = requestAnimationFrame(tick)
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  window.removeEventListener('keydown', onKey)
})

// The scene: the squadron left, stacked; the UFO right; a shot flies for 0.3 s.
const picture = (type: number) => `${import.meta.env.BASE_URL}ships/${type}.webp`
/** The game's interception art, in the app with a game to read (state/interception.ts). */
const art = computed(() => interceptionArt())
const gridStyle = computed(() =>
  art.value?.grid ? { backgroundImage: `url(${art.value.grid})` } : undefined,
)
/** A jet just hit: the Firestorm's hologram turns red for a moment, as in the game. */
const hitNow = (k: number) =>
  !over.value && seen.value.some((e) => e.kind === 'hit' && e.to === k && t.value - e.time < 0.35)
/** The game's button face for Aim, Dodge and Break off: ready, in use, or not to be had. */
function face(u: 'aim' | 'dodge' | 'boost' | 'abort'): string | undefined {
  const a = art.value
  if (!a) return undefined
  const inUse = u === 'boost' ? actions.boost !== undefined : u !== 'abort' && charges(u) > 0
  const state = u === 'abort' ? 'ready' : inUse ? 'active' : canUse(u) ? 'ready' : 'disabled'
  const src = a.button(u, state)
  return src ? `url(${src})` : undefined
}
const W = 640
const H = computed(() => Math.max(190, 56 * n.value + 24))
const UFO = computed(() => ({ x: 550, y: H.value / 2 }))
const jetAt = (k: number) => ({ x: 90, y: H.value / 2 + (k - (n.value - 1) / 2) * 56 })
const at = (who: number) => (who < 0 ? UFO.value : jetAt(who))
const FLIGHT = 0.3
const inFlight = computed(() =>
  // Over: nothing more in the air.
  (over.value ? [] : seen.value)
    .filter((e) => e.kind === 'shot' && t.value - e.time <= FLIGHT + 0.15)
    .map((e, i) => {
      const from = at(e.from!)
      const to = at(e.to!)
      const p = Math.min(1.5, (t.value - e.time) / FLIGHT)
      const miss = e.hit ? 0 : (i % 2 ? 1 : -1) * 30
      return {
        key: `${e.time}-${e.from}-${i}`,
        x: from.x + (to.x - from.x) * p,
        y: from.y + (to.y + miss - from.y) * p,
        // Along its path, for the game's upright projectile pictures.
        angle: (Math.atan2(to.y + miss - from.y, to.x - from.x) * 180) / Math.PI,
        weapon: e.weapon ?? 0,
        ufo: e.from! < 0,
        fade: p > 1 ? 1 - (p - 1) * 2 : 1,
      }
    })
    .filter((s) => s.fade > 0),
)
const bursts = computed(() =>
  seen.value
    .filter((e) => (e.kind === 'hit' || e.kind === 'dodged') && t.value - e.time <= 0.9)
    .map((e, i) => {
      const p = at(e.to!)
      const age = t.value - e.time
      return {
        key: `${e.time}-${e.to}-${e.kind}-${i}`,
        cx: p.x,
        cy: p.y,
        x: p.x,
        y: p.y - 40 - age * 40,
        r: 8 + age * 36,
        opacity: 1 - age / 0.9,
        text: e.kind === 'dodged' ? 'dodged' : `−${e.damage}${e.crit ? ' crit' : ''}`,
        dodged: e.kind === 'dodged',
        ufo: (e.to ?? -1) < 0,
      }
    }),
)

const who = (jet: number | undefined) =>
  jet === undefined || jet < 0 ? ufoName.value : (props.labels[jet] ?? `Jet ${jet + 1}`)
function describe(e: SquadronEvent): string {
  switch (e.kind) {
    case 'shot':
      return `${who(e.from)}${e.from! < 0 ? ` at ${who(e.to)}` : ''}: ${weaponName(e.weapon!, data.value)} ${
        e.aimed ? 'hits (Aim)' : e.hit ? 'hits' : 'misses'
      } (${e.toHit}%)`
    case 'hit':
      return `${who(e.to)} takes ${e.damage}${e.crit ? ' (critical)' : ''}, ${Math.max(0, e.hp!)} left`
    case 'dodged':
      return `Dodge cancels a hit of ${e.damage} on ${who(e.to)}`
    case 'aim':
      return 'Aim: the lead’s next two misses hit (and a Boost)'
    case 'dodge':
      return 'Dodge: the next two hits on the squadron miss (and a Boost)'
    case 'boost':
      return 'Boost: the UFO escapes later'
    case 'leaves':
      return e.why === 'down'
        ? `${who(e.from)} is shot down`
        : e.why === 'ordered'
          ? `${who(e.from)} breaks off`
          : `${who(e.from)} is badly hit and turns for home`
    case 'lead':
      return `${who(e.from)} takes the lead; the UFO goes for it`
    case 'breaking-off':
      return 'The squadron breaks off'
    default:
      return ''
  }
}
const log = computed(() =>
  seen.value
    .filter((e) => e.kind !== 'end')
    .slice(-10)
    .reverse(),
)
const outcomeText = computed(() => {
  const r = result.value
  const lost = r.lost.filter(Boolean).length
  const losses = lost ? ` ${lost === 1 ? 'One jet' : `${lost} jets`} shot down.` : ''
  switch (r.outcome) {
    case 'crashed':
      return `${ufoName.value} down: it crashes.${losses}`
    case 'destroyed':
      return `${ufoName.value} destroyed in the air.${losses}`
    case 'disengaged':
      return `The squadron breaks off. The UFO has ${Math.max(0, r.ufoHp)} HP left.${losses}`
    default:
      return `The UFO gets away with ${Math.max(0, r.ufoHp)} HP left.${losses}`
  }
})
const pctOf = (hp: number, max: number) => `${Math.max(0, Math.min(100, (hp / max) * 100))}%`
</script>

<template>
  <div class="overlay" role="dialog" aria-label="Air fight" @click.self="emit('close')">
    <div class="fight">
      <header>
        <h3>Squadron of {{ n }} vs {{ ufoName }}</h3>
        <button type="button" class="close" aria-label="Close" @click="emit('close')">×</button>
      </header>

      <div class="hud">
        <ul class="squad">
          <li
            v-for="(j, k) in fight.jets"
            :key="k"
            :class="{ gone: !!status(k) && status(k) !== 'lead' }"
          >
            <span class="who"
              >{{ labels[k] }} <span class="muted small">({{ j.stance }})</span>
              <span v-if="status(k)" class="state" :class="status(k)">{{ status(k) }}</span></span
            >
            <span class="hp"
              ><span class="hp-fill jet" :style="{ width: pctOf(hpAt(k), maxHp(k)) }"
            /></span>
            <span class="v small">{{ Math.max(0, hpAt(k)) }} / {{ maxHp(k) }}</span>
          </li>
        </ul>
        <div class="clock">
          <span class="v">{{ t.toFixed(1) }} s</span>
          <span class="hp"
            ><span class="hp-fill time" :style="{ width: pctOf(escapeAt - t, escapeAt) }"
          /></span>
          <span class="muted small">escapes at {{ escapeAt.toFixed(1) }} s</span>
        </div>
        <div class="side right">
          <span class="who">{{ ufoName }}</span>
          <span class="hp"
            ><span class="hp-fill ufo" :style="{ width: pctOf(hpAt(-1), maxHp(-1)) }"
          /></span>
          <span class="v">{{ Math.max(0, hpAt(-1)) }} / {{ maxHp(-1) }}</span>
        </div>
      </div>

      <div class="screen" :class="{ game: art }">
        <span v-if="gridStyle" class="grid" :style="gridStyle" />
        <svg :viewBox="`0 0 ${W} ${H}`" class="scene" aria-hidden="true">
          <g
            v-for="(j, k) in fight.jets"
            :key="k"
            :transform="`translate(${jetAt(k).x} ${jetAt(k).y})`"
            :class="{
              down: hpAt(k) <= 0,
              away: !!status(k) && status(k) !== 'lead' && hpAt(k) > 0,
            }"
          >
            <g :class="{ holo: art, 'hit-flash': art && hitNow(k) && !art.ship(j.type)?.turned }">
              <template v-if="art?.ship(j.type, hitNow(k))">
                <image
                  v-if="art.ship(j.type, hitNow(k))!.turned"
                  :href="art.ship(j.type, hitNow(k))!.src"
                  transform="rotate(90)"
                  x="-24"
                  y="-48"
                  width="48"
                  height="96"
                />
                <image
                  v-else
                  :href="art.ship(j.type, hitNow(k))!.src"
                  x="-48"
                  y="-24"
                  width="96"
                  height="48"
                />
              </template>
              <image v-else :href="picture(j.type)" x="-48" y="-24" width="96" height="48" />
            </g>
            <circle v-if="k === lead && !status(k).includes('home')" r="27" class="target" />
            <circle v-if="charges('dodge') > 0" r="23" class="shield" />
          </g>
          <g :transform="`translate(${UFO.x} ${UFO.y})`" :class="{ down: hpAt(-1) <= 0 }">
            <g
              :class="{ holo: art }"
              :transform="art?.ship(fight.ufo.type) ? 'scale(-1 1)' : undefined"
            >
              <image
                :href="art?.ship(fight.ufo.type)?.src ?? picture(fight.ufo.type)"
                x="-70"
                y="-35"
                width="140"
                height="70"
              />
            </g>
          </g>
          <template v-for="s in inFlight" :key="s.key">
            <image
              v-if="art"
              :href="art.projectile(s.weapon).src"
              :x="-art.projectile(s.weapon).width / 2"
              :y="-art.projectile(s.weapon).height / 2"
              :width="art.projectile(s.weapon).width"
              :height="art.projectile(s.weapon).height"
              :transform="`translate(${s.x} ${s.y})${art.projectile(s.weapon).upright ? ` rotate(${s.angle + 90})` : ''}`"
              :class="{ 'ufo-shot': s.ufo }"
              :opacity="s.fade"
            />
            <circle
              v-else
              :cx="s.x"
              :cy="s.y"
              :r="s.ufo ? 5 : 4"
              :class="s.ufo ? 'shot-ufo' : 'shot-jet'"
              :opacity="s.fade"
            />
          </template>
          <g v-for="b in bursts" :key="b.key" :opacity="b.opacity">
            <template v-if="!b.dodged">
              <image
                v-if="art && (b.ufo ? art.hitUfo : art.hitJet)"
                :href="(b.ufo ? art.hitUfo : art.hitJet)!"
                :x="b.cx - b.r * 1.4"
                :y="b.cy - b.r * 1.4"
                :width="b.r * 2.8"
                :height="b.r * 2.8"
                preserveAspectRatio="xMidYMid slice"
              />
              <circle v-else :cx="b.cx" :cy="b.cy" :r="b.r" class="burst" />
            </template>
            <text :x="b.x" :y="b.y" text-anchor="middle" class="dmg">{{ b.text }}</text>
          </g>
        </svg>
        <span v-if="art?.scan" class="scan" :style="{ backgroundImage: `url(${art.scan})` }" />
      </div>

      <div class="controls" :class="{ game: art }">
        <button
          v-for="u in ['aim', 'dodge', 'boost'] as const"
          :key="u"
          type="button"
          :class="{ face: art }"
          :style="face(u) ? { backgroundImage: face(u) } : undefined"
          :disabled="!canUse(u)"
          :aria-label="`${u}: ${why(u) || 'press'}`"
          @click="use(u)"
        >
          {{ u === 'aim' ? 'Aim' : u === 'dodge' ? 'Dodge' : 'Boost' }}
          <span class="muted small">
            <template v-if="u !== 'boost' && charges(u) > 0">{{ charges(u) }} left</template>
            <template v-else>{{ why(u) }}</template>
          </span>
        </button>
        <button
          type="button"
          :class="{ face: art, abort: art }"
          :style="face('abort') ? { backgroundImage: face('abort') } : undefined"
          :disabled="over || breakingOff"
          @click="breakOff"
        >
          Break off <span class="muted small">the lead leaves</span>
        </button>
        <span class="spacer" />
        <button type="button" @click="running = !running">{{ running ? 'Pause' : 'Play' }}</button>
        <div class="speed" role="group" aria-label="Speed">
          <button
            v-for="s in [0.5, 1, 2]"
            :key="s"
            type="button"
            :class="{ on: speed === s }"
            @click="speed = s"
          >
            {{ s }}×
          </button>
        </div>
      </div>

      <p v-if="over" class="result">
        {{ outcomeText }}
        <button type="button" @click="start">Fly again</button>
      </p>

      <ol class="log">
        <li v-for="(e, i) in log" :key="`${e.time}-${e.kind}-${i}`" :class="e.kind">
          <span class="v">{{ e.time.toFixed(1) }}</span> {{ describe(e) }}
        </li>
      </ol>
      <p class="muted small keys">Keys: A aim · D dodge · B boost · space pause · Esc close</p>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(3, 10, 17, 0.72);
  display: flex;
  /* Pinned at the top: the log grows downwards, the fight screen stays put. */
  align-items: flex-start;
  padding-top: 4vh;
  justify-content: center;
  z-index: 50;
}
.fight {
  width: min(760px, 96vw);
  max-height: 94vh;
  overflow-y: auto;
  background: var(--panel);
  border: 1px solid var(--node-border);
  border-radius: 8px;
  padding: 12px 16px 14px;
}
header {
  display: flex;
  align-items: center;
}
h3 {
  margin: 0;
  font-size: 14px;
}
.close {
  margin-left: auto;
  border: none;
  background: none;
  color: var(--muted);
  font-size: 20px;
  cursor: pointer;
}
.hud {
  display: grid;
  grid-template-columns: 1.3fr 0.8fr 1fr;
  gap: 16px;
  margin: 10px 0 6px;
  font-size: 12.5px;
  align-items: start;
}
.squad {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.squad li {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1px;
}
.squad li.gone {
  opacity: 0.55;
}
.state {
  font-size: 11px;
  margin-left: 4px;
  color: var(--progress);
}
.state.lead {
  color: var(--accent);
}
.state.down {
  color: var(--enables);
}
.side,
.clock {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.right {
  align-items: flex-end;
}
.clock {
  align-items: center;
}
.who {
  font-weight: 600;
}
.hp {
  display: block;
  width: 100%;
  height: 6px;
  background: var(--lane);
  border-radius: 3px;
  overflow: hidden;
}
.hp-fill {
  display: block;
  height: 100%;
  transition: width 0.15s;
}
.hp-fill.jet {
  background: var(--accent);
}
.hp-fill.ufo {
  background: var(--enables);
}
.hp-fill.time {
  background: var(--muted);
  transition: none;
}
.v {
  font-variant-numeric: tabular-nums;
}
.muted {
  color: var(--muted);
}
.small {
  font-size: 11.5px;
}
.scene {
  width: 100%;
  height: auto;
  background: var(--lane);
  border-radius: 6px;
}
.down {
  opacity: 0.2;
}
.away {
  opacity: 0.45;
}
.target {
  fill: none;
  stroke: var(--enables);
  stroke-width: 1.5;
  opacity: 0.6;
}
.shield {
  fill: none;
  stroke: var(--accent);
  stroke-dasharray: 4 4;
  opacity: 0.7;
}
.shot-jet {
  fill: #9fe4ff;
}
.shot-ufo {
  fill: #ffb0e0;
}
.burst {
  fill: none;
  stroke: #ffd27a;
  stroke-width: 2;
}
.dmg {
  fill: var(--text);
  font-size: 13px;
  font-weight: 700;
}
.controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
}
.controls button {
  font-size: 13px;
  padding: 5px 10px;
  display: inline-flex;
  gap: 6px;
  align-items: baseline;
}
.spacer {
  flex: 1;
}
.speed {
  display: inline-flex;
}
.speed button {
  border-radius: 0;
}
.speed button.on {
  background: var(--node-border);
}
.result {
  margin: 10px 0 4px;
  font-size: 14px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.log {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  font-size: 12.5px;
  min-height: 10em;
}
.log li {
  padding: 1px 0;
}
.log li .v {
  color: var(--muted);
  display: inline-block;
  width: 3em;
}
.log li.hit {
  color: #ffd27a;
}
.log li.dodged,
.log li.aim,
.log li.dodge,
.log li.boost,
.log li.lead {
  color: var(--accent);
}
.log li.leaves,
.log li.breaking-off {
  color: var(--progress);
}
.keys {
  margin: 6px 0 0;
}
</style>
<style src="./interception.css" scoped></style>
