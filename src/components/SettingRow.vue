<script setup lang="ts">
// A game setting as a row (features/game-settings-ux.md): its name, its
// editor, what is particular to it. Where the player has their own value,
// the version's is said in the same terms, with a way back to it. Laid out
// by the grid around it (display: contents), so rows line up.

import { computed } from 'vue'
import type { FoundSetting } from '@/model/gamesettings'
import { describe, PLAIN } from '@/model/settingformat'
import { setGameValue, tools } from '@/state/tools'
import SettingField from './SettingField.vue'

const props = defineProps<{ def: FoundSetting; options?: [string, string][] | null }>()

const mine = computed(() => props.def.id in tools.gameValues)
/** What is particular to it, in the app's words (the file's comment is not the text). */
const help = computed(() => props.def.help ?? '')
const own = computed(() =>
  props.def.type === 'toggle'
    ? props.def.value === 'on'
      ? 'on'
      : 'off'
    : describe(props.def.format ?? PLAIN, props.def.value),
)
</script>

<template>
  <div class="row" :class="{ mine }">
    <label class="label" :for="`gs-${def.id}`">{{ def.name }}</label>
    <span class="edit">
      <SettingField
        :def="def"
        :mine="tools.gameValues[def.id]"
        :options="options"
        @set="(v) => setGameValue(def.id, v)"
      />
    </span>
    <span class="about small">
      <span v-if="help">{{ help }}</span>
      <span v-if="mine" class="own muted">{{ tools.gameSettingsFrom }}: {{ own }}</span>
    </span>
  </div>
</template>

<style scoped>
.row {
  display: contents;
}
.row > * {
  padding: 5px 0;
  border-top: 1px solid var(--border);
}
.label {
  font-size: 13px;
  font-weight: 600;
  padding-right: 12px;
}
.mine .label {
  color: var(--accent);
}
.edit {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-right: 12px;
}
.about {
  line-height: 1.4;
  display: flex;
  flex-direction: column;
}
/* Narrow: what it is goes under its editor. */
@media (max-width: 1000px) {
  .about {
    grid-column: 2 / -1;
    border-top: 0;
    padding-top: 0;
  }
}
</style>
