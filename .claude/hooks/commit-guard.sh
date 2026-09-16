#!/usr/bin/env bash
# PreToolUse hook: blocks specific destructive commands before the harness runs them.
# Protocol: read stdin JSON -> inspect .tool_input.command -> exit 2 (block) or exit 0 (proceed).
set -euo pipefail

payload="$(cat)"

# No jq on this machine; Node is present and ships a real JSON parser, so we use
# `node -e` instead of a regex/sed scrape of the JSON (which breaks on nested
# quotes, escaped characters, or key reordering).
command="$(printf '%s' "$payload" | node -e '
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

if [[ "$command" == *"git push --force"* || "$command" == *"rm -rf /"* ]]; then
  echo "commit-guard: blocked — '$command' matches a forbidden pattern (git push --force / rm -rf /)" >&2
  exit 2
fi

exit 0
