<script setup lang="ts">
// A small line chart over campaign days: 2px lines, a hairline grid, the last
// value labelled at the line's end, a crosshair that snaps to the nearest save
// with one tooltip listing every series (also by keyboard: focus the chart and
// use the arrow keys). One measure per chart; two series only when they share a
// unit (then with a legend).

import { computed, ref } from 'vue'
import { useWidth } from './useWidth'
import { formatCampaignDay, monthTicks } from '@/model/history'

export interface Series {
  name: string
  color: string
  points: { x: number; y: number }[]
}

const props = defineProps<{
  title: string
  series: Series[]
  xDomain: [number, number]
  /** Steps rather than slopes, for counts that change in jumps. */
  step?: boolean
  /** Draw the zero line (for measures that go negative). */
  zero?: boolean
}>()

const plotEl = ref<HTMLElement | null>(null)
const width = useWidth(plotEl, 400)
const H = 170
const M = { left: 38, right: 40, top: 10, bottom: 22 }
const W = computed(() => Math.max(200, width.value))
const plotW = computed(() => W.value - M.left - M.right)
const plotH = H - M.top - M.bottom

const allY = computed(() => props.series.flatMap((s) => s.points.map((p) => p.y)))

/** Clean y ticks covering the data (and zero). */
const yTicks = computed(() => {
  const ys = allY.value
  let lo = Math.min(0, ...ys)
  let hi = Math.max(1, ...ys)
  const raw = (hi - lo) / 3
  const mag = 10 ** Math.floor(Math.log10(raw || 1))
  const stepSize = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  lo = Math.floor(lo / stepSize) * stepSize
  hi = Math.ceil(hi / stepSize) * stepSize
  const ticks: number[] = []
  for (let v = lo; v <= hi + 1e-9; v += stepSize) ticks.push(Math.round(v * 1000) / 1000)
  return ticks
})
const yLo = computed(() => yTicks.value[0]!)
const yHi = computed(() => yTicks.value[yTicks.value.length - 1]!)

const sx = (x: number) => {
  const [a, b] = props.xDomain
  return M.left + (b > a ? ((x - a) / (b - a)) * plotW.value : plotW.value / 2)
}
const sy = (y: number) => M.top + plotH - ((y - yLo.value) / (yHi.value - yLo.value || 1)) * plotH

function path(points: { x: number; y: number }[]): string {
  let d = ''
  points.forEach((p, i) => {
    const x = sx(p.x)
    const y = sy(p.y)
    if (i === 0) d += `M${x},${y}`
    else if (props.step) d += ` H${x} V${y}`
    else d += ` L${x},${y}`
  })
  return d
}

