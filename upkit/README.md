# upkit

An UnrealScript decompiler and recompiler for XCOM: Enemy Within's packages
(Unreal Engine 3, package version 845): read a function or a whole class as
UnrealScript, edit it (its functions and defaults; new variables, functions,
states, classes), and compile it back, as a PatchUPK / PatcherGUI mod script
or into a whole new package.

Enemy Within has no SDK. Its mods are bytecode patches, written by hand after
reading the code in a decompiler that does not compile. upkit closes that
loop: decompile, edit the source, compile.

It works on the game's own files on your machine. Nothing of the game's is
part of upkit, and decompiled code stays where you put it.

## Use

Node 24 or later runs it as it is (`node upkit/src/cli.ts …`, no build
step), or as one file: `npm run build` in `upkit/` (`node build.mjs`) writes
`upkit/dist/upkit.mjs`, which is all a modder needs beside Node
(`node upkit.mjs …`). `npm test` runs its tests, `npm run type-check` checks
its types.

The common case, a change to a function as a mod script:

```sh
cd "<the game>/XComGame/CookedPCConsole"
node upkit.mjs class XComStrategyGame.upk XGFacility_Labs > XGFacility_Labs.uc
# edit any function in XGFacility_Labs.uc (or a default in its defaultproperties), then
node upkit.mjs compile XComStrategyGame.upk XGFacility_Labs XGFacility_Labs.uc --patch labs.txt
# labs.txt is a PatchUPK mod script: apply it (or with PatcherGUI); restore puts the originals back
node upkit.mjs apply labs.txt --game .
node upkit.mjs restore --game .
```

All of it:

```sh
node upkit.mjs info      XComStrategyGame.upk
node upkit.mjs list      XComStrategyGame.upk Labs
node upkit.mjs decompile XComStrategyGame.upk XGFacility_Labs.GetResearchPerHour > labs.uc
node upkit.mjs class     XComStrategyGame.upk XGFacility_Labs > XGFacility_Labs.uc
node upkit.mjs export    XComStrategyGame.upk XComStrategyGame-src/   # every class, a .uc each

# one function edited: a mod script, or a whole package
node upkit.mjs compile XComStrategyGame.upk XGFacility_Labs.GetResearchPerHour labs.uc --patch labs.txt
node upkit.mjs compile XComStrategyGame.upk XGFacility_Labs.GetResearchPerHour labs.uc --out XComStrategyGame.new.upk

# a whole class's source: what was edited is compiled (new variables, functions, states too)
node upkit.mjs compile XComStrategyGame.upk XGFacility_Labs XGFacility_Labs.uc --patch labs.txt

# a new class in a package (its source declares it: class UpkitHelper extends XGStrategyActor; …)
node upkit.mjs compile XComStrategyGame.upk UpkitHelper UpkitHelper.uc --patch helper.txt

# a new script package of your own classes
node upkit.mjs new MyMod.u MyModInfo.uc MyModData.uc --game "<the game>/XComGame/CookedPCConsole"

# what another version changed (a mod against the game, say): each function, and each class's
# declarations and defaults, as a diff of its source
node upkit.mjs diff vanilla/XComStrategyGame.upk XComStrategyGame.upk XGFacility_Labs

node upkit.mjs natives Core.upk > natives.md   # the native interface, as a reference (below)

node upkit.mjs roundtrip XComGame.upk   # how much of a package compiles back byte for byte
node upkit.mjs roundtrip XComGame.upk --list   # and which functions do not (hand patches, mostly), and where

# mod scripts (upkit's, PatcherGUI's) applied to the game's packages; --check only says what they would do
node upkit.mjs apply labs.txt SomeoneElsesMod.txt --game "<the game>/XComGame/CookedPCConsole" --check
```

Run it on the packages in the game's `XComGame/CookedPCConsole` folder (other
packages are found beside the one given; `--game <folder>` says where else to
look, as a mod's own folder needs: upkit says so when it finds no Core.upk).
Compressed packages are read as they are.

