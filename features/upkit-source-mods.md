---
title: "Mods as source diffs: a file type of our own (.upkmod), applied to the decompiled source and compiled against the player's own packages"
status: planned
priority: 3
dependsOn: [upkit-apply, tools-mods-complete]
---

## Purpose

The person, 2026-10-22/23, step by step:
- a mode of our own "that lets us do better and possibly more advanced
  things", made so it "cannot be used wrong by accident";
- a file ending "to make it clear when we are using our special mode", and
  "an entirely distinct syntax … that patchupk would just treat as one big
  noop … so there is no overlap of potential for confusion" (agreed: "yeah i
  think that makes a lot of sense");
- "multiple mods applied to that same file must be one of the most
  complicated problems … what if we were to take advantage of our decompile
  recompile and shipped mods as something more akin to git diffs that could
  anchor on text rather than indices?";
- "git is pretty good at being whitespace agnostic, maybe we could use a
  canonical format during the process?" (agreed: "go for it").

What goes wrong with mods today (PatchUPK scripts):
- **Two mods replacing one function.** REPLACEMENT_CODE swaps in a whole
  function, so the second mod silently erases the first.
- **Byte-pattern anchors.** FIND_HEX and BEFORE_HEX search for exact bytes.
  When another mod or another game version changed them, the anchor misses,
  or matches somewhere else.
- **Index numbers.** Mods written in hex carry name and object numbers that
  differ between plain Enemy Within, Long War and LWR.
- (Objects moving inside the file are not the problem: scripts name objects
  by path, and the export table says where each one is now.)

A mod should instead be a change to the source, as a diff of the class's
UnrealScript with a few unchanged lines around each change as its anchor,
like a git patch. It is applied to the player's own code, decompiled, and
compiled back. Then:
- two mods that change different lines of one function combine;
- one mod fits every game version whose code still has its anchor lines;
- no index appears anywhere: the compiler resolves names against the
  player's own package;
