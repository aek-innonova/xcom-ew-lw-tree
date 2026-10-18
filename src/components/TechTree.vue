<script setup lang="ts">
// The tree: lanes, nodes and prerequisite edges in one SVG, with pan and zoom.
// Same-lane edges are always drawn. For the focused tech (hovered, else
// selected) the tree shows, on top and across lanes, what it still needs in
// blue (the whole chain back to what the campaign has, as the planner would
// research it; direct prerequisites strongest) and what it leads to in pink.
// Nothing else changes on hover: fading the rest flickered as the mouse
// crossed the tree.

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { layoutTechs } from '@/model/layout'
import { categories } from '@/model/techs'
import { planResearch } from '@/model/plan'
import { estimate, researchContext, techState, type TechState } from '@/model/research'
import { campaign, changedByIni, plan, planSteps, state, techs } from '@/state/store'
import { edgePath, geometry, labelLines, NODE_H, NODE_W, LABEL_W } from './geometry'

const layout = computed(() => layoutTechs(techs.value, categories))
const geo = computed(() => geometry(layout.value))

const ctx = computed(() =>
  campaign.value ? researchContext(campaign.value, techs.value) : undefined,
)

interface NodeView {
  id: number
  x: number
  y: number
  name: string
  state: TechState | null
  days: string
  daysTitle: string
  alloys: number
  elerium: number
  fragments: number
  items: string | null
  progress: number
  changed: boolean
  /** Position in the research plan, if the tech is in it. */
  step?: number
  goal: boolean
}

const nodes = computed<NodeView[]>(() =>
  techs.value.map((t) => {
    const box = geo.value.nodes.get(t.id)!
    const c = campaign.value
    const st = c ? techState(t, c.researched, c.project?.tech) : null
    let days = `${t.base_days}d`
    let daysTitle = `${t.base_days} base days`
    let progress = 0
    if (c && ctx.value) {
      const est = estimate(t, c, ctx.value)
      if (est) {
        days = est.exact ? `${est.days}d` : `≈${est.days}d`
        daysTitle = est.exact
          ? `${est.days} days left (the game's own figure)`
          : `about ${est.days} days at your current research speed${est.credited ? ', with research credit' : ''}`
      }
      const cost = t.base_days * 720
      const done = c.progress[t.id] ?? 0
      if (!c.researched[t.id] && done > 0) {
        const total = c.project?.tech === t.id ? done + c.project.pointsLeft : cost
        progress = Math.min(1, done / total)
      }
    }
    return {
      id: t.id,
      x: box.x,
      y: box.y,
      name: t.name,
      state: st,
      days,
      daysTitle,
      alloys: t.cost.alloys,
      elerium: t.cost.elerium,
      fragments: t.cost.weapon_fragments,
      items: t.cost.items,
      progress,
      changed: changedByIni.value.has(t.id),
      step: planSteps.value.get(t.id),
      goal: state.goals.includes(t.id),
    }
  }),
)

interface EdgeView {
  key: string
  d: string
  any: boolean
  from: number
  to: number
}

function edgesOf(filter: (from: number, to: number) => boolean): EdgeView[] {
  const out: EdgeView[] = []
  const boxes = geo.value.nodes
  for (const t of techs.value) {
    const add = (from: number, any: boolean) => {
      if (!filter(from, t.id)) return
      const a = boxes.get(from)
      const b = boxes.get(t.id)
      if (a && b) out.push({ key: `${from}-${t.id}`, d: edgePath(a, b), any, from, to: t.id })
    }
    t.prerequisites.forEach((p) => add(p.id, false))
    t.any_one_of.forEach((p) => add(p.id, true))
  }
  return out
}

const sameLane = computed(() => {
  const placed = layout.value.placed
  return edgesOf((a, b) => placed.get(a)?.lane === placed.get(b)?.lane)
})

// Edges along the plan, between its steps.
const planEdges = computed(() => {
  const steps = planSteps.value
  if (!plan.value || !steps.size) return []
  return edgesOf((a, b) => steps.has(a) && steps.has(b))
})

const focus = computed(() => state.hovered ?? state.selected)

interface Highlight {
  /** Direct prerequisites of the focused tech (any "any one of" member included). */
  direct: Set<number>
  /** Further unresearched techs it needs, back to what the campaign has. */
  chain: Set<number>
  /** Techs that list the focused tech as a prerequisite. */
  enables: Set<number>
  directEdges: EdgeView[]
  chainEdges: EdgeView[]
  enablesEdges: EdgeView[]
}