- `--patch` writes the change as `[REPLACEMENT_CODE]` in PatchUPK
  pseudo-code: object references as `<Path>`, so PatchUPK stores the memory
  size the engine counts. The function grows or shrinks as needed (`:AUTO`).
  What PatchUPK would not read back as written goes in as its bytes: a name
  with a space in it (XComGame has one), or ending in `_` and a digit; a path
  it would find another object by (23 of Engine's functions have one), the
  memory size then set after. Every function of Engine, XComGame,
  XComStrategyGame and LWRebalance.u, written back this way and applied by
  PatchUPK, comes out byte for byte with the engine's memory size.
- `--out` writes a whole package: by default every object stays where it was
  and a function that grew moves to the end, as PatchUPK moves it;
  `--layout compact` lays every object out anew. Written unchanged, every
  package of the game comes out byte for byte as it was.

## Applying mod scripts

`upkit apply` applies PatchUPK mod scripts (PatcherGUI's `.txt`, and the ones
`--patch` writes) to the packages in a folder, on any system with Node:

- Every command PatchUPK's readme documents: the scopes (`OFFSET`,
  `NAME_ENTRY`, `IMPORT_ENTRY`, `EXPORT_ENTRY`, `OBJECT` with `KEEP`,
  `MOVE`, `AUTO` and `INPL`), the finds and writes (hex, pseudo-code, the
  value keys, `MODDED_FILE`, `BULK_DATA`), `REPLACEMENT_CODE`,
  `BEFORE`/`AFTER`, `REPLACE_*`, `INSERT_CODE`, `RENAME`, `EXPAND_FUNCTION`
  and `EXPAND_UNDO`, `GUID`, `ALIAS`, and the additions
  (`ADD_NAME_ENTRY`, `ADD_IMPORT_ENTRY`, `ADD_EXPORT_ENTRY`). A file a script
  names is read beside the script.
- The packages as the game ships them: one compressed whole (with its
  `.uncompressed_size`) or in chunks is applied to decompressed, and written
  so: the size file goes, and the flag saying "stored compressed" is
  cleared (the game fails to load the package with it).
- Each step is said: it changes something, it is so already, or it does not
  fit (and why). Nothing is written unless every step of every script fits; a
  mod applied already changes nothing.
- The first time a file changes, it is kept as it was in `upkit-backup`
  beside the folder (`XComGame/upkit-backup`; not inside `CookedPCConsole`:
  the game reads every package under it, subfolders too, and stops at a
  second `XComGame.upk`). `upkit restore --game <folder>` puts them back.

It does what PatchUPK does, byte for byte, wherever a mod could see the
difference: mods were made and tested against PatchUPK as it is. So
`INSERT_CODE` writes its first byte over the one at the offset, as PatchUPK
does (its readme says "insert"). It does otherwise where PatchUPK falls short
of its own readme and no mod can depend on it:

- an object `ADD_EXPORT_ENTRY` adds is linked to its owner (its last child),
  which PatchUPK means to do and does not (it writes the link's four bytes at
  the end of the file instead);
- it is counted among the package's net objects (the game logs it as invalid
  otherwise) and has its (empty) entry in the depends table;
- `REPLACE_HEX` and `REPLACE_CODE` replace every place, where PatchUPK can
  stop at the second.

No uninstall scripts (`.uninstall.txt`) are written: the originals are kept.

### upkit's mode

A script can ask to be read without PatchUPK's faults, on its package lines:

```
UPK_FILE=XComGame.upk:UPKIT1
```

PatchUPK (and so PatcherGUI) stops at such a line before writing anything:
it looks for a file of that name. A key on a line of its own would not do,
since PatchUPK skips keys it does not know and would apply the rest with its
own meaning. So would a patcher of ours that knows an older mode (the number
is the mode's version). Every package line of the script carries the mark;
a script marked in part is refused. In mode 1:

- `INSERT_CODE` inserts (nothing written over), and inside a function's or
  state's script, the script's serial and memory sizes grow with it;
- a key or section the format does not have is an error (PatchUPK skips it:
  a misspelt key does nothing there);
- names and exports added are counted in the package's generation, as
  `--out` counts them.

The rest means what it means without the mode. `upkit apply` and the lwtree
site's Tools page both read it.

The engine is the one the lwtree site's Tools page uses
(`src/model/modpatch.ts` in this repository), written from PatchUPK's
documentation and from its observed behaviour, not from its code (UPKUtils is
GPL v2).

## What compiles back

A function's body and its parameters' defaults, a state's code (its labels,
and the label table the state keeps), and a class's defaultproperties,
against the package's own declarations and the packages it imports (types,
functions, properties, native operators). Measured on the game's own code
(decompile every function, compile it, compare the bytes):

