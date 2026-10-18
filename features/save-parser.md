---
title: Read XCOM EW saves in the browser
status: review
priority: 1
dependsOn: []
---

## Purpose

A player drops their save file on the page and the site knows their
research state, without the file leaving the browser. Everything that
shows campaign progress rests on this.

## Requirements

- A TypeScript module that takes the bytes of a save (`Uint8Array`) and
  returns the parsed save: header, actor table, checkpoint chunks with
  their checkpoints and properties. A port of xcomsave's reader
  (`/home/inno/projects/xcomsave`, `xcomreader.cpp`, `xcomio.cpp`), read
  only, no writer.
- The output for `samples/save1762` matches `samples/save1762.json`
  (xcomsave's own output) property for property. That match is the test.
- A small accessor on top that extracts what the tree needs: researched
  flags, research progress, the current project, scientists, lab
  bonuses, credits, foundry history, difficulty and the in-game date.
- Errors a player can act on: "this is not an XCOM save", "this is an
  Enemy Unknown save", "tactical save, research data not found". Not a
  stack trace.
- Runs in the browser with no WebAssembly and no native dependencies.

## Facts (verified 2026-10-18)

- Layout: 1024-byte header (version 0x10 = EW, 0x0f = EU, 0x13 =
  Android), then UE3 compressed chunks, each starting with magic
  `0x9e2a83c1`, then flags, compressed size, uncompressed size, the two
  sizes repeated, then LZO1X data (zlib on Android). The decompressed
  stream holds the actor table, then checkpoint chunks.
- In save1762 the research data is in the checkpoint whose class is
  `XComStrategyGame.XGFacility_Labs`: `m_arrResearched` (76 entries,
  index = tech id, index 0 is eTech_None and is 1), `m_arrProgress` (in
  research points: Alien Weaponry shows 4320 = 6 base days × 720),
  `m_arrTimeSpent` (hours), `m_kProject` (`iTech`, `iActualHoursLeft`),
  `m_iNumScientists`, `m_fLabBonus`, `m_fAdjLabBonus`, `m_arrCredits`.
  `XGFacility_Engineering.m_arrFoundryHistory` has foundry progress;
  `XGStrategy.m_iDifficulty` and `m_arrSecondWave` are there too.
- Calibration point: save1762 has 10 scientists, Xenobiology at
  1370 / 4320 points, `iActualHoursLeft` = 2950, which is
  (4320 − 1370) / 10 × 10. Probably hours × 10; check against more saves.
- `samples/` holds nine saves from one machine (two campaigns). Six are
  tactical saves. xcomsave refuses tactical saves ("cannot be completely
  parsed"). Whether their strategy state (the labs) can be reached is
  unknown; find out. If it can, a mid-mission save is useful too.
- Strings: positive length = Latin-1 with a NUL terminator, negative
  length = UTF-16LE. `TextDecoder` covers both.

## Hard to verify

- LZO decompression correctness: covered by the oracle comparison, and
  by checking each chunk's decompressed size against its header.
- Saves from other languages, Ironman, Mac/Linux ports: we have none.
  Make the parser fail clearly rather than silently wrong.

## Worth

The core of the project. About a day of careful work; if the tactical
save question turns into reverse engineering, stop and report what was
found instead.

## Report (2026-10-18)

**What changed.** `src/save/`: `lzo.ts` (LZO1X decompressor, port of
minilzo's `lzo1x_decompress_safe`, bounds-checked), `crc32.ts` (the
MSB-first CRC-32/BZIP2 xcomsave uses, not zlib's), `reader.ts` (byte
cursor and XCOM strings), `parse.ts` (header with both checksums,
chunked decompression, actor table, checkpoint chunks, properties, array
sniffing; output shaped exactly like xcom2json), `types.ts`,
`campaign.ts` (the accessor: researched, progress, hours spent, current
project, scientists, engineers, lab bonuses, credits, foundry history,
second wave, difficulty, in-game date). `src/model/research.ts` holds
the time formula.

**Tactical saves work.** A tactical save carries the strategy state the
game returns to after the mission as a second set of compressed chunks
at the end of its body (int: byte count + 4, int 0, chunks running
exactly to the end). `parseSave` finds it, skips the mission data, and
returns the strategy chunk with `strategy_from_tactical: true`. All six
tactical samples read this way.

**Verified.**
- `samples/save1762` parses to xcom2json's output property for property
  (floats within 1e-4): `src/save/__tests__/parse.spec.ts`.
- All nine samples parse and yield a campaign; campaign 55's mid-mission
  saves count 45 → 46 → 47 researched in date order.
- Time formula, checked against the game's own ETA string in all nine
  saves: research speed is scientists × (1 + `m_fLabBonus` +
  `m_fAdjLabBonus`) points/hour, and `TResearchProject.iActualHoursLeft`
  is **points left after research credits**, not hours (the feature's
  "hours × 10" guess was wrong). ETA = ceil(points / speed / 24) days.
- Type check and lint clean.

**Found along the way (for progress-overlay).**
- `m_arrProgress` has 152 entries; the second half is unused.
- For a finished tech, `m_arrProgress` is what it actually cost. That
  shows research credits take 25 % off (Pulse Lasers, Gauss, Mobile
  Power Armor, Biocybernetics all at 75 % of base), and in campaign 55 a
  later 35 % (Plasma Weapons, Advanced Power Armor): the Armor credit
  went from 25 % to 35 % mid-campaign. The INI's continent bonus
  "Expertise (additive % bonus to research credit bonuses)", 10 %, fits;
  not confirmed.
- `m_arrCredits` has 10 slots; campaign 55 holds slots 1, 2, 4, 5, 6, 7
  and has done the Sectoid, Floater, Muton, Berserker, Thin Man and Heavy
  Floater interrogations. Which slot is which credit is not determined;
  deriving held credits from researched interrogations avoids needing it.
- `m_arrFoundryHistory` is a 48-entry flag array indexed by foundry id
  (index 0 set, like `m_arrResearched`), not a list of ids as
  `longwar_foundry.json`'s `save_fields` says.

**Left open.**
- The samples are git-ignored, so in a fresh clone only the four
  rejection tests run; the oracle and sample tests skip. If the saves
  can be committed (or one strategy save plus its JSON), the suite
  covers the parser anywhere.
- No saves from other languages, Ironman, Mac/Linux, or other machines.
  The parser fails with a readable message rather than guessing.
- The `const enum` in parse.ts/lzo.ts is fine under Vite; noted in case
  a type-stripping runtime ever loads these files directly.
