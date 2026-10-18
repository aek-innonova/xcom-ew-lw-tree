<script setup lang="ts">
// One line about the loaded campaign: where it stands and how fast it researches.

import { computed } from 'vue'
import { difficultyName } from '@/save/campaign'
import { pointsPerHour, projectDaysLeft } from '@/model/research'
import { campaign, state, techById, techs } from '@/state/store'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const info = computed(() => {
  const c = campaign.value
  if (!c) return undefined
  const done = techs.value.filter((t) => c.researched[t.id]).length
  const bonus = Math.round(((c.labBonus ?? 0) + (c.adjacentLabBonus ?? 0)) * 100)
  const project = c.project ? techById.value.get(c.project.tech) : undefined
  const days = projectDaysLeft(c)
  return {
    date: c.date ? `${c.date.day} ${MONTHS[c.date.month - 1]} ${c.date.year}` : undefined,
    difficulty: difficultyName(c.difficulty),
    game: c.gameNumber,
    done,
    total: techs.value.length,
    scientists: c.scientists,
    bonus,
    rate: pointsPerHour(c),
    project: project?.name,
    projectId: project?.id,
    days,
    tactical: c.tactical,
    ironman: c.ironman,
  }
})
</script>

<template>
  <div v-if="info" class="campaign">
    <span v-if="info.date"
      ><strong>{{ info.date }}</strong></span
    >
    <span
      >Campaign {{ info.game }}<template v-if="info.difficulty">, {{ info.difficulty }}</template
      ><template v-if="info.ironman">, Ironman</template></span
    >
    <span
      ><strong>{{ info.done }}</strong> of {{ info.total }} researched</span
    >
    <span
      v-if="info.scientists !== undefined"
      :title="info.rate ? `${Math.round(info.rate)} research points per hour` : undefined"
    >
      {{ info.scientists }} scientists<template v-if="info.bonus">
        +{{ info.bonus }}% labs</template
      >
    </span>
    <span v-if="info.project">
      Researching
      <button type="button" class="link" @click="state.selected = info.projectId ?? null">
        {{ info.project }}
      </button>
      <template v-if="info.days"
        >, {{ info.days }} {{ info.days === 1 ? 'day' : 'days' }} left</template
      >
    </span>
    <span v-else>No research in progress</span>
    <span v-if="info.tactical" class="note"
      >Mid-mission save: research as of the mission's start</span
    >
    <span class="legend">
      <i class="sw researched"></i>researched <i class="sw researching"></i>researching
      <i class="sw available"></i>available <i class="sw locked"></i>locked · ≈ estimate
    </span>
  </div>
</template>

<style scoped>
.campaign {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 20px;
  padding: 7px 16px;
  font-size: 13px;
  background: var(--lane-alt);
  border-bottom: 1px solid var(--border);
}
.link {
  border: none;
  background: none;
  padding: 0;
  color: var(--accent);
  font: inherit;
  cursor: pointer;
  text-decoration: underline dotted;
}
.note {
  color: var(--progress);
}
.legend {
  margin-left: auto;
  color: var(--muted);
  font-size: 12px;
}
.sw {
  display: inline-block;
  width: 11px;
  height: 11px;
  margin: 0 4px -1px 8px;
  border-radius: 3px;
  border: 1.5px solid var(--node-border);
  background: var(--node);
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
</style>
