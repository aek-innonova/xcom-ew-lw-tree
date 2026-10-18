---
title: A help window
status: review
priority: 5
dependsOn: []
---

## Purpose

New visitors find out where their files are and what the views and
colours mean. The footer carried some of this and was not discoverable.

## Report (2026-10-18)

`HelpDialog.vue`: a modal (`<dialog>`, Escape or × closes) opened by a
**Help** button in the header, a link in the footer, and by itself on a
first visit (remembered in localStorage). Sections: files stay in the
browser; where saves are on Windows (with a Copy button), what the files
are called, mid-mission saves, Mac/Linux untested; watching the folder
(Chromium); the optional DefaultGameCore.ini and where Steam keeps it
(Copy button); the three views; the colours; where the numbers come
from and the check log. The footer is now one line.

Verified: an end-to-end test (opens on a first visit, closes with
Escape, stays closed after a reload, reopens from Help); the folder test
now starts as a returning visitor. Looked at the dialog on screen.

Left open: the Mac and Linux save locations are not given, since no
save from those ports has been tried.

## Response (2026-10-18)

The person: too much prose; keep the background as comments in the file
to ground it, but nobody will read that much text.

## Report (2026-10-18, round 2)

Cut to essentials: one line on privacy, the two paths with Copy buttons
and a line each, the colour key, one small line on sources. The
background (what was tested, why no Mac/Linux paths, the CSP, what is
stored) is a comment at the top of the template. The INI path starts at
the game folder so it fits on one line.

## Response (2026-10-18, round 2)

The person: the INI line suggests the built-in costs are "stock" and
theirs might differ; their INI disagreed with UFOpaedia in places, yet
they do not think they changed anything.

## Report (2026-10-18, round 3)

The built-in data was taken from the person's own unmodified Long War
1.0 install (their INI matches it exactly), so "stock" was the wrong
claim: UFOpaedia differs from it in places, most likely other Long War
versions or wiki errors. The help now says the built-in costs are an
unmodified Long War 1.0 install's and to load your own if it differs;
the INI-loaded message and the clear button say "built-in costs".
