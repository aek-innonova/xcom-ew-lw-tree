<script setup lang="ts">
// The setup bar at the top of Tools (features/game-setups.md): the game
// version, chosen with buttons since every version has its own setup
// (features/version-setups.md); which of the version's saved setups the
// choices below are, switching to another, saving as a new one (with a name
// offered); and putting the setup into the game. It stays in view while the
// page scrolls, so what the tool does is never at the bottom.

import { computed, nextTick, ref, watch } from 'vue'
import ApplyConsole from './ApplyConsole.vue'
import { desktop } from '@/state/desktop'
import type { GameKind } from '@/state/library'
import {
  baseAvailable,
  baseName,
  canChoose,
  deleteSetup,
  gameKind,
  makePlan,
  resetToGame,
  saveSetup,
  setBase,
  suggestSetupName,
  tools,
  useSetup,
} from '@/state/tools'

const VERSIONS: { kind: GameKind; needs: string }[] = [
  { kind: 'ew', needs: 'needs the Long War installer in the library, to know its files' },
  { kind: 'lw', needs: 'needs the Long War installer in the library' },
  { kind: 'lwr', needs: 'needs the Long War installer and the LWR download in the library' },
]
const label = (k: GameKind) => baseName(k).replace(/^./, (c) => c.toUpperCase())
/** What the button says under the name: in the game now, or what it takes. */
function note(k: GameKind): string {
  if (tools.install?.kind === k) return 'in the game'
  return baseAvailable(k) ? 'from the library' : VERSIONS.find((v) => v.kind === k)!.needs
}
/** Apply puts another version in place of the one in the game. */
const switchTo = computed(() =>
  tools.install && gameKind() !== tools.install.kind ? label(gameKind()) : null,
)
async function choose(k: GameKind) {
  if (k === gameKind() || !canChoose(k)) return
  naming.value = false
  switching.value = null
  deleting.value = false
  consoleOpen.value = false
  await setBase(k)
}

const NEW = '\u0000new'
const SAVE = '\u0000save'
const DELETE = '\u0000delete'
const UNDO = '\u0000undo'
const GAME = '\u0000game'
const ALONE = '\u0000alone'

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
  // Back to the saved setup, dropping the changes since: asked for by name.
  if (v === UNDO && tools.setupFrom) return useSetup(tools.setupFrom)
  if (v === DELETE) {
    deleting.value = true
    return
  }
  if (v === current.value || !v) return
  // The version on its own: a plan without the mods and settings (the choices stay).
  if (v === ALONE) {
    consoleOpen.value = true
    return makePlan(false)
  }
  if (v === GAME) {
    if (unsaved.value && hasChoices.value) {
      switching.value = GAME
      return
    }
    return toGame()
  }
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
    if (next === GAME) await toGame()
    else await useSetup(next)
  }
}
async function switchAnyway() {
  const next = switching.value
  switching.value = null
  if (next === GAME) await toGame()
  else if (next) await useSetup(next)
}
/** Said for a moment after the choices are set to the game's. */
const notice = ref('')
async function toGame() {
  await resetToGame()
  notice.value = 'Now what the game has: applying changes nothing.'
  setTimeout(() => (notice.value = ''), 6000)
}
async function onDelete() {
  const n = tools.setupInUse ?? tools.setupFrom
  deleting.value = false
  if (n) await deleteSetup(n)
}

/** Makes the plan, told step by step in the console under the bar. */
const consoleOpen = ref(false)
async function apply() {
  consoleOpen.value = true
  await makePlan(true)
}
// A plan made from elsewhere (the "no mods" choice below) shows here too.
watch(
  () => tools.plan,
  (p) => {
    if (p) consoleOpen.value = true
  },
)
</script>

