<script setup lang="ts">
// A drawn outline of each UFO type, ours, not the game's art (which stays
// Firaxis's): the families the game's own pictures group them in (Scout and
// Fighter, Destroyer and Raider, Abductor and Harvester, Transport and Terror
// Ship, Battleship and Assault Carrier, Overseer), told apart by details,
// and scaled by size class.

import { computed } from 'vue'

const props = defineProps<{ type: number; size: string }>()

const SCALE: Record<string, number> = { small: 0.66, medium: 0.8, large: 0.9, very_large: 1 }
const scale = computed(() => SCALE[props.size] ?? 0.7)
</script>

<template>
  <svg viewBox="-60 -30 120 60" class="ufo" aria-hidden="true">
    <g :transform="`scale(${scale})`">
      <!-- Scout -->
      <template v-if="type === 4">
        <ellipse rx="44" ry="11" class="hull" />
        <ellipse cy="-8" rx="17" ry="11" class="dome" />
        <ellipse cy="5" rx="12" ry="3" class="glow" />
      </template>
      <!-- Fighter: the scout's disc with swept fins -->
      <template v-else-if="type === 10">
        <path d="M -20 -2 L -54 -18 L -40 4 Z M 20 -2 L 54 -18 L 40 4 Z" class="hull" />
        <ellipse rx="40" ry="10" class="hull" />
        <ellipse cy="-7" rx="13" ry="9" class="dome" />
        <ellipse cy="5" rx="10" ry="3" class="glow" />
      </template>
      <!-- Destroyer: a wider disc with weapon pods -->
      <template v-else-if="type === 5">
        <ellipse rx="50" ry="12" class="hull" />
        <rect x="-58" y="-5" width="16" height="10" rx="3" class="dome" />
        <rect x="42" y="-5" width="16" height="10" rx="3" class="dome" />
        <ellipse cy="-9" rx="20" ry="10" class="dome" />
        <ellipse cy="6" rx="16" ry="3" class="glow" />
      </template>
      <!-- Raider: a disc on a long spine -->
      <template v-else-if="type === 11">
        <rect x="-56" y="-3" width="112" height="6" rx="3" class="dome" />
        <ellipse rx="34" ry="11" class="hull" />
        <ellipse cy="-8" rx="14" ry="9" class="dome" />
        <ellipse cy="5" rx="10" ry="3" class="glow" />
      </template>
      <!-- Overseer: a long lens around a bright core -->
      <template v-else-if="type === 9">
        <path d="M -58 0 Q 0 -26 58 0 Q 0 26 -58 0 Z" class="hull" />
        <path d="M -30 0 Q 0 -12 30 0 Q 0 12 -30 0 Z" class="dome" />
        <circle r="6" class="glow" />
      </template>
      <!-- Abductor: a thick disc with an underside ring -->
      <template v-else-if="type === 6">
        <ellipse cy="4" rx="40" ry="12" class="glow-soft" />
        <ellipse rx="50" ry="15" class="hull" />
        <ellipse cy="-12" rx="26" ry="12" class="dome" />
        <ellipse cy="10" rx="24" ry="5" class="glow" />
      </template>
      <!-- Harvester: the abductor's hull with hanging arms -->
      <template v-else-if="type === 12">
        <path d="M -24 6 L -32 26 M -8 8 L -10 28 M 8 8 L 10 28 M 24 6 L 32 26" class="arms" />
        <ellipse rx="48" ry="14" class="hull" />
        <ellipse cy="-11" rx="22" ry="11" class="dome" />
      </template>
      <!-- Transport: a long boxy hull -->
      <template v-else-if="type === 7">
        <path
          d="M -56 -6 L -44 -16 L 44 -16 L 56 -6 L 56 8 L 44 16 L -44 16 L -56 8 Z"
          class="hull"
        />
        <rect x="-36" y="-10" width="72" height="8" rx="2" class="dome" />
        <rect x="-30" y="6" width="60" height="4" rx="2" class="glow" />
      </template>
      <!-- Terror Ship: the transport's hull with spikes -->
      <template v-else-if="type === 13">
        <path
          d="M -40 -14 L -46 -26 L -30 -16 M 0 -16 L 0 -29 M 40 -14 L 46 -26 L 30 -16"
          class="arms"
        />
        <path
          d="M -56 -6 L -44 -16 L 44 -16 L 56 -6 L 56 8 L 44 16 L -44 16 L -56 8 Z"
          class="hull"
        />
        <rect x="-36" y="-10" width="72" height="8" rx="2" class="dome" />
        <rect x="-30" y="6" width="60" height="4" rx="2" class="glow" />
      </template>
      <!-- Battleship: a tiered giant -->
      <template v-else-if="type === 8">
        <ellipse cy="6" rx="58" ry="14" class="hull" />
        <ellipse cy="-4" rx="44" ry="12" class="hull" />
        <ellipse cy="-14" rx="26" ry="10" class="dome" />
        <circle cx="-30" cy="8" r="3" class="glow" />
        <circle cx="0" cy="12" r="3" class="glow" />
        <circle cx="30" cy="8" r="3" class="glow" />
      </template>
      <!-- Assault Carrier: the battleship hull with a hangar bay -->
      <template v-else-if="type === 14">
        <ellipse cy="6" rx="58" ry="14" class="hull" />
        <ellipse cy="-4" rx="44" ry="12" class="hull" />
        <rect x="-18" y="-4" width="36" height="12" rx="2" class="bay" />
        <ellipse cy="-14" rx="22" ry="8" class="dome" />
      </template>
      <ellipse v-else rx="44" ry="12" class="hull" />
    </g>
  </svg>
</template>

<style scoped>
.ufo {
  width: 100%;
  height: 100%;
  display: block;
}
.hull {
  fill: #c86aa6;
}
.dome {
  fill: #f0a9d6;
}
.glow {
  fill: #ffe08a;
}
.glow-soft {
  fill: #ffe08a;
  opacity: 0.25;
}
.bay {
  fill: #2a1626;
}
.arms {
  fill: none;
  stroke: #c86aa6;
  stroke-width: 4;
  stroke-linecap: round;
}
</style>
