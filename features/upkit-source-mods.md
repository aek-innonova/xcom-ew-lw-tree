---
title: "Mods as source: a file type of our own (.upkmod), UnrealScript compiled against the player's own packages when applied"
status: planned
priority: 3
dependsOn: [upkit-apply, tools-mods-complete]
---

## Purpose

The person, 2026-10-22/23: a mode of our own "that lets us do better and
possibly more advanced things", made so it "cannot be used wrong by
accident". Then: a file ending "to make it clear when we are using our
special mode", and "an entirely distinct syntax that we recognize … and that
patchupk would just treat as one big noop … so there is no overlap of
potential for confusion". Agreed 2026-10-23: "yeah i think that makes a lot
of sense".

Today a mod is bytes for one version of one package. A REPLACEMENT_CODE
written for Long War 1.0's XComGame.upk names objects by path, but carries
everything else as compiled bytecode, so it breaks on LWR (other offsets,
other locals). Two mods that change the same function cannot both be
applied: the second replaces the first. A modder ships one script per game
version, and players cannot combine mods freely.

A mod written as source can do better. It is compiled when it is applied,
by upkit's compiler, against the packages the player actually has. Then:
- the same mod fits plain Enemy Within, Long War and LWR wherever the code
  it names exists;
- an edit can say where it goes inside a function, so two mods that touch
  one function combine;
- what does not fit says why, in UnrealScript terms.

What a player and a modder see:
- a mod of ours is a `.upkmod` file, and its first line says so;
- PatcherGUI refuses it instead of misreading it;
- the site and `upkit apply` take it, beside PatcherGUI's scripts, which
  keep their meaning exactly.

## Facts (PatchUPK built from UPKUtils 9b2fd07, tried 2026-10-23)

- It acts only on lines it reads as its commands (`KEY=` of its own keys,
  `[SECTION]`). Every other line is skipped without a word, whether plain
  text, a key it does not know, or garbage between commands.
- Anything inside `{ … }` is a comment to it, across lines: an UnrealScript
  body is invisible to it, `MOD_NAME=…` lines inside included.
- A file with no command of its own: `Bad/unknown mod file format!`, exit 1,
  nothing written. So a file in another syntax is refused, not applied.
- A file with commands plus other text: the commands run, the rest is
  skipped.
- The file's name and ending do not matter to it (`mod.upkit`, `mod` applied
  like `mod.txt`; its uninstall file is `<name>.uninstall.txt`). PatcherGUI,
  a separate program, was not checked.

## Requirements

- **The file type.** `.upkmod`, its first line `upkit mod <version>` (the
  format's version). Below it, a syntax of our own in which no line outside
  `{ … }` is one PatchUPK reads as a command.
- **No overlap**:
  - a file whose first line is the header is ours;
  - any other file is a PatchUPK script and means exactly what it means
    today (upkit-apply), our syntax in it being text PatchUPK skips;
  - a file with our header in which PatchUPK would find a command is
    refused by our tools (PatchUPK would apply that part);
  - nothing our tools write contains one;
  - a version newer than the tools know is refused, saying so.
- **The contents** (to be designed; the sketch below is a start):
  UnrealScript in the form `upkit class` writes it. Whole functions,
  defaults and new declarations, compiled as `upkit compile` compiles a
  class's source today, against the package and its neighbours in the
  install. Edits placed inside a function at a statement named by its
  source, so a mod need not repeat the whole function and two mods can
  combine. Byte-level operations only if a real need turns up.
- **Where it works**: `upkit apply` (and `restore`), and the site's Tools
  page: listed as a mod, checked, applied and taken out like a PatcherGUI
  script. upkit can also write one (`compile … --upkmod <file>`, say).
- **The `:UPKIT1` marker of upkit-mode is retired**: it kept PatchUPK
  syntax and relied on one line to keep PatchUPK out. Its fixes (an insert
  that inserts, unknown commands as errors, additions counted in the
  generation) belong to this format wherever it edits at that level.

## A sketch, to be challenged

```
upkit mod 1
name: Faster labs
author: …
package: XComStrategyGame.upk

class XGFacility_Labs
{
    function int GetResearchPerHour()
    {
        …the whole function, as upkit class writes it…
    }

    in function UpdateLabBonus, after "m_fLabBonus = 0;"
    {
        m_fLabBonus += 0.1;
    }
}
```

## Open questions

- How an edit inside a function is anchored, so it is neither fragile nor
  ambiguous (a statement's source, a label, the n-th call of something),
  and what happens when two mods anchor at the same place.
- How big the site's bundle gets with upkit's compiler, and whether it is
  loaded only when a `.upkmod` is there. The compiler also needs the game's
  Core and Engine at hand, read before it runs.
- What a mod says when part of it does not fit one version: refuse it whole,
  or apply what fits.
- Options a player sets (as PatcherGUI's ALIAS literals are today).

## Verification

- PatchUPK, given any `.upkmod` our tools write, refuses it and writes
  nothing (tested, as in the facts above).
- Our tools: a header with a PatchUPK command in the file refused, a newer
  version refused, a PatchUPK script unchanged in meaning (upkit-apply's
  tests stay green).
- One mod fitting two versions (Long War 1.0 and LWR), and two mods
  editing one function, applied together, compiled back to what the source
  says.
- In the game: a `.upkmod` applied by the site or `upkit apply` runs.
