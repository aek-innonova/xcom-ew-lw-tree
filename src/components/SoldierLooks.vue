<script setup lang="ts">
// The soldiers' looks as one table (features/game-settings-ux.md): a row per
// class, the rookie first with its deco, the armor color with a swatch of
// its tint and the headgear; picking a row puts that class on the soldier
// beside the table (above it in a narrow window). Other settings of the
// group follow as ordinary rows. In LWR the class colours are LWR's own,
// shown and not edited (features/version-setups.md).

import { computed, ref, shallowRef } from 'vue'
import type { FoundSetting } from '@/model/gamesettings'
import lwrTints from '../../data/lwr/class-tints.json'
import type { PaletteEntry } from '@/model/material'
import { armorPalette, kevlarDecos } from '@/state/soldier'
import { gameKind, setGameValue, tools } from '@/state/tools'
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
/**
 * The rest of the group. In LWR not its option to hand the class colours
 * back to the INI: LWR's scheme is the one this card shows (the option can
 * still be set as a line of DefaultGameCore.ini).
 */
const others = computed(() =>
  props.items.filter((d) => !inTable.value.has(d.id) && !(lwrOwn.value && d.id === LWR_OPTION)),
)

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
  decos.value.length ? [['-1', 'the weapon’s kit'], ...decos.value] : null,
)

/**
 * LWR's own class colours (data/lwr/class-tints.json, from its mutator): LWR
 * sets each class's tint itself at Lance Corporal, and again for some perks
 * chosen later. A thought-through part of LWR, so in LWR they are shown, not
 * edited; the rookie's colour and the headgear stay the INI's (LWR leaves them).
 */
const LWR_OPTION = 'lwr.soldier_cost_classic'
const lwrOwn = computed(() => gameKind() === 'lwr')
type LwrClass = { class: string; tint: number; byPerk: { name: string; tint: number }[] }
const lwrClass = (name: string) =>
  lwrOwn.value ? (lwrTints.classes as LwrClass[]).find((c) => c.class === name) : undefined
/** The perks that change a class's colour. */
const perksOf = (c: LwrClass) => c.byPerk.filter((p) => p.tint !== c.tint)
const colorName = (n: number) => (n === 0 ? 'the armor’s own' : tools.codes.colors.get(String(n)))
/** A perk's colour on the soldier instead of the class's, by look id. */
const perkShown = ref<Record<string, string>>({})
function showPerk(l: Look, perk: string | null) {
  perkShown.value = { ...perkShown.value, [l.id]: perk ?? '' }
  pick(l.id)
}
/** The colours the soldier wears where LWR sets them, by color setting id. */
const codes = computed<Record<string, number>>(() =>
  Object.fromEntries(
    looks.value.flatMap((l) => {
      const c = lwrClass(l.name)
      const perk = c && perksOf(c).find((p) => p.name === perkShown.value[l.id])
      return l.color && c ? [[l.color.id, perk ? perk.tint : c.tint]] : []
    }),
  ),
)

const palette = shallowRef<PaletteEntry[]>([])
void armorPalette().then((p) => (palette.value = p))
const valueOf = (d?: FoundSetting) => (d ? (tools.gameValues[d.id] ?? d.value) : '')
/** Long War's color n is the palette's entry n − 1; 0 is the armor's own (no swatch). */
const swatchOf = (n: number) => {
  const e = n >= 1 ? palette.value[n - 1] : undefined
  return e ? [css(e.primary), css(e.secondary)] : null
}
const swatch = (d?: FoundSetting) => swatchOf(Number(valueOf(d)))
const css = (c: number[]) =>
  `rgb(${c
    .slice(0, 3)
    .map((x) => Math.round(Math.pow(Math.max(0, x), 1 / 2.2) * 255))
    .join(',')})`
const mine = (d?: FoundSetting) => !!d && d.id in tools.gameValues

/** A class's deco: the rookie's, which a promotion keeps; none: the weapon's kit. */
const rookieDeco = computed(() => {
  const d = props.items.find((x) => x.id === 'look.rookie-deco')
  const v = d ? (tools.gameValues[d.id] ?? d.value) : '-1'
  return Number(v) < 0
    ? 'the weapon’s kit'
    : `the rookie’s, ${decoChoices.value?.find(([k]) => k === String(v))?.[1] ?? v}`
})

const colors = computed(() => looks.value.flatMap((l) => l.color ?? []))
const headgear = computed(() =>
  looks.value.flatMap((l) => [l.headgear, l.deco]).flatMap((d) => d ?? []),
)
</script>

<template>
  <div class="looks">
    <div class="layout">
      <div class="table-side">
        <p v-if="lwrOwn" class="lwr-note small">
          LWR sets each class’s colour itself, at the promotion to Lance Corporal and again for some
          perks chosen later; shown here as LWR sets them, and a perk shows its colour on the
          soldier. The rookie’s colour and the class headgear remain settings.
        </p>
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
                <span v-if="l.color && lwrClass(l.name)" class="cell lwr">
                  <span class="swatch" aria-hidden="true">
                    <template v-if="swatchOf(lwrClass(l.name)!.tint)">
                      <i :style="{ background: swatchOf(lwrClass(l.name)!.tint)![0] }" />
                      <i :style="{ background: swatchOf(lwrClass(l.name)!.tint)![1] }" />
                    </template>
                  </span>
                  <span>
                    {{ colorName(lwrClass(l.name)!.tint) ?? lwrClass(l.name)!.tint }}
                    <span class="tag">LWR’s own</span>
                    <span v-if="perksOf(lwrClass(l.name)!).length" class="perks">
                      later, with
                      <button
                        v-for="p in perksOf(lwrClass(l.name)!)"
                        :key="p.name"
                        type="button"
                        class="perk"
                        :aria-pressed="perkShown[l.id] === p.name"
                        :aria-label="`Show ${l.name} with ${p.name} on the soldier`"
                        :title="colorName(p.tint) ?? String(p.tint)"
                        @click.stop="showPerk(l, perkShown[l.id] === p.name ? null : p.name)"
                      >
                        <span class="swatch small" aria-hidden="true">
                          <template v-if="swatchOf(p.tint)">
                            <i :style="{ background: swatchOf(p.tint)![0] }" />
                            <i :style="{ background: swatchOf(p.tint)![1] }" />
                          </template>
                        </span>
                        {{ p.name }}
                      </button>
                    </span>
                  </span>
                </span>
                <span v-else-if="l.color" class="cell" :class="{ mine: mine(l.color) }">
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
                </span>
                <span v-else class="muted small">{{ rookieDeco }}</span>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="others.length" class="rows">
          <SettingRow v-for="d in others" :key="d.id" :def="d" />
        </div>
      </div>
      <SoldierPreview class="soldier-side" :colors="colors" :headgear="headgear" :codes="codes" />
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
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.cell :deep(select) {
  max-width: 220px;
}
.lwr-note {
  margin: 0 0 6px;
  color: var(--muted);
}
.cell.lwr {
  align-items: flex-start;
  font-size: 13px;
}
.tag {
  margin-left: 6px;
  font-size: 11px;
  color: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 3px;
  padding: 0 4px;
}
.perks {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 6px;
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--muted);
}
.perk {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 5px;
  border: 1px solid transparent;
  border-radius: 3px;
  background: none;
  color: var(--text);
  font: inherit;
  cursor: pointer;
}
.perk:hover,
.perk[aria-pressed='true'] {
  border-color: var(--accent);
}
.swatch.small {
  width: 16px;
  height: 10px;
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