- a conflict is said in source terms ("both mods change this line of
  `GetResearchPerHour`"), not left as a silent overwrite;
- making a mod is decompiling, editing, and letting upkit write the diff.

What a player and a modder see:
- a mod of ours is a `.upkmod` file, and its first line says so;
- PatcherGUI refuses it instead of misreading it;
- the site and `upkit apply` take it, beside PatcherGUI's scripts, which
  keep their meaning exactly.

## Facts

PatchUPK, built from UPKUtils 9b2fd07, tried 2026-10-23:
- It acts only on lines it reads as its own commands (`KEY=` of its own
  keys, `[SECTION]`). Every other line is skipped without a word: plain
  text, a key it does not know, garbage between commands.
- Anything inside `{ … }` is a comment to it, across lines.
- A file with no command of its own: `Bad/unknown mod file format!`, exit 1,
  nothing written. A file in another syntax is refused, not applied.
- A file with commands and other text: the commands run, the rest is
  skipped.
- The file's name and ending do not matter to it. PatcherGUI, a separate
  program, was not checked.

upkit, as of upkit-asm and upkit-natives:
- every function and state of the corpus compiles back from its decompiled
  source byte for byte (hand patches through `__asm`);
- `upkit diff` already writes changed functions, declarations and defaults
  as source diffs;
- compiling a class's source compiles what was edited in it, new
  declarations included.

## Requirements

- **The file type.** `.upkmod`, its first line `upkit mod <version>` (the
  format's version), then a few header fields:
  - `name:`, `author:`, `description:`;
  - the package(s) it changes;
  - the game versions it was made and tested on.
  Then the diffs: per class, unified-diff hunks of the class's source, in
  the form `upkit class` writes it. The hunks cover functions, states,
  declarations and defaults, and a new class is a diff from nothing.
- **No overlap with PatchUPK scripts**:
  - a file whose first line is the header is ours;
  - any other file is a PatchUPK script and means exactly what it means
    today (upkit-apply);
  - our writer checks every file it writes with the same PatchUPK-compatible
    reader the engine uses, and never writes one in which PatchUPK would
    find a command;
  - our reader refuses a `.upkmod` in which PatchUPK would find one;
  - a format version newer than the tools know is refused, saying so.
- **Applying** one or more mods, in order:
  1. the classes they touch, decompiled from the package as it is to be
     built on (the original, as the site's planners build from originals);
  2. each mod's hunks applied in turn, the later on what the earlier left;
  3. what changed compiled once, against the package and its neighbours in
     the install;
  4. everything else left byte for byte as it was.
  A hunk whose anchor is not found, or found more than once, does not fit,
  and says where and why in source terms. So does a hunk whose lines another
  mod has already changed: a conflict, naming both mods.
- **Matching anchors on a canonical form**, not on characters:
  - *Tokens*: both sides through upkit's lexer. Spacing, line breaks and
    comments do not count; identifiers compare without case (UnrealScript
    ignores case); fragments such as a lone `if (x)` or `}` work.
  - *Names resolved*: a reference compares by the object it means, so
    `class'XGUnit'` and `class'XComGame.XGUnit'` match, and so do `self.m_iX`
    and `m_iX`.
  - *Meaning, later if needed*: anchor statements compiled to upkit's decoded
    bytecode tree, references by path, compared with the function's own,
    which is immune to how any upkit version prints. The format must allow
    adding this without changing.
- **The decompiler's output** no longer has to stay the same character for
  character. A later upkit may print code better, as long as it still reads
  the old text. A golden copy of the corpus's decompiled source, checked in
  the tests (generated locally, nothing of the game's in the repository),
  makes sure a printing change never changes the tokens or the meaning a
  mod's anchors match.
- **Making a mod**: an upkit command that writes a `.upkmod` from an edited
  class source (`upkit compile … --upkmod <file>`, say), from the same edit
  `--patch` and `--out` take today.
- **Where it works**: `upkit apply` and `restore`, and the site's Tools page.
  A `.upkmod` is listed as a mod, checked, applied and taken out like a
  PatcherGUI script, and its conflicts and misfits are shown in its card.
- **Mods outside the tested versions**: applied when they fit, and the page
  and `upkit apply` say they were not tested there.
- **What stays with PatchUPK scripts**: changes that only make sense in
  bytes (Flash movies, textures, a hand patch nobody can say in source).
  Those scripts keep working as they do.
- **The fixes of the retired `:UPKIT1` marker** (an insert that inserts,
  unknown commands as errors, additions counted in the generation) apply
  wherever this format writes at that level: the compiler's own writing of
  new objects already counts them.

## A sketch, to be challenged

```
upkit mod 1
name: Faster labs
author: …
package: XComStrategyGame.upk
tested: Long War 1.0, Long War Rebalanced 2.06

--- XGFacility_Labs
@@ function int GetResearchPerHour() @@
     iResearch = GetResearchPerHourNoBonus();
-    iResearch = iResearch * (1 + m_fLabBonus);
+    iResearch = iResearch * (2 + m_fLabBonus);
     return iResearch;
```

(A hunk names the function or block it is in, rather than line numbers, so
it can be found wherever the function is and whatever lines come before it.)

## Open questions

- Hunks: how much context by default, and what a hunk may span (a whole
  function, part of one, declarations).
- Two mods touching neighbouring lines: merged as git merges them, or a
  conflict.
- A mod that fits one version only in part: refuse it whole, or apply what
  fits.
- Options a player sets (as PatcherGUI's ALIAS literals are today).
- The site's bundle with upkit's compiler (loaded only when a `.upkmod` is
  there?), and reading the game's Core and Engine before compiling.

## Verification

- PatchUPK, given any `.upkmod` our tools write, refuses it and writes
  nothing (live with `PATCHUPK`).
- Our tools: a header with a PatchUPK command in the file refused, a newer
  version refused, PatchUPK scripts unchanged in meaning (upkit-apply's
  tests stay green).
- Canonical matching: anchors that differ only in spacing, line breaks,
  comments, case or qualification match; anchors that differ in code do not.
- Two mods editing one function apply together and compile to what both
  diffs say; two mods editing one line are reported as a conflict, naming
  both.
- One mod applies to Long War 1.0 and to LWR, and fails where its anchors
  are missing, saying where.
- The golden copy: the corpus decompiles to the same tokens as recorded.
- In the game: a `.upkmod` applied by the site or `upkit apply` runs.
