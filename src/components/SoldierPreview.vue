<script setup lang="ts">
// A soldier in a class's colors, beside the class color settings
// (features/game-soldiers.md, features/game-settings.md): choose the armor,
// the gender and whose color to see; the soldier follows the setting's value,
// yours or the version's own.

import { computed, ref, shallowRef, watch } from 'vue'
import type { FoundSetting } from '@/model/gamesettings'
import type { PaletteEntry } from '@/model/material'
import {
  ARMORS,
  armorPalette,
  gameLooks,
  loadSoldier,
  type Looks,
  tintFor,
  type Armor,
  type Gender,
  type Soldier,
} from '@/state/soldier'
import { tools } from '@/state/tools'
import SoldierView from './SoldierView.vue'

const props = defineProps<{ colors: FoundSetting[]; headgear: FoundSetting[] }>()

const armor = ref<Armor>('Kevlar')
const gender = ref<Gender>('Male')
const whose = ref(props.colors[0]?.id ?? '')
const head = ref(0)
const hair = ref(0)
const looks = shallowRef<Looks>({ heads: [], hair: [] })
void gameLooks().then((l) => (looks.value = l))
const heads = computed(() => looks.value.heads.filter((h) => h.gender === gender.value))
const hairs = computed(() => looks.value.hair.filter((h) => !h.helmet && h.gender === gender.value))
const RACES: Record<string, string> = {
  Caucasian: 'Caucasian',
  African: 'African',
  Asian: 'Asian',
  Hispanic: 'Hispanic',
}
const headName = (h: { race: string; pkg: string }) =>
  `${RACES[h.race] ?? h.race} ${h.pkg.split('_').pop()}`
const hairName = (h: { pkg: string }) => `Style ${h.pkg.split('_').pop()}`
watch(gender, () => {
  head.value = 0
  hair.value = 0
})
/** The chosen color's headgear: the same class's headgear setting (the rookie's for the rookie). */
const headgear = computed(() => {
  const id = whose.value
    .replace(/\.color$/, '.headgear')
    .replace('look.rookie-color', 'look.rookie-headgear')
  const d = props.headgear.find((x) => x.id === id)
  const v = Number(tools.gameValues[id] ?? d?.value ?? -1)
  return v >= 0 ? v : null
})
const soldier = shallowRef<Soldier | null>(null)
const palette = shallowRef<PaletteEntry[]>([])
const status = ref('Reading the soldier from your install…')

let run = 0
async function load() {
  const mine = ++run
  status.value = 'Reading the soldier from your install…'
  try {
    const [s, p] = await Promise.all([
      loadSoldier({
        armor: armor.value,
        gender: gender.value,
        head: head.value || undefined,
        hair: headgear.value ?? (hair.value || undefined),
      }),
      armorPalette(),
    ])
    if (mine !== run) return
    soldier.value = s
    palette.value = p
    status.value = ''
  } catch (e) {
    if (mine === run) status.value = `Could not read the soldier: ${(e as Error).message}`
  }
}
watch([armor, gender, head, hair, headgear], load, { immediate: true })

const setting = computed(() => props.colors.find((c) => c.id === whose.value))
const code = computed(() => Number(tools.gameValues[whose.value] ?? setting.value?.value ?? 0))
const tint = computed(() => {
  const own = soldier.value?.meshes[0]?.paints.find((p) => p.kind === 'armor')
  if (!own || !palette.value.length) return { top: null, bottom: null }
  return tintFor(code.value, palette.value, own)
})
</script>

<template>
  <div class="preview">
    <div class="view">
      <SoldierView :soldier="soldier" :top="tint.top" :bottom="tint.bottom" />
      <p v-if="status" class="status small">{{ status }}</p>
    </div>
    <div class="controls small">
      <label>
        Color of
        <select v-model="whose" aria-label="Whose color the soldier wears">
          <option v-for="c in colors" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </label>
      <label>
        Armor
        <select v-model="armor" aria-label="The soldier's armor">
          <option v-for="a in ARMORS" :key="a" :value="a">{{ a }}</option>
        </select>
      </label>
      <label>
        <select v-model="gender" aria-label="The soldier's gender">
          <option value="Male">Male</option>
          <option value="Female">Female</option>
        </select>
      </label>
      <label>
        Face
        <select v-model="head" aria-label="The soldier's face">
          <option :value="0">The first</option>
          <option v-for="h in heads" :key="h.id" :value="h.id">{{ headName(h) }}</option>
        </select>
      </label>
      <label>
        Hair
        <select v-model="hair" :disabled="headgear !== null" aria-label="The soldier's hair">
          <option :value="0">The first</option>
          <option v-for="h in hairs" :key="h.id" :value="h.id">{{ hairName(h) }}</option>
        </select>
      </label>
      <p v-if="headgear !== null" class="muted">
        Wearing headgear {{ headgear
        }}{{
          tools.codes.headgear.get(String(headgear))
            ? `, ${tools.codes.headgear.get(String(headgear))}`
            : ''
        }}: the class's headgear setting.
      </p>
      <p class="muted">
        Color {{ code }}, drawn from your install. Drag to turn it. Our own shader, so close to the
        game's look rather than the same.
      </p>
    </div>
  </div>
</template>

<style scoped>
.preview {
  display: flex;
  gap: 14px;
  margin: 8px 0 10px;
}
.view {
  position: relative;
  width: 260px;
  height: 400px;
  flex: none;
  border: 1px solid var(--border);
  border-radius: 4px;
  overflow: hidden;
}
.status {
  position: absolute;
  inset: auto 8px 8px;
  margin: 0;
  color: var(--muted);
}
.controls {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 300px;
}
.controls label {
  display: flex;
  gap: 8px;
  align-items: baseline;
}
</style>