const highlight = computed<Highlight | null>(() => {
  const f = focus.value
  if (f === null) return null
  const researched = campaign.value?.researched ?? [true]
  const tech = techs.value.find((t) => t.id === f)
  if (!tech) return null
  const direct = new Set([...tech.prerequisites, ...tech.any_one_of].map((p) => p.id))
  const chain = new Set(
    planResearch([f], techs.value, researched).steps.filter((id) => id !== f && !direct.has(id)),
  )
  const needed = new Set([...chain, ...direct].filter((id) => !researched[id]))
  const enables = new Set(
    techs.value
      .filter(
        (t) => t.prerequisites.some((p) => p.id === f) || t.any_one_of.some((p) => p.id === f),
      )
      .map((t) => t.id),
  )
  return {
    direct,
    chain,
    enables,
    directEdges: edgesOf((a, b) => b === f),
    // Into each still-needed tech, from another needed tech or from one already researched.
    chainEdges: edgesOf((a, b) => needed.has(b) && (needed.has(a) || !!researched[a])),
    enablesEdges: edgesOf((a) => a === f),
  }
})

// --- Pan and zoom ------------------------------------------------------------

const svg = ref<SVGSVGElement | null>(null)
const view = ref({ x: 0, y: 0, k: 1 })
// The tree refits when its space changes (window, detail panel) until the
// player pans or zooms; after that it stays where they put it.
let autoFit = true
const MIN_K = 0.25
const MAX_K = 2.5
const MARGIN = 16

function size() {
  const r = svg.value?.getBoundingClientRect()
  return { w: r?.width ?? 1, h: r?.height ?? 1 }
}

function fit() {
  autoFit = true
  const { w, h } = size()
  const k = Math.min(
    MAX_K,
    Math.max(
      MIN_K,
      Math.min((w - 2 * MARGIN) / geo.value.width, (h - 2 * MARGIN) / geo.value.height),
    ),
  )
  view.value = {
    k,
    x: (w - geo.value.width * k) / 2,
    y: Math.max(MARGIN, (h - geo.value.height * k) / 2),
  }
}

/** Centres a tech, after the detail panel (if it is opening) has taken its space. */
async function centerOn(id: number) {
  const box = geo.value.nodes.get(id)
  if (!box) return
  autoFit = false
  await nextTick()
  const { w, h } = size()
  const k = Math.max(view.value.k, 0.9)
  view.value = { k, x: w / 2 - (box.x + NODE_W / 2) * k, y: h / 2 - (box.y + NODE_H / 2) * k }
}

function zoomAt(px: number, py: number, factor: number) {
  autoFit = false
  const { x, y, k } = view.value
  const nk = Math.min(MAX_K, Math.max(MIN_K, k * factor))
  const f = nk / k
  view.value = { k: nk, x: px - (px - x) * f, y: py - (py - y) * f }
}

function onWheel(e: WheelEvent) {
  e.preventDefault()
  const r = svg.value!.getBoundingClientRect()
  zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015))
}

function zoomBy(factor: number) {
  const { w, h } = size()
  zoomAt(w / 2, h / 2, factor)
}

let drag: { id: number; sx: number; sy: number; vx: number; vy: number; moved: boolean } | null =
  null

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return
  drag = {
    id: e.pointerId,
    sx: e.clientX,
    sy: e.clientY,
    vx: view.value.x,
    vy: view.value.y,
    moved: false,
  }
}

function onPointerMove(e: PointerEvent) {
  if (!drag || drag.id !== e.pointerId) return
  const dx = e.clientX - drag.sx
  const dy = e.clientY - drag.sy
  if (!drag.moved && Math.hypot(dx, dy) < 4) return
  if (!drag.moved) svg.value?.setPointerCapture(e.pointerId)
  drag.moved = true
  autoFit = false
  view.value = { ...view.value, x: drag.vx + dx, y: drag.vy + dy }
}

function onPointerUp(e: PointerEvent) {
  if (!drag || drag.id !== e.pointerId) return
  const wasDrag = drag.moved
  drag = null
  if (wasDrag) return
  // A click: on a node selects it, on empty space clears the selection.
  const node = (e.target as Element).closest('[data-tech]')
  state.selected = node ? Number(node.getAttribute('data-tech')) : null
}

function onKey(e: KeyboardEvent, id: number) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    state.selected = id
  }
}

/** Pans just enough to bring a tech fully into view, if it is not. */
function ensureVisible(id: number) {
  const box = geo.value.nodes.get(id)
  if (!box) return
  const { w, h } = size()
  const { x, y, k } = view.value
  const left = x + box.x * k
  const top = y + box.y * k
  const right = left + NODE_W * k
  const bottom = top + NODE_H * k
  let dx = 0
  let dy = 0
  if (left < MARGIN) dx = MARGIN - left
  else if (right > w - MARGIN) dx = w - MARGIN - right
  if (top < MARGIN) dy = MARGIN - top
  else if (bottom > h - MARGIN) dy = h - MARGIN - bottom
  if (dx || dy) view.value = { k, x: x + dx, y: y + dy }
}