| Package | Functions | Identical | With `__asm` (escapes) |
|---|---|---|---|
| Core (vanilla) | 311 | 100% | 0 |
| Engine (vanilla) | 4,341 | 100% | 0 |
| XComGame (vanilla) | 11,756 | 100% | 0 |
| XComStrategyGame (vanilla) | 5,349 | 100% | 2 (8) |
| GFxUI, GameFramework, IpDrv, OnlineSubsystemSteamworks (vanilla) | 1,154 | 100% | 0 |
| XComGame (Long War 1.0) | 11,756 | 100% | 176 (945) |
| XComStrategyGame (Long War 1.0) | 5,349 | 100% | 244 (1,652) |
| LWRebalance.u (LWR 2.06) | 1,484 | 100% | 36 (90) |

States' code, the same way: all of them (269 vanilla, 262 Long War's, 7 of
LWRebalance's).

Most of that is source as Epic's compiler would compile it. Where the bytes
say what UnrealScript cannot, the decompiler writes those places as
`__asm(…)` (upkit's own syntax, below), as few as it takes: Long War's
packages carry many functions patched by hand, in forms no compiler writes
(a constant of another width, flags set otherwise, stale skips, another
function's local, a context nested inside a context's member, code copied
from another function with its return value). `decompile` says so above
such a function. The vanilla packages' two are Epic's compiler's own odd
bytes (two cheats' left-out arguments wrapped in the Outer context). A
hand-patched function can be edited like any: what is not touched keeps its
bytes. (Code reading members of classes only C++ defines compiles as plain
source: their parents, as the bytecode shows them, below.)

### Edits

Given a whole class's source (as `class` writes it), `compile` finds the
functions and states' code whose source differs from what the package
decompiles to, and compiles those, together (what they add is added once).
Its `defaultproperties` are compiled too: a value changed or added (in the
class's default object, or a component it owns) is written from the
variable's type, every entry left as it was keeps its bytes; so are a
struct's `structdefaultproperties`, edited. (Every class's
defaults in the packages above, compiled from the text alone, come back byte
for byte.)

What an edited body needs that the package lacks is added:

- with `--out` (a whole package): new names, new imports (a function or a
  class of another package used for the first time), and new local variables
  (`local float fBonus;`), linked into the function;
- with `--patch` (a mod script): the same, the way PatchUPK adds them: new
  names by `[ADD_NAME_ENTRY]`, new imports by `[ADD_IMPORT_ENTRY]` (each
  appended to the table, its outer first), new locals by `[ADD_EXPORT_ENTRY]`
  with the local's data written over the empty object PatchUPK appends, all
  before the code that names them. (PatchUPK says it links each object it
  adds as its owner's last child, but writes that link at the end of the file
  instead, four stray bytes; upkit writes every link itself.)
  A default changed in place is hex at offsets in its object; one that
  changes its size replaces the part that changed, and PatchUPK resizes the
  object.

Mistakes are refused with the function and the line: a value of another type
where one is wanted (`iCount = "abc";`), an object where a subclass of its
class is wanted without a cast, more arguments than a function takes, an
assignment to what is not a variable, an unknown name, source that does not
parse.

### New declarations

A class's source can declare what the class does not have (into a whole
package with `--out`, or as a mod script, below):
member variables (`var config float m_fBonus;`, arrays, structs, objects,
delegates), functions and events (in the class or one of its states, with
parameters, optional and out ones, a return value; or declared without a
body), states (`auto`, `simulated`, `extends`; their functions and code),
structs (with their `structdefaultproperties`), enums, constants and
delegates. They are declared as the compiler lays them out (linked among the
class's fields, entered in its function map, an override linked to what it
overrides), then compiled like any edited function; a default can be given
in `defaultproperties`. A native class cannot get new variables (its C++
fixes its layout).

A class the package does not have can be declared too (`class X extends Y
[within Z] [config(Name)] [abstract] [placeable] [implements(I)] …;`, or
`interface IFoo;`), into a package, or with `new` into a new script package
of its own (its header a cooked script package's, as Core's: the game's
versions and flags, not compressed). Its parent can be in any of the game's
script packages, or a mod's beside them; what it names there is imported. It
inherits as the compiler has it inherit: its parent's flags (but the native
ones), `within`, config file and hidden categories; a copy of each component
its parent's default object owns, archetyped from the parent's, with the
defaults that pointed at the parent's pointing at its own; the probe-mask
bits of the events it defines (Tick, Touch, PostBeginPlay …), without which
the engine does not send them. Its `replication` block is compiled (the
conditions become the class's script; the variables named are marked
replicated with their condition's offset). Classes compiled together can
name each other. `new` also writes, beside the package, a start for what its
classes read from outside it: `<Package>.int` with the values its
`localized` variables are given in `defaultproperties`, and
`Default<Config>.ini` with its `config` ones (never over a file there).

With `--patch`, declarations (and a new class in the package) go into a mod
script too: upkit builds the whole package as `--out` would, and writes the
script that makes the original into it, every object it adds by
`[ADD_EXPORT_ENTRY]` and its data, every object that changes by its code
(pseudo-code) or its bytes. Applied by PatchUPK, it makes the same package
as `--out` (checked for a member variable and a function, a constant, an
enum, a struct and a state, and a new class).

A variable the class has can have its modifiers changed (`var int X;` to
`var config int X;`, `const`, `transient` …; the type, category and array
size as they were): its flags are written, either way. `config` needs the
class to have a config file (`config(GameCore)`); a native variable is C++'s.
upkit says where a config or localized variable's value now comes from. A
function can be made `exec` (callable from the console), `simulated`,
`singular` or an `event`, or no longer, its parameters and return type as
they were. An enum can get values added at its end (new item or tech types,
say): the values it had keep their numbers.

### What is not compiled

What the source leaves out stays in the package (nothing is deleted), and a
declaration the package has, changed in the source (a function's
parameters, return type or other modifiers; a variable's type, category or
array size; a struct's members, which a native class using the struct would
have fixed in C++; an enum's values but for ones added at its end; a
constant's value; a state's or a class's declaration; a replication block),
is refused with that said: for what the package has, bodies, defaults and
the modifiers and enum values above compile. Native functions are not
compiled (their code is C++).

## The native interface

`natives` writes what the game's script calls in C++ and is called by, from
the packages beside the one given (or `--game`), as a reference: per package
its native classes (no variable can be added to them) and native structs,
its native functions (declaration, native index, final, static, latent,
iterator, operator and precedence) and its events (script functions C++
calls: what a mod overrides to be called); then the classes only C++
defines, which the packages import and none has (`Engine.NetConnection`,
`Engine.FracturedStaticMesh` …), with their members as the packages import
them and their parents as the shipped bytecode shows them (code reading a
`StaticMesh` member on a `FracturedStaticMesh` says the one descends from
the other), each with where it was seen. The compiler uses the same: a
member of such a class is found through its parent, and an object member of
one has the class the bytecode reads it as.

The reference is generated on the machine that has the game, not shipped.
`notes/natives.md` is ours: what natives do as far as we know it, in our own
words, each saying how it is known (Unreal Engine 3's known behaviour,
observed in the game's code, or inferred from either); `natives` shows each
under its declaration. It is a start, open to more.

## How it is checked

- Rebuilt from source: LWR's `LWRebalance.u` (13 classes, 1,484 functions,
  192 constants, 10 structs, 9 states, delegates; built by its authors with
  Unreal's own compiler), decompiled class by class and built anew with
  `new`, compared with the original object by object; and the other mod
  packages beside it in LWR's install the same way:

  | Package | Functions and states | Same code | Same declarations |
  |---|---|---|---|
  | LWRebalance.u | 1,493 | 97.5% | 99.7% of 9,235 objects |
  | MiniModsCollection.u | 569 | 97.4% | 96.8% of 2,121 |
  | XComCampaignSummary.u | 100 | 89.0% | 96.6% of 441 |
  | XComLZMutator.u | 72 | 100% | 96.4% of 474 |
  | LWDebugger.u | 63 | 100% | 97.9% of 243 |
  | Sightlines.u | 32 | 100% | 98.0% of 147 |
  | CharacterColorizer.u | 24 | 100% | 96.7% of 92 |
  | LoadoutManager.u | 24 | 100% | 97.1% of 137 |
  | XComModsProfile.u | 23 | 100% | 97.9% of 146 |
  | XComModBridge.u | 22 | 100% | 92.5% of 107 |
  | XComMutator.u | 18 | 100% | 92.5% of 67 |
  | RevealMod.u | 14 | 85.7% | 94.9% of 59 |
  | XComSaveHelper.u | 8 | 100% | 98.0% of 49 |

  What differs is mostly where a mod was built against its own stubs of the
  game's classes (a function not final there, a parameter an int), and
  details of the compiler those mods were built with (UDK's) that the game's
  own packages do not share (a class's probe mask, repeated hidden
  categories). (XComModShell.u names `XComUIShell.UIFinalShell`, a class of
  Enemy Unknown's that Enemy Within does not ship, so it is not built.)
- A mod script makes what `--out` makes: applied by PatchUPK to the
  original, the same names, imports and export entries, and every object the
  same bytes. Checked for a function's code the same size, grown and shrunk,
  naming a name the package lacks, naming a class or calling a function the
  package does not import, declaring locals (after the return value; where
  the function had no children); defaults the same size and grown; a state's
  code with a label added; a variable made `config`; declarations (a member
  variable and a function; a constant, an enum, a struct and a state; a new
  class); and on 60 more classes of every sort, 40 of them at random (a
  variable and a function, a function alone in native ones, a statement, a
  default). PatchUPK here is the binary built from wghost's UPKUtils (the
  tests run it when `PATCHUPK` names it), the PatchUPK.exe Long War's Mod
  Manager ships (on Windows, for imports, locals and declarations), and
  `upkit apply` (always: the same tables and objects as `--out`, for the
  declarations, the flags and a hand patch's function edited, and for the
  packages as the game ships them, compressed). (PatchUPK also moves a shrunk
  object to the end and leaves an undo record after a moved one; the game
  reads neither.)
- `upkit apply`'s engine against PatchUPK, command by command
  (`src/model/__tests__/modpatch.spec.ts` in this repository): every command
  its readme documents, on LWR's XComStrategyGame.upk, the same bytes as
  PatchUPK made of the same script; the additions the same tables and
  objects but for the link, the count and the depends entries above.
- Mods people wrote by hand (the PatcherGUI scripts in the samples: EXALT
  Reminder, Soldier Gender, Sightlines, Lightning Reflexes, the Mutator
  Enabler), applied and decompiled: all 16 functions they change compile
  back byte for byte, 9 of them with `__asm` for what their authors wrote in
  hex that no compiler would (a context's skip written as a fixed 10, a call
  short of an argument it needs, a switch put together by hand).
- Every class, decompiled, reads back as unchanged; every package of the
  corpus (and 25 others of the game's, maps among them) is written back byte
  for byte.

In the game (Enemy Within from Steam, on Windows): changed code, new
variables and functions (written by `--out`; and as a mod script, applied
by Long War's PatchUPK.exe and by `upkit apply` to the packages as shipped),
a package made by `new` and loaded by name, and the main menu's own
seek-free package edited, all load and run. Getting the game to load a new
package by itself (Long War's mutators are one way) is outside upkit.

## How it reads

The decompiler writes what the bytecode says, but leaves out the widening
conversions the compiler makes on its own (`float(1) + x` reads `1 + x`,
`int(eMode) == int(eOff)` reads `eMode == eOff`), wherever the function, so
written, compiles to the very same bytes; elsewhere it keeps them
(`float(I) / 2` without its `float` would divide ints). Narrowing ones
(`int(f)`) it always writes. A number where a byte is wanted reads as the
number (the compiler makes it a byte constant, as Epic's does). `for` loops,
`continue`, `else if` and a switch's `break` read as they were written.

## upkit's own syntax

Where the bytecode holds something UnrealScript cannot say, the decompiler
writes it in a form the compiler reads back the same:

- `goto L123;` and `L123:` for jumps that fit no if/while/for/switch;
  `if (!(x)) goto L123;` for a conditional jump. `goto @123;` jumps to a
  place where no statement starts (a hand patch's stale jump).
- `0x00`, `0x00000005`: an integer constant in the width it was stored in
  (decimal literals compile as Epic's compiler stores them: 0 and 1 as their
  own tokens, up to 255 in a byte).
- `byte(5)`: a byte constant where a plain `5` would not be one (an int is
  wanted there); `byte(int(5))`: a cast.
- `-5` is a negative constant; `-(5)` the minus operator on 5.
- `super(Class.State).Function()`: a parent state's function.
- `class'Engine'.static.super(Engine).Function()`: a function that is not
  final, called final through a class (a patch's).
- `obj.(5)`: a constant read through an object (a patch's).
- `Object'None'`: an object constant of nothing (content the cook stripped
  leaves one; it is not `none`'s bytes).
- `assert(x, 2257)`: an assert with the source line it says it is on.
- `;` alone: an empty statement (`Nothing`, which patches pad with).
- `"\n"`, `"\t"`: a line break and a tab in a string (UnrealScript has no
  way to write them; a string stays on its line).
- `__NoEpilogue;`: a function without the return the compiler adds at the
  end (a patch that removed it).
- `__IteratorNext;`, `__IteratorPop;`: iterator steps outside a foreach.
- `__asm(Token, operands…)`: a node as its token and operands, where the
  bytes say what source cannot; as an expression or a statement. Operands
  follow the token: objects by path (`XGFacility_Labs.TResearchProject.iTech`,
  an import with its package first: `Engine.Actor.Location`; a number where a
  path does not name it alone), names as `'Name'`, numbers, strings, and
  children as source (which may hold `__asm` themselves). A skip the
  compiler computes is `_`, a number only where the bytes hold another; a
  closing byte that is not the usual one is a last number. A context's member
  is compiled as the object's (`__asm(Context, kUnit, 12, …, GetName())`).
  It takes the type its operands say (a variable's, a call's return, a
  cast's) and no conversion. Natives are `__asm(Native129, …)`; a state's
  label table `__asm(LabelTable, 'Begin', 0, 'None', 65535)`. It is for what
  the bytes already hold: the compiler checks no more than the bytes did.
- `__ParmSlots(n);`: only the first n optional parameters have the slot the
  compiler opens the script with (a parameter made optional by its flag
  alone).
- `__NoStateEnd;`: a state's code that writes its own closing (`stop;`, its
  padding, its label table), as a hand patch laid it out.

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
| `src/patch.ts` | PatchUPK mod scripts: code as pseudo-code; the script that makes a package into another upkit wrote from it |
| `src/changes.ts` | a set of changes compiled together, into a package or a mod script |
| `src/classsrc.ts` | a class's source split into its parts; what was edited, declared anew, or given other modifiers |
| `src/declare.ts` | new declarations: variables, functions, states, structs, enums, constants, delegates, classes, replication |
| `src/defaults.ts` | defaultproperties to the tagged properties of the default object and its components |
| `src/diff.ts` | two versions of a package compared, function by function and class by class, as diffs of their source |
| `src/natives.ts` | the native interface: classes only C++ defines (members, parents from the bytecode); the reference |
| `notes/natives.md` | our notes on what natives do |
| `src/fidelity.ts` | whether a function's source says all its bytecode; where not, the `__asm` escapes it needs, found by compiling |
| `src/cli.ts` | the command line (`build.mjs` bundles it into one file) |

Tests (`npx vitest run` in `upkit/`) run on the game's packages in the
repository's git-ignored `samples/` folder (vanilla ones in `samples/ew/`)
and skip without them: every script decoded and encoded back, every object
read to its end, every package written back unchanged, every function
through PatchUPK, every class decompiled and read back unchanged, every
class's defaults compiled from text, the round trips above, the rebuilt mod
packages, hand-written UnrealScript (a function, a mod class, an interface,
replication), the mistakes refused, and the command line end to end.

With `PATCHUPK` set to a PatchUPK binary, the tests also apply upkit's mod
scripts with PatchUPK itself and compare: every function of four packages,
each kind of edit against `--out`, and a sweep of edits on ten classes of
every sort. It builds on Linux from
[wghost/UPKUtils](https://github.com/wghost/UPKUtils) as it is
(`cmake <src> -DCMAKE_BUILD_TYPE=Release && make PatchUPK`, with
`CXX_FLAGS='-O2 -include cstdint'` for a newer GCC; checked with 9b2fd07); it opens a package by its name in lower case, as on Windows.
