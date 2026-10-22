---
title: "Mods as source: UnrealScript in a mod script, compiled against the player's own packages when applied (upkit's mode)"
status: planned
priority: 3
dependsOn: [upkit-mode]
---

## Purpose

The person, 2026-10-22: a mode of our own "that lets us do better and
possibly more advanced things". upkit-mode gave scripts a way to say they
are for our patcher (`UPK_FILE=…:UPKIT1`). This is the first thing worth
doing with it that no PatchUPK script can.

Today a mod is bytes for one version of one package. A REPLACEMENT_CODE
written for Long War 1.0's XComGame.upk names objects by path but carries
everything else as compiled bytecode, so it breaks on LWR (other offsets,
other locals). Two mods that change the same function cannot both be
applied: the second replaces the first. A modder has to ship one script per
game version, and players cannot combine mods freely.

A mod written as source can do better. It is compiled when it is applied,
by upkit's compiler, against the packages the player actually has. Then:
- the same mod fits plain Enemy Within, Long War and LWR wherever the code
  it names exists;
- an edit can say where it goes in a function ("after the line that sets
  X"), so two mods that touch one function combine;
- what does not fit says why, in UnrealScript terms.

## A sketch, to be challenged

- A section of the mode, `[UNREALSCRIPT]`, holding a class's source in the
  form `upkit class` writes it, with only the edited functions, defaults and
  new declarations. It is compiled as `upkit compile` compiles a class's
  source today, against the package and its neighbours in the install.
- Edits inside a function: inserted at a statement of it named by its
  source (a line, or a pattern), so they need not repeat the whole function.
- The site's engine gets upkit's compiler (the same TypeScript, bundled);
  the packages it needs (Core, Engine, the one edited) read before it runs.

## Open questions

- How the edit inside a function is anchored, so it is neither fragile nor
  ambiguous.
- How big the site's bundle gets with the compiler, and whether it is loaded
  only when a script asks for it.
- What a mod says when it does not fit one version: refuse, or apply what
  fits.
