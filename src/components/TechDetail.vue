<script setup lang="ts">
// The panel for the selected tech: what it costs, what it needs, what it gives.

import { computed } from 'vue'
import { estimate, researchContext, techState } from '@/model/research'
import { campaign, changedByIni, planTo, state, techById, techs, toggleGoal } from '@/state/store'

const tech = computed(() =>
  state.selected === null ? undefined : techById.value.get(state.selected),
)
const ctx = computed(() =>
  campaign.value ? researchContext(campaign.value, techs.value) : undefined,
)

const status = computed(() => {
  const t = tech.value
  const c = campaign.value
  if (!t || !c) return undefined
  const st = techState(t, c.researched, c.project?.tech)
  const est = ctx.value ? estimate(t, c, ctx.value) : undefined
  return {
    label: {
      researched: 'Researched',
      researching: 'Researching now',
      available: 'Available now',
      locked: 'Locked',
    }[st],
    state: st,
    est,
    progress: c.progress[t.id] ?? 0,
    hours: c.hoursSpent[t.id] ?? 0,
  }
})

const leadsTo = computed(() => {
  const t = tech.value
  if (!t) return []
  return techs.value.filter(
    (o) => o.prerequisites.some((p) => p.id === t.id) || o.any_one_of.some((p) => p.id === t.id),
  )
})

const isResearched = (id: number) => campaign.value?.researched[id] ?? false
const select = (id: number) => (state.selected = id)
</script>

<template>
  <section v-if="tech" class="detail" aria-label="Selected tech">
    <header>
      <div>
        <p class="category">{{ tech.category }}</p>
        <h2>{{ tech.name }}</h2>
      </div>
      <button type="button" class="close" title="Close" @click="state.selected = null">×</button>
    </header>

    <p v-if="status" class="status" :class="status.state">
      {{ status.label }}
      <template v-if="status.est">
        ·
        <span v-if="status.est.exact"
          >{{ status.est.days }} {{ status.est.days === 1 ? 'day' : 'days' }} left</span
        >
        <span v-else
          >about {{ status.est.days }} {{ status.est.days === 1 ? 'day' : 'days' }} at your research
          speed</span
        >
      </template>
    </p>

    <div v-if="!isResearched(tech.id)" class="plan-actions">
      <button v-if="!state.goals.length" type="button" @click="planTo(tech.id)">
        Plan research to here
      </button>
      <template v-else-if="state.goals.includes(tech.id)">
        <button type="button" @click="toggleGoal(tech.id)">Remove from plan</button>
      </template>
      <template v-else>
        <button type="button" @click="toggleGoal(tech.id)">Add to plan</button>
        <button type="button" @click="planTo(tech.id)">Plan only this</button>
      </template>
    </div>

    <dl class="costs">
      <dt>Base time</dt>
      <dd>
        {{ tech.base_days }} days
        <span class="muted">({{ tech.base_days * 720 }} research points)</span>
      </dd>
      <template v-if="tech.cost.alloys">
        <dt>Alloys</dt>
        <dd>{{ tech.cost.alloys }}</dd>
      </template>
      <template v-if="tech.cost.elerium">
        <dt>Elerium</dt>
        <dd>{{ tech.cost.elerium }}</dd>
      </template>
      <template v-if="tech.cost.weapon_fragments">
        <dt>Fragments</dt>
        <dd>{{ tech.cost.weapon_fragments }}</dd>
      </template>
      <template v-if="tech.cost.items">
        <dt>Items</dt>
        <dd>{{ tech.cost.items }}</dd>
      </template>
      <template v-if="tech.research_credit">
        <dt>Credit</dt>
        <dd>
          {{ tech.research_credit }}
          <span v-if="status?.est?.credited" class="muted">
            (held: {{ Math.round((ctx?.creditReduction ?? 0) * 100) }}% off{{
              ctx?.creditMeasured ? ', measured from your save' : ', assumed'
            }})
          </span>
        </dd>
      </template>
      <template v-if="status && status.progress > 0 && status.state !== 'researched'">
        <dt>Progress</dt>
        <dd>{{ status.progress }} points, {{ status.hours }} hours so far</dd>
      </template>
      <template v-if="status?.state === 'researched'">
        <dt>Took</dt>
        <dd>{{ status.hours }} hours, {{ status.progress }} points</dd>
      </template>
    </dl>
    <p v-if="changedByIni.has(tech.id)" class="note">Cost from your DefaultGameCore.ini.</p>

    <section v-if="tech.prerequisites.length">
      <h3>Requires all of</h3>
      <ul class="links">
        <li v-for="p in tech.prerequisites" :key="p.id">
          <button type="button" :class="{ done: isResearched(p.id) }" @click="select(p.id)">
            {{ p.name }}
          </button>
        </li>
      </ul>
    </section>
    <section v-if="tech.any_one_of.length">
      <h3>And any one of</h3>
      <ul class="links">
        <li v-for="p in tech.any_one_of" :key="p.id">
          <button type="button" :class="{ done: isResearched(p.id) }" @click="select(p.id)">
            {{ p.name }}
          </button>
        </li>
      </ul>
    </section>
    <section v-if="leadsTo.length">
      <h3>Leads to</h3>
      <ul class="links">
        <li v-for="o in leadsTo" :key="o.id">
          <button type="button" :class="{ done: isResearched(o.id) }" @click="select(o.id)">
            {{ o.name }}
          </button>
        </li>
      </ul>
    </section>
    <section v-if="tech.unlocks.length">
      <h3>Unlocks</h3>
      <ul class="unlocks">
        <li v-for="u in tech.unlocks" :key="u">{{ u }}</li>
      </ul>
    </section>
  </section>
</template>

<style scoped>
.detail {
  padding: 16px 18px 20px;
}
.plan-actions {
  display: flex;
  gap: 6px;
  margin-top: 12px;
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
  color: var(--muted);
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
.status.researched {
  border-color: var(--done-text);
}
.status.researching {
  border-color: var(--progress);
}
.status.available {
  border-color: var(--available);
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
.muted {
  color: var(--muted);
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
.links {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.links button {
  font-size: 12.5px;
  padding: 3px 8px;
}
.links button.done::before {
  content: '✓ ';
  color: var(--done-text);
}
.unlocks li {
  font-size: 13px;
  padding: 2px 0;
}
</style>
