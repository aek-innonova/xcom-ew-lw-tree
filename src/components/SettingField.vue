<script setup lang="ts">
// One game setting's editor, in the setting's own terms
// (features/game-settings-ux.md): a percentage for a fraction, a checkbox
// for LWR's 0 and 1, a list of meanings for a choice. What it emits is the file's own form
// (model/settingformat.ts); a value it cannot write is said, not sent.

import { computed, ref, watch } from 'vue'
import type { FoundSetting } from '@/model/gamesettings'
import { fieldsOf, limitsOf, numberOf, PLAIN, valueOf } from '@/model/settingformat'

const props = defineProps<{
  def: FoundSetting
  /** The player's value; none: the version's own. */
  mine?: string
  /** Named values to choose from (colors, headgear, decos), when the app knows them. */
  options?: [string, string][] | null
}>()
const emit = defineEmits<{ set: [value: string | null] }>()

const format = computed(() => props.def.format ?? PLAIN)
const value = computed(() => props.mine ?? props.def.value)
const id = computed(() => `gs-${props.def.id}`)
const limits = computed(() => limitsOf(format.value))
const error = ref('')
watch(value, () => (error.value = ''))

/** What the fields show now. */
const shown = computed(() => fieldsOf(format.value, value.value))

function commit(fields: string[]) {
  // Emptied: back to the version's own.
  if (fields.every((f) => f.trim() === '')) {
    error.value = ''
    emit('set', null)
    return
  }
  const r = valueOf(format.value, fields, props.def.value)
  if ('error' in r) {
    // Said, and the field shows the value kept, until the next try.
    error.value = `${r.error}; kept ${shown.value[0]}`
    for (const [k, el] of inputs.value.entries()) if (el) el.value = shown.value[k] ?? ''
    return
  }
  error.value = ''
  emit('set', r.value)
}
const input = (e: Event) => (e.target as HTMLInputElement).value
const inputs = ref<(HTMLInputElement | null)[]>([])
const choices = computed<[string, string][]>(() => {
  const own = props.options ?? []
  // A value the list does not name still shows as itself.
  return own.some(([k]) => numberOf(k) === numberOf(value.value))
    ? own
    : [[value.value, 'not in the list'], ...own]
})
const chosen = computed(
  () => choices.value.find(([k]) => numberOf(k) === numberOf(value.value))?.[0] ?? value.value,
)
</script>

<template>
  <span class="field">
    <input
      v-if="def.type === 'toggle'"
      :id="id"
      type="checkbox"
      :checked="value === 'on'"
      @change="emit('set', ($event.target as HTMLInputElement).checked ? 'on' : 'off')"
    />
    <select
      v-else-if="options"
      :id="id"
      :value="chosen"
      @change="emit('set', ($event.target as HTMLSelectElement).value)"
    >
      <option v-for="[k, v] in choices" :key="k" :value="k">{{ k }} · {{ v }}</option>
    </select>
    <input
      v-else-if="format.kind === 'switch'"
      :id="id"
      type="checkbox"
      :checked="shown[0] === 'on'"
      @change="commit([($event.target as HTMLInputElement).checked ? 'on' : 'off'])"
    />
    <select
      v-else-if="format.kind === 'choice'"
      :id="id"
      :value="shown[0]"
      @change="commit([($event.target as HTMLSelectElement).value])"
    >
      <option v-for="[k, v] in format.options" :key="k" :value="String(k)">{{ v }}</option>
    </select>
    <template v-else>
      <span v-if="format.kind === 'times'" class="muted unit">×</span>
      <input
        :id="id"
        :ref="(el) => (inputs[0] = el as HTMLInputElement | null)"
        type="number"
        step="any"
        class="num"
        :min="limits.min"
        :max="limits.max"
        :value="shown[0]"
        @change="commit([input($event)])"
        @input="error = ''"
      />
      <span v-if="format.kind === 'percent'" class="muted unit">%</span>
      <span v-else-if="format.kind === 'hours'" class="muted unit"
        >hours<template v-if="numberOf(shown[0]!) >= 48">
          · {{ Math.round((numberOf(shown[0]!) / 24) * 10) / 10 }} days</template
        ></span
      >
      <span v-else-if="format.kind === 'number' && format.unit" class="muted unit">{{
        format.unit
      }}</span>
    </template>
    <span v-if="error" class="error small" role="alert">{{ error }}</span>
  </span>
</template>

<style scoped>
.field {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
input.num,
select {
  background: var(--node);
  color: var(--text);
  border: 1px solid var(--node-border);
  border-radius: 4px;
  padding: 2px 6px;
  font: inherit;
  font-size: 13px;
}
select {
  max-width: 260px;
}
.num {
  width: 76px;
}
.unit {
  font-size: 12px;
}
.error {
  color: var(--danger, #e66);
}
</style>