watch(
  () => state.selected,
  async (id) => {
    if (id === null || autoFit) return
    await nextTick()
    ensureVisible(id)
  },
)

let resizeObserver: ResizeObserver | undefined
onMounted(() => {
  fit()
  if (typeof ResizeObserver === 'undefined') return
  resizeObserver = new ResizeObserver(() => {
    if (autoFit) fit()
    else if (state.selected !== null) ensureVisible(state.selected)
  })
  if (svg.value) resizeObserver.observe(svg.value)
})
onBeforeUnmount(() => resizeObserver?.disconnect())

defineExpose({ fit, centerOn })

const transform = computed(
  () => `translate(${view.value.x},${view.value.y}) scale(${view.value.k})`,
)
const laneLabelX = LABEL_W - 14
</script>

<template>
  <div class="tree">
    <svg
      ref="svg"
      class="canvas"
      role="img"
      aria-label="Long War research tree"
      @wheel="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <defs>
        <marker
          id="arrow"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
        >
          <path d="M0,0 L8,4 L0,8 z" class="arrowhead" />
        </marker>
        <marker
          id="arrow-hot"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
        >
          <path d="M0,0 L8,4 L0,8 z" class="arrowhead hot" />
        </marker>
        <marker
          id="arrow-enables"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
        >
          <path d="M0,0 L8,4 L0,8 z" class="arrowhead enables" />
        </marker>
      </defs>
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

        <g class="edges">
          <path
            v-for="e in sameLane"
            :key="e.key"
            :d="e.d"
            :class="{ any: e.any }"
            marker-end="url(#arrow)"
          />
        </g>
        <g class="edges plan">
          <path
            v-for="e in planEdges"
            :key="e.key"
            :d="e.d"
            :class="{ any: e.any }"
            marker-end="url(#arrow-hot)"
          />
        </g>
        <template v-if="highlight">
          <g class="edges chain">
            <path
              v-for="e in highlight.chainEdges"
              :key="e.key"
              :d="e.d"
              :class="{ any: e.any }"
              marker-end="url(#arrow-hot)"
            />
          </g>
          <g class="edges hot">
            <path
              v-for="e in highlight.directEdges"
              :key="e.key"
              :d="e.d"
              :class="{ any: e.any }"
              marker-end="url(#arrow-hot)"
            />
          </g>
          <g class="edges enables">
            <path
              v-for="e in highlight.enablesEdges"
              :key="e.key"
              :d="e.d"
              :class="{ any: e.any }"
              marker-end="url(#arrow-enables)"
            />
          </g>
        </template>

        <g
          v-for="n in nodes"
          :key="n.id"
          class="node"
          :class="[
            n.state ?? 'neutral',
            {
              selected: state.selected === n.id,
              'needs-direct': highlight?.direct.has(n.id),
              'needs-chain': highlight?.chain.has(n.id),
              enables: highlight?.enables.has(n.id),
            },
          ]"
          :data-tech="n.id"
          tabindex="0"
          role="button"
          :aria-label="n.name"
          @mouseenter="state.hovered = n.id"
          @mouseleave="state.hovered = null"
          @keydown="onKey($event, n.id)"
        >
          <title>{{ n.name }}</title>
          <rect
            v-if="n.step || n.goal"
            class="planned"
            :x="n.x - 4"
            :y="n.y - 4"
            :width="NODE_W + 8"
            :height="NODE_H + 8"
            rx="8"
          />
          <rect class="box" :x="n.x" :y="n.y" :width="NODE_W" :height="NODE_H" rx="5" />
          <rect
            v-if="n.progress > 0"
            class="bar"
            :x="n.x + 1"
            :y="n.y + NODE_H - 4"
            :width="(NODE_W - 2) * n.progress"
            height="3"
          />
          <foreignObject :x="n.x" :y="n.y" :width="NODE_W" :height="NODE_H">
            <div class="content">
              <div class="name">
                <span v-if="n.state === 'researched'" class="tick" aria-label="researched">✓</span
                >{{ n.name }}
              </div>
              <div class="cost">
                <span class="days" :title="n.daysTitle">{{ n.days }}</span>
                <span v-if="n.alloys" class="res res-alloys" title="Alien alloys">{{
                  n.alloys
                }}</span>
                <span v-if="n.elerium" class="res res-elerium" title="Elerium">{{
                  n.elerium
                }}</span>
                <span v-if="n.fragments" class="res res-fragments" title="Weapon fragments">{{
                  n.fragments
                }}</span>
                <span v-if="n.items" class="res res-items" :title="n.items">{{ n.items }}</span>
                <span
                  v-if="n.changed"
                  class="changed"
                  title="Your DefaultGameCore.ini changes this cost"
                  >ini</span
                >
              </div>
            </div>
          </foreignObject>
          <g v-if="n.step" class="step">
            <circle :cx="n.x + NODE_W" :cy="n.y" r="10" />
            <text :x="n.x + NODE_W" :y="n.y">{{ n.step }}</text>
          </g>
          <text v-else-if="n.goal" class="goal-star" :x="n.x + NODE_W" :y="n.y">★</text>
        </g>
      </g>
    </svg>

    <div class="zoom" role="group" aria-label="Zoom">
      <button type="button" title="Zoom in" @click="zoomBy(1.25)">+</button>
      <button type="button" title="Zoom out" @click="zoomBy(0.8)">−</button>
      <button type="button" title="Fit the whole tree" @click="fit">Fit</button>
    </div>
  </div>
