<script setup lang="ts">
// The panel for the selected tech: what it costs, what it needs, what it gives.

import { computed } from 'vue'
import { gameImages, gamePicture } from '@/state/gameimages'
import {
  applicableCredits,
  creditReductionFor,
  estimate,
  gateMet,
  techState,
  unmetGates,
  baseDays,
} from '@/model/research'
import { gateText, gateShown } from '@/model/gates'
import { foundryFor, itemUnlocks } from '@/model/unlocks'
import { covers, creditGivenBy, creditSources } from '@/model/credits'
import { itemLink, techLink } from '@/model/ufopaedia'
import {
  campaign,
  credits,
  foundry,
  changedByIni,
  planTo,
  state,
  techById,
  techs,
  toggleGoal,
  research,
  showFoundry,
  game,
} from '@/state/store'

const tech = computed(() =>
  state.selected === null ? undefined : techById.value.get(state.selected),
)
const ctx = research

const status = computed(() => {
  const t = tech.value
  const c = campaign.value
  if (!t || !c) return undefined
  const st = techState(t, c.researched, c.project?.tech, c)
  const est = ctx.value ? estimate(t, c, ctx.value) : undefined
  // Name the missing item or UFO only when research is not what is missing.
  const missing =
    st === 'locked' && techState(t, c.researched, c.project?.tech) === 'available'
      ? unmetGates(t.gates, c)
      : []
  return {
    label: {
      researched: 'Researched',
      researching: 'Researching now',
      available: 'Available now',
      locked: missing.length ? `Locked: needs ${missing.map(gateText).join(', ')}` : 'Locked',
    }[st],
    state: st,
    est,
    progress: c.progress[t.id] ?? 0,
    hours: c.hoursSpent[t.id] ?? 0,
  }
})

/** The game's other checks, where the cost does not already say them; met or not with a save. */
const gates = computed(() => {
  const t = tech.value
  if (!t) return []
  const c = campaign.value
  return t.gates
    .filter((g) => gateShown(g, t.cost.items))
    .map((g) => ({ text: gateText(g), met: c ? gateMet(g, c) : false }))
})

const leadsTo = computed(() => {
  const t = tech.value
  if (!t) return []
  return techs.value.filter(
    (o) => o.prerequisites.some((p) => p.id === t.id) || o.any_one_of.some((p) => p.id === t.id),
  )
})

const unlocks = computed(() => (tech.value ? itemUnlocks(tech.value, foundry.value) : []))
const foundryUnlocks = computed(() => (tech.value ? foundryFor(tech.value.id, foundry.value) : []))

/**
 * "35% off: 25% credit + 10% Expertise (Brazil)"; for two credits "58% off:
 * Plasma Weapons and Weapons credits, 35% each (25% + 10% Expertise (Brazil))";
 * with the Ethereal's 20 % one, each credit's share.
 */
const creditText = computed(() => {
  const c = ctx.value
  const t = tech.value
  if (!c || !t) return ''
  const expertise = c.bonuses.sources
    .filter((b) => b.bonus_id === 54)
    .map(
      (b) =>
        `${b.value}% ${b.name}${b.country ? ` (${b.type === 'starting' ? 'start' : b.country})` : ''}`,
    )
  const plus = expertise.length ? ` + ${expertise.join(' + ')}` : ''
  const share = (n: string) => Math.round((game.value.creditShares[n] ?? 0.25) * 100)
  const label = (n: string) => (n === 'All' ? 'All research' : n)
  const credits = applicableCredits(t, c.held)
  const total = Math.round(creditReductionFor(t, c) * 100)
  if (credits.length === 1) return `${total}% off: ${share(credits[0]!)}% credit${plus}`
  if (new Set(credits.map(share)).size === 1) {
    const each = Math.round((share(credits[0]!) / 100 + c.expertise) * 100)
    return `${total}% off: ${credits.map(label).join(' and ')} credits, ${each}% each${plus ? ` (${share(credits[0]!)}%${plus})` : ''}`
  }
  return `${total}% off: ${credits.map((n) => `${label(n)} ${share(n)}%`).join(', ')}${plus ? `, each${plus}` : ''}`
})

/**
 * The credits that can cover this tech (the game's list, e.g. a plasma weapon's
 * own field and the Muton Elite's Weapons). With a save: held or not.
 */
const creditRows = computed(() => {
  const t = tech.value
  if (!t) return []
  const names = t.credits
  const sources = creditSources(techs.value)
  const held = credits.value?.held
  return names.map((name) => ({
    name,
    source: sources.get(name),
    held: held ? held.has(name) : undefined,
  }))
})

