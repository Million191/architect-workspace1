---
description: Test, typecheck, and draft a PR for the current change
argument-hint: [pr-title]
allowed-tools: Bash(npm test:*), Bash(npm run typecheck:*), Bash(git add:*), Bash(git diff:*)
---

Ship ceremony for the `backend/` change currently in the working tree. Run the numbered
steps in order. Do not skip ahead.

1. Run the test command: `npm test --prefix backend`.
   If anything fails, STOP and report the failures. Do not continue to step 2.
   <!-- WHY: verification is step one, and step one is allowed to say no. -->

2. On green, run `npm run typecheck --prefix backend` (this repo has no formatter
   installed — see PROGRESS.md / CLAUDE.md discussion; `tsc --noEmit` is the real
   second gate). If that fails, STOP and report the failures, same as step 1.
   Once both are green, stage the change: `git add -A -- backend`.

3. Read the staged diff with `git diff --staged -- backend` and draft a PR
   description titled **$ARGUMENTS**, with:
   - A **Summary** of what changed and why.
   - A **Test Evidence** line quoting the actual passing output from step 1
     (and the typecheck result from step 2).
   - A **Risk** note: blast radius, what could break, what wasn't covered.

   <!-- WHY: $ARGUMENTS is whatever was typed after /ship — the title travels into the body. -->

Do not run `git commit` or `git push`. This command prepares a change; it does not
ship one. Stop after presenting the drafted PR description.
