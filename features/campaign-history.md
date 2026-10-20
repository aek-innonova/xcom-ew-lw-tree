---
title: Campaign history over time
status: done
priority: 4
dependsOn:
  - live-saves
  - campaign-stats
---

## Purpose

See how a campaign has gone, not only where it stands: the aliens'
counters, research pace, staff and satellites over the in-game months.

## Requirements

- A snapshot (a few numbers) of every save loaded, manual or watched,
  kept per campaign in the browser.
- Fill a campaign's history at once: from the watched folder (only that
  campaign's saves, picked out by the cheap header check) or by picking
  many saves.
- A History view: small charts over in-game time, one measure each (no
  two scales on one chart), crosshair and tooltip, a table view.
- A research timeline from the current save alone: every save records
  when each tech was finished.

## Worth

Most of a day.

## Report (2026-10-18)

**What changed.** `src/model/history.ts` (snapshots, month ticks, the
campaign number from a save's header alone), `campaign.ts` (the
campaign day with time of day; each tech's completion day from
`m_arrResearchedTimes`), the store (a snapshot recorded for every save
loaded; `importSaves` for many at once, yielding to the page between
saves), `watch.ts` (`importCampaignFromFolder`), a History tab:
`HistoryView.vue`, `charts/LineChart.vue`, `charts/ResearchTimeline.vue`.

- **Charts**, one measure each (no two scales on a chart): alien
  resources, XCOM threat this month, alien bonus research (with its zero
  line), techs researched and satellites (steps), scientists and
  engineers (the one shared chart: same unit, with a legend and end
  labels). 2px lines, hairline grid, the last value labelled, a
  crosshair snapping to the nearest save with one tooltip for every
  series; keyboard: focus a chart, arrow keys step through saves. A table
  view lists every snapshot. Colours: blue `#3987e5` and orange
  `#d95926`, the reference palette's dark steps, validated against the
  panel surface (all six checks pass). Charts draw at their real width,
  so text stays its set size.
- **Research timeline**: from the loaded save alone, a row per
  category, a dot per finished tech at its completion date, hover or
  focus for the name and date.
- **Filling it**: every save loaded or picked up by the watcher adds a
  snapshot. "Add this campaign's saves from <folder>" reads only the
  loaded campaign's saves from the watched folder (the campaign number
  is at bytes 8–11 of the header, so other campaigns are skipped
  without parsing); "Add saves…" does the same for picked files.
  Snapshots persist in localStorage, per campaign; "Clear history".

**Verified.** Unit tests (snapshot, campaign day, one per save in order,
header peek, completion days, month ticks). In Chromium: a test folder
with 40 of campaign 55's saves spread over its months and 3 of campaign
31; "Add this campaign's saves" read the 40 in 1.5 s and skipped the 3;
charts, hover tooltip, table (40 rows), timeline on screen. Found and
fixed in that test: a detached `getFile` lost its handle ("Illegal
invocation"), and import failures now show a message.

**Left open.** History is per browser (localStorage); a very long
history across many campaigns could approach its limit (about 300 bytes
per save).
