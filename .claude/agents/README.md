# Subagents

This folder holds subagent definitions (one Markdown file per subagent). Currently defined:

- `explorer.md` — read-only subsystem mapping / data-flow tracing (>5 file reads).
- `reviewer.md` — read-only risk/correctness review (idempotency, contracts, failure paths, secrets) before an edit lands.
- `editor.md` — implements one specific, already-reviewed change; runs the typecheck; no scope expansion.
- `data-analyst.md` — read-only quantitative analysis over existing data (stats, aggregates, quality checks).
- `transcription-diarizer.md`, `minutes-extractor.md`, `email-draft-agent.md` — the meeting pipeline (see below).

## Coordination example: recording → minutes → draft emails

**The task, in one sentence:** Turn a raw meeting recording sitting in this repo into ready-to-review, per-participant follow-up email drafts, with nothing sent and no step skipped.

**The sequence:**

1. **`transcription-diarizer` runs first.** Input: the raw recording file (e.g. `meeting-assistant/data/attachments/sample-standup-recording.wav`). It transcribes the audio locally, marks anything inaudible or low-confidence, and saves a timestamped transcript to a new text file. **Hands off:** the path to that transcript file.
2. **`minutes-extractor` runs second.** Input: the transcript file path from step 1. It reads the transcript and produces structured minutes — summary, discussion points by topic, decisions with rationale, and an action-item table (owner, due date, priority, status). **Hands off:** that structured minutes/action-item content.
3. **`email-draft-agent` runs third — but only after a person explicitly approves Gate #1** on the minutes from step 2 (this is a hard stop from the project plan, not optional). Input: the approved, finalized minutes/action-item table. It drafts one email per participant, covering only that participant's own action items. **Hands off:** the finished drafts, for a person to review under Gate #2. It never sends anything — sending is a separate, explicitly gated step this agent has no authority over.

**The exact request to start it:**

> "Run the full meeting pipeline on `meeting-assistant/data/attachments/sample-standup-recording.wav`: transcribe it, extract minutes, and once I approve Gate #1, draft participant emails."

**What the finished result looks like when it worked:**

- A new transcript file sitting next to the recording, with timestamps and any uncertain segments marked.
- A structured minutes document (summary + discussion points + decisions + action-item table) shown to you for Gate #1 approval.
- After you explicitly approve Gate #1, one drafted email per participant — addressed only to their own action items — handed back for your Gate #2 review. Nothing sent, no minutes/emails generated silently past a gate.
