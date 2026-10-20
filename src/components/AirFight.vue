<script setup lang="ts">
// A playable engagement: the game's rolled shots shown as they happen, with
// Aim, Dodge, Boost and Break off at the moment you press them, then the next
// jet in the sequence against the same, damaged UFO. The fight itself is
// model/airwar.ts (rollShots, then playBack with your actions). In the
// desktop app, drawn with the game's own interception screen art
// (state/interception.ts); on the website, with our own pictures.

import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  consumableAllowed,
  escapeTime,
  playBack,
  rollShots,
  seeded,
  shipName,
  weaponName,
  type Actions,
  type Engagement,
  type FightEvent,
  type Leg,
  type Shot,
  type ShipStats,
} from '@/model/airwar'
import { interceptionArt } from '@/state/interception'

const props = defineProps<{
  legs: (Leg & { label: string })[]
  ufo: ShipStats & { hp: number }
  analysis: boolean
  /** Consumables in stores (campaign); null for any number. */
  held: Record<'aim' | 'dodge' | 'boost', number> | null
  /** Why none can be used when stores are empty. */
  noneReason?: string
}>()
const emit = defineEmits<{ close: [] }>()

type Use = 'aim' | 'dodge' | 'boost'
const legIndex = ref(0)
const ufoHp = ref(props.ufo.hp)
const usedBefore = reactive({ aim: 0, dodge: 0, boost: 0 })
const t = ref(0)
const speed = ref(1)
const running = ref(true)
let seed = (Date.now() & 0x7fffffff) >>> 0

const leg = computed(() => props.legs[legIndex.value]!)
const engagement = computed<Engagement>(() => ({
  craft: { ...leg.value.craft },
  ufo: { ...props.ufo, hp: ufoHp.value },
  stance: leg.value.stance,
  analysis: props.analysis,
}))
const shots = ref<Shot[]>([])
const actions = reactive<Actions>({})
const rollSeed = ref(0)

function start() {
  seed = (seed * 1103515245 + 12345) >>> 0
  rollSeed.value = seed
  shots.value = rollShots(engagement.value, seeded(seed))
  for (const k of ['aim', 'dodge', 'boost', 'abort'] as const) delete actions[k]
  t.value = 0
  running.value = true
}
start()

const result = computed(() =>
  playBack(engagement.value, shots.value, { ...actions }, seeded(rollSeed.value ^ 0x5bd1e995)),
)
const over = computed(() => t.value >= result.value.time)
const seen = computed(() => result.value.events.filter((e) => e.time <= t.value))

function hpAt(target: 0 | 1): number {
  const hits = seen.value.filter((e) => e.kind === 'hit' && e.target === target)
  return hits.length ? hits[hits.length - 1]!.hp! : target === 0 ? ufoHp.value : leg.value.craft.hp
}
const escapeAt = computed(() =>
  escapeTime(engagement.value, actions.boost !== undefined && actions.boost <= t.value ? 1 : 0),
)

function canUse(kind: Use): boolean {
  if (over.value || actions[kind] !== undefined || actions.abort !== undefined) return false
  if (!consumableAllowed(kind, leg.value.stance)) return false
  return !props.held || props.held[kind] - usedBefore[kind] > 0
}
function use(kind: Use) {
  if (canUse(kind)) actions[kind] = t.value
}
function breakOff() {
  if (!over.value && actions.abort === undefined) actions.abort = t.value
}
function why(kind: Use): string {
  if (!consumableAllowed(kind, leg.value.stance))
    return kind === 'aim' ? 'not in defensive stance' : 'not in aggressive stance'
  if (props.held && props.held[kind] - usedBefore[kind] <= 0)
    return usedBefore[kind] ? 'none left' : (props.noneReason ?? 'none left')
  if (actions[kind] !== undefined) return 'used'
  return ''
}
/** Charges left on Aim and Dodge (two each). */
const charges = computed(() => ({
  aim:
    actions.aim === undefined
      ? 0
      : 2 - seen.value.filter((e) => e.kind === 'shot' && e.aimed).length,
  dodge: actions.dodge === undefined ? 0 : 2 - seen.value.filter((e) => e.kind === 'dodged').length,
}))