/** For an interrogation: the credit it gives and everything that credit covers. */
const gives = computed(() => {
  const t = tech.value
  const credit = t && creditGivenBy(t)
  if (!credit) return undefined
  return {
    credit,
    techs: techs.value.filter((x) => covers(credit, x.credits)),
    foundry: foundry.value.filter((p) => covers(credit, p.credits)),
    each: Math.round(
      ((credit === 'All' ? credits.value?.all : credits.value?.each) ??
        game.value.creditShares[credit] ??
        0.25) * 100,
    ),
  }
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
// The game's own picture of it, in the desktop app (features/game-images.md).
const picture = computed(() =>
  gameImages.version >= 0 && tech.value ? gamePicture('tech', tech.value.id) : null,
)
</script>

<template>
  <section v-if="tech" class="detail" aria-label="Selected tech">
    <header>
      <div>
        <p class="category">
          {{ tech.category }}<template v-if="game.ufopaedia"> ·</template>
          <a
            v-if="game.ufopaedia"
            :href="techLink(tech)"
            target="_blank"
            rel="noopener"
            class="wiki"
            >UFOpaedia ↗</a
          >
        </p>
        <h2>{{ tech.name }}</h2>
      </div>
      <button type="button" class="close" title="Close" @click="state.selected = null">×</button>
    </header>
    <img v-if="picture" :src="picture" alt="" class="picture" />

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
        {{ baseDays(tech.base_days) }} days
        <span class="muted"
          >({{ Math.round(tech.base_days * 720).toLocaleString('en-US') }} research points)</span
        >
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
      <template v-if="creditRows.length">
        <dt>Credit</dt>
        <dd class="credits">
          <div v-for="r in creditRows" :key="r.name">
            {{ r.name }}
            <span class="muted"> from </span>
            <button v-if="r.source" type="button" class="inline-link" @click="select(r.source.id)">
              {{ r.source.name }}
            </button>
            <span v-if="r.held === true" class="held">held</span>
            <span v-else-if="r.held === false" class="not-held">not held</span>
          </div>
          <div v-if="status?.est?.credited" class="muted">{{ creditText }}</div>
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
    <p v-if="waysText" class="note">{{ waysText }}, included above.</p>
    <p v-if="changedByIni.has(tech.id)" class="note">Cost from your DefaultGameCore.ini.</p>

    <section v-if="tech.prerequisites.length || gates.length">
      <h3>Requires all of</h3>
      <ul class="links">
        <li v-for="p in tech.prerequisites" :key="p.id">
          <button type="button" :class="{ done: isResearched(p.id) }" @click="select(p.id)">
            {{ p.name }}
          </button>
          <span v-if="p.via" class="muted"> for the {{ p.via }}</span>
        </li>
        <li v-for="g in gates" :key="g.text" class="gate" :class="{ done: g.met }">
          {{ g.text }}
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
    <section v-if="gives?.credit === 'All'">
      <h3>Gives a credit for everything</h3>
      <p class="gives">{{ gives.each }}% off all research and Foundry projects.</p>
    </section>
    <section v-else-if="gives">
      <h3>Gives the {{ gives.credit }} credit</h3>
      <p class="gives">
        {{ gives.each }}% off {{ gives.techs.length }} techs<template v-if="gives.foundry.length">
          and {{ gives.foundry.length }} Foundry projects</template
        >:
        <template v-for="(o, i) in gives.techs" :key="o.id"
          ><button
            type="button"
            class="inline-link"
            :class="{ done: isResearched(o.id) }"
            @click="select(o.id)"
          >
            {{ o.name }}</button
          ><span v-if="i < gives.techs.length - 1 || gives.foundry.length">, </span></template
        ><template v-for="(p, i) in gives.foundry" :key="`f${p.id}`"
          ><button type="button" class="inline-link foundry-inline" @click="showFoundry(p.id)">
            {{ p.name }}</button
          ><span v-if="i < gives.foundry.length - 1">, </span></template
        >
      </p>
    </section>
    <section v-if="unlocks.length || foundryUnlocks.length">
      <h3>Unlocks</h3>
      <ul class="unlocks">
        <li v-for="u in unlocks" :key="u">
          <a
            v-if="game.ufopaedia && itemLink(u)"
            :href="itemLink(u)"
            target="_blank"
            rel="noopener"
            class="item-link"
            >{{ u }}</a
          >
          <template v-else>{{ u }}</template>
        </li>
        <li v-for="f in foundryUnlocks" :key="`foundry:${f.id}`" class="foundry-item">
          <button type="button" class="foundry-link" @click="showFoundry(f.id)">
            {{ f.name }}
          </button>
        </li>
      </ul>
    </section>
  </section>
</template>

<style scoped>
.picture {
  display: block;
  width: 100%;
  max-width: 320px;
  aspect-ratio: 2;
  object-fit: contain;
  margin: 2px auto 8px;
}
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
.links button.done::before,
.links .gate.done::before {
  content: '✓ ';
  color: var(--done-text);
}
.links li {
  display: flex;
  align-items: center;
  font-size: 12px;
}
.links .gate {
  font-size: 12.5px;
  padding: 3px 8px;
  border: 1px dashed var(--border);
  border-radius: 4px;
}
.wiki {
  color: var(--muted);
  text-decoration: none;
  text-transform: none;
  letter-spacing: 0;
}
.wiki:hover {
  color: var(--accent);
  text-decoration: underline;
}
.item-link {
  color: inherit;
  text-decoration: underline dotted var(--muted);
  text-underline-offset: 3px;
}
.item-link:hover {
  color: var(--accent);
}
.credits div + div {
  margin-top: 2px;
}
.inline-link {
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  color: var(--accent);
  cursor: pointer;
}
.inline-link:hover {
  text-decoration: underline;
}
.not-held {
  margin-left: 6px;
  color: var(--muted);
}
.held {
  margin-left: 6px;
  font-size: 11px;
  color: var(--done-text);
  border: 1px solid var(--done-border);
  border-radius: 3px;
  padding: 0 4px;
}
.gives {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--muted);
}
.gives .inline-link {
  font-size: 12.5px;
}
.gives .inline-link.done {
  color: var(--done-text);
}
.foundry-inline {
  color: var(--foundry) !important;
}
.foundry-button {
  color: var(--foundry);
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
