<script setup lang="ts">
// Items (features/game-items.md): every item's numbers in the game's file,
// item by item. A list under the file's own headings with a search; the
// picked item's card in parts (to build, as a weapon, as armor, carried),
// each part only where the file has its line, each field in its own terms.

import { computed, ref } from 'vue'
import type { FoundSetting, ItemPart } from '@/model/gamesettings'
import { numberOf } from '@/model/settingformat'
import { gameImages, gamePicture } from '@/state/gameimages'
import { tools } from '@/state/tools'
import SettingRow from './SettingRow.vue'

const props = defineProps<{ items: FoundSetting[] }>()

interface Item {
  type: number
  name: string
  section: string
  fields: FoundSetting[]
  mine: number
}
const all = computed<Item[]>(() => {
  const by = new Map<number, Item>()
  for (const d of props.items) {
    if (!d.item) continue
    const i = by.get(d.item.type) ?? {
      type: d.item.type,
      name: d.item.name,
      section: d.section ?? 'Other items',
      fields: [],
      mine: 0,
    }
    i.fields.push(d)
    if (d.id in tools.gameValues) i.mine++
    by.set(d.item.type, i)
  }
  return [...by.values()]
})

const query = ref('')
const sections = computed(() => {
  const q = query.value.toLowerCase().trim()
  const out = new Map<string, Item[]>()
  for (const i of all.value) {
    if (q && !i.name.toLowerCase().includes(q)) continue
    out.set(i.section, [...(out.get(i.section) ?? []), i])
  }
  return [...out].map(([name, items]) => ({ name, items }))
})

const pickedType = ref<number | null>(null)
const picked = computed(
  () => all.value.find((i) => i.type === pickedType.value) ?? all.value[0] ?? null,
)

const PARTS: [ItemPart, string][] = [
  ['build', 'To build'],
  ['weapon', 'When used'],
  ['armor', 'As armor'],
  ['carried', 'Carried'],
]
/** Fields that mean nothing for this item when they are 0 (ammo on a grenade), unless set. */
const QUIET = new Set(['ammo', 'ammo-conserving', 'radius', 'flight-fuel', 'environment'])
const idOf = (d: FoundSetting) => d.id.split('.').slice(2).join('.')
const parts = computed(() => {
  const i = picked.value
  if (!i) return []
  const armor = i.fields.some((d) => d.item?.part === 'armor')
  const shown = (d: FoundSetting) => {
    const id = idOf(d)
    if (d.id in tools.gameValues) return true
    // Armor has its own mobility and defense; aim from carrying is for armor only.
    if (armor && (id === 'mobility' || id === 'carried-defense')) return false
    if (!armor && id === 'carried-aim') return false
    if (unsetHere(d)) return false
    return !(QUIET.has(id) && numberOf(d.value) === 0)
  }
  return PARTS.map(([part, title]) => ({
    part,
    title,
    fields: i.fields.filter((d) => d.item?.part === part && shown(d)),
  })).filter((p) => p.fields.length)
})
const picture = computed(() =>
  gameImages.version >= 0 && picked.value ? gamePicture('item', picked.value.type) : null,
)
const SHORT: Record<string, string> = {
  Credits: 'cost',
  'Days to build': 'build time',
  'Engineers needed': 'engineers',
}
/** Build fields Long War leaves to the game (−1): said once, the field not shown unless set. */
const unsetHere = (d: FoundSetting) =>
  d.item?.part === 'build' && numberOf(d.value) === -1 && !(d.id in tools.gameValues)
const notSetHere = computed(() =>
  (picked.value?.fields ?? [])
    .filter(unsetHere)
    .map((d) => SHORT[d.item!.label] ?? d.item!.label.toLowerCase()),
)
</script>

<template>
  <div class="items">
    <nav class="list" aria-label="Items">
      <input
        v-model="query"
        type="search"
        class="search"
        placeholder="Find an item…"
        aria-label="Find an item"
      />
      <section v-for="s in sections" :key="s.name" :aria-label="s.name">
        <h4>{{ s.name }}</h4>
        <button
          v-for="i in s.items"
          :key="i.type"
          type="button"
          class="pick"
          :class="{ on: picked?.type === i.type, mine: i.mine }"
          :aria-pressed="picked?.type === i.type"
          @click="pickedType = i.type"
        >
          {{ i.name }}<span v-if="i.mine" class="count"> · {{ i.mine }}</span>
        </button>
      </section>
      <p v-if="!sections.length" class="muted small">No item by that name.</p>
    </nav>
    <article v-if="picked" class="item-card" :aria-label="picked.name">
      <header>
        <img v-if="picture" :src="picture" alt="" class="picture" />
        <h4>{{ picked.name }}</h4>
        <span class="muted small">{{ picked.section }}</span>
      </header>
      <p v-if="notSetHere.length" class="muted small unset">
        Its {{ notSetHere.join(', ').replace(/, ([^,]*)$/, ' and $1') }} to build are not set in
        this file: the game’s own apply.
      </p>
      <section v-for="p in parts" :key="p.part" class="part" :aria-label="p.title">
        <h5>{{ p.title }}</h5>
        <div class="rows">
          <SettingRow v-for="d in p.fields" :key="d.id" :def="d" :label="d.item!.label" />
        </div>
      </section>
    </article>
  </div>
</template>

<style scoped>
.items {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 18px;
  align-items: start;
  margin-top: 6px;
}
.list {
  max-height: 640px;
  overflow-y: auto;
  border-right: 1px solid var(--border);
  padding-right: 8px;
  position: relative;
}
.search {
  width: 100%;
  box-sizing: border-box;
  background: var(--node);
  color: var(--text);
  border: 1px solid var(--node-border);
  border-radius: 4px;
  padding: 4px 8px;
  font: inherit;
  font-size: 13px;
}
.list h4 {
  margin: 10px 0 2px;
  font-size: 12px;
  color: var(--muted);
  font-weight: 600;
}
.pick {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: 0;
  border-radius: 3px;
  padding: 2px 6px;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.pick:hover {
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}
.pick.on {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent);
}
.pick.mine {
  font-weight: 600;
}
.count {
  color: var(--accent);
  font-weight: normal;
}
.item-card header {
  display: flex;
  align-items: center;
  gap: 12px;
}
.item-card h4 {
  margin: 0;
  font-size: 15px;
}
.picture {
  height: 56px;
  border-radius: 3px;
}
.part h5 {
  margin: 12px 0 2px;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}
.unset {
  margin: 8px 0 0;
}
.rows {
  display: grid;
  grid-template-columns: minmax(150px, 15rem) 220px minmax(0, 1fr);
}
@media (max-width: 1000px) {
  .items {
    grid-template-columns: minmax(0, 1fr);
  }
  .list {
    max-height: 260px;
    border-right: 0;
  }
  .rows {
    grid-template-columns: minmax(140px, 14rem) minmax(0, 1fr);
  }
}
</style>
