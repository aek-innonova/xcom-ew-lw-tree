<script setup lang="ts">
// Putting the setup into the game, told where it was asked for
// (features/game-setups.md): right under the setup bar, a console that says
// each step as it happens ("Reading Long War 1.0…", "Working out what
// changes…"), then the plan (the files that will change, to write or
// cancel) or that there is nothing to change, then what was written. Not a
// box at the bottom of the page that the page scrolls to.

import { computed, nextTick, ref, watch } from 'vue'
import { EXE } from '@/state/baseplan'
import { applyPlanNow, cancelPlan, tools } from '@/state/tools'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

/** What has happened since Apply was pressed, a line a step. */
const lines = ref<string[]>([])
watch(
  () => props.open,
  (now) => {
    if (now) lines.value = []
  },
)
watch(
  () => tools.busy,
  (b) => {
    if (props.open && b && lines.value[lines.value.length - 1] !== b) lines.value.push(b)
  },
)

const ACTION_TEXT = { write: 'changed', create: 'added', remove: 'removed' }
const shown = (path: string) => (path === EXE ? 'XEW\\Binaries\\Win32\\XComEW.exe' : path)
function keptText(c: { keep?: { to: string }[] }): string {
  const k = c.keep ?? []
  if (!k.length) return ''
  const aside = k.find((x) => x.to.includes('/found-'))
  return aside
    ? ` (the file as it is now kept first in ${aside.to.split('/').slice(0, 2).join('/')}/)`
    : ' (the game’s own kept first)'
}

const written = computed(() => !tools.plan && tools.log.length > 0)

const panel = ref<HTMLElement | null>(null)
// Keyboard focus to the console when there is something to do or read.
watch(
  () => [tools.plan, written.value],
  async () => {
    if (!props.open) return
    await nextTick()
    panel.value?.focus({ preventScroll: true })
  },
)

function close() {
  if (tools.plan) cancelPlan()
  emit('close')
}
</script>

<template>
  <div
    v-if="open"
    ref="panel"
    class="console"
    role="region"
    aria-label="What will change"
    aria-live="polite"
    tabindex="-1"
  >
    <p v-for="(l, i) in lines" :key="i" class="step">
      <span class="prompt">›</span> {{ l.replace(/…$/, '')
      }}<span v-if="i < lines.length - 1 || !tools.busy" class="ok"> ✓</span
      ><span v-else class="dots">…</span>
    </p>
    <p v-if="tools.error" class="error"><span class="prompt">!</span> {{ tools.error }}</p>

    <template v-if="tools.plan && !tools.busy">
      <p v-if="!tools.plan.changes.length" class="result ok">
        ✓ Nothing to change: the game already has your setup<template v-if="tools.plan.base">
          on {{ tools.plan.base }}</template
        >.
      </p>
      <template v-else>
        <p class="result">
          These files will change<template v-if="tools.plan.base">
            for {{ tools.plan.base }} under your setup</template
          >:
        </p>
        <ul class="changes">
          <li v-for="c in tools.plan.changes" :key="c.path">
            <code>{{ shown(c.path) }}</code> {{ ACTION_TEXT[c.action] }}
            <span class="muted">: {{ c.why.join(', ') }}</span>
            <span v-if="c.backup" class="muted"> (original kept first)</span>
            <span v-if="c.keep?.length" class="muted">{{ keptText(c) }}</span>
          </li>
        </ul>
      </template>
      <ul v-if="tools.plan.problems.length" class="problems">
        <li v-for="p in tools.plan.problems" :key="p" class="error">{{ p }}</li>
      </ul>
    </template>

    <template v-if="written">
      <p v-for="l in tools.log" :key="l" class="step written">
        <span class="prompt">›</span> {{ l }}
      </p>
      <p class="result ok">✓ Done. Start the game when you are ready.</p>
    </template>

    <p class="actions">
      <button
        v-if="tools.plan?.changes.length && !tools.busy"
        type="button"
        class="primary"
        @click="applyPlanNow"
      >
        Write these changes
      </button>
      <button v-if="!tools.busy" type="button" @click="close">
        {{ tools.plan?.changes.length ? 'Cancel' : 'Close' }}
      </button>
    </p>
  </div>
</template>

<style scoped>
.console {
  margin: 8px 0 2px;
  padding: 8px 12px;
  max-height: 46vh;
  overflow-y: auto;
  background: #050c13;
  border: 1px solid var(--node-border);
  border-radius: 4px;
  font-size: 13px;
  outline: none;
}
.console p {
  margin: 2px 0;
}
.step {
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  font-size: 12.5px;
  color: var(--muted);
}
.step.written {
  color: var(--text);
}
.prompt {
  color: var(--accent);
}
.ok {
  color: var(--done-text);
}
.dots {
  color: var(--accent);
  animation: blink 1s steps(2) infinite;
}
@keyframes blink {
  50% {
    opacity: 0.2;
  }
}
.result {
  margin-top: 6px !important;
  font-size: 13.5px;
}
.changes,
.problems {
  margin: 4px 0;
  padding-left: 18px;
  font-size: 12.5px;
}
.changes {
  max-height: 30vh;
  overflow-y: auto;
}
.muted {
  color: var(--muted);
}
.error {
  color: var(--danger, #e66);
}
.actions {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 8px !important;
}
button.primary {
  background: var(--accent);
  color: #04131f;
  border: none;
  font-weight: 600;
}
</style>
