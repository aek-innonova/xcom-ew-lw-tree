<script setup lang="ts">
// A UFO's picture: our own render (scripts/ufo_art.py, public/ufos), not the
// game's art, scaled by size class so a Scout looks smaller than a Battleship.

import { computed } from 'vue'

const props = defineProps<{ type: number; size: string }>()

const SCALE: Record<string, number> = { small: 0.7, medium: 0.82, large: 0.92, very_large: 1 }
const src = computed(() => `${import.meta.env.BASE_URL}ufos/${props.type}.webp`)
const scale = computed(() => SCALE[props.size] ?? 0.85)
</script>

<template>
  <img :src="src" alt="" class="ufo" :style="{ transform: `scale(${scale})` }" />
</template>

<style scoped>
.ufo {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
</style>
