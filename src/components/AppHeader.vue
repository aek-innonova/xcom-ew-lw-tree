<script setup lang="ts">
// Title, the two file loaders, search, and the privacy promise.

import { computed, ref } from 'vue'
import { search, searchIndex, type SearchEntry } from '@/model/unlocks'
import {
  clearIni,
  clearSave,
  loadFile,
  setGame,
  showFoundry,
  showTech,
  state,
  techs,
  foundry,
} from '@/state/store'
import { chooseFolder, resumeWatch, stopWatch, watcher } from '@/state/watch'
import { GAMES, type GameId } from '@/model/game'

const emit = defineEmits<{
  find: [hit: { view: 'research' | 'foundry'; id: number }]
  help: []
}>()

const saveInput = ref<HTMLInputElement | null>(null)
const iniInput = ref<HTMLInputElement | null>(null)

async function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  for (const file of input.files ?? []) await loadFile(file)
  input.value = ''
}

const query = ref('')
// Techs, what they unlock, and the Foundry projects they open: finding any of
// them selects the tech.
const index = computed(() => searchIndex(techs.value, foundry.value))
const matches = computed<SearchEntry[]>(() => search(index.value, query.value))

/** A Foundry hit opens the project on the Foundry board; anything else, the tech. */
function find(hit: SearchEntry) {
  if (hit.kind === 'foundry' && hit.foundryId !== undefined) {
    showFoundry(hit.foundryId)
    emit('find', { view: 'foundry', id: hit.foundryId })
  } else {
    showTech(hit.techId)
    emit('find', { view: 'research', id: hit.techId })
  }
  query.value = ''
}

