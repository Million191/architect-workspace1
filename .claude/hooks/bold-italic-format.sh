#!/usr/bin/env bash
# UserPromptSubmit hook: injects a formatting instruction into context
# before every turn, so Claude's reply is wrapped in bold+italics markdown.
cat <<'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "Formatting rule for this reply: wrap the entire text response in Markdown bold+italics (***like this***), with no unformatted prose outside that wrapping. Do not apply this inside code blocks or file paths."
  }
}
EOF
