---
description: Run CLAUDE.md's Session start protocol — mint a Session ID, read CLAUDE.md and PROGRESS.md in full, and summarize current state before any code changes
argument-hint: (none)
allowed-tools: Read
---

This is the mandatory session-start ritual from CLAUDE.md's "Session start protocol"
section, done in full, before any other work this session. Do not skip ahead to a task
just because you can already guess what PROGRESS.md's last unchecked item is.

1. **Mint a unique Session ID.** Format: `CC-<YYYYMMDD>-<4 random alphanumeric>`
   (e.g. `CC-20260920-7f3a`), dated today. Generate the 4-character suffix fresh — do
   not reuse one you recognize from earlier in this conversation or from a prior
   PROGRESS.md entry you've seen. You'll cross-check it against PROGRESS.md in step 3;
   if it collides with an ID already logged there, mint a new suffix and check again.

2. **Read `CLAUDE.md` in full**, root and any subdirectory `CLAUDE.md` files relevant to
   where this session's work is likely to land (`backend/CLAUDE.md`, `frontend/CLAUDE.md`,
   etc.) — not a partial re-skim of what you already remember.

3. **Read `PROGRESS.md` in full.** Confirm your minted Session ID (step 1) doesn't already
   appear in it. Identify the first unchecked (`- [ ]`) task, and note any `- [ ]` entries
   tagged with a *different* Session ID — those may be another instance's in-flight work;
   do not touch or "clean up" them.

4. **Make no code changes during this step.** This command is read-only by design — it
   ends with a summary, not an edit.

5. **Report back**, leading with the Session ID:
   - The Session ID you minted.
   - A short summary of CLAUDE.md's current operating rules most relevant to likely work
     this session (don't restate the whole file).
   - The first unchecked task in PROGRESS.md, and whether any other Session ID has
     in-flight entries worth being aware of.
   - What you'd propose doing next, without starting it.