/** "14:02", or "12 Oct 14:02" if it was not today. */
function loadedAt(ms: number): string {
  const d = new Date(ms)
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return d.toDateString() === new Date().toDateString()
    ? time
    : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`
}

function onSearchKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && matches.value[0]) find(matches.value[0])
  if (e.key === 'Escape') query.value = ''
}
</script>

<template>
  <header class="bar">
    <h1>Long War <span>Tech Tree</span></h1>
    <select
      class="game"
      :value="state.game"
      aria-label="Game version"
      title="Which game the tree, numbers and rules are for"
      @change="setGame(($event.target as HTMLSelectElement).value as GameId)"
    >
      <option v-for="g in Object.values(GAMES)" :key="g.id" :value="g.id">{{ g.short }}</option>
    </select>

    <div class="views" role="tablist" aria-label="Board">
      <button
        type="button"
        role="tab"
        :aria-selected="state.view === 'research'"
        :class="{ on: state.view === 'research' }"
        @click="state.view = 'research'"
      >
        Research
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="state.view === 'foundry'"
        :class="{ on: state.view === 'foundry' }"
        @click="state.view = 'foundry'"
      >
        Foundry
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="state.view === 'history'"
        :class="{ on: state.view === 'history' }"
        @click="state.view = 'history'"
      >
        History
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="state.view === 'market'"
        :class="{ on: state.view === 'market' }"
        @click="state.view = 'market'"
      >
        Grey market
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="state.view === 'air'"
        :class="{ on: state.view === 'air' }"
        @click="state.view = 'air'"
      >
        Air war
      </button>
    </div>

    <div class="search">
      <input
        v-model="query"
        type="search"
        placeholder="Search techs, items, Foundry"
        aria-label="Find a tech, item or Foundry project"
        @keydown="onSearchKey"
      />
      <ul v-if="matches.length" class="matches" role="listbox">
        <li v-for="m in matches" :key="`${m.kind}:${m.techId}:${m.label}`">
          <button type="button" @mousedown.prevent="find(m)">
            <span class="label" :class="m.kind">{{ m.label }}</span>
            <span v-if="m.kind !== 'tech'" class="via">
              <span v-if="m.kind === 'foundry'" class="foundry-tag">Foundry</span>{{ m.techName }}
            </span>
          </button>
        </li>
      </ul>
    </div>

    <div class="files">
      <div v-if="watcher.supported" class="file watch">
        <button v-if="watcher.status === 'off'" type="button" @click="chooseFolder">
          Watch save folder
        </button>
        <button
          v-else-if="watcher.status === 'needs-permission'"
          type="button"
          @click="resumeWatch"
        >
          Resume watching {{ watcher.folder }}
        </button>
        <span v-else class="watching" role="status">
          <span class="dot" aria-hidden="true"></span>
          Watching {{ watcher.folder }}
        </span>
        <span v-if="watcher.error" class="watch-error">{{ watcher.error }}</span>
        <button
          v-if="watcher.status !== 'off'"
          type="button"
          class="clear"
          aria-label="Stop watching the save folder"
          @click="stopWatch"
        >
          ×
        </button>
      </div>
      <div class="file">
        <button type="button" @click="saveInput?.click()">
          {{ state.save ? 'Change save' : 'Load save' }}
        </button>
        <span v-if="state.save" class="loaded" :title="state.save.campaign.description">
          {{ state.save.fileName
          }}<span v-if="state.save.loadedAt" class="when">
            · {{ loadedAt(state.save.loadedAt) }}</span
          >
          <button type="button" class="clear" title="Forget this save" @click="clearSave">×</button>
        </span>
        <input ref="saveInput" type="file" hidden @change="onPick" />
      </div>
      <div class="file">
        <button type="button" @click="iniInput?.click()">
          {{ state.ini ? 'Change INI' : 'Load DefaultGameCore.ini' }}
        </button>
        <span v-if="state.ini" class="loaded">
          {{ state.ini.fileName }}
          <button type="button" class="clear" title="Back to the built-in costs" @click="clearIni">
            ×
          </button>
        </span>
        <input ref="iniInput" type="file" accept=".ini,text/plain" hidden @change="onPick" />
      </div>
    </div>

    <p class="privacy">Nothing is uploaded.</p>
    <button type="button" class="help-button" @click="emit('help')">Help</button>
  </header>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px 18px;
  padding: 10px 16px;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
}
.game {
  background: var(--node);
  color: var(--text);
  border: 1px solid var(--node-border);
  border-radius: 4px;
  padding: 3px 6px;
  font: inherit;
  font-size: 12.5px;
}
h1 {
  margin: 0;
  font-size: 17px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
}
h1 span {
  color: var(--accent);
}
.views {
  display: flex;
}
.views button {
  border-radius: 0;
}
.views button:first-child {
  border-radius: 4px 0 0 4px;
}
.views button + button {
  border-left: none;
}
.views button:last-child {
  border-radius: 0 4px 4px 0;
}
.views button.on {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--bg);
  font-weight: 600;
}
.search {
  position: relative;
}
.search input {
  width: 250px;
}
.matches {
  position: absolute;
  z-index: 10;
  top: calc(100% + 4px);
  left: 0;
  width: 100%;
  margin: 0;
  padding: 4px;
  list-style: none;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 5px;
  box-shadow: 0 6px 20px rgb(0 0 0 / 0.4);
}
.matches {
  width: 380px;
}
.matches button {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
  text-align: left;
  border: none;
  background: none;
}
.label.foundry {
  color: var(--foundry);
}
.via {
  flex: none;
  max-width: 55%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--muted);
}
.via::before {
  content: '→ ';
}
.via .foundry-tag {
  color: var(--foundry);
}
.matches button:hover {
  background: var(--node);
}
.files {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
}
.file {
  display: flex;
  align-items: center;
  gap: 6px;
}
.loaded {
  font-size: 12.5px;
  color: var(--muted);
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.when {
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.clear {
  padding: 0 6px;
  margin-left: 2px;
}
.watching {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text);
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--done-text);
  box-shadow: 0 0 6px var(--done-text);
  animation: pulse 2s ease-in-out infinite;
}
@keyframes pulse {
  50% {
    opacity: 0.35;
  }
}
.watch-error {
  font-size: 12px;
  color: #ff8a8a;
}
.help-button {
  flex: none;
}
.privacy {
  margin: 0 0 0 auto;
  font-size: 12px;
  color: var(--muted);
}
</style>