</template>

<style scoped>
.tree {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
}
.canvas {
  width: 100%;
  height: 100%;
  display: block;
  cursor: grab;
  touch-action: none;
  user-select: none;
}
.canvas:active {
  cursor: grabbing;
}

.lane rect {
  fill: var(--lane);
}
.lane.odd rect {
  fill: var(--lane-alt);
}
.lane-label {
  fill: var(--muted);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  text-anchor: end;
  dominant-baseline: middle;
}

.edges path {
  fill: none;
  stroke: var(--edge);
  stroke-width: 1.4;
}
.edges path.any {
  stroke-dasharray: 5 4;
}
.edges.plan path {
  stroke: var(--accent);
  stroke-width: 1.6;
  opacity: 0.8;
}
.edges.chain path {
  stroke: var(--accent);
  stroke-width: 1.6;
  opacity: 0.6;
}
.edges.hot path {
  stroke: var(--accent);
  stroke-width: 2.2;
}
.edges.enables path {
  stroke: var(--enables);
  stroke-width: 2.2;
}
.arrowhead {
  fill: var(--edge);
}
.arrowhead.hot {
  fill: var(--accent);
}
.arrowhead.enables {
  fill: var(--enables);
}

.node {
  cursor: pointer;
  outline: none;
}
.node .box {
  fill: var(--node);
  stroke: var(--node-border);
  stroke-width: 1.2;
}
.node:hover .box,
.node:focus-visible .box {
  stroke: var(--accent);
}
.node.selected .box {
  stroke: var(--accent);
  stroke-width: 2.5;
}

.node.researched .box {
  fill: var(--done);
  stroke: var(--done-border);
}
.node.researching .box {
  stroke: var(--progress);
  stroke-width: 2.2;
}
.node.available .box {
  stroke: var(--available);
  stroke-width: 1.8;
}
.node.locked .box {
  fill: var(--locked);
}
.node.locked .content {
  opacity: 0.65;
}
.bar {
  fill: var(--progress);
}
/* Focus highlights glow rather than recolour the border, which already
   carries the tech's state (available is blue too). After the state rules. */
.node.needs-direct .box {
  stroke: var(--accent);
  filter: drop-shadow(0 0 5px var(--accent));
}
.node.needs-chain .box {
  filter: drop-shadow(0 0 4px rgb(76 195 239 / 0.6));
}
.node.enables .box {
  stroke: var(--enables);
  filter: drop-shadow(0 0 5px var(--enables));
}
.planned {
  fill: none;
  stroke: var(--accent);
  stroke-width: 1.5;
  stroke-dasharray: 4 3;
}
.step circle {
  fill: var(--accent);
}
.step text,
.goal-star {
  font-size: 11px;
  font-weight: 700;
  text-anchor: middle;
  dominant-baseline: central;
}
.step text {
  fill: var(--bg);
}
.goal-star {
  font-size: 16px;
  fill: var(--accent);
}

.content {
  box-sizing: border-box;
  height: 100%;
  padding: 5px 9px 6px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  pointer-events: none;
}
.name {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text);
}
.tick {
  color: var(--done-text);
  margin-right: 4px;
}
.cost {
  display: flex;
  gap: 7px;
  align-items: baseline;
  font-size: 11.5px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
}
.days {
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.res-items {
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.changed {
  margin-left: auto;
  font-size: 10px;
  color: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 3px;
  padding: 0 3px;
}

.zoom {
  position: absolute;
  right: 12px;
  bottom: 12px;
  display: flex;
  gap: 4px;
}
.zoom button {
  min-width: 32px;
  height: 30px;
}
</style>
