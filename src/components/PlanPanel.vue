<script setup lang="ts">
// The research plan: what is still needed for the goals, in order, and what it costs.

import { computed } from 'vue'
import { planTotals } from '@/model/plan'
import { daysFor, estimate, researchContext, techState } from '@/model/research'
import { campaign, plan, state, techById, techs, toggleGoal } from '@/state/store'

const ctx = computed(() =>
  campaign.value ? researchContext(campaign.value, techs.value) : undefined,
)
const totals = computed(() => (plan.value ? planTotals(plan.value, techs.value) : undefined))

const steps = computed(() => {
  const c = campaign.value
  return (plan.value?.steps ?? []).map((id) => {
    const t = techById.value.get(id)!
    const est = c && ctx.value ? estimate(t, c, ctx.value) : undefined
    const st = c ? techState(t, c.researched, c.project?.tech) : undefined
    return {
      id,
      name: t.name,
      days: est ? est.days : t.base_days,
      approx: est ? !est.exact : false,
      state: st,
      points: est?.pointsLeft,
    }
  })
})

/** Days for the whole plan at the campaign's speed, one project after another. */
const estimatedDays = computed(() => {
  if (!ctx.value || !steps.value.length) return undefined
  const points = steps.value.reduce((sum, s) => sum + (s.points ?? 0), 0)
  return daysFor(points, ctx.value.perHour)
})

const choices = computed(() =>
  (plan.value?.choices ?? []).map((c) => ({
    for: techById.value.get(c.for)?.name,
    picked: techById.value.get(c.picked)?.name,
    alternatives: c.alternatives.length,
  })),
)

const goalNames = computed(() =>
  state.goals.map((id) => ({ id, name: techById.value.get(id)?.name ?? `#${id}` })),
)
const select = (id: number) => (state.selected = id)
</script>

<template>
  <section v-if="plan" class="plan" aria-label="Research plan">
    <header>
      <h2>Research plan</h2>
      <button type="button" title="Clear the plan" @click="state.goals = []">Clear</button>
    </header>

    <ul class="goals">
      <li v-for="g in goalNames" :key="g.id">
        <button type="button" class="goal" @click="select(g.id)">★ {{ g.name }}</button>
        <button
          type="button"
          class="remove"
          :title="`Remove ${g.name} from the plan`"
          @click="toggleGoal(g.id)"
        >
          ×
        </button>
      </li>
    </ul>

    <p v-if="!plan.steps.length" class="done">Everything for these goals is researched.</p>
    <template v-else>
      <dl v-if="totals" class="totals">
        <dt>Techs</dt>
        <dd>{{ plan.steps.length }}</dd>
        <dt>Time</dt>
        <dd>
          <template v-if="estimatedDays !== undefined"
            >≈ {{ estimatedDays }} days at your research speed</template
          >
          <template v-else>{{ totals.baseDays }} base days</template>
        </dd>
        <template v-if="totals.alloys">
          <dt>Alloys</dt>
          <dd>{{ totals.alloys }}</dd>
        </template>
        <template v-if="totals.elerium">
          <dt>Elerium</dt>
          <dd>{{ totals.elerium }}</dd>
        </template>
        <template v-if="totals.fragments">
          <dt>Fragments</dt>
          <dd>{{ totals.fragments }}</dd>
        </template>
        <template v-if="totals.items.length">
          <dt>Items</dt>
          <dd>{{ totals.items.join(', ') }}</dd>
        </template>
      </dl>

      <p v-for="c in choices" :key="c.for" class="choice">
        {{ c.for }} needs any one of {{ c.alternatives + 1 }}: picked <strong>{{ c.picked }}</strong
        >, the quickest.
      </p>

      <ol class="steps">
        <li v-for="(s, i) in steps" :key="s.id" :class="s.state">
          <span class="n">{{ i + 1 }}</span>
          <button type="button" @click="select(s.id)">{{ s.name }}</button>
          <span class="d">{{ s.approx ? '≈' : '' }}{{ s.days }}d</span>
        </li>
      </ol>
    </template>
  </section>
</template>

<style scoped>
.plan {
  padding: 14px 18px 20px;
  border-top: 1px solid var(--border);
}
.plan:first-child {
  border-top: none;
}
header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
h2 {
  margin: 0;
  font-size: 15px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--accent);
}
ul,
ol {
  margin: 0;
  padding: 0;
  list-style: none;
}
.goals {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 10px;
}
.goals li {
  display: flex;
}
.goal {
  border-radius: 4px 0 0 4px;
  font-size: 12.5px;
  padding: 3px 8px;
}
.remove {
  border-left: none;
  border-radius: 0 4px 4px 0;
  padding: 3px 7px;
}
.done {
  font-size: 13px;
  color: var(--done-text);
}
.totals {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  margin: 12px 0 0;
  font-size: 13px;
}
dt {
  color: var(--muted);
}
dd {
  margin: 0;
}
.choice {
  margin: 10px 0 0;
  font-size: 12.5px;
  color: var(--muted);
}
.steps {
  margin-top: 12px;
}
.steps li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
  font-size: 13px;
}
.n {
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 11px;
  background: var(--node);
  border: 1px solid var(--accent);
  color: var(--accent);
}
.steps li.available .n {
  background: var(--accent);
  color: var(--bg);
}
.steps li.researching .n {
  border-color: var(--progress);
  color: var(--progress);
}
.steps button {
  border: none;
  background: none;
  padding: 0;
  text-align: left;
  flex: 1;
  min-width: 0;
}
.steps button:hover {
  color: var(--accent);
}
.d {
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
</style>
