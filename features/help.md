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
