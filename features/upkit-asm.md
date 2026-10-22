---
title: "upkit: inline assembly for bytecode UnrealScript cannot say (hand patches, keep their bytes)"
status: in-progress
priority: 2
dependsOn: [upkit]
---

## Purpose

The person, 2026-10-22, after the first night of upkit: could the things
upkit cannot handle yet be handled "by adding a kind of inline assembly?",
and then: "yeah i think that is worth doing".

Long War's packages are full of hand patches: bytecode modders wrote in hex,
which no UnrealScript compiles to. upkit decompiles such a function to the
source closest to it and says above it that the bytes differ; edited, it
compiles to clean code, losing what the hand patch did differently, or is
refused (a member of a subclass read without a cast, another function's
local, a stray token). About 420 of Long War's functions are like that
(XComGame 176, XComStrategyGame 245), and LWR's own package has 36 (built
against stubs of the game's classes).

The reader of a decompiled function should see ordinary UnrealScript with
the few places where the bytes say something else written as an escape the
compiler reads back to exactly those bytes. Then a modder edits a hand
patched function and keeps everything about it they did not touch.

## Requirements

- An expression-level escape, `__asm(Token, operands…)`, usable anywhere an
  expression or a statement is: one odd token inside an otherwise ordinary
  statement stays one escape, not a statement of hex.
- Operands are symbolic: objects by path, names as names, sub-expressions as
  source (which may hold escapes themselves). The compiler resolves them as
  it resolves source (imports added where needed), and memory sizes come out
  as the engine counts them. No raw reference bytes.
- A value the compiler would compute (a context's skip, a conditional's
  sizes) is written `_` when the bytes hold what it would compute, and as a
  number only when they hold something else (a hand patch's stale skip).
- The decompiler writes the escapes itself, as few as it can: only the nodes
  where the plain source does not compile back to the bytes, or does not
  compile at all. A function that comes back without them is written
  without them.
- What the escape's value is (its type) is known to the compiler where the
  operands say it (a property's type, a call's return), so the code around
  it compiles as around any expression.
- Not: a way around the compiler's checks for code people write. The escape
  is for what the bytes already hold; the README says so.

Also in this feature (found on the way, not assembly):
- the two vanilla cheat functions that call with arguments left out and come
  back as `__EmptyParmValue`: a decompiler fix.

## Verification

The round trip is the measure, as for upkit: every function of Long War's
XComGame and XComStrategyGame and of LWRebalance.u decompiled and compiled
back; the share that comes back byte for byte should go from 98.5% / 95.4% /
97.6% to nearly all. Vanilla must stay where it is (all but the C++-only
cases, which upkit-natives addresses). An edit next to an escape (a
statement added before it, a value changed in it) must compile, through
PatchUPK too.
