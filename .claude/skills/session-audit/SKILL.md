---
name: session-audit
description: Use before ending a Claude Code session that touched src/, project-blueprint/, docs/, tests/, or .claude/skills/ — cross-checks git's actual working-tree changes against this session's PROGRESS.md entries and reports any file with no matching entry. Also use when asked to audit progress, check for missing progress entries, or verify the session-end gate.
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/audit-session.sh *) Read
---

# Session Audit

Perform the end-of-session audit CLAUDE.md requires: confirm every file this session actually changed has a corresponding `PROGRESS.md` entry carrying this session's own Session ID — without editing `PROGRESS.md` itself. Writing entries is a separate skill's job (`progress-log-entry`); this skill only checks.

## Input

- The current Session ID (format `CC-<YYYYMMDD>-<4 alphanumerics>`)

## Process

1. **Run the bundled script, and only the bundled script:** `${CLAUDE_SKILL_DIR}/scripts/audit-session.sh <SessionID>`. This is the sole command this skill is permitted to run — it deterministically gathers two raw facts (git's current working-tree change list, and this session's `Session:`-tagged entries in `PROGRESS.md`) rather than asking Claude to eyeball `git log` or hand-grep the file, which is error-prone and easy to get subtly wrong.
2. **Read the script's output.** It prints the git change list, then the matching `PROGRESS.md` blocks (or "(none found)").
3. **Cross-reference by judgment, not regex.** For each file git reports as changed, confirm it's covered by at least one of this session's entries — directly named, or clearly implied (e.g. an entry describing "added the `scripts/` folder" covers every file inside it). This step needs Claude's reading comprehension, not the script — `PROGRESS.md`'s "What changed" lines are prose, not a structured file list.
4. **List every file with no matching coverage.** Those are the real gaps this audit exists to catch.

## When finished

State the result as one line, in this exact form (per CLAUDE.md's required closing statement):

`Session <SessionID>: PROGRESS.md audit: N changes, N entries, audit clean.`

If any file lacks a matching entry, do **not** say "clean" — name the missing file(s) explicitly instead, then stop and invoke `progress-log-entry` to write the missing entry before re-running this audit.
