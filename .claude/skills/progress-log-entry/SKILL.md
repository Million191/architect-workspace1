---
name: progress-log-entry
description: Use immediately after finishing any change to src/, project-blueprint/, docs/, tests/, or .claude/skills/ — appends a compliant PROGRESS.md entry with today's date, the current Session ID, and verification evidence. Also use when asked to log progress, write a progress note, or update PROGRESS.md.
---

# Progress Log Entry

Turn a just-finished code change into a single, correctly formatted `PROGRESS.md` entry, appended safely even if another Claude instance has written to the file since it was last read.

## Input

- The task/change just completed (one line summary)
- Files touched
- Verification evidence — required, not optional: a test name, a deploy URL, "user confirmed", or "TypeScript passes"
- The current Session ID (format `CC-<YYYYMMDD>-<4 alphanumerics>`, minted at session start per `CLAUDE.md`)
- Any blocker, deviation, or non-obvious decision worth a note

## Process

1. **Re-read the tail of `PROGRESS.md` immediately before writing.** Do not rely on an earlier read — another instance may have appended since then. Anchor the new entry after the current last line, never on stale content.
2. **Confirm verification evidence exists.** If none exists yet (tests haven't run, deploy hasn't happened), stop and gather it first. An entry with no evidence violates the hard gate in `CLAUDE.md` and is not a valid output of this skill — do not write "TODO: verify" as a placeholder.
3. **Append** (never overwrite, reorder, or rewrite existing lines) a new entry under the relevant task heading:

   ```markdown
   - [x] <task name>
     - Date: YYYY-MM-DD
     - Session: CC-<YYYYMMDD>-<id>
     - What changed: <one line>
     - Verification: <test name | deploy URL | "user confirmed" | "TypeScript passes">
     - Notes: <only if blocker, deviation, or non-obvious decision>
   ```

4. **Only touch entries carrying this session's own Session ID.** Never edit, reorder, or "clean up" another instance's entries during this or any later pass.

## When finished

Report back with:
1. The exact entry text that was appended
2. The Session ID it was tagged with

Do not just say "logged it" — the report must show the literal entry so the user can verify it without opening the file.