const xTicks = computed(() => monthTicks(props.xDomain[0], props.xDomain[1], 6))
const compact = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10}K` : String(v))

// --- Hover / focus -----------------------------------------------------------

/** All x positions with a value, merged across series. */
const xs = computed(() =>
  [...new Set(props.series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b),
)
const hoverIndex = ref<number | null>(null)
const hoverX = computed(() => (hoverIndex.value === null ? null : xs.value[hoverIndex.value]))

function nearestIndex(x: number): number {
  let best = 0
  xs.value.forEach((v, i) => {
    if (Math.abs(v - x) < Math.abs(xs.value[best]! - x)) best = i
  })
  return best
}

function onMove(e: PointerEvent) {
  const svg = e.currentTarget as SVGSVGElement
  const r = svg.getBoundingClientRect()
  const px = ((e.clientX - r.left) / r.width) * W.value
  const [a, b] = props.xDomain
  const x = a + ((px - M.left) / plotW.value) * (b - a)
  if (xs.value.length) hoverIndex.value = nearestIndex(x)
}

function onKey(e: KeyboardEvent) {
  if (!xs.value.length) return
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault()
    const i = hoverIndex.value ?? (e.key === 'ArrowRight' ? -1 : xs.value.length)
    hoverIndex.value = Math.min(
      xs.value.length - 1,
      Math.max(0, i + (e.key === 'ArrowRight' ? 1 : -1)),
    )
  } else if (e.key === 'Escape') hoverIndex.value = null
}

/** Each series' value at the hovered x: its last point at or before it. */
const readout = computed(() => {
  const x = hoverX.value
  if (x === undefined || x === null) return null
  return {
    x,
    rows: props.series.map((s) => {
      const before = s.points.filter((p) => p.x <= x)
      return {
        name: s.name,
        color: s.color,
        y: before.length ? before[before.length - 1]!.y : undefined,
      }
    }),
  }
})
const tooltipLeft = computed(() => (hoverX.value == null ? 0 : (sx(hoverX.value) / W.value) * 100))
const last = (s: Series) => s.points[s.points.length - 1]
</script>

<template>
  <figure class="chart">
    <figcaption>{{ title }}</figcaption>
    <div v-if="series.length > 1" class="legend">
      <span v-for="s in series" :key="s.name"
        ><i :style="{ background: s.color }"></i>{{ s.name }}</span
      >
    </div>
    <div ref="plotEl" class="plot">
      <svg
        :viewBox="`0 0 ${W} ${H}`"
        :width="W"
        :height="H"
        role="img"
        :aria-label="`${title} over the campaign`"
        tabindex="0"
        @pointermove="onMove"
        @pointerleave="hoverIndex = null"
        @keydown="onKey"
        @blur="hoverIndex = null"
      >
        <g class="grid">
          <line
            v-for="t in yTicks"
            :key="t"
            :x1="M.left"
            :x2="W - M.right"
            :y1="sy(t)"
            :y2="sy(t)"
          />
        </g>
        <line
          v-if="zero && yLo < 0"
          class="zero"
          :x1="M.left"
          :x2="W - M.right"
          :y1="sy(0)"
          :y2="sy(0)"
        />
        <g class="axis">
          <text v-for="t in yTicks" :key="t" :x="M.left - 6" :y="sy(t)" class="y">
            {{ compact(t) }}
          </text>
          <text v-for="t in xTicks" :key="t.day" :x="sx(t.day)" :y="H - 6" class="x">
            {{ t.label }}
          </text>
        </g>
        <g v-for="s in series" :key="s.name">
          <path :d="path(s.points)" class="line" :style="{ stroke: s.color }" />
          <template v-if="last(s)">
            <circle
              :cx="sx(last(s)!.x)"
              :cy="sy(last(s)!.y)"
              r="4"
              class="end"
              :style="{ fill: s.color }"
            />
            <text :x="sx(last(s)!.x) + 8" :y="sy(last(s)!.y)" class="end-label">
              {{ compact(last(s)!.y) }}
            </text>
          </template>
        </g>
        <g v-if="readout">
          <line
            class="crosshair"
            :x1="sx(readout.x)"
            :x2="sx(readout.x)"
            :y1="M.top"
            :y2="M.top + plotH"
          />
          <template v-for="r in readout.rows" :key="r.name">
            <circle
              v-if="r.y !== undefined"
              :cx="sx(readout.x)"
              :cy="sy(r.y)"
              r="4"
              class="end"
              :style="{ fill: r.color }"
            />
          </template>
        </g>
      </svg>
      <div v-if="readout" class="tooltip" :style="{ left: `${tooltipLeft}%` }" role="status">
        <div class="when">{{ formatCampaignDay(readout.x) }}</div>
        <div v-for="r in readout.rows" :key="r.name" class="row">
          <i :style="{ background: r.color }"></i><strong>{{ r.y ?? '–' }}</strong>
          <span v-if="series.length > 1">{{ r.name }}</span>
        </div>
      </div>
    </div>
  </figure>
</template>

<style scoped>
.chart {
  margin: 0;
  padding: 12px 14px 10px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
}
figcaption {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.legend {
  display: flex;
  gap: 14px;
  margin-top: 4px;
  font-size: 12px;
  color: var(--muted);
}
.legend i,
.row i {
  display: inline-block;
  width: 12px;
  height: 2px;
  margin-right: 5px;
  vertical-align: middle;
  border-radius: 1px;
}
.plot {
  position: relative;
  margin-top: 6px;
}
svg {
  display: block;
  width: 100%;
  height: auto;
  outline: none;
  overflow: visible;
}
svg:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: 2px;
}
.grid line {
  stroke: var(--border);
  stroke-width: 1;
}
.zero {
  stroke: var(--muted);
  stroke-width: 1;
}
.axis text {
  fill: var(--muted);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
}
.axis .y {
  text-anchor: end;
  dominant-baseline: middle;
}
.axis .x {
  text-anchor: middle;
}
.line {
  fill: none;
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.end {
  stroke: var(--panel);
  stroke-width: 2;
}
.end-label {
  fill: var(--text);
  font-size: 11px;
  dominant-baseline: middle;
  font-variant-numeric: tabular-nums;
}
.crosshair {
  stroke: var(--muted);
  stroke-width: 1;
}
.tooltip {
  position: absolute;
  top: -6px;
  transform: translateX(-50%);
  padding: 6px 9px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 5px;
  font-size: 12px;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.4);
}
.when {
  color: var(--muted);
  font-size: 11px;
}
.row strong {
  margin-right: 6px;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.row span {
  color: var(--muted);
}
</style>
