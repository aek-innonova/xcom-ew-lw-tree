# Notes on natives

What native functions do, as far as we know it, in our own words. `upkit
natives` shows each note under the native's declaration (generated from the
game's packages on the user's machine). A note is keyed by the function's path
in its package (`## Class.Function`) and says how it is known:

- *UE3*: what Unreal Engine 3 is publicly known to do (Epic's engine, which
  Enemy Within is built on); the game may have changed it.
- *Observed*: seen in the game's own packages (how its code calls it).
- *Inferred*: concluded from the above; say from what.

Nothing here is copied from Epic's or Firaxis's text.

## Object.Rand
A random integer from 0 up to, not including, `Max`.
How known: UE3. Observed: the game's own shot roll
(`XGAbility_Targeted.RollForHit`) does not use it but `XComEngine.SyncRand`;
a mod that rolls for gameplay should do as the game does.

## Object.FRand
A random float from 0 to 1.
How known: UE3. Observed: gameplay code uses `XComEngine.SyncFRand` instead.

## XComEngine.SyncRand
A random integer from 0 up to, not including, `Max`, from the game's own
random sequence. Callers pass who asks as `strFnName`: the object's name, its
state's and the function's (`string(Name) @ string(GetStateName()) @
string(GetFuncName())`).
How known: Observed (the shot roll, `XGAbility_Targeted.RollForHit`, calls it
so). Inferred: the sequence is the one a save keeps, which is why a shot
reloaded from a save rolls the same; the caller's name is likely for a log
of the rolls.

## XComEngine.SyncFRand
As `SyncRand`, a float from 0 to 1.
How known: Observed, as `SyncRand`.

## Object.VSize
The length of a vector.
How known: UE3.

## Object.IsA
Whether the object's class is the class of that name or one of its subclasses
(by name, so the class need not be loaded or imported).
How known: UE3.

## Object.ClassIsChildOf
Whether one class is another or a subclass of it.
How known: UE3.

## Object.GotoState
Leaves the current state for another (at a label if given, `Begin` otherwise).
The state left gets `EndState`, the state entered `BeginState`; going to the
state the object is already in calls neither unless `bForceEvents` is set. No
name leaves every state.
How known: UE3.

## Object.IsInState
Whether the object is in that state (or, with `bTestStateStack`, has it on its
state stack).
How known: UE3.

## Object.Localize
A localized string: the key in the section of the package's localization file
(`<Package>.int` for English), in the language the game runs in.
How known: UE3.

## Object.DynamicLoadObject
Loads an object by its full path at run time (a class, a mesh …), of the class
given; none if there is none. `MayFail` keeps a missing one out of the log.
How known: UE3.

## Object.SaveConfig
Writes the object's config variables to its class's ini file.
How known: UE3.

## Actor.Sleep
Latent: state code waits there that many seconds while the game runs on. Only
in a state's code, not in a function.
How known: UE3.

## Actor.FinishAnim
Latent: state code waits there until the animation node has played to its end.
How known: UE3.

## Actor.SetLocation
Moves the actor there, as a teleport (no sweep), if it fits; whether it moved.
How known: UE3.

## Actor.Trace
A line from `TraceStart` (the actor's location if not given) to `TraceEnd`:
the first actor it hits (the world counts as one), with where and the surface
normal there; none if nothing is in the way. `bTraceActors` lets it hit actors
as well as the world; `Extent` sweeps a box instead of a line.
How known: UE3.

## Actor.Spawn
Creates an actor of the class (at the location and rotation given, else the
spawning actor's), owned and tagged as given, as a copy of a template if one is
given; none if it cannot be placed there. The new actor's spawn events run
before Spawn returns.
How known: UE3.

## Actor.Destroy
Removes the actor from the world; whether it did. Its `Destroyed` event runs
first.
How known: UE3.

## Actor.SetTimer
Calls the function named `inTimerFunc` (`Timer` if none) on `inObj` (this actor
if none) after `InRate` seconds, again every `InRate` seconds if `inbLoop`. Set
again, it starts over; a rate of 0 stops it.
How known: UE3.

## Actor.ClearTimer
Stops the timer of that function (`Timer` if none) on that object (this actor
if none).
How known: UE3.

## Actor.AllActors
Iterator: every actor of the class (or its subclasses) in the level, as
`foreach AllActors(class'X', A)`. Goes through all of them: slow; called often,
it shows.
How known: UE3.

## Actor.DynamicActors
Iterator: as `AllActors`, but only actors that are not static (not part of the
map's fixed geometry): faster where that is what is wanted.
How known: UE3.
