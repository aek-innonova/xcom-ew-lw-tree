<script setup lang="ts">
// One line about the loaded campaign: where it stands and how fast it researches.

import { computed, ref } from 'vue'
import { difficultyName } from '@/save/campaign'
import { countryName, EXPERTISE, WE_HAVE_WAYS, type Bonus } from '@/model/bonuses'
import { pointsPerHour, projectEtaDays } from '@/model/research'
import { bonuses, campaign, state, techById, techs } from '@/state/store'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const info = computed(() => {
  const c = campaign.value
  if (!c) return undefined
  const done = techs.value.filter((t) => c.researched[t.id]).length
  const bonus = Math.round(((c.labBonus ?? 0) + (c.adjacentLabBonus ?? 0)) * 100)
  const project = c.project ? techById.value.get(c.project.tech) : undefined
  const days = projectEtaDays(c)
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
    start: countryName(c.startCountry),
  }
})

// The campaign's bonuses, opened from the bar.
const showBonuses = ref(false)
const groups = computed(() => {
  const b = bonuses.value
  if (!b) return []
  return [
    { title: 'Starting bonus', items: b.starting ? [b.starting] : [] },
    { title: 'Country bonuses (satellite coverage)', items: researchFirst(b.countries) },
    { title: 'Continent bonuses (every country covered)', items: researchFirst(b.continents) },
  ].filter((g) => g.items.length)
})
const JAI_VIDWAN = 46
const affectsResearch = (b: Bonus) => b.bonus_id === EXPERTISE || b.bonus_id === WE_HAVE_WAYS
/** How a bonus reaches the research numbers, if it does. */
const researchTag = (b: Bonus) =>
  affectsResearch(b) ? 'in estimates' : b.bonus_id === JAI_VIDWAN ? "in the save's lab bonus" : ''
const researchFirst = (items: Bonus[]) =>
  [...items].sort((a, b) => Number(!researchTag(a)) - Number(!researchTag(b)))
const where = (b: Bonus) => (b.type === 'continent' ? b.continent : b.country)
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
    <span v-if="info.start" class="bonus-anchor">
      Started in {{ info.start }}
      <button
        type="button"
        class="link"
        :aria-expanded="showBonuses"
        @click="showBonuses = !showBonuses"
      >
        {{ bonuses?.all.length === 1 ? '1 bonus' : `${bonuses?.all.length ?? 0} bonuses` }}
      </button>
      <div v-if="showBonuses" class="bonuses" role="dialog" aria-label="Campaign bonuses">
        <button type="button" class="close" aria-label="Close" @click="showBonuses = false">
          ×
        </button>
        <section v-for="g in groups" :key="g.title">
          <h3>{{ g.title }}</h3>
          <ul>
            <li v-for="b in g.items" :key="`${b.type}:${b.bonus_id}:${where(b)}`">
              <strong>{{ b.name }}</strong> <span class="where">{{ where(b) }}</span>
              <span v-if="researchTag(b)" class="research">{{ researchTag(b) }}</span>
              <div class="desc">{{ b.description }}</div>
            </li>
          </ul>
        </section>
        <p class="foot">
          A country's bonus counts while it has a satellite, except the starting country's. Values
          come from your DefaultGameCore.ini when loaded.
        </p>
      </div>
    </span>
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
.bonus-anchor {
  position: relative;
}
.bonuses {
  position: absolute;
  z-index: 20;
  top: calc(100% + 8px);
  left: 0;
  width: 420px;
  max-height: 70vh;
  overflow-y: auto;
  padding: 12px 14px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.5);
}
.bonuses .close {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 0 7px;
}
.bonuses h3 {
  margin: 8px 0 4px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
}
.bonuses ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
.bonuses li {
  padding: 4px 0;
}
.where {
  color: var(--muted);
  font-size: 12px;
}
.research {
  margin-left: 6px;
  font-size: 10px;
  color: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 3px;
  padding: 0 4px;
}
.desc {
  font-size: 12.5px;
  color: var(--muted);
}
.bonuses .foot {
  margin: 10px 0 0;
  font-size: 11.5px;
  color: var(--muted);
}
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
