# Design: XCOM EW Long War tech tree

## Purpose

A website where a Long War player sees the whole research tree at once and
where their campaign stands in it. They can load two files:

- their `DefaultGameCore.ini`, so costs and times match their install
  (Long War is often tweaked, and the INI is the source of truth for
  `[TechBalance]`);
- a save file, so the tree shows what is researched, in progress,
  available now and locked.

A good result: a player drops in a save and in a few seconds can answer
"what can I research now", "what do I still need for Plasma Rifles, and
what will it cost me" and "how long will that take with my labs".

## Principles

- **Purely client side.** Files are read in the browser and never
  uploaded; the site is static files. The UI says so plainly, because it
  is a reason to trust the site with a save.
- **Honest numbers.** Where a figure is derived by a formula we have not
  verified against the game (research time with labs and credits, for
  instance), it is labelled as an estimate, or not shown. Base values
  from the INI and raw values from the save are shown as they are.
- **Works without files.** With nothing loaded the tree shows the
  default Long War 1.0 costs from `tech.json`.

## Data

- `tech.json`: 75 techs. `id` is the `ETechType` enum value and the index
  into `XGFacility_Labs.m_arrResearched` / `m_arrProgress` in a save.
  `config_key` is how the INI names the tech. Prerequisites come from
  ufopaedia, not from game code, so they may contain errors.
- The INI names techs three ways: enum names (`eTech_Xenobiology`), bare
  numbers (`eTech=72`), and one reused vanilla name: `eTech_Placeholder`
  is Alien Biocybernetics (id 60).
- The save: see `features/save-parser.md` for the format and the facts
  found so far.

## Decisions

- 2026-10-18: Port xcomsave's reader to TypeScript rather than compiling
  the C++ to WebAssembly. Reading only; ~800 lines of C++ plus LZO1X
  decompression. `fixtures/saves/save1762.json` (xcomsave's own output)
  is the oracle.
- 2026-10-18: Tree layout is our own, rendered as SVG: a lane per
  category, nine columns, every prerequisite strictly left of the tech
  that needs it (across lanes), lanes as few rows as that allows (15 in
  all), edges routed through gutters and row gaps so none passes behind
  a node. A first version that compacted harder (14 rows) made edges run
  backwards and hid skipping edges behind nodes; readability won.
- 2026-10-18: Research time: speed = scientists × (1 + lab bonus +
  adjacency bonus) points/hour; a tech costs base days × 720, less 25 %
  plus Expertise when a credit covering it is held (stacking of two
  credits is not known), fixed when the project starts; We Have Ways
  shortens autopsies and interrogations (unconfirmed); the
  current project's remaining points come from the save. Verified
  against the game's ETA in every sample; see `src/model/research.ts`.
- 2026-10-18: Campaign bonuses: starting bonus from the save, country
  bonuses for covered countries except the starting country, continent
  bonuses once every council country on the continent is covered (see
  features/campaign-bonuses.md).
- 2026-10-18: Foundry: a second board in the same style, a lane per
  category, each project right of the tech it needs; boards share
  `usePanZoom.ts` and `board.css`.
- 2026-10-18: Long War's alien counters live in reused recap statistics
  (see features/campaign-stats.md); their names are inferred and shown
  as such.
- 2026-10-18: Tactical saves are read through the strategy state they
  embed (see the save-parser report).
- 2026-10-18: What persists in localStorage is what was extracted (costs,
  campaign summary, goals), never the files themselves.
- 2026-10-18: Hosted as static files at `https://xcom.innonova.ch`, served
  by nginx on `www` (see `features/deploy.md`).
- 2026-10-18: Test saves are checked in under `fixtures/saves/` (see its
  README). `samples/` stays git-ignored: the person's drop folder for new
  game files, and the home of Firaxis' `DefaultGameCore.ini`, which is not
  published. The one test that reads that INI skips without it.