const nextLeg = computed(() =>
  over.value &&
  (result.value.outcome === 'escaped' || result.value.outcome === 'disengaged') &&
  legIndex.value < props.legs.length - 1
    ? props.legs[legIndex.value + 1]
    : undefined,
)
function goNext() {
  for (const k of ['aim', 'dodge', 'boost'] as const) if (actions[k] !== undefined) usedBefore[k]++
  ufoHp.value = Math.max(1, result.value.ufoHp)
  legIndex.value++
  start()
}
function again() {
  legIndex.value = 0
  ufoHp.value = props.ufo.hp
  usedBefore.aim = usedBefore.dodge = usedBefore.boost = 0
  start()
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
watch(legIndex, () => (last = 0))

// The scene: the jet left, the UFO right; a shot flies for 0.3 s.
const picture = (type: number) => `${import.meta.env.BASE_URL}ships/${type}.webp`
/** The game's interception art, in the app with a game to read. */
const art = computed(() => interceptionArt())
/** The jet just hit: the Firestorm's hologram turns red for a moment, as in the game. */
const jetHit = computed(() =>
  seen.value.some((e) => e.kind === 'hit' && e.target === 1 && t.value - e.time < 0.35),
)
const jetArt = computed(() => art.value?.ship(leg.value.craft.type, jetHit.value) ?? null)
const ufoArt = computed(() => art.value?.ship(props.ufo.type) ?? null)
/** The screen behind the fight: the game's dot grid, faint. */
const gridStyle = computed(() =>
  art.value?.grid ? { backgroundImage: `url(${art.value.grid})` } : undefined,
)
/** The game's button face for Aim, Dodge and Break off: ready, in use, or not to be had. */
function face(u: 'aim' | 'dodge' | 'abort'): string | undefined {
  const a = art.value
  if (!a) return undefined
  const state =
    u === 'abort' ? 'ready' : charges.value[u] > 0 ? 'active' : canUse(u) ? 'ready' : 'disabled'
  const src = a.button(u, state)
  return src ? `url(${src})` : undefined
}
const W = 640
const H = 190
const JET = { x: 90, y: 95 }
const UFO = { x: 550, y: 95 }
const FLIGHT = 0.3
const inFlight = computed(() =>
  seen.value
    .filter((e) => e.kind === 'shot' && t.value - e.time <= FLIGHT + 0.15)
    .map((e, i) => {
      const s = e.shot!
      const from = s.source === 1 ? JET : UFO
      const to = s.source === 1 ? UFO : JET
      const hits = s.hit || e.aimed
      const p = Math.min(1.5, (t.value - e.time) / FLIGHT)
      const miss = hits ? 0 : (i % 2 ? 1 : -1) * 46
      return {
        key: `${e.time}-${s.source}-${s.slot}`,
        x: from.x + (to.x - from.x) * p,
        y: from.y + (to.y + miss - from.y) * p,
        source: s.source,
        fade: p > 1 ? 1 - (p - 1) * 2 : 1,
        hits,
      }
    })
    .filter((s) => s.fade > 0),
)
const bursts = computed(() =>
  seen.value
    .filter((e) => (e.kind === 'hit' || e.kind === 'dodged') && t.value - e.time <= 0.9)
    .map((e) => {
      const at = e.target === 0 ? UFO : JET
      const age = t.value - e.time
      return {
        key: `${e.time}-${e.target}-${e.kind}`,
        x: at.x,
        y: at.y - 20 - age * 40,
        r: 8 + age * 40,
        opacity: 1 - age / 0.9,
        text: e.kind === 'dodged' ? 'dodged' : `−${e.shot!.damage}${e.shot!.crit ? ' crit' : ''}`,
        dodged: e.kind === 'dodged',
        target: e.target,
      }
    }),
)

function describe(e: FightEvent): string {
  const s = e.shot
  const who = s?.source === 1 ? 'You' : shipName(props.ufo.type)
  switch (e.kind) {
    case 'shot':
      return `${who}: ${weaponName(s!.weapon)} ${e.aimed ? 'hits (Aim)' : s!.hit ? 'hits' : 'misses'} (${s!.toHit + 1}%)`
    case 'hit':
      return `${e.target === 0 ? `${shipName(props.ufo.type)} takes` : 'You take'} ${s!.damage}${s!.crit ? ' (critical)' : ''}, ${Math.max(0, e.hp!)} left`
    case 'dodged':
      return `Dodge cancels a hit of ${s!.damage}`
    case 'aim':
      return 'Aim: the next two misses hit'
    case 'dodge':
      return 'Dodge: the next two hits miss you'
    case 'boost':
      return 'Boost: the UFO escapes later'
    case 'abort':
      return 'Breaking off'
    default:
      return ''
  }
}
const log = computed(() =>
  seen.value
    .filter((e) => e.kind !== 'end')
    .slice(-9)
    .reverse(),
)
const outcomeText = computed(() => {
  const r = result.value
  const lost = r.craftLost ? ' Your jet is shot down.' : ''
  switch (r.outcome) {
    case 'crashed':
      return `${shipName(props.ufo.type)} down: it crashes.${lost}`
    case 'destroyed':
      return `${shipName(props.ufo.type)} destroyed in the air.${lost}`
    case 'disengaged':
      return `You break off. The UFO has ${Math.max(0, r.ufoHp)} HP left.${lost}`
    default:
      return r.craftLost
        ? `Your jet is shot down. The UFO flies on with ${Math.max(0, r.ufoHp)} HP.`
        : `The UFO outruns you with ${Math.max(0, r.ufoHp)} HP left.`
  }
})
const pctOf = (hp: number, max: number) => `${Math.max(0, Math.min(100, (hp / max) * 100))}%`
</script>

<template>
  <div class="overlay" role="dialog" aria-label="Air fight" @click.self="emit('close')">
    <div class="fight">
      <header>
        <h3>
          {{ legIndex + 1 }}/{{ legs.length }} · {{ leg.label }} ({{ leg.stance }}) vs
          {{ shipName(ufo.type) }}
        </h3>
        <button type="button" class="close" aria-label="Close" @click="emit('close')">×</button>
      </header>

      <div class="hud">
        <div class="side">
          <span class="who">You</span>
          <span class="hp"
            ><span class="hp-fill jet" :style="{ width: pctOf(hpAt(1), leg.craft.maxHp) }"
          /></span>
          <span class="v">{{ Math.max(0, hpAt(1)) }} / {{ leg.craft.maxHp }}</span>
        </div>
        <div class="clock">
          <span class="v">{{ t.toFixed(1) }} s</span>
          <span class="hp"
            ><span class="hp-fill time" :style="{ width: pctOf(escapeAt - t, escapeAt) }"
          /></span>
          <span class="muted small">escapes at {{ escapeAt.toFixed(1) }} s</span>
        </div>
        <div class="side right">
          <span class="who">{{ shipName(ufo.type) }}</span>
          <span class="hp"
            ><span class="hp-fill ufo" :style="{ width: pctOf(hpAt(0), ufo.maxHp) }"
          /></span>
          <span class="v">{{ Math.max(0, hpAt(0)) }} / {{ ufo.maxHp }}</span>
        </div>
      </div>

      <div class="screen" :class="{ game: art }">
        <span v-if="gridStyle" class="grid" :style="gridStyle" />
        <svg :viewBox="`0 0 ${W} ${H}`" class="scene" aria-hidden="true">
          <g :transform="`translate(${JET.x} ${JET.y})`" :class="{ down: hpAt(1) <= 0 }">
            <g :class="{ holo: art }">
              <image
                v-if="jetArt"
                :href="jetArt.src"
                :transform="jetArt.turned ? 'rotate(90)' : undefined"
                :x="jetArt.turned ? -32 : -64"
                :y="jetArt.turned ? -64 : -32"
                :width="jetArt.turned ? 64 : 128"
                :height="jetArt.turned ? 128 : 64"
              />
              <image
                v-else
                :href="picture(leg.craft.type)"
                x="-64"
                y="-32"
                width="128"
                height="64"
              />
            </g>
            <circle v-if="charges.dodge > 0" r="30" class="shield" />
          </g>
          <g :transform="`translate(${UFO.x} ${UFO.y})`" :class="{ down: hpAt(0) <= 0 }">
            <!-- The game's UFOs face right: turned to face the jet. -->
            <g :class="{ holo: art }" :transform="ufoArt ? 'scale(-1 1)' : undefined">
              <image
                :href="ufoArt?.src ?? picture(ufo.type)"
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
              :href="art.shot"
              :x="s.x - 9"
              :y="s.y - 9"
              width="18"
              height="18"
              :class="s.source === 1 ? 'game-shot-jet' : 'game-shot-ufo'"
              :opacity="s.fade"
            />
            <circle
              v-else
              :cx="s.x"
              :cy="s.y"
              :r="s.source === 1 ? 4 : 5"
              :class="s.source === 1 ? 'shot-jet' : 'shot-ufo'"
              :opacity="s.fade"
            />
          </template>
          <g v-for="b in bursts" :key="b.key" :opacity="b.opacity">
            <template v-if="!b.dodged">
              <image
                v-if="art && (b.target === 0 ? art.hitUfo : art.hitJet)"
                :href="(b.target === 0 ? art.hitUfo : art.hitJet)!"
                :x="(b.target === 0 ? UFO.x : JET.x) - b.r * 1.4"
                :y="(b.target === 0 ? UFO.y : JET.y) - b.r * 1.4"
                :width="b.r * 2.8"
                :height="b.r * 2.8"
                preserveAspectRatio="xMidYMid slice"
              />
              <circle
                v-else
                :cx="b.target === 0 ? UFO.x : JET.x"
                :cy="b.target === 0 ? UFO.y : JET.y"
                :r="b.r"
                class="burst"
              />
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
          :class="{ face: art && u !== 'boost', on: u !== 'boost' && charges[u] > 0 }"
          :style="u !== 'boost' && face(u) ? { backgroundImage: face(u) } : undefined"
          :disabled="!canUse(u)"
          :aria-label="`${u}: ${why(u) || 'press'}`"
          @click="use(u)"
        >
          {{ u === 'aim' ? 'Aim' : u === 'dodge' ? 'Dodge' : 'Boost' }}
          <span class="muted small">
            <template v-if="u === 'aim' && charges.aim > 0">{{ charges.aim }} left</template>
            <template v-else-if="u === 'dodge' && charges.dodge > 0"
              >{{ charges.dodge }} left</template
            >
            <template v-else>{{ why(u) }}</template>
          </span>
        </button>
        <button
          type="button"
          :class="{ face: art, abort: art }"
          :style="face('abort') ? { backgroundImage: face('abort') } : undefined"
          :disabled="over || actions.abort !== undefined"
          @click="breakOff"
        >
          Break off
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
        <button v-if="nextLeg" type="button" class="primary" @click="goNext">
          Next: {{ nextLeg.label }}
        </button>
        <button type="button" @click="again">Fly again</button>
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
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.fight {
  width: min(720px, 96vw);
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
  grid-template-columns: 1fr 1fr 1fr;
  gap: 16px;
  margin: 10px 0 4px;
  font-size: 12.5px;
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
  height: 7px;
  background: var(--lane);
  border-radius: 4px;
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
  display: block;
}
.down {
  opacity: 0.25;
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
.result .primary {
  background: var(--accent);
  color: #04131f;
  border: none;
  font-weight: 600;
}
.log {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  font-size: 12.5px;
  min-height: 9em;
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
.log li.boost {
  color: var(--accent);
}
.keys {
  margin: 6px 0 0;
}
</style>
<style src="./interception.css" scoped></style>
