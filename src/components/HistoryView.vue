<script setup lang="ts">
// The History view: how the loaded campaign went over in-game time, from the
// snapshots of its saves, plus when each tech was finished.

import { computed, ref } from 'vue'
import { formatCampaignDay, type Snapshot } from '@/model/history'
import {
  campaign,
  campaignHistory,
  clearHistory,
  importSaves,
  state,
  techs,
  categories,
} from '@/state/store'
import { importCampaignFromFolder, watcher } from '@/state/watch'
import LineChart, { type Series } from './charts/LineChart.vue'
import ResearchTimeline from './charts/ResearchTimeline.vue'

const BLUE = '#3987e5'
const ORANGE = '#d95926'

const asTable = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

const snaps = computed(() => campaignHistory.value)
const xDomain = computed<[number, number]>(() => {
  const days = [
    0,
    ...snaps.value.map((s) => s.day),
    ...(campaign.value?.researchedOn.filter((d): d is number => d !== undefined) ?? []),
    campaign.value?.campaignDay ?? 0,
  ]
  return [0, Math.max(30, ...days)]
})

function series(name: string, pick: (s: Snapshot) => number | undefined, color = BLUE): Series {
  return {
    name,
    color,
    points: snaps.value.flatMap((s) => {
      const y = pick(s)
      return y === undefined ? [] : [{ x: s.day, y }]
    }),
  }
}

const charts = computed(() => [
  { title: 'Alien resources', series: [series('Alien resources', (s) => s.alienResources)] },
  { title: 'XCOM threat this month', series: [series('XCOM threat', (s) => s.xcomThreat)] },
  {
    title: 'Alien bonus research',
    series: [series('Alien bonus research', (s) => s.alienBonusResearch)],
    zero: true,
  },
  { title: 'Techs researched', series: [series('Techs', (s) => s.researched)], step: true },
  {
    title: 'Scientists and engineers',
    series: [
      series('Scientists', (s) => s.scientists),
      series('Engineers', (s) => s.engineers, ORANGE),
    ],
  },
  {
    title: 'Countries with satellites',
    series: [series('Satellites', (s) => s.satellites)],
    step: true,
  },
])

async function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  await importSaves(
    files.map((f) => ({
      name: f.name,
      head: async () => new Uint8Array(await f.slice(0, 12).arrayBuffer()),
      bytes: async () => new Uint8Array(await f.arrayBuffer()),
    })),
    campaign.value?.gameNumber,
  )
}

const canImportFolder = computed(() => watcher.status === 'watching')

async function importFromFolder() {
  if (!campaign.value) return
  try {
    await importCampaignFromFolder(campaign.value.gameNumber)
  } catch (e) {
    state.importing = null
    state.message = { kind: 'error', text: `Could not read the folder: ${(e as Error).message}` }
  }
}
</script>

<template>
  <section class="history" aria-label="Campaign history">
    <p v-if="!campaign" class="empty">Load a save to see its campaign's history.</p>
    <template v-else>
      <div class="bar">
        <h2>Campaign {{ campaign.gameNumber }} over time</h2>
        <span class="muted"
          >{{ snaps.length }} {{ snaps.length === 1 ? 'save' : 'saves' }} in the history</span
        >
        <button
          v-if="canImportFolder"
          type="button"
          :disabled="!!state.importing"
          @click="importFromFolder"
        >
          Add this campaign's saves from {{ watcher.folder }}
        </button>
        <button type="button" :disabled="!!state.importing" @click="fileInput?.click()">
          Add saves…
        </button>
        <input ref="fileInput" type="file" multiple hidden @change="onPick" />
        <span v-if="state.importing" class="muted" role="status">
          Reading {{ state.importing.done }} of {{ state.importing.total }}…
        </span>
        <span class="spacer"></span>
        <button type="button" :aria-pressed="asTable" @click="asTable = !asTable">
          {{ asTable ? 'Charts' : 'Table' }}
        </button>
        <button v-if="snaps.length" type="button" @click="clearHistory(campaign.gameNumber)">
          Clear history
        </button>
      </div>

      <p v-if="snaps.length < 2" class="hint">
        The history fills in as saves are loaded or picked up from the watched folder. To fill it at
        once, add this campaign's saves<template v-if="canImportFolder">
          from the watched folder</template
        >
        <template v-else> (Add saves…, or watch the save folder)</template>; only campaign
        {{ campaign.gameNumber }}'s saves are read.
      </p>

      <table v-if="asTable && snaps.length" class="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Save</th>
            <th>Techs</th>
            <th>Scientists</th>
            <th>Engineers</th>
            <th>Satellites</th>
            <th>Alien resources</th>
            <th>XCOM threat</th>
            <th>Bonus research</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in snaps" :key="s.save">
            <td>{{ formatCampaignDay(s.day) }}</td>
            <td>{{ s.fileName }}{{ s.tactical ? ' (mission)' : '' }}</td>
            <td>{{ s.researched }}</td>
            <td>{{ s.scientists ?? '–' }}</td>
            <td>{{ s.engineers ?? '–' }}</td>
            <td>{{ s.satellites }}</td>
            <td>{{ s.alienResources ?? '–' }}</td>
            <td>{{ s.xcomThreat ?? '–' }}</td>
            <td>{{ s.alienBonusResearch ?? '–' }}</td>
          </tr>
        </tbody>
      </table>
      <div v-else-if="snaps.length" class="grid">
        <LineChart
          v-for="c in charts"
          :key="c.title"
          :title="c.title"
          :series="c.series"
          :x-domain="xDomain"
          :step="c.step"
          :zero="c.zero"
        />
      </div>

      <ResearchTimeline
        class="timeline"
        :techs="techs"
        :categories="categories"
        :researched-on="campaign.researchedOn"
        :x-domain="xDomain"
      />
      <p class="foot">
        The alien counters are Long War's hidden ones (see Stats); their names are read from how
        they behave. Mid-mission saves show the campaign as the mission began.
      </p>
    </template>
  </section>
</template>

<style scoped>
.history {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px 24px;
}
.empty,
.hint {
  color: var(--muted);
  font-size: 13.5px;
}
.bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}
h2 {
  margin: 0;
  font-size: 16px;
}
.muted {
  color: var(--muted);
  font-size: 13px;
}
.spacer {
  flex: 1;
}
.grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin-top: 14px;
}
@media (max-width: 1100px) {
  .grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
.timeline {
  margin-top: 14px;
}
.table {
  margin-top: 14px;
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
}
.table th {
  text-align: left;
  color: var(--muted);
  font-weight: 600;
  padding: 5px 8px;
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  background: var(--bg);
}
.table td {
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
}
.foot {
  margin-top: 12px;
  font-size: 12px;
  color: var(--muted);
}
</style>
