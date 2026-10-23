<script setup lang="ts">
// Putting the setup into the game, told where it was asked for
// (features/game-setups.md): right under the setup bar, a console that says
// each step as it happens ("Reading Long War 1.0…", "Working out what
// changes…"), then the plan (the files that will change, to write or
// cancel) or that there is nothing to change, then what was written. Not a
// box at the bottom of the page that the page scrolls to.

import { computed, nextTick, ref, watch } from 'vue'
import { EXE } from '@/state/baseplan'
import { BACKUP } from '@/state/setup'
import { applyPlanNow, baseName, cancelPlan, gameKind, tools } from '@/state/tools'

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
/** A step without its count: "Unpacking LWR: 12 of 149 files" is the same step as "…: 13 of 149". */
const stepOf = (text: string) => text.replace(/\d+ of \d+/g, '#').replace(/…$/, '')
watch(
  () => tools.busy,
  (b) => {
    if (!props.open || !b) return
    const last = lines.value[lines.value.length - 1]
    // Progress through a step updates its line; a new step adds one.
    if (last !== undefined && stepOf(last) === stepOf(b)) lines.value[lines.value.length - 1] = b
    else lines.value.push(b)
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

/** Said first when the plan puts another version in place of the one in the game. */
const replaces = computed(() => {
  const now = tools.install?.kind
  return now && now !== gameKind() ? { from: baseName(now), to: baseName(gameKind()) } : null
})

const panel = ref<HTMLElement | null>(null)
/** The list that scrolls; the buttons below it are part of the frame, always in sight. */
const list = ref<HTMLElement | null>(null)
// While files are written, the newest line in sight.
watch(
  () => [tools.log.length, lines.value.length, written.value],
  async () => {
    await nextTick()
    if (list.value && (tools.busy || written.value)) list.value.scrollTop = list.value.scrollHeight
  },
)
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
    <div ref="list" class="list">
      <p v-for="(l, i) in lines" :key="i" class="step">
        <span class="prompt">›</span> {{ l.replace(/…$/, '')
        }}<span v-if="i < lines.length - 1 || !tools.busy" class="ok"> ✓</span
        ><span v-else class="dots">…</span>
      </p>
      <p v-if="tools.error" class="error"><span class="prompt">!</span> {{ tools.error }}</p>

      <template v-if="tools.plan && !tools.busy">
        <p v-if="!tools.plan.changes.length" class="result ok">
          ✓ Nothing to change: the game already has this setup<template v-if="tools.plan.base">
            on {{ tools.plan.base }}</template
          >.
        </p>
        <template v-else>
          <p v-if="replaces" class="result switch">
            This replaces {{ replaces.from }} in the game with {{ replaces.to }}, under its own
            setup.
          </p>
          <p class="result">
            These files will change<template v-if="tools.plan.base">
              for {{ tools.plan.base }} under this setup</template
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
        <p v-if="tools.plan.changes.length" class="muted small before">
          The game must be closed while these are written. Each file's original is kept in
          <code>XComGame\{{ BACKUP }}</code> before it is first replaced, a file the app does not
          recognise too, so the game can always go back.
        </p>
      </template>

      <template v-if="written">
        <p v-for="l in tools.log" :key="l" class="step written">
          <span class="prompt">›</span> {{ l }}
        </p>
        <p class="result ok">✓ Done. The game is ready to start.</p>
      </template>
    </div>

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
  /* The list scrolls; the buttons stay at the bottom of the frame. */
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #050c13;
  border: 1px solid var(--node-border);
  border-radius: 4px;
  font-size: 13px;
  outline: none;
}
.console p {
  margin: 2px 0;
}
.list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
.console > .actions {
  flex: none;
  margin: 6px 0 0;
  padding-top: 6px;
  border-top: 1px solid var(--node-border);
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
.before {
  margin-top: 6px !important;
}
.switch {
  color: var(--accent);
  font-weight: 600;
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
button.primary:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
