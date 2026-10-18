---
title: Air war simulator
status: review
priority: 4
dependsOn: [game-script-rules]
---

## Purpose

The air war is where Long War players most often guess, and stances are
where they get it wrong. Pit an interceptor, or a sequence of them, against
a UFO and show the odds under each stance, with what every number does;
then let the fight be played, consumables and all. Either with what the
campaign has (its hangar, Foundry projects, the month's UFOs) or with
anything, regardless of tech.

## The game's rules (XGInterceptionEngagement and friends, read 2026-10-18)

**One interceptor per engagement.** XGInterception.ToggleInterceptor drops
the first jet when a second is added, so a "sequence" is successive
engagements; a UFO keeps its damage between them.

**The fight is decided before it is shown.** GetCombat simulates up to 60
seconds and records every shot; UIInterceptionEngagement.Playback shows them
and applies the consumables.

- Both ships start firing at once: every XCOM weapon has range 100 and every
  UFO weapon 101 (XGItemTree.UpdateShips), so ranges never matter. Each
  weapon's first shot comes after a random 0.0–1.9 s (StaggerWeaponsForShip),
  then one every firing time.
- To hit = weapon to-hit, plus for XCOM 3 per confirmed kill of the
  interceptor (at most 30); **aggressive stance +15 for both sides,
  defensive −15 for both**; clamped to 5–95. The roll is Rand(100) ≤ to-hit,
  so 5–95 means 6–96 %.
- The stance is the interceptor's TShip.iRange (0 balanced, 1 aggressive,
  2 defensive), set on the launch screen (ShipSelection.OnAccept) and kept
  in the save.
- Damage = weapon damage × (1 − 5 % × (target armor − weapon AP − ship AP)),
  the cut between 0 and 95 %, kept whole. Critical: Rand(100) ≤ (AP total −
  armor) / 2, clamped 5–25, doubles it. Then + Rand(damage / 2). For XCOM
  shots: × 1.1 once that UFO type's analysis is researched, × (1 + kills /
  100); the second weapon (Wingtip Sparrowhawks' Stingray) does half.
- A missed shot from the interceptor's own weapon keeps its damage, so that
  Aim can turn it into a hit.
- Escape: after 30 × interceptor battle speed / UFO battle speed seconds the
  UFO is gone (GetTimeUntilOutrun), unless it is down. A hit lands 0.3 s
  after the shot.
- UFO down: it crashes, or is destroyed with chance (overkill damage / k) %,
  k = 5 Scout and Fighter, 6 Destroyer and Raider, 7 Abductor and
  Harvester, 8 Transport and Terror Ship, 15 Battleship and Assault
  Carrier; an Overseer always crashes (UpdateEngagementResult).
- Consumables (one of each per engagement, needs Aircraft Boosters):
  Uplink Targeting (Aim) turns the next two missed shots of the
  interceptor's weapon into hits, not usable in defensive stance; Defense
  Matrix (Dodge) cancels the next two hits on the interceptor, not usable in
  aggressive stance; UFO Tracking (Boost) adds 50 % to the interceptor's
  battle speed for the escape timer.

**Ships and weapons** come from the INI's reused ContBalance_Classic lines
(each labelled there): speed, battle speed, HP, armor, armor penetration; for
weapons firing time, damage, AP and to-hit. Foundry: Armored Fighters (+HP),
Elerium Afterburners (+battle speed), Penetrator Weapons (+AP), Improved
Avionics (+to-hit), Phoenix Coilguns and Supercapacitors (improved Phoenix
and Laser), Wingtip Sparrowhawks (a Stingray as second weapon), UFO
Countermeasures (−15 UFO to-hit). Second wave Friendly Skies: XCOM to-hit
+ ABDUCTION_REWARD_SCI. UFOs grow with category = alien research / 30
(at most 32): + HP, damage and to-hit per category; from category 9, 11, 13
and 19 some types get other weapons, and the Destroyer other stats from 19.
Alien research is the recap "Days" statistic, which already includes the
aliens' bonus research.

## Report (2026-10-18)

**What changed.** A new **Air war** tab.

- *Your campaign* flies the save's hangar (each jet's callsign, weapons,
  current HP, kills and last stance, read from XGShip_Interceptor), with the
  campaign's Foundry projects, Friendly Skies, the UFOs as this month makes
  them, the UFO analysis if done, and consumables only if Aircraft Boosters
  is done and they are in stores (shared down the sequence). *Anything*
  picks freely: UFO type and category, jet type, weapon, kills, HP, the
  eight air Foundry projects and Friendly Skies; it starts from the
  campaign's values.
- A sequence of jets against one UFO, each with its stance and the
  consumables it uses at the start (the best time: each acts on what comes
  next). Odds: UFO down (crashed, destroyed), per jet: down, escapes, jet
  lost, damage dealt and taken; and for every jet the three stances side by
  side (click one to pick it). Worked out in a Web Worker, 3,000 runs for
  the sequence and 1,500 per stance.
- "What the numbers do" per jet: each weapon's to-hit sum and chance, armor
  cut, damage, crit chance, firing time and shots before the escape; the
  UFO's the same; the escape time; the stance and consumable rules; the
  crash-or-destroyed rule.
