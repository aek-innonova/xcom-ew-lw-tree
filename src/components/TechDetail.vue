<script setup lang="ts">
// The panel for the selected tech: what it costs, what it needs, what it gives.

import { computed } from 'vue'
import { estimate, techState } from '@/model/research'
import { foundryFor, itemUnlocks } from '@/model/unlocks'
import {
  campaign,
  changedByIni,
  planTo,
  state,
  techById,
  techs,
  toggleGoal,
  research,
  showFoundry,
} from '@/state/store'

const tech = computed(() =>
  state.selected === null ? undefined : techById.value.get(state.selected),
)
const ctx = research

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

const unlocks = computed(() => (tech.value ? itemUnlocks(tech.value) : []))
const foundry = computed(() => (tech.value ? foundryFor(tech.value.id) : []))

/** "35% off: 25% credit + 10% Expertise (Brazil)". */
const creditText = computed(() => {
  const c = ctx.value
  if (!c) return ''
  const parts = ['25% credit']
  for (const b of c.bonuses.sources.filter((b) => b.bonus_id === 54)) {
    parts.push(
      `${b.value}% ${b.name}${b.country ? ` (${b.type === 'starting' ? 'start' : b.country})` : ''}`,
    )
  }
  return `${Math.round(c.creditReduction * 100)}% off: ${parts.join(' + ')}`
})

/** We Have Ways, when it shortens this tech. */
const waysText = computed(() => {
  const c = ctx.value
  if (!c || !status.value?.est?.shortened) return ''
  const b = c.bonuses.sources.find((x) => x.bonus_id === 57)
  return b
    ? `${b.name}: ${b.value}% less time (${b.type === 'starting' ? 'starting bonus' : b.country})`
    : ''
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
        <dt class="res res-alloys">Alloys</dt>
        <dd>{{ tech.cost.alloys }}</dd>
      </template>
      <template v-if="tech.cost.elerium">
        <dt class="res res-elerium">Elerium</dt>
        <dd>{{ tech.cost.elerium }}</dd>
      </template>
      <template v-if="tech.cost.weapon_fragments">
        <dt class="res res-fragments">Fragments</dt>
        <dd>{{ tech.cost.weapon_fragments }}</dd>
      </template>
      <template v-if="tech.cost.items">
        <dt class="res res-items">Items</dt>
        <dd>{{ tech.cost.items }}</dd>
      </template>
      <template v-if="tech.research_credit">
        <dt>Credit</dt>
        <dd>
          {{ tech.research_credit }}
          <span v-if="status?.est?.credited" class="muted">(held: {{ creditText }})</span>
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
    <p v-if="waysText" class="note">{{ waysText }}; not yet confirmed against a save.</p>
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
    <section v-if="unlocks.length || foundry.length">
      <h3>Unlocks</h3>
      <ul class="unlocks">
        <li v-for="u in unlocks" :key="u">{{ u }}</li>
        <li v-for="f in foundry" :key="`foundry:${f.id}`" class="foundry-item">
          <button type="button" class="foundry-link" @click="showFoundry(f.id)">
            {{ f.name }}
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
.foundry-link {
  border: none;
  background: none;
  padding: 0;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.foundry-link:hover {
  text-decoration: underline;
}
.unlocks li {
  font-size: 13px;
  padding: 2px 0;
}
</style>
