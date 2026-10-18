<script setup lang="ts">
// The Foundry board: a lane per Foundry category, each project right of the
// tech it needs (columns line up with the research tree), in the same visual
// language as the tree. Resting on a project opens its box with the full cost,
// the tech it needs and its effect.

import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { foundryCategories, foundryState, layoutFoundry, type FoundryState } from '@/model/foundry'
import { layoutTechs } from '@/model/layout'
import { categories } from '@/model/techs'
import {
  campaign,
  changedFoundryByIni,
  foundry,
  foundryReduction,
  state,
  techById,
  techs,
} from '@/state/store'
import { geometry, labelLines, LABEL_W, NODE_H, NODE_W } from './geometry'
import { usePanZoom } from './usePanZoom'

const techLayout = computed(() => layoutTechs(techs.value, categories))
const layout = computed(() =>
  layoutFoundry(
    foundry.value,
    foundryCategories,
    (id) => techLayout.value.placed.get(id)?.column ?? 0,
  ),
)
const geo = computed(() => geometry(layout.value))

interface ProjectView {
  id: number
  x: number
  y: number
  name: string
  state: FoundryState | null
  days: number
  engineers: number
  cash: number
  alloys: number
  elerium: number
  fragments: number
  meld: number
  items: string[]
  tech: string
  techState: 'researched' | 'missing' | null
  changed: boolean
  goal: boolean
  building?: { engineers: number }
  label: string
}

const projects = computed<ProjectView[]>(() => {
  const c = campaign.value
  const building = new Map((c?.foundryInProgress ?? []).map((b) => [b.id, b]))
  return foundry.value.map((p) => {
    const box = geo.value.nodes.get(p.id)!
    const st = c ? foundryState(p, c.foundryHistory, new Set(building.keys()), c.researched) : null
    const tech = p.requires_tech
      ? (techById.value.get(p.requires_tech.id)?.name ?? p.requires_tech.name)
      : ''
    const techDone = c && p.requires_tech ? !!c.researched[p.requires_tech.id] : null
    return {
      id: p.id,
      x: box.x,
      y: box.y,
      name: p.name,
      state: st,
      days: p.base_days,
      engineers: p.engineers,
      cash: p.cost.cash,
      alloys: p.cost.alloys,
      elerium: p.cost.elerium,
      fragments: p.cost.weapon_fragments,
      meld: p.cost.meld,
      items: p.cost.items,
      tech,
      techState: techDone === null ? null : techDone ? 'researched' : 'missing',
      changed: changedFoundryByIni.value.has(p.id),
      goal: state.foundryGoals.includes(p.id),
      building: building.get(p.id) && { engineers: building.get(p.id)!.engineers },
      label: [
        p.name,
        st === 'building' ? 'being built' : st,
        `${p.base_days} days base time`,
        `${p.engineers} engineers`,
        p.cost.cash && `${p.cost.cash} cash`,
        p.cost.alloys && `${p.cost.alloys} alloys`,
        p.cost.elerium && `${p.cost.elerium} elerium`,
        p.cost.weapon_fragments && `${p.cost.weapon_fragments} weapon fragments`,
        p.cost.meld && `${p.cost.meld} meld`,
        ...p.cost.items,
        tech && `needs ${tech}`,
      ]
        .filter(Boolean)
        .join(', '),
    }
  })
})

const svg = ref<SVGSVGElement | null>(null)
const {
  panning,
  transform,
  fit,
  centerOn,
  zoomBy,
  onWheel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
} = usePanZoom({
  svg,
  geo,
  selected: () => state.selectedFoundry,
  onClick: (target) => {
    const node = target.closest('[data-foundry]')
    state.selectedFoundry = node ? Number(node.getAttribute('data-foundry')) : null
  },
})

function onKey(e: KeyboardEvent, id: number) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    state.selectedFoundry = id
  }
}

// The opened box, as on the research tree.
const CARD_MAX_H = 420
const CARD_PAD = 10
const CARD_DELAY_MS = 280
const cardId = ref<number | null>(null)
let cardTimer: ReturnType<typeof setTimeout> | undefined
watch(
  () => state.hoveredFoundry,
  (id) => {
    clearTimeout(cardTimer)
    cardId.value = null
    if (id !== null) cardTimer = setTimeout(() => (cardId.value = id), CARD_DELAY_MS)
  },
)
onBeforeUnmount(() => clearTimeout(cardTimer))

const card = computed(() => {
  const id = cardId.value
  if (id === null || panning.value) return null
  const n = projects.value.find((v) => v.id === id)
  const p = foundry.value.find((v) => v.id === id)
  if (!n || !p) return null
  const up = n.y + NODE_H / 2 > geo.value.height * 0.6
  return {
    node: n,
    effect: p.effect,
    credit: p.research_credit,
    x: n.x - CARD_PAD,
    y: up ? n.y + NODE_H - CARD_MAX_H : n.y,
    up,
  }
})

defineExpose({ fit, centerOn })
const laneLabelX = LABEL_W - 14
const stateClass = (s: FoundryState | null) =>
  s === 'done' ? 'researched' : s === 'building' ? 'researching' : (s ?? 'neutral')
</script>

