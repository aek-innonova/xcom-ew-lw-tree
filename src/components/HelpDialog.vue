<script setup lang="ts">
// Help: where the files are, what the views show, what the colours mean.
// Opens by itself on a first visit, then from the header's Help button.

import { onMounted, ref, watch } from 'vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const dialog = ref<HTMLDialogElement | null>(null)
const copied = ref<string | null>(null)

watch(
  () => props.open,
  (open) => {
    if (!dialog.value) return
    if (open && !dialog.value.open) dialog.value.showModal?.()
    else if (!open && dialog.value.open) dialog.value.close()
  },
)
onMounted(() => {
  if (props.open) dialog.value?.showModal?.()
})

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = text
    setTimeout(() => (copied.value = null), 1500)
  } catch {
    // Clipboard not available: the path is there to select by hand.
  }
}

const SAVES_WINDOWS = String.raw`Documents\My Games\XCOM - Enemy Within\XComGame\SaveData`
// In the game folder under Steam (steamapps\common\...).
const INI_WINDOWS = String.raw`XCom-Enemy-Unknown\XEW\XComGame\Config\DefaultGameCore.ini`
</script>

<template>
  <!--
    Kept short on purpose: people skim this. Background for whoever edits it:
    - Privacy: files are parsed in the browser; the CSP (connect-src 'self')
      means the page cannot send them anywhere; localStorage keeps only
      extracted summaries (save summary, costs, plan, history), never files.
    - Saves: PC Enemy Within + Long War, tested on ~1,700 saves from one
      Windows machine. Names are "save" + number, no extension. Mid-mission
      saves work (they embed the strategy state; we show it as the mission
      began). Mac/Linux (Feral) saves are untested, so no paths given.
    - Watching: File System Access API, Chromium only; permission may be asked
      again after a reload.
    - INI: optional; Long War's file is XEW/XComGame/Config/DefaultGameCore.ini
      in the Steam install. Sets research and Foundry costs and bonus values.
    - Numbers: prerequisites from UFOpaedia (may contain errors); research
      time, credits and bonuses verified against the game's own figures
      (features/history-verification.md); Checks keeps verifying per save.
  -->
  <dialog
    ref="dialog"
    class="help"
    aria-labelledby="help-title"
    @close="emit('close')"
    @cancel="emit('close')"
  >
    <header>
      <h2 id="help-title">How this works</h2>
      <button type="button" class="close" aria-label="Close help" @click="emit('close')">×</button>
    </header>

    <p class="lead">Your files are read in this browser. Nothing is uploaded.</p>

    <section>
      <h3>Saves</h3>
      <p class="path">
        <code>{{ SAVES_WINDOWS }}</code>
        <button type="button" @click="copy(SAVES_WINDOWS)">
          {{ copied === SAVES_WINDOWS ? 'Copied' : 'Copy' }}
        </button>
      </p>
      <p>
        Files named <code>save</code> + a number; the highest is the newest. Drop one on the page,
        or <strong>Watch save folder</strong> (Chrome, Edge) to follow new saves as you play.
      </p>
    </section>

    <section>
      <h3>DefaultGameCore.ini <span class="opt">optional</span></h3>
      <p class="path">
        <code>{{ INI_WINDOWS }}</code>
        <button type="button" @click="copy(INI_WINDOWS)">
          {{ copied === INI_WINDOWS ? 'Copied' : 'Copy' }}
        </button>
      </p>
      <p>Only if you changed your install: your costs instead of stock Long War 1.0.</p>
    </section>

    <section>
      <h3>Colours</h3>
      <ul class="legend">
        <li><i class="sw researched"></i>Done</li>
        <li><i class="sw researching"></i>In progress</li>
        <li><i class="sw available"></i>Available now</li>
        <li><i class="sw locked"></i>Locked</li>
        <li><i class="ln needs"></i>Still needed (on hover)</li>
        <li><i class="ln enables"></i>Leads to (on hover)</li>
        <li><i class="tx foundry"></i>Foundry project</li>
        <li><span class="approx">≈</span>Estimate</li>
      </ul>
    </section>

    <p class="small">
      Prerequisites from
      <a
        href="https://www.ufopaedia.org/index.php/Research_(Long_War)"
        target="_blank"
        rel="noopener"
        >UFOpaedia</a
      >
      may contain errors. Times are checked against the game's own: see <strong>Checks</strong>.
    </p>
  </dialog>
</template>

<style scoped>
.help {
  width: min(600px, calc(100vw - 32px));
  max-height: calc(100vh - 48px);
  padding: 0 24px 20px;
  color: var(--text);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 12px 40px rgb(0 0 0 / 0.6);
}
.help::backdrop {
  background: rgb(4 10 16 / 0.7);
}
header {
  position: sticky;
  top: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 18px 0 10px;
  background: var(--panel);
}
h2 {
  margin: 0;
  font-size: 19px;
}
.close {
  font-size: 18px;
  line-height: 1;
  padding: 2px 9px;
}
section {
  margin-top: 16px;
}
.lead {
  margin: 0;
  font-size: 14.5px;
}
.opt {
  margin-left: 6px;
  font-size: 10px;
  color: var(--muted);
  letter-spacing: 0.04em;
}
.small {
  margin-top: 18px;
  font-size: 12.5px;
  color: var(--muted);
}
h3 {
  margin: 0 0 6px;
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--accent);
}
p {
  margin: 6px 0;
  font-size: 14px;
  line-height: 1.5;
}
code {
  font-size: 13px;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--bg);
  border: 1px solid var(--border);
}
.path {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.path code {
  user-select: all;
  word-break: break-all;
}
.path button {
  padding: 2px 9px;
  font-size: 12px;
}
.legend {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 18px;
  font-size: 13.5px;
}
.legend li {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sw {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  border: 1.5px solid var(--node-border);
  background: var(--node);
  flex: none;
}
.sw.researched {
  background: var(--done);
  border-color: var(--done-border);
}
.sw.researching {
  border-color: var(--progress);
}
.sw.available {
  border-color: var(--available);
}
.sw.locked {
  background: var(--locked);
}
.ln {
  width: 16px;
  height: 0;
  border-top: 2px solid;
  flex: none;
}
.ln.needs {
  border-color: var(--accent);
}
.ln.enables {
  border-color: var(--enables);
}
.tx {
  width: 14px;
  height: 14px;
  flex: none;
  border-radius: 3px;
}
.tx.foundry {
  background: var(--foundry);
}
.approx {
  width: 14px;
  text-align: center;
  color: var(--muted);
  flex: none;
}
</style>
