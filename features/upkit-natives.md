---
title: "upkit: the native interface mapped (for upkit's compiler, and as a reference modders generate)"
status: planned
priority: 3
dependsOn: [upkit]
---

## Purpose

The person, 2026-10-22: "would it be worth mapping out and documenting the
entire native interface at least the parts already used, both for upkit's
own sake and for future mod makers?"

Enemy Within's script runs on C++ it cannot see: native functions, native
classes whose layout C++ fixes, events C++ calls, and classes that exist only
in C++ (`NetConnection`, `FracturedStaticMesh`, `StaticMesh` …), which the
script packages only import. upkit needs part of this to compile (three
vanilla functions do not come back because it cannot tell a C++-only class's
parent), and modders need all of it to know what they can call, override
and not change.

## Requirements

- Generated from the user's own packages by an upkit command, not committed:
  nothing of the game's goes into the repository. A modder runs it against
  their install and gets a readable reference (markdown).
- What the packages say: every native function (its index, owner, signature,
  flags: final, static, latent, iterator, operator and precedence); every
  event (what C++ calls, modders override); native classes (no new
  variables) and native structs.
- What the packages imply: the C++-only classes, their members as the
  packages import them (with types), and their parents as the shipped
  bytecode shows them (code reading a `StaticMesh` member on a
  `FracturedStaticMesh` says the one descends from the other), each with
  where it was seen.
- upkit's compiler uses the same inference, so the C++-only cases compile as
  plain source.
- What no package says (what a native does) is out of scope beyond a place
  for notes, if the person wants one.

## Verification

The three vanilla functions that do not come back today do, as plain source.
The inferred parents agree with what Unreal Engine 3 is known to have where
that is known; every inference names its evidence, so a wrong one can be
traced.