- **Fly it**: the game's rolled shots played out (0.5×, 1×, 2×, pause), HP
  and the escape clock, Aim, Dodge, Boost and Break off at the moment you
  press them (keys A, D, B), a log, and the next jet against the damaged UFO.
- Data: `scripts/upk_airwar.py` reads the ship and weapon definitions as
  XGItemTree builds them (which INI value feeds which stat, what each Foundry
  project and Friendly Skies add, the per-category growth, the category
  thresholds for new UFO weapons) with the INI's numbers and the INT names,
  into `data/airwar.json`. The disassembler (`scripts/upk_script.py`) now
  prints memory offsets too, so jump targets resolve, and reads the array
  tokens these functions use.
- The save reader takes the hangar (`interceptors`); the recap "Days"
  statistic turned out to be alien research itself (ahead of the calendar by
  exactly the positive bonus research in all 600 saves where that is
  positive), so the Stats panel no longer adds the bonus a second time; it
  now also shows the UFO category.

**Verified.** Unit tests (14): stats from the INI with and without every
upgrade, UFO growth and re-arming by category, the stance and kill to-hit
rules and clamp, armor and crit, shot timing, Aim, Dodge, stance blocks,
shots from a downed ship, escape time with Boost, odds ordered by stance,
damage carried to the next jet, and the hangar read from save1762 (four
jets; "Mongoose" at 1,486/2,500 HP, 1 kill, aggressive). Playwright: the
tab from a save, the worker's odds, picking a stance, free selection, a
fight to its end. Checked on screen in both modes. The odds match Long
War's reputation: early Avalanches do 5 % damage to an Abductor (armor 30),
aggressive roughly triples a Scout kill against defensive at twice the
damage taken.

**Not verifiable here.** No save records a fight (only its result), so
the simulation is checked against the script, not against history.
Frame timing at the escape moment (a hit landing within one frame after it
may still count in the game) is not modelled. Break off ends the fight
0.3 s after it is pressed; in the game it waits for the animation, a
moment longer. The game rolls only once per engagement, so a single
"Fly it" is one possible fight, not the one the game would show.

**Left open.**
- The air war data is built from the person's INI; a loaded
  DefaultGameCore.ini does not change it yet.
- Long War's crash rule has a second "Transport / Terror Ship" case that can
  never be reached (the first wins); the code is followed as it is.

## Report (2026-10-18, round 2)

- Stances are shown from −15 to +15: Defensive, Balanced, Aggressive.
- The UFO is picked from a gallery on the right, smallest first (size class
  from XGItemTree.BuildShips, then hull points): a drawn outline per type
  (ours; the game's pictures are Firaxis's art), HP, armor with the game's
  own label for it, speed, weapons, what the type is for (paraphrased from
  the game's UFO analysis reports, `src/model/ufos.ts`), the next category
  change to come, and with a save how often the campaign has met it and
  whether its analysis is done. `data/airwar.json` now carries each ship's
  size class and picture number.

## Report (2026-10-18, round 3)

The gallery's "met N×" was the same counter, which counts won crash-site
and landed-UFO missions only (XGStrategy.PostCombat); it now reads
"captured N×" or "not yet captured". The disassembler reads `new` (token
0x11), which is what had hidden PostCombat.

## Report (2026-10-18, round 4)

- The UFO pictures are renders of our own models: `scripts/ufo_art.py`
  builds all eleven in Blender from simple shapes (revolved hulls, boxes,
  fins, glowing lights), each type with its own features (the Destroyer's
  prow and cannons, the Abductor's tower and beam emitter, the Harvester's
  arms, the Transport's ribbed hull, the Terror Ship's spikes, the
  Battleship's spire and turrets, the Assault Carrier's hangar bay), and
  renders them with Cycles on the CPU (this machine has no GPU; about 24 s
  for all) to `public/ufos/<type>.webp`, 400 × 200, about 10 KB each.
  `blender -b -P scripts/ufo_art.py -- public/ufos [type …]` redraws them.
  They show in the gallery, scaled by size class, and in the fight.
- The UFO block on the left keeps only its controls (name, starting HP,
  and in free selection the category and analysis); the gallery carries the
  numbers.

## Report (2026-10-18, round 5)

- The models were redone to be recognisable as their classes in Enemy
  Unknown's look, as UFOpaedia's pictures show them, without copying them
  (the reference pictures were only looked at, not kept): the Scout a thick,
  rounded-square saucer with a carved front scoop and side bulges; the
  Destroyer a wide flat oval with a layered rim and the same scoop; the
  Abductor a wide rounded block with a row of humps and front nacelles; the
  Transport a chunky box ending in a cluster of six thrusters; the
  Battleship a long angular hull with swept wings, a raised spine and ring
  structures; the Overseer a smooth violet lens. No glass domes (none of the
  game's have one). Long War's extra types keep their parent's shape, as the
  game keeps its pictures, plus their own mark (the Fighter's fins, the
  Raider's spine, the Harvester's claws, the Terror Ship's spikes, the
  Assault Carrier's deck and hangar bay). Hulls carry a panel grid.
- Our jets are modelled too: the Interceptor a twin-tailed fighter with
  canards, the Firestorm a crescent with forward-curving wings and a
  glowing engine ring. They fly in the fight instead of the triangle and
  sit on each jet's card. All pictures are now `public/ships/<EShipType>.webp`.
