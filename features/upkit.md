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

Written through the night and kept current; the state below is as of the
last commit before 07:00.

upkit is in `upkit/` (TypeScript, run by Node 24 directly, or as one file:
`node upkit/build.mjs` writes `upkit/dist/upkit.mjs`). `npx vitest run` in
`upkit/` runs its tests on the game's packages in the git-ignored `samples/`
(skipped without them). `upkit/README.md` is the manual: the common case
first, every command, what compiles back, how the source reads, upkit's own
syntax for what UnrealScript cannot say, and the files.

### What it does

- Reads every package of the game, compressed or not; writes any of them back
  byte for byte. Decodes and encodes every script (41,666 in the corpus) byte
  for byte; reads every object to its end.
- Decompiles a function, a state's code, a whole class (constants, enums,
  structs, variables, functions, states, defaultproperties with components),
  or a whole package (`export`: a .uc per class). The source reads as written
  where that is provably the same code: `for`, `continue`, `else if`, the
  conversions the compiler makes on its own left out (each function so
  written is compiled and kept only if its bytes are the same).
- Compiles back what was edited in a function's or a whole class's source:
  bodies, state code (labels, the label table), defaultproperties and a
  struct's structdefaultproperties (a value from its type; the rest kept
  byte for byte). Mistakes are refused with the function and the line (a
  type where another is wanted, a missing cast, too many arguments, an
  unknown name, a parse error); so is a changed declaration of something the
  package has (a function's parameters, a variable's type or modifiers, a
  struct's members, a state's or class's declaration, a replication block),
  which is not compiled: what the package has keeps its declarations.
- Writes the change as a PatchUPK mod script (`--patch`; it adds the names,
  imports and new locals the code needs; with new declarations, the script
  that makes the original into the whole package `--out` writes)
  or as a whole package (`--out`; also new imports, locals, and new
  declarations: member variables, functions, states, structs, enums,
  constants, delegates, interfaces, classes with their replication; `new`
  builds a new script package, and a start for its .int and .ini).
- `diff`: two versions of a package compared, each changed function as a
  diff of its source (Long War changed 651 of XComStrategyGame's).

### How far it is, measured

Decompiled and compiled back in place, byte for byte:

| Package | Functions | Identical |
|---|---|---|
| Core (vanilla) | 311 | 100% |
| Engine (vanilla) | 4,341 | 99.8% |
| XComGame (vanilla) | 11,756 | 99.9% |
| XComStrategyGame (vanilla) | 5,349 | 99.8% |
| XComGame (Long War 1.0) | 11,756 | 98.4% |
| XComStrategyGame (Long War 1.0) | 5,349 | 95.2% |
| LWRebalance.u | 1,484 | 97.1% |

Long War's packages carry hand patches (bytecode no source compiles to:
flags set otherwise, stale jumps, nested contexts, arguments a function no
longer takes); `decompile` says so above such a function. The vanilla
packages came from the win VM's install into `samples/ew/`.

- Every class's defaultproperties, compiled from the text alone, come back
  byte for byte (all seven corpus packages and vanilla).
- Every class, decompiled, reads back as unchanged (nothing compiled when
  nothing was edited).
- Built anew from source: LWR's `LWRebalance.u`, every class decompiled and
  built as a new package with `new`, has 97.1% of its 1,493 functions and
  states token for token as the original Unreal compiler made them, and
  99.7% of its 9,235 objects the same declarations. Twelve more mod packages
  beside it rebuild with 96.5% of their code the same.
- A whole package from upkit holds what PatchUPK makes of the same change:
  the same names, imports, export entries and every object's bytes. Checked
  with PatchUPK itself (built on Linux from wghost's UPKUtils source, run by
  the tests when `PATCHUPK` names the binary; eleven kinds of edit: a
  function's code (the same size, grown, shrunk, a name added, two adding
  imports, two adding locals), defaults (the same size; grown, a name added),
  a state's code with a label added) and with the app's implementation
  (four, as it takes neither imports nor objects). Every function of Engine, XComGame,
  XComStrategyGame and LWRebalance.u (22,930), written back as a mod script and
  applied by PatchUPK, comes out byte for byte with the engine's memory size
  (which found that PatchUPK cannot read a name with a space in it as
  `<Name>`; such a name now goes in as its bytes). Declarations as a mod
  script (a member variable and a function; a constant, an enum, a struct and
  a state; a new class in the package), applied by PatchUPK: the same package
  as `--out`. On the win VM, the
  PatchUPK.exe that Long War's Mod Manager ships, applying the mod scripts
  that add imports, locals, a member variable and a function, and a new
  class, made the same packages as `--out` (five scripts).
- The rebuilt LWRebalance.u imports what the original does, as it does
  (2,828 imports the same, none of another class).
- On Windows (the VM's Node 24, its vanilla and its LW + LWR installs, paths
  with spaces) the one-file build decompiles, exports, diffs, writes a mod
  script and a whole package.
- Lint-clean as the repository lints; the app's own unit tests leave
  upkit's to upkit (they had been picking them up).

### Not verified, and not done

- Nothing upkit wrote has been loaded by the game. The win VM has no GPU
  (Microsoft Basic Display Adapter), so XCOM does not run there (recorded
  with `am learn`). The checks above are structural and by comparison with
  what Unreal's compiler and PatchUPK make.
- The app's own PatchUPK implementation takes neither `[ADD_IMPORT_ENTRY]`
  nor `[ADD_EXPORT_ENTRY]`, so a mod script that adds imports, locals or
  declarations needs PatcherGUI / PatchUPK to apply it. PatchUPK's
  `[ADD_EXPORT_ENTRY]` does not link what it adds (it writes the link at the
  end of the file: a stream's reading and writing positions apart); upkit's
  scripts write every link themselves.
- Not compiled: native functions; a changed declaration of something the
  package has (refused, with that said). Replication is compiled for new
  classes only.
- Mods people wrote by hand (the samples' PatcherGUI scripts): 7 of the 16
  functions they change compile back byte for byte; the rest is hex no
  compiler writes (a fixed skip of 10, a call short of an argument).
- upkit lives in this repository; standing on its own needs a repository of
  its own (a person's decision: its name, its licence), with the test that
  uses the app's PatchUPK implementation moved or dropped. `upkit/package.json`
  is ready for that (private for now).

### To check in the game (a machine with a GPU, the game installed)

Smallest risk first; each step undone by restoring the package (keep a copy):

1. A mod script: `class XComStrategyGame.upk XGFacility_Labs`, change
   `GetResearchPerHour` to return a large number, `compile … --patch labs.txt`,
   apply with PatcherGUI; research should finish within a day.
2. The same change as a whole package (`--out`), copied over the game's
   `XComStrategyGame.upk` (on an install whose exe has the hash check off, as
   Long War's has): the same result, which tells that upkit's packages load.
3. A new member variable and function in a class (`--out`), used from an
   edited function: tells that new declarations load and run.
4. A new script package (`new`, a class extending XComMutator) loaded the way
   Long War's mutators are: tells that a package upkit made from nothing loads.
   
