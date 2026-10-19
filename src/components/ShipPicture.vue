<script setup lang="ts">
// A ship's picture, a UFO or one of our jets: on the website our own render
// (scripts/ufo_art.py, public/ships), not the game's art; in the desktop app,
// with a game to read, the game's own interception pictures
// (features/game-images.md). UFOs scaled by size class so a Scout looks
// smaller than a Battleship.

import { computed } from 'vue'
import data from '../../data/airwar.json'
import { gameImages, shipPicture } from '@/state/gameimages'

const props = defineProps<{ type: number; size?: string }>()

const SCALE: Record<string, number> = { small: 0.7, medium: 0.82, large: 0.92, very_large: 1 }
const image = (type: number) =>
  (data.ships as { id: number; image?: number }[]).find((s) => s.id === type)?.image
const src = computed(
  () =>
    (gameImages.version >= 0 && shipPicture(image(props.type))) ||
    `${import.meta.env.BASE_URL}ships/${props.type}.webp`,
)
const scale = computed(() => (props.size ? (SCALE[props.size] ?? 0.85) : 1))
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
