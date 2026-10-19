<script setup lang="ts">
// What can be sold on the grey market: stores, what remaining research and
// Foundry projects still need, the spare, and what the spare is worth.
// Background (slots, prices, what counts as needed): model/inventory.ts.

import { computed } from 'vue'
import type { ItemGroup } from '@/model/inventory'
import { campaign, inventory, showFoundry, showTech, type InventoryRow } from '@/state/store'
import { gameImages, gamePicture } from '@/state/gameimages'

const GROUPS: ItemGroup[] = [
  'Corpses and wrecks',
  'Captives',
  'Artifacts',
  'Alien weapons',
  'Resources',
]

const groups = computed(() =>
  GROUPS.map((g) => ({
    name: g,
    rows: inventory.value
      .filter((r) => r.item.group === g)
      .sort(
        (a, b) =>
          value(b) - value(a) || b.needed - a.needed || a.item.name.localeCompare(b.item.name),
      ),
  })),
)
const value = (r: InventoryRow) => (r.spare ?? 0) * r.price
const total = computed(() =>
  inventory.value.filter((r) => r.item.group !== 'Resources').reduce((n, r) => n + value(r), 0),
)
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
const open = (n: InventoryRow['needs'][number]) =>
  n.for.kind === 'tech' ? showTech(n.for.id) : showFoundry(n.for.id)
// The game's own picture of an item, in the desktop app (features/game-images.md).
const picture = (slot: number) => (gameImages.version >= 0 ? gamePicture('item', slot) : null)
</script>

<template>
  <section class="market" aria-label="Grey market">
    <div class="bar">
      <h2>Grey market</h2>
      <span v-if="campaign" class="total">Spare worth §{{ fmt(total) }}</span>
      <span v-else class="muted">Load a save to see your stores.</span>
      <span class="muted">Needed = what remaining research and Foundry projects use.</span>
    </div>

    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th class="n">In stores</th>
          <th class="n">Needed</th>
          <th class="n">Spare</th>
          <th class="n">Price</th>
          <th class="n">Spare value</th>
          <th>Needed for</th>
        </tr>
      </thead>
      <tbody v-for="g in groups" :key="g.name">
        <tr class="group">
          <th colspan="7">{{ g.name }}</th>
        </tr>
        <tr
          v-for="r in g.rows"
          :key="r.item.key"
          :class="{ short: r.stock !== undefined && r.stock < r.needed }"
        >
          <td>
            <img v-if="picture(r.item.slot)" :src="picture(r.item.slot)!" alt="" class="pic" />{{
              r.item.name
            }}
          </td>
          <td class="n">{{ r.stock ?? (campaign ? '–' : '') }}</td>
          <td class="n">{{ r.needed || '' }}</td>
          <td class="n spare">{{ r.spare || '' }}</td>
          <td class="n">§{{ fmt(r.price) }}</td>
          <td class="n">{{ value(r) ? `§${fmt(value(r))}` : '' }}</td>
          <td class="for">
            <template v-for="(n, i) in r.needs.slice(0, 4)" :key="`${n.for.kind}${n.for.id}`"
              ><button type="button" :class="n.for.kind" @click="open(n)">{{ n.for.name }}</button
              ><span v-if="i < Math.min(r.needs.length, 4) - 1">, </span></template
            ><span v-if="r.needs.length > 4" class="muted"> +{{ r.needs.length - 4 }} more</span>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.pic {
  width: 48px;
  height: 24px;
  object-fit: contain;
  vertical-align: middle;
  margin-right: 8px;
}
.market {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px 24px;
}
.bar {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px 16px;
  margin-bottom: 10px;
}
h2 {
  margin: 0;
  font-size: 16px;
}
.total {
  font-weight: 600;
  color: var(--done-text);
}
.muted {
  color: var(--muted);
  font-size: 12.5px;
}
table {
  width: 100%;
  max-width: 1200px;
  border-collapse: collapse;
  font-size: 13px;
}
th,
td {
  padding: 4px 10px;
  text-align: left;
  border-bottom: 1px solid var(--border);
}
thead th {
  color: var(--muted);
  font-weight: 600;
  position: sticky;
  top: 0;
  background: var(--bg);
}
.n {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.group th {
  padding-top: 14px;
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--accent);
  border-bottom: none;
}
.spare {
  color: var(--done-text);
  font-weight: 600;
}
tr.short td:nth-child(2) {
  color: var(--progress);
}
.for button {
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  font-size: 12.5px;
  color: var(--accent);
  cursor: pointer;
}
.for button.foundry {
  color: var(--foundry);
}
.for button:hover {
  text-decoration: underline;
}
</style>
