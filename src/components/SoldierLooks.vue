<script setup lang="ts">
// The soldiers' looks as one table (features/game-settings-ux.md): a row per
// class, the rookie first with its deco, the armor color with a swatch of
// its tint and the headgear; picking a row puts that class on the soldier
// beside the table (above it in a narrow window). Other settings of the
// group (LWR's colors on promotion) follow as ordinary rows.

import { computed, shallowRef } from 'vue'
import type { FoundSetting } from '@/model/gamesettings'
import type { PaletteEntry } from '@/model/material'
import { armorPalette, kevlarDecos } from '@/state/soldier'
import { setGameValue, tools } from '@/state/tools'
import SettingField from './SettingField.vue'
import SettingRow from './SettingRow.vue'
import SoldierPreview from './SoldierPreview.vue'

const props = defineProps<{ items: FoundSetting[] }>()

interface Look {
  /** The soldier's id for it: its color setting. */
  id: string
  name: string
  color?: FoundSetting
  headgear?: FoundSetting
  deco?: FoundSetting
}
const looks = computed<Look[]>(() => {
  const by = new Map(props.items.map((d) => [d.id, d]))
  const out: Look[] = []
  if (by.has('look.rookie-color'))
    out.push({
      id: 'look.rookie-color',
      name: 'Rookie',
      color: by.get('look.rookie-color'),
      headgear: by.get('look.rookie-headgear'),
      deco: by.get('look.rookie-deco'),
    })
  for (const d of props.items) {
    const m = /^class\.(\w+)\.color$/.exec(d.id)
    if (!m) continue
    out.push({
      id: d.id,
      name: d.name.replace(/ color$/i, ''),
      color: d,
      headgear: by.get(`class.${m[1]}.headgear`),
    })
  }
  return out
})
const inTable = computed(
  () =>
    new Set(looks.value.flatMap((l) => [l.color, l.headgear, l.deco]).flatMap((d) => d?.id ?? [])),
)
const others = computed(() => props.items.filter((d) => !inTable.value.has(d.id)))

const picked = computed(() =>
  looks.value.some((l) => l.id === tools.soldierFor) ? tools.soldierFor : looks.value[0]?.id,
)
const pick = (id: string) => (tools.soldierFor = id)

const colorChoices = computed<[string, string][] | null>(() =>
  tools.codes.colors.size ? [['0', 'the armor’s own'], ...tools.codes.colors] : null,
)
const headgearChoices = computed<[string, string][] | null>(() =>
  tools.codes.headgear.size ? [['-1', 'hair, no helmet'], ...tools.codes.headgear] : null,
)
const decos = shallowRef<[string, string][]>([])
void kevlarDecos().then((d) => (decos.value = d))
const decoChoices = computed<[string, string][] | null>(() =>
  decos.value.length ? [['-1', 'the armor’s own'], ...decos.value] : null,
)

const palette = shallowRef<PaletteEntry[]>([])
void armorPalette().then((p) => (palette.value = p))
const valueOf = (d?: FoundSetting) => (d ? (tools.gameValues[d.id] ?? d.value) : '')
/** Long War's color n is the palette's entry n − 1; 0 is the armor's own (no swatch). */
const swatch = (d?: FoundSetting) => {
  const n = Number(valueOf(d))
  const e = n >= 1 ? palette.value[n - 1] : undefined
  return e ? [css(e.primary), css(e.secondary)] : null
}
const css = (c: number[]) =>
  `rgb(${c
    .slice(0, 3)
    .map((x) => Math.round(Math.pow(Math.max(0, x), 1 / 2.2) * 255))
    .join(',')})`
const mine = (d?: FoundSetting) => !!d && d.id in tools.gameValues

const colors = computed(() => looks.value.flatMap((l) => l.color ?? []))
const headgear = computed(() =>
  looks.value.flatMap((l) => [l.headgear, l.deco]).flatMap((d) => d ?? []),
)
</script>

