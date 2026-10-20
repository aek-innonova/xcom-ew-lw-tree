<script setup lang="ts">
// The soldier's stats as one table (features/game-settings-ux.md): a row per
// stat with its base, the lowest a rookie can roll, and the build points a
// point of it costs, beside what that means: rookies roll from the lowest to
// as far above the base (Long War's rule: highest = 2 × base − lowest), so
// base 13 with lowest 11 rolls 11 to 15. A version without rookie rolls
// (plain EW) shows the bases alone.

import { computed } from 'vue'
import type { FoundSetting, Stat } from '@/model/gamesettings'
import { numberOf } from '@/model/settingformat'
import { setGameValue, tools } from '@/state/tools'
import SettingField from './SettingField.vue'
import SettingRow from './SettingRow.vue'

const props = defineProps<{ items: FoundSetting[] }>()

const STATS: Stat[] = ['HP', 'Mobility', 'Aim', 'Will', 'Defense']
const of = (stat: Stat, role: string) =>
  props.items.find((d) => d.stat?.of === stat && d.stat.role === role)
const rows = computed(() =>
  STATS.map((stat) => ({
    stat,
    base: of(stat, 'base'),
    lowest: of(stat, 'lowest') ?? of(stat, 'added'),
    cost: of(stat, 'cost'),
  })).filter((r) => r.base || r.lowest || r.cost),
)
const has = computed(() => ({
  lowest: rows.value.some((r) => r.lowest),
  cost: rows.value.some((r) => r.cost),
}))
const others = computed(() => props.items.filter((d) => !d.stat))

const now = (d?: FoundSetting) => (d ? numberOf(tools.gameValues[d.id] ?? d.value) : NaN)
/** What a rookie rolls for the stat, in words. */
function rolls(r: (typeof rows.value)[number]): { text: string; wrong?: boolean } {
  const base = now(r.base)
  const low = now(r.lowest)
  if (Number.isNaN(base) || Number.isNaN(low)) return { text: '' }
  if (r.lowest?.stat?.role === 'added') {
    const start = base + low
    return { text: `starts at ${start}, plus the armor’s` }
  }
  if (low > base) {
    // As the version has it (LWR's mobility), said; set so by the player, marked.
    const theirs = [r.base, r.lowest].some((d) => d && d.id in tools.gameValues)
    return theirs
      ? { text: 'the lowest is above the base', wrong: true }
      : {
          text: `lowest above the base, as ${tools.gameSettingsFrom.replace(/’s own$/, '')} has it`,
        }
  }
  const high = 2 * base - low
  return { text: low === high ? `always ${low}` : `${low} to ${high}` }
}
/** LWR rolls rookies this way only with one of its second wave options, its file says. */
const secondWave = computed(() =>
  props.items.some((d) => d.stat?.role === 'lowest' && /second wave/i.test(d.comment)),
)
</script>

<template>
  <table class="stats">
    <thead>
      <tr>
        <th scope="col">Stat</th>
        <th scope="col">Base</th>
        <th v-if="has.lowest" scope="col">Rookie’s lowest</th>
        <th v-if="has.lowest" scope="col">Rookies roll</th>
        <th v-if="has.cost" scope="col">Point cost</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="r in rows" :key="r.stat">
        <th scope="row">{{ r.stat }}</th>
        <td>
          <template v-if="r.base">
            <label class="sr" :for="`gs-${r.base.id}`">{{ r.base.name }}</label>
            <SettingField
              :def="r.base"
              :mine="tools.gameValues[r.base.id]"
              was
              @set="(v) => setGameValue(r.base!.id, v)"
            />
          </template>
        </td>
        <td v-if="has.lowest">
          <template v-if="r.lowest">
            <label class="sr" :for="`gs-${r.lowest.id}`">{{ r.lowest.name }}</label>
            <span v-if="r.lowest.stat?.role === 'added'" class="muted small">added</span>
            <SettingField
              :def="r.lowest"
              :mine="tools.gameValues[r.lowest.id]"
              was
              @set="(v) => setGameValue(r.lowest!.id, v)"
            />
          </template>
        </td>
        <td v-if="has.lowest" class="rolls" :class="{ wrong: rolls(r).wrong }">
          {{ rolls(r).text }}
        </td>
        <td v-if="has.cost">
          <template v-if="r.cost">
            <label class="sr" :for="`gs-${r.cost.id}`">{{ r.cost.name }}</label>
            <SettingField
              :def="r.cost"
              :mine="tools.gameValues[r.cost.id]"
              was
              @set="(v) => setGameValue(r.cost!.id, v)"
            />
          </template>
        </td>
      </tr>
    </tbody>
  </table>
  <p v-if="secondWave" class="note small muted">
    LWR’s file says it rolls rookies this way only with its balanced soldiers second wave option.
  </p>
  <div v-if="others.length" class="rows">
    <SettingRow v-for="d in others" :key="d.id" :def="d" />
  </div>
</template>

<style scoped>
.stats {
  border-collapse: collapse;
  margin: 4px 0 8px;
}
.stats th,
.stats td {
  text-align: left;
  padding: 4px 18px 4px 0;
  vertical-align: middle;
  border-top: 1px solid var(--border);
}
.stats thead th {
  font-weight: normal;
  color: var(--muted);
  font-size: 12px;
  border-top: 0;
}
.stats tbody th {
  font-size: 13px;
  font-weight: 600;
  min-width: 90px;
}
.stats :deep(.num) {
  width: 64px;
}
.rolls {
  font-size: 13px;
  min-width: 170px;
  font-variant-numeric: tabular-nums;
}
.rolls.wrong {
  color: var(--danger, #e66);
}
.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
.note {
  margin: 0 0 8px;
}
.rows {
  display: grid;
  grid-template-columns: minmax(170px, 17rem) 300px minmax(0, 1fr);
}
</style>
