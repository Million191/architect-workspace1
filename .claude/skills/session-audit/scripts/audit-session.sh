#!/usr/bin/env bash
# audit-session.sh <SessionID>
#
# Prints two raw facts for the calling skill to cross-reference:
#   1. git's actual working-tree change list (ground truth for "what changed")
#   2. this session's PROGRESS.md entries (ground truth for "what was logged")
# Does not modify any file. Does not decide whether the audit passes —
# that judgment call (does an entry actually cover a changed file) is left
# to the skill's instructions, since it requires reading comprehension a
# shell script can't do reliably.
set -euo pipefail

SESSION_ID="${1:?Usage: audit-session.sh <SessionID>}"
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

echo "=== Git working-tree changes (uncommitted) ==="
CHANGED="$(git status --porcelain=v1)"
if [ -z "$CHANGED" ]; then
  echo "  (none - working tree clean)"
else
  echo "$CHANGED" | sed 's/^/  /'
fi

echo
if [ ! -f PROGRESS.md ]; then
  echo "=== PROGRESS.md not found at repo root ==="
  exit 1
fi

ENTRY_COUNT="$(grep -cF "Session: $SESSION_ID" PROGRESS.md || true)"
echo "=== PROGRESS.md entries tagged 'Session: $SESSION_ID' (found: $ENTRY_COUNT) ==="
if [ "$ENTRY_COUNT" -eq 0 ]; then
  echo "  (none found)"
else
  grep -B2 -A3 -F "Session: $SESSION_ID" PROGRESS.md | sed 's/^/  /'
fi
