---
title: "upkit: an UnrealScript decompiler and recompiler for Enemy Within's packages, as a standalone tool"
status: in-progress
priority: 2
dependsOn: []
---

## Purpose

The person, 2026-10-21, on the bytecode reader written for the tree's rules
(scripts/upk_script.py): "how complete is it and how hard would it be to
close the loop and make a full decompiler+recompiler as a stand alone tool?"
Then: "it should support outputting full upk's too in case someone want to
build something more serious but supporting the patch mode for the most
common use case is a good call", and: see how far it gets by 07:00 CEST on
2026-10-22.

XCOM: Enemy Within has no SDK; its mods are bytecode patches (PatchUPK /
PatcherGUI scripts), written by hand in hex or PatchUPK's pseudo-code after
reading the code in UE Explorer, which decompiles but does not compile. A
tool that decompiles a function to UnrealScript and compiles the edited
source back closes that loop.

## The shape

- `upkit/` in this repository for now (its own repository once it stands):
  TypeScript, run by Node directly, no build step; its own tests.
- Library and command line:
  - read a package (compressed or not): names, imports, exports, every
    object's fields;
  - bytecode: every token decoded to a tree and encoded back;
  - decompile a function, a state or a class to UnrealScript;
  - compile UnrealScript (a function body, a class) back to bytecode
    against the package's own types;
  - write: a whole package (functions replaced, objects grown and moved),
    or a PatchUPK script with the change, for the common case.

## Verification: the game's own code is the test

Every phase is measured over every function of XComGame.upk,
XComStrategyGame.upk and LWRebalance.u (about 18,600 functions):
- the bytecode: decoded to exactly its stored length, memory size equal to
  the stored one, encoded back byte for byte;
- the objects: each read to exactly its end;
- the compiler: decompile, compile, and the bytecode comes out identical.
  The share that does is the measure of how far it is.

Decompiled code stays on the user's machine; nothing of the game's goes into
the repository.
