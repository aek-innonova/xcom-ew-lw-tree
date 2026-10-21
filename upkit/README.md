# upkit

An UnrealScript decompiler and recompiler for XCOM: Enemy Within's packages
(Unreal Engine 3, package version 845): read a function or a whole class as
UnrealScript, edit a function, and compile it back, into a whole new package
or as a PatchUPK / PatcherGUI mod script.

Enemy Within has no SDK. Its mods are bytecode patches, written by hand after
reading the code in a decompiler that does not compile. upkit closes that
loop: decompile, edit the source, compile.

It works on the game's own files on your machine. Nothing of the game's is
part of upkit, and decompiled code stays where you put it.

## Use

Node 24 or later runs it as it is (no build step):

```sh
node upkit/src/cli.ts info      XComStrategyGame.upk
node upkit/src/cli.ts list      XComStrategyGame.upk Labs
node upkit/src/cli.ts decompile XComStrategyGame.upk XGFacility_Labs.GetResearchPerHour > labs.uc
node upkit/src/cli.ts class     XComStrategyGame.upk XGFacility_Labs > XGFacility_Labs.uc

# edit labs.uc, then either …
node upkit/src/cli.ts compile XComStrategyGame.upk XGFacility_Labs.GetResearchPerHour labs.uc --patch labs.txt
# … a mod script any PatcherGUI install applies, or
node upkit/src/cli.ts compile XComStrategyGame.upk XGFacility_Labs.GetResearchPerHour labs.uc --out XComStrategyGame.new.upk

# or edit any of a whole class's functions and states' code, and compile what was edited
node upkit/src/cli.ts compile XComStrategyGame.upk XGFacility_Labs XGFacility_Labs.uc --patch labs.txt

node upkit/src/cli.ts roundtrip XComGame.upk   # how much of a package compiles back byte for byte
```

Run it on the packages in the game's `XComGame/CookedPCConsole` folder (other
packages are found beside the one given; `--game <folder>` says where else to
look). Compressed packages are read as they are.

- `--patch` writes the change as `[REPLACEMENT_CODE]` in PatchUPK
  pseudo-code: object references as `<Path>`, so PatchUPK stores the memory
  size the engine counts. The function grows or shrinks as needed (`:AUTO`).
- `--out` writes a whole package: by default every object stays where it was
  and a function that grew moves to the end, as PatchUPK moves it;
  `--layout compact` lays every object out anew. Written unchanged, every
  package of the game comes out byte for byte as it was.

## What compiles back

A function's body and its parameters' defaults, and a state's code (its
labels, and the label table the state keeps), against the package's own
declarations and the packages it imports (types, functions, properties,
native operators). Measured on the game's own code (decompile every function,
compile it, compare the bytes):

| Package | Functions | Identical |
|---|---|---|
| Core (vanilla) | 311 | 100% |
| Engine (vanilla) | 4,341 | 99.4% |
| XComGame (Long War 1.0) | 11,756 | 97.4% |
| XComStrategyGame (Long War 1.0) | 5,349 | 94.2% |
| LWRebalance.u (LWR 2.06) | 1,484 | 96.9% |

Long War's and LWR's packages carry many functions patched by hand, some of
them in forms Epic's compiler never wrote (a constant where a member was,
flags set differently); those are most of the difference.

What an edited body needs that the package lacks is added:

- with `--out` (a whole package): new names, new imports (a function or a
  class of another package used for the first time), and new local variables
  (`local float fBonus;`), linked into the function;
- with `--patch` (a mod script): new names, by `[ADD_NAME_ENTRY]`. A mod
  script cannot add imports or locals; upkit says so and points to `--out`.

Given a whole class's source (as `class` writes it), `compile` finds the
functions and states' code whose source differs from what the package
decompiles to, and compiles those, together (what they add is added once).

Not compiled yet: other declarations (new member variables, functions,
states, classes, a function's signature), defaultproperties, replication.

Hand patches can hold bytecode no UnrealScript compiles to (a flag set
otherwise, a skip size that is not what it skips). `decompile` says so above
such a function, naming where its source and its bytes part; the source
compiles to what Epic's compiler would write.

## upkit's own syntax

Where the bytecode holds something UnrealScript cannot say, the decompiler
writes it in a form the compiler reads back the same:

- `goto L123;` and `L123:` for jumps that fit no if/while/for/switch;
  `if (!(x)) goto L123;` for a conditional jump. `goto @123;` jumps to a
  place where no statement starts (a hand patch's stale jump).
- `0x00`, `0x00000005`: an integer constant in the width it was stored in
  (decimal literals compile as Epic's compiler stores them: 0 and 1 as their
  own tokens, up to 255 in a byte).
- `byte(5)`: a byte constant (an enum value); `byte(int(5))`: a cast.
- `-5` is a negative constant; `-(5)` the minus operator on 5.
- `super(Class.State).Function()`: a parent state's function.
- `obj.(5)`: a constant read through an object (a patch's).
- `;` alone: an empty statement (`Nothing`, which patches pad with).
- `"\n"`, `"\t"`: a line break and a tab in a string (UnrealScript has no
  way to write them; a string stays on its line).
- `__NoEpilogue;`: a function without the return the compiler adds at the
  end (a patch that removed it).
- `__IteratorNext;`, `__IteratorPop;`: iterator steps outside a foreach.

## How it is built

| File | What it does |
|---|---|
| `src/package.ts` | the package: summary, names, imports, exports, objects' data; decompression |
| `src/writer.ts` | a package written back (tables rebuilt; names, imports, exports added) |
| `src/bytecode.ts` | every token, decoded to a tree and encoded back from one table |
| `src/objects.ts` | functions, states, classes, structs, enums, consts, properties read whole |
| `src/linker.ts` | imports followed into other packages; natives by index |
| `src/types.ts` | UnrealScript types from properties |
| `src/decompile.ts` | a function (or a state's code) to UnrealScript |
| `src/classdecomp.ts` | a whole class to UnrealScript |
| `src/parse.ts` | UnrealScript to a syntax tree |
| `src/compile.ts` | the syntax tree to bytecode, tokens chosen as Epic's compiler chose them |
| `src/patch.ts` | a change as a PatchUPK mod script |
| `src/changes.ts` | a set of changes compiled together, into a package or a mod script |
| `src/classsrc.ts` | a class's source split into its functions and states' code; what was edited |
| `src/fidelity.ts` | whether a function's source says all its bytecode (the note on hand patches) |
| `src/cli.ts` | the command line |

Tests (`npx vitest run` in `upkit/`) run on the game's packages in the
repository's git-ignored `samples/` folder and skip without them: every
script decoded and encoded back, every object read to its end, every package
written back unchanged, every function through PatchUPK, every class
decompiled, and the round trip above.
