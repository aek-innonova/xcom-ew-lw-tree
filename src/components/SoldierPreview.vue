<script setup lang="ts">
// A soldier in a class's colors, beside the class color settings
// (features/game-soldiers.md, features/game-settings-ux.md): the class is the
// row picked in the table beside it; here the armor, the weapon carried (its
// kit, unless a deco is set), gender, face and hair. The soldier follows the
// setting's value, yours or the version's own, and the version's own kits.

import { computed, ref, shallowRef, watch } from 'vue'
import type { FoundSetting } from '@/model/gamesettings'
import type { PaletteEntry } from '@/model/material'
import {
  ARMORS,
  armorPalette,
  gameLooks,
  gamePalette,
  kitWeapons,
  loadSoldier,
  weaponLabel,
  type Looks,
  tintFor,
  type Armor,
  type Gender,
  type Soldier,
} from '@/state/soldier'
import { contentKey, tools } from '@/state/tools'
import SoldierView from './SoldierView.vue'

const props = defineProps<{
  colors: FoundSetting[]
  headgear: FoundSetting[]
  /** Colours set by the version rather than the setting (LWR's own), by color setting id. */
  codes?: Record<string, number>
}>()

const armor = ref<Armor>('Kevlar')
const gender = ref<Gender>('Male')
// The class picked in the table (a color or headgear row in use), else the first.
const whose = computed(() =>
  props.colors.some((c) => c.id === tools.soldierFor)
    ? tools.soldierFor
    : (props.colors[0]?.id ?? ''),
)
const head = ref(0)
const hair = ref(0)
const looks = shallowRef<Looks>({ heads: [], hair: [], kits: {}, decos: {}, armorKits: [] })
// The chosen version's own file: read again when another version is chosen.
const content = computed(() => contentKey())
watch(content, () => void gameLooks().then((l) => (looks.value = l)), { immediate: true })

/** The weapon carried: its kit is the one worn when no deco is set. */
const weapons = computed(() => kitWeapons(looks.value, armor.value))
const weapon = ref('')
/** What a class carries by default: a sniper rifle, an LMG, else a rifle. */
function weaponFor(id: string): string {
  const w =
    /\.sniper\./.test(id) ? 'eItem_SniperRifle' : /\.gunner\./.test(id) ? 'eItem_LMG' : ''
  return weapons.value.includes(w) ? w : (weapons.value[0] ?? '')
}
// Another class, or another armor's kits: that class's weapon again.
watch([whose, weapons], () => (weapon.value = weaponFor(whose.value)), { immediate: true })
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
/**
 * The rookie's armor deco setting. A promotion keeps it, so every class wears
 * it; at −1 (none) the soldier wears the kit of the weapon carried.
 */
const deco = computed(() => {
  const d = props.headgear.find((x) => x.id === 'look.rookie-deco')
  const v = Number(tools.gameValues['look.rookie-deco'] ?? d?.value ?? -1)
  return v >= 0 ? v : undefined
})
const hairColors = shallowRef<PaletteEntry[]>([])
void gamePalette('HairColor').then((p) => (hairColors.value = p))
const hairColor = ref(0)
const srgbCss = (c: number[]) =>
  `rgb(${c
    .slice(0, 3)
    .map((x) => Math.round(Math.pow(Math.max(0, x), 1 / 2.2) * 255))
    .join(',')})`
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
        deco: deco.value,
        weapon: weapon.value || undefined,
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
watch([armor, gender, head, hair, headgear, deco, weapon, content], load, { immediate: true })

const setting = computed(() => props.colors.find((c) => c.id === whose.value))
const code = computed(
  () =>
    props.codes?.[whose.value] ??
    Number(tools.gameValues[whose.value] ?? setting.value?.value ?? 0),
)
const tint = computed(() => {
  const own = soldier.value?.meshes[0]?.paints.find((p) => p.kind === 'armor')
  if (!own || !palette.value.length) return { top: null, bottom: null }
  return tintFor(code.value, palette.value, own)
})
</script>

<template>
  <div class="preview">
    <p class="who">
      <strong>{{ (setting?.name ?? '').replace(/ (armor )?color$/i, '') }}</strong
      >&nbsp;
      <span class="muted"
        >color {{ code
        }}<template v-if="tools.codes.colors.get(String(code))">
          · {{ tools.codes.colors.get(String(code)) }}</template
        ></span
      >
    </p>
    <div class="view">
      <SoldierView
        :soldier="soldier"
        :top="tint.top"
        :bottom="tint.bottom"
        :hair="hairColors[hairColor]?.primary ?? null"
      />
      <p v-if="status" class="status small">{{ status }}</p>
    </div>
    <div class="controls small">
      <label>
        Armor
        <select v-model="armor" aria-label="The soldier's armor">
          <option v-for="a in ARMORS" :key="a" :value="a">{{ a }}</option>
        </select>
      </label>
      <label>
        Weapon
        <select
          v-model="weapon"
          :disabled="deco !== undefined || !weapons.length"
          aria-label="The soldier's weapon"
          :title="deco !== undefined ? 'A deco is set: it is worn whatever the weapon' : undefined"
        >
          <option v-for="w in weapons" :key="w" :value="w">{{ weaponLabel(w) }}</option>
        </select>
      </label>
      <label>
        Gender
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
      <div v-if="hairColors.length" class="swatches" role="radiogroup" aria-label="Hair color">
        <span>Hair color</span>
        <button
          v-for="(c, i) in hairColors"
          :key="i"
          type="button"
          role="radio"
          :aria-checked="hairColor === i"
          :aria-label="`Hair color ${i}`"
          :style="{ background: srgbCss(c.primary) }"
          :class="{ on: hairColor === i }"
          @click="hairColor = i"
        />
      </div>
      <p v-if="headgear !== null" class="muted">
        Wearing headgear {{ headgear
        }}{{
          tools.codes.headgear.get(String(headgear))
            ? `, ${tools.codes.headgear.get(String(headgear))}`
            : ''
        }}: the class's headgear setting.
      </p>
      <p class="muted">
        Drawn from your install; drag to turn it. Our own shading: close to the game’s look, not the
        same.
      </p>
    </div>
  </div>
</template>

<style scoped>
.preview {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 280px;
}
.who {
  margin: 0;
}
.view {
  position: relative;
  width: 280px;
  height: 420px;
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
}
.swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  align-items: center;
}
.swatches span {
  margin-right: 5px;
}
.swatches button {
  width: 14px;
  height: 14px;
  padding: 0;
  margin: 0;
  border: 1px solid var(--border);
  border-radius: 2px;
}
.swatches button.on {
  outline: 2px solid var(--accent);
}
.controls select {
  background: var(--node);
  color: var(--text);
  border: 1px solid var(--node-border);
  border-radius: 4px;
  padding: 2px 4px;
  font: inherit;
}
.controls label {
  display: grid;
  grid-template-columns: 56px 1fr;
  gap: 8px;
  align-items: baseline;
}
</style>
