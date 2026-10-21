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

## Report (2026-10-22)

Interim, written at 23:20 CEST and kept current through the night; the
final state is at the end of this section.

upkit is in `upkit/` (TypeScript, run by Node 24 directly; `npx vitest run`
in `upkit/` runs its 59 tests on the game's packages in the git-ignored
`samples/`, and skips them without). `upkit/README.md` says how to use it,
what compiles back, and the dialect the decompiler writes where UnrealScript
cannot say what a hand patch did.

What it does:

- reads every package of the game, compressed or not, and writes any of
  them back byte for byte;
- decodes and encodes every script (41,666 in the corpus) byte for byte;
  reads every object to its end;
- decompiles a function, a state's code or a whole class (declarations,
  structs, enums, constants, states, defaultproperties with components);
- compiles back, from a function's source or a whole class's (it finds what
  was edited): function bodies, state code with its label table,
  defaultproperties (every value from its type; the rest kept byte for
  byte);
- writes the change as a PatchUPK mod script (`--patch`; checked through
  the app's own PatchUPK implementation) or as a whole package (`--out`);
- with `--out`, declares what a class does not have: member variables,
  functions, states, structs, enums, constants, delegates; and new classes
  in a package, or (`new`) a new script package of new classes.

How far it is, measured:

| Compiled back in place, byte for byte | Functions | Identical |
|---|---|---|
| Core | 311 | 100% |
| Engine | 4,341 | 99.4% |
| XComGame (Long War 1.0) | 11,756 | 97.4% |
| XComStrategyGame (Long War 1.0) | 5,349 | 94.2% |
| LWRebalance.u | 1,484 | 96.9% |

Long War's own packages carry hand patches (bytecode no source compiles
to: flags set otherwise, stale jumps, nested contexts); `decompile` says so
above such a function. Every class's defaultproperties, compiled from the
text alone, come back byte for byte in all seven corpus packages.

Rebuilt from scratch: every class of LWR's `LWRebalance.u` decompiled and
built anew as a package with `new` has 96.9% of its 1,493 functions and
states token for token as the original, and 99.7% of its 9,235 objects
the same declarations. Twelve more mod packages in LWR's install rebuild the
same way (96.1% of their code); the table is in the README. What differs is
mostly where a mod was built against its own stubs of the game's classes,
and quirks of the UDK compiler those mods were built with.

Not verified: nothing upkit wrote has been loaded by the game. The win VM
has no GPU (Microsoft Basic Display Adapter) so XCOM does not run there
(recorded with `am learn`). The checks are structural: every package read
back whole, every class decompiled to its source, every function compiled
back to the same bytes against the written package, mod scripts applied by
the app's PatchUPK implementation, and the rebuilt mod packages compared
with what Unreal's own compiler made of the same source.
