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

# a new class in a package (its source declares it: class UpkitHelper extends XGStrategyActor; …)
node upkit/src/cli.ts compile XComStrategyGame.upk UpkitHelper UpkitHelper.uc --out XComStrategyGame.new.upk

# a new script package of your own classes
node upkit/src/cli.ts new MyMod.u MyModInfo.uc MyModData.uc --game <the game's CookedPCConsole>

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
| Engine (vanilla) | 4,341 | 99.7% |
| XComGame (vanilla) | 11,756 | 99.4% |
| XComStrategyGame (vanilla) | 5,349 | 99.2% |
| XComGame (Long War 1.0) | 11,756 | 97.9% |
| XComStrategyGame (Long War 1.0) | 5,349 | 94.8% |
| LWRebalance.u (LWR 2.06) | 1,484 | 97.1% |

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
Its `defaultproperties` are compiled too: a value changed or added (in the
class's default object, or a component it owns) is written from the
variable's type; every entry left as it was keeps its bytes. Every class's
defaults in the packages above, written out and compiled from the text
alone, come back byte for byte. In a mod script, a change that keeps the
object's size is hex at offsets in it; one that does not replaces the part
that changed, and PatchUPK resizes the object.

With `--out`, a class's source can also declare what the class does not
have: member variables (`var config float m_fBonus;`, arrays, structs,
objects) and functions (in the class or in one of its states, with
parameters, optional and out ones, and a return value). They are declared as
the compiler lays them out (linked first among the class's fields, entered
in its function map, an override linked to the function it overrides), then
compiled like any edited function; a default can be given in
`defaultproperties`. A native class cannot get new variables (its C++ fixes
its layout), and a mod script cannot add objects at all.

A class the package does not have can be declared too (`class X extends Y
[within Z] [config(Name)] [abstract] [placeable] …;`), into a package, or
with `new` into a new script package of its own (its header a cooked script
package's, as Core's: the game's versions and flags, not compressed). Its
parent can be in any of the game's script packages; what it names there is
imported. It inherits as the compiler has it inherit: its parent's flags
(but the native ones), `within`, config file and hidden categories; a copy
of each component its parent's default object owns, archetyped from the
parent's, with the defaults that pointed at the parent's pointing at its
own; the probe-mask bits of the events it defines (Tick, Touch,
PostBeginPlay …), without which the engine does not send them. Classes
compiled together can name each other.

The whole of it is measured on a real mod package: LWR's `LWRebalance.u`
(13 classes, 1,484 functions, 192 constants, 10 structs, 9 states,
delegates; built by its authors with Unreal's own compiler) decompiled class
by class and built anew from that source with `new`. Compared with the
original object by object: 96.9% of its functions and states have the same
code token for token (as compiling each function back in place does: the
rest are where LWR was built against its own stubs of the game's classes),
and 99.7% of its objects the same declarations (flags, links, members,
defaults).

The same for the other mod packages beside it in LWR's install (all built
with Unreal's compiler):

| Package | Functions and states | Same code | Same declarations |
|---|---|---|---|
| LWRebalance.u | 1,493 | 96.9% | 99.7% of 9,235 objects |
| MiniModsCollection.u | 569 | 96.0% | 96.8% of 2,121 |
| XComCampaignSummary.u | 100 | 89.0% | 96.6% of 441 |
| XComLZMutator.u | 72 | 98.6% | 96.4% of 474 |
| LWDebugger.u | 63 | 100% | 97.9% of 243 |
| Sightlines.u | 32 | 100% | 98.0% of 147 |
| CharacterColorizer.u | 24 | 100% | 96.7% of 92 |
| LoadoutManager.u | 24 | 95.8% | 97.1% of 137 |
| XComModsProfile.u | 23 | 100% | 97.9% of 146 |
| XComModBridge.u | 22 | 100% | 92.5% of 107 |
| XComMutator.u | 18 | 100% | 92.5% of 67 |
| RevealMod.u | 14 | 85.7% | 94.9% of 59 |
| XComSaveHelper.u | 8 | 100% | 98.0% of 49 |

(XComModShell.u names a class of the game's, `XComUIShell.UIFinalShell`,
that none of the game's package files the samples hold has, so it is not
built.) What differs is mostly where a mod was built against its own stubs
of the game's classes (a function not final there, a parameter an int), and
details of the compiler those mods were built with (UDK's) that the game's
own packages do not share (a class's probe mask, repeated hidden categories).

None of what upkit writes has been loaded by the game yet: the packages are
checked by reading them back (every object to its end, every class
decompiled to its source, every function compiled back to the same bytes),
and mod scripts by the app's own PatchUPK implementation. Getting the game to
load a new package (Long War's mutators are one way) is outside upkit.

Declared too: constants, enums, structs (with their
`structdefaultproperties`), states (`auto`, `simulated`, `extends`; their
functions and code), delegates and delegate-typed variables, functions
declared without a body.

Not compiled yet: native functions and interfaces; a changed signature or
variable type; new subobjects in the defaults; replication.

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
| `src/declare.ts` | new member variables and functions declared in a class |
| `src/defaults.ts` | defaultproperties to the tagged properties of the default object and its components |
| `src/fidelity.ts` | whether a function's source says all its bytecode (the note on hand patches) |
| `src/cli.ts` | the command line |

Tests (`npx vitest run` in `upkit/`) run on the game's packages in the
repository's git-ignored `samples/` folder and skip without them: every
script decoded and encoded back, every object read to its end, every package
written back unchanged, every function through PatchUPK, every class
decompiled, and the round trip above.