<template>
  <div class="looks">
    <div class="layout">
      <div class="table-side">
        <table class="classes">
          <thead>
            <tr>
              <th scope="col">Class</th>
              <th scope="col">Armor color</th>
              <th scope="col">Headgear</th>
              <th scope="col">Deco</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="l in looks"
              :key="l.id"
              :class="{ picked: l.id === picked }"
              @click="pick(l.id)"
              @focusin="pick(l.id)"
            >
              <th scope="row">
                <button
                  type="button"
                  class="link"
                  :aria-pressed="l.id === picked"
                  :aria-label="`Show ${l.name} on the soldier`"
                >
                  {{ l.name }}
                </button>
              </th>
              <td>
                <span v-if="l.color" class="cell" :class="{ mine: mine(l.color) }">
                  <span class="swatch" aria-hidden="true">
                    <template v-if="swatch(l.color)">
                      <i :style="{ background: swatch(l.color)![0] }" />
                      <i :style="{ background: swatch(l.color)![1] }" />
                    </template>
                  </span>
                  <label class="sr" :for="`gs-${l.color.id}`">{{ l.color.name }}</label>
                  <SettingField
                    :def="l.color"
                    :mine="tools.gameValues[l.color.id]"
                    :options="colorChoices"
                    @set="(v) => setGameValue(l.color!.id, v)"
                  />
                  <button
                    v-if="mine(l.color)"
                    type="button"
                    class="undo"
                    :aria-label="`Undo your value: ${l.color.name}`"
                    :title="`Back to ${tools.gameSettingsFrom}: ${l.color.value}`"
                    @click.stop="setGameValue(l.color.id, null)"
                  >
                    ×
                  </button>
                </span>
              </td>
              <td>
                <span v-if="l.headgear" class="cell" :class="{ mine: mine(l.headgear) }">
                  <label class="sr" :for="`gs-${l.headgear.id}`">{{ l.headgear.name }}</label>
                  <SettingField
                    :def="l.headgear"
                    :mine="tools.gameValues[l.headgear.id]"
                    :options="headgearChoices"
                    @set="(v) => setGameValue(l.headgear!.id, v)"
                  />
                  <button
                    v-if="mine(l.headgear)"
                    type="button"
                    class="undo"
                    :aria-label="`Undo your value: ${l.headgear.name}`"
                    :title="`Back to ${tools.gameSettingsFrom}: ${l.headgear.value}`"
                    @click.stop="setGameValue(l.headgear.id, null)"
                  >
                    ×
                  </button>
                </span>
              </td>
              <td>
                <span v-if="l.deco" class="cell" :class="{ mine: mine(l.deco) }">
                  <label class="sr" :for="`gs-${l.deco.id}`">{{ l.deco.name }}</label>
                  <SettingField
                    :def="l.deco"
                    :mine="tools.gameValues[l.deco.id]"
                    :options="decoChoices"
                    @set="(v) => setGameValue(l.deco!.id, v)"
                  />
                  <button
                    v-if="mine(l.deco)"
                    type="button"
                    class="undo"
                    :aria-label="`Undo your value: ${l.deco.name}`"
                    :title="`Back to ${tools.gameSettingsFrom}: ${l.deco.value}`"
                    @click.stop="setGameValue(l.deco.id, null)"
                  >
                    ×
                  </button>
                </span>
                <span v-else class="muted small">the armor’s own</span>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="others.length" class="rows">
          <SettingRow v-for="d in others" :key="d.id" :def="d" />
        </div>
      </div>
      <SoldierPreview class="soldier-side" :colors="colors" :headgear="headgear" />
    </div>
  </div>
</template>

<style scoped>
.looks {
  container-type: inline-size;
}
.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 16px 24px;
  align-items: start;
}
.soldier-side {
  position: sticky;
  top: 8px;
}
/* Narrow: the soldier above the table. */
@container (max-width: 860px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .soldier-side {
    order: -1;
    position: static;
  }
}
.classes {
  border-collapse: collapse;
  width: 100%;
}
.classes th,
.classes td {
  text-align: left;
  padding: 4px 8px 4px 0;
  vertical-align: middle;
}
.classes thead th {
  font-weight: normal;
  color: var(--muted);
  font-size: 12px;
}
.classes tbody tr {
  cursor: pointer;
  border-top: 1px solid var(--border);
}
.classes tbody tr.picked {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
.classes tbody tr.picked th .link {
  color: var(--accent);
  font-weight: 600;
}
.link {
  background: none;
  border: 0;
  padding: 0 4px;
  color: inherit;
  cursor: pointer;
  font: inherit;
}
.cell {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.cell :deep(select) {
  max-width: 220px;
}
.swatch {
  display: inline-flex;
  width: 22px;
  height: 14px;
  border: 1px solid var(--border);
  border-radius: 2px;
  overflow: hidden;
}
.swatch i {
  flex: 1;
}
.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
.undo {
  border: none;
  background: none;
  color: var(--muted);
  font-size: 16px;
  cursor: pointer;
  padding: 0 2px;
}
.cell.mine :deep(select),
.cell.mine :deep(input) {
  border-color: var(--accent);
}
.rows {
  margin-top: 12px;
  display: grid;
  grid-template-columns: minmax(170px, 17rem) 300px minmax(0, 1fr);
}
@media (max-width: 1000px) {
  .rows {
    grid-template-columns: minmax(140px, 14rem) minmax(0, 1fr);
  }
}
</style>
