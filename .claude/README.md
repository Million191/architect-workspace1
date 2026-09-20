# .claude/

<video src="../artifacts/week-08/progress-gate-pipeline-demo.mp4" controls></video>

*Recording: running `/mark-verification-complete`, the `progress-gate.sh` hook
firing on the resulting commit, and the `push-code-review.yml` CI reviewer
leaving its findings as a commit comment.*

## Commands (`.claude/commands/`)

### `mark-verification-complete`
Closes out one finished piece of work the way `CLAUDE.md`'s PROGRESS.md hard
gate requires: figures out what changed, runs the real verification for that
layer (`tsc --noEmit`, a test suite, a syntax check — whichever applies),
writes the PROGRESS.md entry with that evidence, stages exactly the touched
files, and commits.

- **Triggers on:** manual invocation only — `/mark-verification-complete
  [task or story name]`.
- **Never:** runs `git push`, or reports a failed verification as a pass.

### `check-action-items-and-draft-followups`
Runs a meeting transcript through review → minutes → action-item extraction
→ risk flagging → follow-up drafting, asking for anything it's missing
(an owner, a due date, a recipient email) instead of guessing.

- **Triggers on:** manual invocation — `/check-action-items-and-draft-followups
  <transcript-path-or-meeting-id> <recipient emails>`.

### `ship`
Runs the backend test suite and `tsc --noEmit`, then drafts a PR description
from the staged diff.

- **Triggers on:** manual invocation — `/ship [pr-title]`. Never commits or
  pushes.

### `greet`
Says hello. Exists as the minimal example command in this repo.

- **Triggers on:** manual invocation — `/greet [name]`.

### `session-start`
Runs CLAUDE.md's Session start protocol in one shot: mints a fresh Session ID, reads
`CLAUDE.md` and `PROGRESS.md` in full, checks the minted ID against PROGRESS.md for
collisions, and reports the first unchecked task plus any other instance's in-flight
entries. Read-only — makes no code changes.

- **Triggers on:** manual invocation only — `/session-start`, at the top of a session.

## Hooks (`.claude/hooks/`)

### `progress-gate.sh`
Blocks a `git commit` that touches `backend/`, `frontend/`, `scripts/`,
`nginx/`, or `directives/` when the same commit doesn't also include
`PROGRESS.md`, per `CLAUDE.md`'s PROGRESS.md hard gate. Read-only: it only
runs informational `git diff` commands, never `git add`/`commit`/`reset` —
it can block or allow, never fix the problem itself. Fails closed (blocks)
whenever `git commit` is combined with another command in the same call,
since it can only see git state as it existed before that call runs.

- **Triggers on:** `PreToolUse` for the `Bash` tool, on every call — it
  no-ops immediately unless the command is (or contains) `git commit`.
- **Blocks when:** a gated-directory file is about to be committed without
  `PROGRESS.md` in the same commit, or a `git commit` can't be verified
  because it's bundled with other commands in one call.

### `commit-guard.sh`
Blocks specific destructive commands before they run: `git push --force`
and `rm -rf /`.

- **Triggers on:** `PreToolUse` for the `Bash` tool, on every call.

### `claude-dir-drift-warn.sh`
Non-blocking: when a `git commit` is about to run, checks whether `.claude/`
has uncommitted changes (staged, unstaged, or untracked) that this commit
does *not* include, and attaches a warning if so — the config-drift case
`progress-gate.sh` doesn't cover, since it only watches
`backend/frontend/scripts/nginx/directives`. Always allows the commit;
only ever adds a `permissionDecisionReason` note.

- **Triggers on:** `PreToolUse` for the `Bash` tool, on a leading `git
  commit`. Skips silently (no false-positive warning) when `git commit` is
  bundled with other commands in the same call, since pre-call git state
  can't show what a compound command is about to stage.

### `action-item-gate.sh`
Blocks writing a meeting-artifact file (minutes, recap, action items,
follow-up) when an action item inside it is missing an owner or a due date
and isn't already marked flagged for review.

- **Triggers on:** `PreToolUse` for the `Write` tool, scoped to
  meeting-artifact file paths.

### `bold-italic-format.sh`
Injects a formatting instruction into context before every turn, so the
reply is wrapped in Markdown bold+italics.

- **Triggers on:** `UserPromptSubmit`, every turn.

## CI (`.github/workflows/`)

### `push-code-review.yml`
On every push, checks out the pushed commits, computes the actual diff range
for that push, and runs a Claude Code review of it against this repo's
`CLAUDE.md` rules — specifically Idempotency & Replayability, Contract
Enforcement, and Failure-First Design — looking for correctness bugs and
simplification/efficiency opportunities. It always leaves a commit comment
with the findings, or an explicit tooling-failure notice if the review step
itself errored — never a silent pass or a bare CI status badge.

- **Triggers on:** `push` to any branch (tag pushes and branch-deletion
  pushes excluded). A newer push to the same branch cancels the still-running
  review for the one it supersedes.
- **Needs:** the `ANTHROPIC_API_KEY` repository secret (Settings → Secrets
  and variables → Actions). `contents: write` permission, nothing else, so
  the final step can post the commit comment.

### `pr-code-review.yml`
Same review criteria, applied to a pull request's diff instead of a push,
posted as inline PR review comments.

- **Triggers on:** a pull request opened, synchronized, or reopened.