<template>
  <div class="setup-bar" role="region" aria-label="Setup">
    <div
      v-if="tools.install && desktop?.bases"
      class="versions"
      role="group"
      aria-label="Version in the game"
    >
      <button
        v-for="v in VERSIONS"
        :key="v.kind"
        type="button"
        class="version"
        :class="{ chosen: v.kind === gameKind(), installed: v.kind === tools.install.kind }"
        :aria-pressed="v.kind === gameKind()"
        :disabled="!!tools.busy || (!canChoose(v.kind) && v.kind !== gameKind())"
        @click="choose(v.kind)"
      >
        <span class="v-name">{{ label(v.kind) }}</span>
        <span class="v-note">{{ note(v.kind) }}</span>
      </button>
    </div>
    <label class="pick">
      <span class="what">Setup</span>
      <select
        :value="current"
        aria-label="Setup"
        :disabled="!!tools.busy"
        title="The mods ticked and their options, the game and INI settings of this version, under a name"
        @change="onPick"
      >
        <option v-if="!tools.setupInUse && !tools.setupFrom" value="" disabled>
          Not saved yet
        </option>
        <option v-if="changed" :value="current" disabled>{{ tools.setupFrom }}, changed</option>
        <option v-for="x in tools.setups" :key="x.name" :value="x.name">{{ x.name }}</option>
        <option disabled>──────────</option>
        <option v-if="changed" :value="SAVE">Save the changes to {{ tools.setupFrom }}</option>
        <option v-if="changed" :value="UNDO">Undo my changes to {{ tools.setupFrom }}</option>
        <option v-if="tools.install" :value="GAME">Back to what the game has now…</option>
        <option v-if="tools.install" :value="ALONE">
          {{ label(gameKind()) }} alone, without mods or settings…
        </option>
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
      The current choices are not saved.
      <button type="button" @click="startNaming">Save them first…</button>
      <button type="button" @click="switchAnyway">
        {{ switching === GAME ? 'Use what the game has' : `Switch to ${switching}` }}
      </button>
      <button type="button" @click="switching = null">Cancel</button>
    </span>
    <span v-else-if="deleting" class="ask small">
      Delete {{ tools.setupInUse ?? tools.setupFrom }}? The choices below stay as they are.
      <button type="button" @click="onDelete">Delete it</button>
      <button type="button" @click="deleting = false">Cancel</button>
    </span>
    <span v-else-if="notice" class="state small present" role="status">{{ notice }}</span>
    <span v-else-if="tools.setupInUse" class="state small present">in use</span>
    <span v-else-if="changed" class="state small muted">changed since saved</span>

    <span class="spacer" />
    <span v-if="tools.busy && !consoleOpen" class="muted small busy">{{ tools.busy }}</span>
    <button
      v-if="tools.install"
      type="button"
      class="primary apply"
      :disabled="!!tools.busy"
      @click="apply"
    >
      {{ switchTo ? `Switch the game to ${switchTo}…` : 'Apply the setup…' }}
    </button>
    <ApplyConsole :open="consoleOpen" class="console" @close="consoleOpen = false" />
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
.versions {
  display: flex;
  flex-basis: 100%;
  gap: 8px;
  flex-wrap: wrap;
}
.version {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  min-width: 190px;
  padding: 6px 14px;
  border: 1px solid var(--node-border);
  border-radius: 5px;
  background: var(--node);
  color: var(--text);
  cursor: pointer;
  text-align: left;
}
.version:hover:not(:disabled):not(.chosen) {
  border-color: var(--accent);
}
.version.chosen {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 16%, var(--node));
  box-shadow: inset 0 0 0 1px var(--accent);
  cursor: default;
}
.version:disabled:not(.chosen) {
  opacity: 0.5;
  cursor: default;
}
.v-name {
  font-size: 14px;
  font-weight: 600;
}
.v-note {
  font-size: 11.5px;
  color: var(--muted);
}
.version.installed .v-note {
  color: var(--done-text);
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
.console {
  flex-basis: 100%;
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
button.primary:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
