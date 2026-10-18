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
const INI_WINDOWS = String.raw`steamapps\common\XCom-Enemy-Unknown\XEW\XComGame\Config\DefaultGameCore.ini`
</script>

<template>
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

    <section>
      <h3>Your files stay with you</h3>
      <p>
        Saves and INI files are read in this browser and never uploaded. The page is not even
        allowed to send them anywhere. What it remembers between visits (a summary of the save, your
        costs, your plan) stays in this browser too.
      </p>
    </section>

    <section>
      <h3>Your save</h3>
      <p>
        Load a save to see your campaign on the tree: what is researched, what is in progress, what
        you can start now, and how long things take at your research speed. On Windows the saves are
        in:
      </p>
      <p class="path">
        <code>{{ SAVES_WINDOWS }}</code>
        <button type="button" @click="copy(SAVES_WINDOWS)">
          {{ copied === SAVES_WINDOWS ? 'Copied' : 'Copy' }}
        </button>
      </p>
      <p>
        The files are called <code>save</code> plus a number, with no extension; the highest number
        is usually the newest. Geoscape saves and mid-mission saves both work (a mid-mission save
        shows the campaign as the mission began). Only PC Enemy Within saves have been tested; Mac
        and Linux saves may work but have not been tried.
      </p>
      <p>Pick one with <strong>Load save</strong>, or drop it anywhere on the page.</p>
    </section>

    <section>
      <h3>Following your saves as you play</h3>
      <p>
        In Chrome, Edge and other Chromium browsers, <strong>Watch save folder</strong> lets the
        page follow the SaveData folder: pick it once and every new save shows up by itself. After a
        reload the browser may ask once more for permission.
      </p>
    </section>

    <section>
      <h3>Your DefaultGameCore.ini (optional)</h3>
      <p>
        Without it the site uses stock Long War 1.0 costs. If you have changed your install, load
        your own so research and Foundry costs, and bonus values, match it. With Steam it is under
        the Steam library folder:
      </p>
      <p class="path">
        <code>{{ INI_WINDOWS }}</code>
        <button type="button" @click="copy(INI_WINDOWS)">
          {{ copied === INI_WINDOWS ? 'Copied' : 'Copy' }}
        </button>
      </p>
    </section>

    <section>
      <h3>The views</h3>
      <dl>
        <dt>Research</dt>
        <dd>
          The tech tree, a lane per category, every prerequisite to the left of what needs it. Rest
          on a tech to open its box; click it for details and to plan research towards it.
        </dd>
        <dt>Foundry</dt>
        <dd>The Foundry projects, each beside the tech it needs, with what they cost and do.</dd>
        <dt>History</dt>
        <dd>
          How your campaign went over time: alien activity, research, staff and satellites. It fills
          in as saves are loaded, or all at once from the watched folder.
        </dd>
      </dl>
    </section>

    <section>
      <h3>Colours</h3>
      <ul class="legend">
        <li><i class="sw researched"></i>Researched or built</li>
        <li><i class="sw researching"></i>In progress</li>
        <li><i class="sw available"></i>Available now</li>
        <li><i class="sw locked"></i>Locked</li>
        <li><i class="ln needs"></i>When you rest on a tech: what it still needs</li>
        <li><i class="ln enables"></i>…and what it leads to</li>
        <li><i class="tx foundry"></i>Foundry projects in a tech's unlocks</li>
        <li><span class="approx">≈</span>An estimate at your current research speed</li>
      </ul>
    </section>

    <section>
      <h3>Where the numbers come from</h3>
      <p>
        Costs come from DefaultGameCore.ini, prerequisites from
        <a
          href="https://www.ufopaedia.org/index.php/Research_(Long_War)"
          target="_blank"
          rel="noopener"
          >UFOpaedia</a
        >
        (they may contain errors). Research times, credits and bonuses were checked against the
        game's own figures in about 1,700 saves. <strong>Checks</strong> in the campaign bar keeps
        doing that for every save you load.
      </p>
    </section>
  </dialog>
</template>

<style scoped>
.help {
  width: min(720px, calc(100vw - 32px));
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
  margin-top: 14px;
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
dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px 14px;
  margin: 0;
  font-size: 14px;
  line-height: 1.45;
}
dt {
  font-weight: 600;
}
dd {
  margin: 0;
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