<template>
  <div class="tree">
    <svg
      ref="svg"
      class="canvas"
      role="img"
      aria-label="Long War Foundry projects"
      @wheel="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <g :transform="transform">
        <g v-for="(lane, i) in geo.lanes" :key="lane.category" class="lane" :class="{ odd: i % 2 }">
          <rect :x="0" :y="lane.y" :width="geo.width" :height="lane.height" rx="6" />
          <text :x="laneLabelX" :y="lane.y + lane.height / 2" class="lane-label">
            <tspan
              v-for="(line, w) in labelLines(lane.category)"
              :key="w"
              :x="laneLabelX"
              :dy="w === 0 ? `${-(labelLines(lane.category).length - 1) * 0.6}em` : '1.2em'"
            >
              {{ line }}
            </tspan>
          </text>
        </g>

        <g
          v-for="n in projects"
          :key="n.id"
          class="node"
          :class="[stateClass(n.state), { selected: state.selectedFoundry === n.id }]"
          :data-foundry="n.id"
          tabindex="0"
          role="button"
          :aria-label="n.label"
          @mouseenter="state.hoveredFoundry = n.id"
          @mouseleave="state.hoveredFoundry = null"
          @keydown="onKey($event, n.id)"
        >
          <rect
            v-if="n.goal"
            class="planned"
            :x="n.x - 4"
            :y="n.y - 4"
            :width="NODE_W + 8"
            :height="NODE_H + 8"
            rx="8"
          />
          <rect class="box" :x="n.x" :y="n.y" :width="NODE_W" :height="NODE_H" rx="5" />
          <foreignObject :x="n.x" :y="n.y" :width="NODE_W" :height="NODE_H">
            <div class="content">
              <div class="name">
                <span v-if="n.state === 'done'" class="tick">✓</span>{{ n.name }}
              </div>
              <div class="cost">
                <span class="days">{{ n.days }}d</span>
                <span v-if="n.cash" class="cash">${{ n.cash }}</span>
                <span v-if="n.alloys" class="res res-alloys">{{ n.alloys }}</span>
                <span v-if="n.elerium" class="res res-elerium">{{ n.elerium }}</span>
                <span v-if="n.fragments" class="res res-fragments">{{ n.fragments }}</span>
                <span v-if="n.meld" class="res res-meld">{{ n.meld }}</span>
                <span v-if="n.changed" class="changed">ini</span>
              </div>
            </div>
          </foreignObject>
          <text v-if="n.goal" class="goal-star foundry-star" :x="n.x + NODE_W" :y="n.y">★</text>
        </g>

        <foreignObject
          v-if="card"
          class="card-layer"
          :x="card.x"
          :y="card.y"
          :width="NODE_W + 2 * CARD_PAD"
          :height="CARD_MAX_H"
        >
          <div class="card-wrap" :class="{ up: card.up }">
            <div class="card" :class="[stateClass(card.node.state), { up: card.up }]">
              <div class="content card-head">
                <div class="name">
                  <span v-if="card.node.state === 'done'" class="tick">✓</span>{{ card.node.name }}
                </div>
                <div class="cost">
                  <span class="days">{{ card.node.days }}d</span>
                  <span v-if="card.node.cash" class="cash">${{ card.node.cash }}</span>
                  <span v-if="card.node.alloys" class="res res-alloys">{{ card.node.alloys }}</span>
                  <span v-if="card.node.elerium" class="res res-elerium">{{
                    card.node.elerium
                  }}</span>
                  <span v-if="card.node.fragments" class="res res-fragments">{{
                    card.node.fragments
                  }}</span>
                  <span v-if="card.node.meld" class="res res-meld">{{ card.node.meld }}</span>
                </div>
              </div>
              <div class="card-body">
                <div class="card-days">
                  {{ card.node.days }} days base time, {{ card.node.engineers }} engineers
                </div>
                <div v-if="card.node.building" class="card-days">
                  Being built with {{ card.node.building.engineers }} engineers
                </div>
                <div v-for="it in card.node.items" :key="it" class="res res-items card-items">
                  {{ it }}
                </div>
                <div v-if="card.node.tech" class="card-needs" :class="card.node.techState">
                  Needs {{ card.node.tech }}
                </div>
                <div v-if="card.credit" class="card-credit">Credit: {{ card.credit }}</div>
                <div v-if="foundryReduction" class="card-credit">
                  New Warfare: {{ Math.round(foundryReduction * 100) }}% off cash, alloys and
                  elerium
                </div>
                <p class="card-effect">{{ card.effect }}</p>
              </div>
            </div>
          </div>
        </foreignObject>
      </g>
    </svg>

    <div class="zoom" role="group" aria-label="Zoom">
      <button type="button" title="Zoom in" @click="zoomBy(1.25)">+</button>
      <button type="button" title="Zoom out" @click="zoomBy(0.8)">−</button>
      <button type="button" title="Fit the whole board" @click="fit">Fit</button>
    </div>
  </div>
</template>

<style src="./board.css"></style>
<style>
.cash {
  color: var(--cash);
  font-variant-numeric: tabular-nums;
}
.card-needs {
  margin-top: 4px;
}
.card-needs.researched::before {
  content: '✓ ';
  color: var(--done-text);
}
.card-needs.missing {
  color: var(--progress);
}
.card-effect {
  margin: 6px 0 0;
  padding-top: 5px;
  border-top: 1px solid var(--border);
  line-height: 1.4;
}
.card.up .card-effect {
  padding-bottom: 5px;
  border-bottom: 1px solid var(--border);
}
.foundry-star {
  fill: var(--foundry);
}
</style>
