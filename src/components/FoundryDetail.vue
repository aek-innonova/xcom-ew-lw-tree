<script setup lang="ts">
// The panel for the selected Foundry project.

import { computed } from 'vue'
import { foundryProgress, foundryState } from '@/model/foundry'
import {
  campaign,
  changedFoundryByIni,
  foundryById,
  foundryReduction,
  planToFoundry,
  showTech,
  state,
  toggleFoundryGoal,
} from '@/state/store'

const project = computed(() =>
  state.selectedFoundry === null ? undefined : foundryById.value.get(state.selectedFoundry),
)

const status = computed(() => {
  const p = project.value
  const c = campaign.value
  if (!p || !c) return undefined
  const building = c.foundryInProgress.find((b) => b.id === p.id)
  const st = foundryState(
    p,
    c.foundryHistory,
    new Set(c.foundryInProgress.map((b) => b.id)),
    c.researched,
  )
  return {
    state: st,
    label: { done: 'Done', building: 'Being built', available: 'Available now', locked: 'Locked' }[
      st
    ],
    building,
    progress: building ? foundryProgress(p, building.workLeft) : undefined,
  }
})

const techDone = (id: number) => campaign.value?.researched[id] ?? false
const anyGoals = computed(() => state.goals.length + state.foundryGoals.length > 0)
</script>

<template>
  <section v-if="project" class="detail" aria-label="Selected Foundry project">
    <header>
      <div>
        <p class="category">Foundry · {{ project.category }}</p>
        <h2>{{ project.name }}</h2>
      </div>
      <button type="button" class="close" title="Close" @click="state.selectedFoundry = null">
        ×
      </button>
    </header>

    <p v-if="status" class="status" :class="status.state">
      {{ status.label }}
      <template v-if="status.building && status.progress">
        · {{ Math.round(status.progress.done * 100) }}% with
        {{ status.building.engineers }} engineers; about {{ status.progress.baseDaysLeft }} days
        left at base speed
      </template>
    </p>
    <p v-if="status?.building" class="note">
      Spare engineers make Foundry work faster (up to about 1.6× in your saves); the days above are
      at base speed.
    </p>

    <div v-if="status?.state !== 'done'" class="plan-actions">
      <button v-if="!anyGoals" type="button" @click="planToFoundry(project.id)">
        Plan research to here
      </button>
      <template v-else-if="state.foundryGoals.includes(project.id)">
        <button type="button" @click="toggleFoundryGoal(project.id)">Remove from plan</button>
      </template>
      <template v-else>
        <button type="button" @click="toggleFoundryGoal(project.id)">Add to plan</button>
        <button type="button" @click="planToFoundry(project.id)">Plan only this</button>
      </template>
    </div>

    <p class="effect">{{ project.effect }}</p>

    <dl class="costs">
      <dt>Base time</dt>
      <dd>{{ project.base_days }} days</dd>
      <dt>Engineers</dt>
      <dd>{{ project.engineers }}</dd>
      <template v-if="project.cost.cash">
        <dt class="cash">Cash</dt>
        <dd>${{ project.cost.cash }}</dd>
      </template>
      <template v-if="project.cost.alloys">
        <dt class="res res-alloys">Alloys</dt>
        <dd>{{ project.cost.alloys }}</dd>
      </template>
      <template v-if="project.cost.elerium">
        <dt class="res res-elerium">Elerium</dt>
        <dd>{{ project.cost.elerium }}</dd>
      </template>
      <template v-if="project.cost.weapon_fragments">
        <dt class="res res-fragments">Fragments</dt>
        <dd>{{ project.cost.weapon_fragments }}</dd>
      </template>
      <template v-if="project.cost.meld">
        <dt class="res res-meld">Meld</dt>
        <dd>{{ project.cost.meld }}</dd>
      </template>
      <template v-if="project.cost.items.length">
        <dt class="res res-items">Items</dt>
        <dd>
          <div v-for="it in project.cost.items" :key="it">{{ it }}</div>
        </dd>
      </template>
      <template v-if="project.research_credit">
        <dt>Credit</dt>
        <dd>{{ project.research_credit }}</dd>
      </template>
    </dl>
    <p v-if="foundryReduction" class="note">
      New Warfare (Asia): {{ Math.round(foundryReduction * 100) }}% off cash, alloys and elerium,
      included above.
    </p>
    <p v-if="changedFoundryByIni.has(project.id)" class="note">
      Cost from your DefaultGameCore.ini.
    </p>

    <section v-if="project.requires_tech">
      <h3>Requires</h3>
      <ul class="links">
        <li>
          <button
            type="button"
            :class="{ done: techDone(project.requires_tech.id) }"
            @click="showTech(project.requires_tech.id)"
          >
            {{ project.requires_tech.name }}
          </button>
        </li>
      </ul>
    </section>
  </section>
</template>

<style scoped>
.detail {
  padding: 16px 18px 20px;
}
header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}
.category {
  margin: 0;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--foundry);
}
h2 {
  margin: 2px 0 0;
  font-size: 19px;
}
.close {
  font-size: 18px;
  line-height: 1;
  padding: 2px 8px;
}
.status {
  margin: 12px 0 0;
  padding: 6px 9px;
  border-radius: 4px;
  border-left: 3px solid var(--node-border);
  background: var(--node);
  font-size: 13px;
}
.status.done {
  border-color: var(--done-text);
}
.status.building {
  border-color: var(--progress);
}
.status.available {
  border-color: var(--available);
}
.plan-actions {
  display: flex;
  gap: 6px;
  margin-top: 12px;
}
.effect {
  margin: 14px 0 0;
  font-size: 13px;
  line-height: 1.45;
}
.costs {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 5px 12px;
  margin: 14px 0 0;
  font-size: 13px;
}
dt {
  color: var(--muted);
}
dd {
  margin: 0;
}
.note {
  font-size: 12px;
  color: var(--accent);
}
h3 {
  margin: 18px 0 6px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
}
ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
.links button {
  font-size: 12.5px;
  padding: 3px 8px;
}
.links button.done::before {
  content: '✓ ';
  color: var(--done-text);
}
</style>
