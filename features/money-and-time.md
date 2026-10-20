---
title: "Money, materials and research time explained in the campaign bar and tech details"
status: review
priority: 4
dependsOn: [campaign-stats]
---

## Purpose

The person (2026-10-20):
- The resources in the campaign bar had titles saying what each was. Show
  them all with their full names on hover, maybe with income and expenses.
- "Researching Beam Lasers" did nothing outside the tree.
- The relation between base time and actual time was unexplained, and
  finished techs showed their base time on the tree.
- The tabs' hover borders were imperfect.

## Report (2026-10-20)

- **Money and materials** (`CampaignBar.vue`): hovering or focusing the
  figures shows a card with everything in stores by its full name, then
  the month's funding and upkeep:
  - **Long War 1.0, by its own rules**, read from its XComStrategyGame
    script (`src/model/economy.ts`):
    - Funding: the funding of each council country still paying, plus
      Wealth of Nations' percentage, as whole credits (XGWorld.GetIncome).
    - Upkeep: each facility's (FacilityBalance iMaintenance ×
      FACILITY_MAINTENANCE_BALANCE) times the number of them. Each craft's:
      §40 an Interceptor, §50 a Firestorm, the Skyranger's from the INI, less
      Air Superiority's percentage (XGHeadQuarters.GetMaintenanceTotal).
    - The net at the month's end. The facility figures are built in, from
      each version's own files (`scripts/economy_data.py` →
      `data/economy.json`).
    - The save now gives each country's funding and council seat, and the
      base's facility counts.
  - **LWR:** it pays daily, partly by rules in its own code, so the card
    says so rather than show numbers the app cannot stand behind.
- **"Researching …"** switches to the research tree and centres on the
  tech.
- **Research time** (`TechDetail.vue`):
  - The points, the base days, and what they mean: "At your speed, 4,176
    points a day (116 scientists, labs +50%): 3 days; research credit takes
    part of the work off". A base day is 720 points, 30 scientists without
    labs (10 in LWR's formula).
  - Finished techs say how long they took. On the tree their boxes show it
    too (from the save's hours on each), not base time.
- **Tabs:** neighbours share one border line, and the hovered or chosen
  tab is drawn on top, so its whole outline shows.

Verified:
- Unit tests on a Long War save: 15 council countries paying §728; a lift
  and an uplink §25; four Interceptors and the Skyranger §180; with Wealth
  of Nations 20 % and Air Superiority 25 %, §873 and §30 / §15 a craft.
- Screenshots of the card, the tree after the link, and the detail.
- Open: checking the net against the game's own payday on the person's
  saves either side of a month's end.
- On the bench, read-only on the person's Long War saves either side of
  three month ends:
  - **Income:** exact in all three. In campaign 55 a satellite over Africa
    raised a country's funding mid-month, and the payday paid the new sum.
  - **Campaign 56:** the net matched the cash change to the credit, Air
    Superiority's discount included.
  - **Campaign 55:** upkeep was §18 too high. Long War's XGItemTree.GetFacility
    also takes Architects of the Future's percentage off a Laboratory's and
    a Workshop's upkeep, and Power to the People's off the generators', as
    whole credits. With that, both of its month ends balance exactly. Now
    in the rules, with a unit test.
- The bench also found that a save stored by the previous site (without
  countries and facilities) broke the whole campaign bar. It now has no
  monthly figures, and the card says to load the save again.
