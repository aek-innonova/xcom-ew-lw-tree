<script setup lang="ts">
// The setup bar at the top of Tools (features/game-setups.md): which saved
// setup the choices below are, switching to another, saving as a new one
// (with a name offered), and putting the setup into the game. It stays in
// view while the page scrolls, so what the tool does is never at the bottom.

import { computed, nextTick, ref } from 'vue'
import { deleteSetup, makePlan, saveSetup, suggestSetupName, tools, useSetup } from '@/state/tools'

const NEW = '\u0000new'
const SAVE = '\u0000save'
const DELETE = '\u0000delete'

/** What the list shows as chosen: the setup in use, else the changed one it came from. */
const current = computed(() => tools.setupInUse ?? (tools.setupFrom ? `${tools.setupFrom}*` : ''))
const changed = computed(() => !tools.setupInUse && !!tools.setupFrom)
/** The current choices are in no saved setup. */
const unsaved = computed(() => !tools.setupInUse)

const naming = ref(false)
const name = ref('')
const nameInput = ref<HTMLInputElement | null>(null)
/** A setup to switch to once the player has said what to do with unsaved choices. */
const switching = ref<string | null>(null)
const deleting = ref(false)

async function startNaming() {
  name.value = suggestSetupName()
  naming.value = true
  switching.value = null
  await nextTick()
  nameInput.value?.focus()
  nameInput.value?.select()
}

async function onPick(e: Event) {
  const select = e.target as HTMLSelectElement
  const v = select.value
  select.value = current.value
  deleting.value = false
  if (v === NEW) return startNaming()
  if (v === SAVE && tools.setupFrom) return saveSetup(tools.setupFrom)
  if (v === DELETE) {
    deleting.value = true
    return
  }
  if (v === current.value || !v) return
  // Choices not saved anywhere would be lost: ask first.
  if (unsaved.value && (tools.setupFrom || hasChoices.value)) {
    switching.value = v
    return
  }
  await useSetup(v)
}
const hasChoices = computed(
  () =>
    Object.keys(tools.gameValues).length > 0 ||
    tools.settings.length > 0 ||
    tools.mods.some((m) => Object.values(m.wanted ?? {}).some(Boolean)),
)

async function onSave() {
  const n = name.value.trim()
  if (!n) return
  await saveSetup(n)
  naming.value = false
  if (switching.value) {
    const next = switching.value
    switching.value = null
    await useSetup(next)
  }
}
async function switchAnyway() {
  const next = switching.value
  switching.value = null
  if (next) await useSetup(next)
}
async function onDelete() {
  const n = tools.setupInUse ?? tools.setupFrom
  deleting.value = false
  if (n) await deleteSetup(n)
}

/** Makes the plan, and brings it into view. */
async function apply() {
  await makePlan(true)
  await nextTick()
  const plan = document.querySelector<HTMLElement>('[aria-label="What will change"]')
  plan?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  // Keyboard focus follows: to the plan, to read it and write or cancel.
  plan?.focus({ preventScroll: true })
}
</script>

<template>
  <div class="setup-bar" role="region" aria-label="Your setup">
    <label class="pick">
      <span class="what">Setup</span>
      <select
        :value="current"
        aria-label="Your setup"
        :disabled="!!tools.busy"
        title="The version, the mods ticked and their options, the game and INI settings, under a name"
        @change="onPick"
      >
        <option v-if="!tools.setupInUse && !tools.setupFrom" value="" disabled>
          Not saved yet
        </option>
        <option v-if="changed" :value="current" disabled>{{ tools.setupFrom }}, changed</option>
        <option v-for="x in tools.setups" :key="x.name" :value="x.name">{{ x.name }}</option>
        <option disabled>──────────</option>
        <option v-if="changed" :value="SAVE">Save the changes to {{ tools.setupFrom }}</option>
        <option :value="NEW">Save as a new setup…</option>
        <option v-if="tools.setupInUse || tools.setupFrom" :value="DELETE">
          Delete {{ tools.setupInUse ?? tools.setupFrom }}…
        </option>
      </select>
    </label>

    <form v-if="naming" class="naming" @submit.prevent="onSave">
      <input
        ref="nameInput"
        v-model="name"
        type="text"
        aria-label="Name for this setup"
        @keydown.esc="naming = false"
      />
      <button type="submit" :disabled="!name.trim()">
        {{ tools.setups.some((x) => x.name === name.trim()) ? 'Replace it' : 'Save' }}
      </button>
      <button type="button" @click="naming = false">Cancel</button>
    </form>
    <span v-else-if="switching" class="ask small">
      Your choices now are not saved.
      <button type="button" @click="startNaming">Save them first…</button>
      <button type="button" @click="switchAnyway">Switch to {{ switching }}</button>
      <button type="button" @click="switching = null">Cancel</button>
    </span>
    <span v-else-if="deleting" class="ask small">
      Delete {{ tools.setupInUse ?? tools.setupFrom }}? Your choices below stay as they are.
      <button type="button" @click="onDelete">Delete it</button>
      <button type="button" @click="deleting = false">Cancel</button>
    </span>
    <span v-else-if="tools.setupInUse" class="state small present">in use</span>
    <span v-else-if="changed" class="state small muted">changed since saved</span>

    <span class="spacer" />
    <span v-if="tools.busy" class="muted small busy">{{ tools.busy }}</span>
    <button
      v-if="tools.install"
      type="button"
      class="primary apply"
      :disabled="!!tools.busy"
      @click="apply"
    >
      Apply my setup…
    </button>
  </div>
</template>

<style scoped>
.setup-bar {
  position: sticky;
  top: -16px;
  z-index: 5;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  margin: 12px -20px 0;
  padding: 10px 20px;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  box-shadow: 0 4px 10px -8px rgba(0, 0, 0, 0.6);
}
.pick {
  display: flex;
  align-items: center;
  gap: 8px;
}
.what {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
}
select,
input {
  background: var(--node);
  color: var(--text);
  border: 1px solid var(--node-border);
  border-radius: 4px;
  padding: 3px 6px;
  font: inherit;
  font-size: 13.5px;
}
select {
  min-width: 220px;
  max-width: 360px;
}
.naming {
  display: flex;
  gap: 6px;
}
.naming input {
  width: 320px;
}
.ask {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.spacer {
  flex: 1;
}
.busy {
  max-width: 420px;
}
button.primary {
  background: var(--accent);
  color: #04131f;
  border: none;
  font-weight: 600;
}
</style>
