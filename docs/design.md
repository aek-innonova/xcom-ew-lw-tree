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
  `config_key` is how the INI names the tech. Prerequisites agree with
  the game's script, except steps marked `via` (the way to an item the
  game requires); a test holds them to it.
- `data/techtree.json`: the rules read from the game's script by
  `scripts/upk_techtree.py`: prerequisites, item and UFO checks, credit
  shares and coverage, Foundry checks (features/game-script-rules.md).
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
  adjacency bonus) points/hour; a tech costs base days × 720, times
  (1 − 25 % − Expertise; the Ethereal's "All" credit 20 %, and whole
  numbers as in features/game-script-rules.md) for each held credit that covers it (credits
  stack by multiplying), fixed when the project starts; We Have Ways
  takes its share off autopsy and interrogation cost (all verified on
  the person's 1,711 saves, features/history-verification.md); the
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
- 2026-10-18: Held research credits are read from the save
  (`m_arrCredits` slots, mapped in `src/model/credits.ts`); credits cut
  Foundry work by the same rule as research (features/research-credits.md).
- 2026-10-18: Game numbering (items, techs, Foundry, facilities, credits)
  comes from the game's own script packages via scripts/upk_enums.py into
  data/enums.json; Firaxis's files stay in samples/, only the extracted
  names are committed.
- 2026-10-18: Research and Foundry rules (prerequisites, item and UFO
  checks, credit coverage and formula) come from Long War's compiled
  script, read by scripts/upk_techtree.py into data/techtree.json; the
  app merges it into tech.json and longwar_foundry.json at load. Where a
  game rule only names an item, the tree keeps the tech that leads to it
  as a marked step (features/game-script-rules.md).
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
