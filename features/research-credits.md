---
title: Research credits, made concrete
status: review
priority: 5
dependsOn: [history-verification]
---

## Purpose

"Credit: Plasma Weapons" said little. Show where a credit comes from,
whether the campaign holds it, what it takes off, and what it covers.

## Report (2026-10-18)

**Found in the save history (1,711 saves).**
- `XGFacility_Labs.m_arrCredits` is a flag per credit. Slot ↔ credit
  matched held interrogations in all 1,651 saves of 33 campaigns: 1 Laser
  Weapons, 2 Plasma Weapons, 3 Weapons, 4 Aerospace, 5 Armor,
  6 Cybernetics, 7 Gauss Weapons, 8 Psionics. The Ethereal's "All" credit
  was never earned, so its slot is unknown; it is read from the
  interrogation.
- Credits shorten **Foundry** projects too: with the credit held a
  project starts at 75 % of its work (base days × 24 × engineers), 65 %
  with Brazil's Expertise; never below that when started without the
  bonus. Same rule as research.

**What changed.** `src/model/credits.ts` (slots, sources, coverage);
held credits are read from the save's slots (plus interrogations, for
"All"); Foundry progress and time account for held credits.
- A tech's or project's **Credit** row: each credit that can cover it
  (its field's, plus Weapons for weapon research), the interrogation that
  gives it (a link), held or not held, and what they take off together.
- An **interrogation's** panel: "Gives the Weapons credit: 35% off 15
  techs and 14 Foundry projects", each a link (green done, yellow
  Foundry).
- **Stats**: the credits held and what each takes off.
- Foundry: "35% less work: about 14 days at base speed".

**Verified.** Unit tests: slots on save1738 agree with its
interrogations; sources; coverage; Foundry reduction. Checked on screen.

**Left open.** The "All" credit's slot; whether the Weapons credit
stacks on Foundry weapon projects as it does on research (one case in
the history, inconclusive).
