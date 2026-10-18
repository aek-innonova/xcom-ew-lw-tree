<script setup lang="ts">
// When each tech was finished, from the current save alone (every save keeps
// the completion date of every tech): a row per research category, a dot per
// tech on the campaign's timeline. Hover or focus a dot for the tech and date.

import { computed, ref } from 'vue'
import { useWidth } from './useWidth'
import { formatCampaignDay, monthTicks } from '@/model/history'
import type { Tech } from '@/model/techs'

const props = defineProps<{
  techs: Tech[]
  categories: string[]
  researchedOn: (number | undefined)[]
  xDomain: [number, number]
}>()

const ROW = 26
const M = { left: 150, right: 24, top: 8, bottom: 24 }
const plotEl = ref<HTMLElement | null>(null)
const width = useWidth(plotEl, 1200)
const W = computed(() => Math.max(400, width.value))
const H = computed(() => M.top + props.categories.length * ROW + M.bottom)
const plotW = computed(() => W.value - M.left - M.right)

const sx = (x: number) => {
  const [a, b] = props.xDomain
  return M.left + (b > a ? ((x - a) / (b - a)) * plotW.value : plotW.value / 2)
}

const dots = computed(() =>
  props.techs
    .filter((t) => props.researchedOn[t.id] !== undefined)
    .map((t) => ({
      id: t.id,
      name: t.name,
      day: props.researchedOn[t.id]!,
      row: props.categories.indexOf(t.category),
    }))
    .filter((d) => d.row >= 0)
    .sort((a, b) => a.day - b.day),
)
const xTicks = computed(() => monthTicks(props.xDomain[0], props.xDomain[1], 12))
const hovered = ref<number | null>(null)
const tip = computed(() => dots.value.find((d) => d.id === hovered.value))
</script>

<template>
  <figure class="chart">
    <figcaption>Research finished, by category ({{ dots.length }} techs)</figcaption>
    <div ref="plotEl" class="plot">
      <svg
        :viewBox="`0 0 ${W} ${H}`"
        :width="W"
        :height="H"
        role="img"
        aria-label="When each tech was finished"
      >
        <g v-for="(c, i) in categories" :key="c">
          <line
            class="row"
            :x1="M.left"
            :x2="W - M.right"
            :y1="M.top + i * ROW + ROW / 2"
            :y2="M.top + i * ROW + ROW / 2"
          />
          <text class="cat" :x="M.left - 10" :y="M.top + i * ROW + ROW / 2">{{ c }}</text>
        </g>
        <g class="axis">
          <line
            v-for="t in xTicks"
            :key="t.day"
            class="tick"
            :x1="sx(t.day)"
            :x2="sx(t.day)"
            :y1="M.top"
            :y2="H - M.bottom"
          />
          <text v-for="t in xTicks" :key="`l${t.day}`" :x="sx(t.day)" :y="H - 6">
            {{ t.label }}
          </text>
        </g>
        <g
          v-for="d in dots"
          :key="d.id"
          class="dot"
          :class="{ on: hovered === d.id }"
          tabindex="0"
          role="img"
          :aria-label="`${d.name}, finished ${formatCampaignDay(d.day)}`"
          @pointerenter="hovered = d.id"
          @pointerleave="hovered = null"
          @focus="hovered = d.id"
          @blur="hovered = null"
        >
          <circle class="hit" :cx="sx(d.day)" :cy="M.top + d.row * ROW + ROW / 2" r="11" />
          <circle class="mark" :cx="sx(d.day)" :cy="M.top + d.row * ROW + ROW / 2" r="5" />
        </g>
      </svg>
      <div
        v-if="tip"
        class="tooltip"
        :style="{
          left: `${(sx(tip.day) / W) * 100}%`,
          top: `${((M.top + tip.row * ROW) / H) * 100}%`,
        }"
        role="status"
      >
        <strong>{{ tip.name }}</strong>
        <div class="when">{{ formatCampaignDay(tip.day) }}</div>
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
}
.plot {
  position: relative;
  margin-top: 6px;
}
svg {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
}
.row {
  stroke: var(--border);
  stroke-width: 1;
}
.cat {
  fill: var(--muted);
  font-size: 12px;
  text-anchor: end;
  dominant-baseline: middle;
}
.tick {
  stroke: var(--border);
  stroke-width: 1;
}
.axis text {
  fill: var(--muted);
  font-size: 11px;
  text-anchor: middle;
}
.dot {
  outline: none;
  cursor: default;
}
.hit {
  fill: transparent;
}
.mark {
  fill: #3987e5;
  stroke: var(--panel);
  stroke-width: 2;
}
.dot.on .mark,
.dot:focus-visible .mark {
  fill: #6aa8ef;
}
.tooltip {
  position: absolute;
  transform: translate(-50%, -110%);
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
</style>
