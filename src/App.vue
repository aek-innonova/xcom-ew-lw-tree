<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import AppHeader from '@/components/AppHeader.vue'
import CampaignBar from '@/components/CampaignBar.vue'
import PlanPanel from '@/components/PlanPanel.vue'
import TechDetail from '@/components/TechDetail.vue'
import TechTree from '@/components/TechTree.vue'
import { loadFile, state } from '@/state/store'

const tree = ref<InstanceType<typeof TechTree> | null>(null)
const dragging = ref(false)
let depth = 0

// Files can be dropped anywhere on the page.
function onDragEnter(e: DragEvent) {
  if (!e.dataTransfer?.types.includes('Files')) return
  depth++
  dragging.value = true
}
function onDragLeave() {
  depth = Math.max(0, depth - 1)
  if (depth === 0) dragging.value = false
}
function onDragOver(e: DragEvent) {
  if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
}
async function onDrop(e: DragEvent) {
  e.preventDefault()
  depth = 0
  dragging.value = false
  for (const file of e.dataTransfer?.files ?? []) await loadFile(file)
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) state.selected = null
}

onMounted(() => {
  window.addEventListener('dragenter', onDragEnter)
  window.addEventListener('dragleave', onDragLeave)
  window.addEventListener('dragover', onDragOver)
  window.addEventListener('drop', onDrop)
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  window.removeEventListener('dragenter', onDragEnter)
  window.removeEventListener('dragleave', onDragLeave)
  window.removeEventListener('dragover', onDragOver)
  window.removeEventListener('drop', onDrop)
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div class="app">
    <AppHeader @find="tree?.centerOn($event)" />
    <CampaignBar />
    <p v-if="state.message" class="message" :class="state.message.kind" role="status">
      {{ state.message.text }}
      <button type="button" class="dismiss" title="Dismiss" @click="state.message = null">×</button>
    </p>
    <main class="main">
      <TechTree ref="tree" />
      <aside v-if="state.selected !== null || state.goals.length" class="side">
        <TechDetail />
        <PlanPanel />
      </aside>
    </main>
    <footer class="foot">
      Long War 1.0 research tree. Costs from DefaultGameCore.ini; prerequisites from
      <a
        href="https://www.ufopaedia.org/index.php/Research_(Long_War)"
        target="_blank"
        rel="noopener"
        >UFOpaedia</a
      >
      and may contain errors. Drop a save (Documents\My Games\XCOM - Enemy Within\XComGame\SaveData)
      or your DefaultGameCore.ini anywhere on the page.
    </footer>
    <div v-if="dragging" class="dropzone">Drop a save or DefaultGameCore.ini</div>
  </div>
</template>

<style>
:root {
  --bg: #08121c;
  --panel: #0d1b29;
  --border: #1d3348;
  --lane: #0c1824;
  --lane-alt: #0f1d2b;
  --node: #13263a;
  --node-border: #2c4a66;
  --text: #dbe8f3;
  --muted: #8299ad;
  --accent: #4cc3ef;
  --edge: #3b5a77;
  --done: #12301f;
  --done-border: #2f7a4c;
  --done-text: #5fd38d;
  --progress: #f0b443;
  --available: #4cc3ef;
  --locked: #0f1c29;
  --alloys: #b8c4cf;
  --elerium: #c08cff;
  --fragments: #f39a4c;
  --items: #8fd0a8;
  color-scheme: dark;
}
* {
  box-sizing: border-box;
}
html,
body,
#app {
  height: 100%;
  margin: 0;
}
body {
  background: var(--bg);
  color: var(--text);
  font:
    14px/1.4 system-ui,
    -apple-system,
    'Segoe UI',
    Roboto,
    sans-serif;
}
button {
  font: inherit;
  font-size: 13px;
  color: var(--text);
  background: var(--node);
  border: 1px solid var(--node-border);
  border-radius: 4px;
  padding: 5px 11px;
  cursor: pointer;
}
button:hover {
  border-color: var(--accent);
}
input[type='search'] {
  font: inherit;
  font-size: 13px;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--node-border);
  border-radius: 4px;
  padding: 5px 9px;
}
input[type='search']:focus {
  outline: none;
  border-color: var(--accent);
}
a {
  color: var(--accent);
}
</style>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.main {
  flex: 1;
  display: flex;
  min-height: 0;
}
.side {
  width: 340px;
  flex: none;
  overflow-y: auto;
  background: var(--panel);
  border-left: 1px solid var(--border);
}
.message {
  margin: 0;
  padding: 6px 16px;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid var(--border);
}
.message.info {
  background: #0f2a22;
}
.message.error {
  background: #3a1518;
}
.dismiss {
  margin-left: auto;
  padding: 0 7px;
}
.foot {
  padding: 6px 16px;
  font-size: 11.5px;
  color: var(--muted);
  border-top: 1px solid var(--border);
}
.dropzone {
  position: fixed;
  inset: 12px;
  display: grid;
  place-items: center;
  font-size: 22px;
  border: 3px dashed var(--accent);
  border-radius: 12px;
  background: rgb(8 18 28 / 0.85);
  pointer-events: none;
}
</style>
