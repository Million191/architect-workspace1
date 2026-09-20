#!/usr/bin/env bash
# PreToolUse hook (Bash): non-blocking. Warns when a `git commit` is about to
# run while .claude/ has uncommitted changes that this commit does NOT include.
# Protocol: read stdin JSON -> inspect tool_input.command -> if it's a leading
# `git commit`, compare real git state -> always allow, optionally attach a
# permissionDecisionReason warning.
#
# Why warn instead of block: PROGRESS.md already documents a case where a
# .claude/settings.json hook registration sat uncommitted for a whole story
# cycle before anyone noticed (the "Register bold+italic..." entry folded a
# prior story's stray registration into an unrelated commit). That's exactly
# the config drift progress-gate.sh doesn't catch, since it only watches
# backend/frontend/scripts/nginx/directives. Blocking every commit that
# leaves *any* .claude/ file dirty would be too strict for normal
# multi-step, multi-file work on hooks/commands/settings -- this only
# surfaces it so it gets noticed before it ages, it never stops the commit.
#
# Least-privilege note: same as the other hooks here -- `node --permission`
# with zero --allow-* flags, so this can only read stdin and write stdout.
set -uo pipefail

payload="$(cat)"

command="$(printf '%s' "$payload" | node --permission -e '
let data = "";
process.stdin.on("data", (chunk) => { data += chunk; });
process.stdin.on("end", () => {
  try {
    const payload = JSON.parse(data);
    process.stdout.write(String((payload.tool_input && payload.tool_input.command) || ""));
  } catch (err) {
    process.stdout.write("");
  }
});
')"

allow() {
  cat <<'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow"
  }
}
EOF
  exit 0
}

# Only worth checking when `git commit` is the true leading statement of the
# whole command -- same reasoning as progress-gate.sh: git state right now
# can't tell us what a compound command (e.g. `git add x && git commit ...`)
# is about to stage, so guessing there would just produce false-positive
# warnings. Skip silently rather than warn on state we can't actually verify.
if ! [[ "$command" =~ ^[[:space:]]*git[[:space:]]+commit ]]; then
  allow
fi

# Files this call is actually about to commit.
staged_files="$(git diff --cached --name-only 2>/dev/null || true)"
about_to_commit="$staged_files"
if printf '%s' "$command" | grep -Eq -- '(^|[[:space:]])-[a-zA-Z]*a[a-zA-Z]*([[:space:]]|$)|--all\b'; then
  unstaged_tracked="$(git diff --name-only 2>/dev/null || true)"
  about_to_commit="$(printf '%s\n%s' "$about_to_commit" "$unstaged_tracked")"
fi

# Every .claude/ path with any uncommitted change right now: staged,
# unstaged-tracked, or untracked-new (porcelain's first 3 columns are the
# two status letters plus one space, so strip exactly those).
dirty_claude="$(git status --porcelain -- .claude 2>/dev/null | sed -E 's/^...//' | sort -u || true)"

if [[ -z "$dirty_claude" ]]; then
  allow
fi

left_out="$(comm -23 <(printf '%s\n' "$dirty_claude" | sort -u) <(printf '%s\n' "$about_to_commit" | sort -u) || true)"
left_out="$(printf '%s\n' "$left_out" | sed '/^$/d')"

if [[ -z "$left_out" ]]; then
  allow
fi

reason="claude-dir-drift-warn: .claude/ has uncommitted changes NOT included in this commit -- $(printf '%s' "$left_out" | tr '\n' ',' | sed 's/,$//'). PROGRESS.md already records one of these sitting unnoticed for a whole story cycle; consider committing it now (with this change or on its own) before it ages further. Warning only -- the commit is proceeding."

reason_json="$(printf '%s' "$reason" | node --permission -e '
let data = "";
process.stdin.on("data", (c) => { data += c; });
process.stdin.on("end", () => { process.stdout.write(JSON.stringify(data)); });
')"

cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "permissionDecisionReason": $reason_json
  }
}
EOF
exit 0
