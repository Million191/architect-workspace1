---
name: tech-stack-recommender
description: Use when the user has a system architecture and wants a recommended tech stack, explained simply.
---

# Tech Stack Recommender

Turn an existing system architecture into a concrete, honest tech-stack recommendation: one real, current technology per component, rated for fit against *this specific idea's* actual scale and needs, explained in plain English, with a ready-to-paste follow-up prompt for whichever ones the user wants to dig into later.

## Input

`project-blueprint/architecture.md` (produced by the `system-architect` skill). If it doesn't exist, tell the user to run `/system-architect` first — do not invent an architecture to fill the gap.

## Process

1. **Read `project-blueprint/architecture.md` fully.** Pull out the component list, the idea's stated scale (personal/single-user vs. team vs. public-facing), and any constraints already implied (offline-only, no external services, budget-sensitive, etc.). These constraints drive the fit ratings in step 3 — don't skip past them.

2. **For each component, pick exactly one real, currently-maintained technology.** Not a category ("a database") — a named product or library ("PostgreSQL", "SQLite", "Redis"). Not a shortlist of three options to hedge with — commit to one. If a component genuinely has no meaningful tech choice (e.g., "Your Markdown Docs" as an existing data store the system only reads), skip it rather than forcing a recommendation.

3. **Rate the fit honestly against THIS idea, not in the abstract:**
   - 🟢 **great fit** — matches the idea's actual scale, is the boring/obvious right-sized choice, nothing to second-guess
   - 🟡 **good fit** — works fine, but there's a real tradeoff worth knowing about (e.g., it's overkill for a single user, or it's the simplest option but will need replacing if scale changes)
   - 🔴 **consider carefully** — works, but only under an assumption that might not hold (cost, lock-in, a maintenance burden, a mismatch with the stated scale) — say what that assumption is

   A generic "safe" recommendation with a 🟢 slapped on it is a failure of this skill. If a component is a single-user, offline, file-reading tool and the obvious recommendation is SQLite over Postgres, say so — and if an earlier draft would have reached for Postgres by default, that's exactly the instinct this rating exists to correct.

4. **Write the "why" as one plain-English sentence.** No unexplained jargon. If a technical term is unavoidable (e.g., "vector database," "ORM," "webhook"), append a same-sentence, comma-separated plain definition — not a footnote, not a glossary. Test: could someone who has never shipped software read the sentence and know why this pick makes sense for their project?

5. **Keep every row short.** Icons and labels, not paragraphs. This is a scan-able table, not an essay. If a "why" needs more than one sentence to justify, the recommendation is probably wrong for this component, not under-explained.

6. **End every row with a copy-ready follow-up prompt** the user can paste into a new conversation to learn more about that specific technology, phrased using their project as the example — e.g. `Explain SQLite to me like I'm new to databases, using my project as the example.` The prompt must name the specific technology and reference "my project," not be generic.

7. **Save the result** to `project-blueprint/tech-stack.md` (create `project-blueprint/` if it somehow doesn't exist — it should, from the architecture step).

## Output format for `project-blueprint/tech-stack.md`

```markdown
# Tech Stack: <short project name, matching architecture.md>

Based on [project-blueprint/architecture.md](architecture.md).

## Recommendations

| Component | Recommended Tech | Fit | Why | Learn More |
|---|---|:---:|---|---|
| <Component name> | **<Technology>** | 🟢 great fit | <one plain-English sentence> | `<copy-ready prompt>` |
| <Component name> | **<Technology>** | 🟡 good fit | <one plain-English sentence, names the tradeoff> | `<copy-ready prompt>` |
| <Component name> | **<Technology>** | 🔴 consider carefully | <one plain-English sentence, names the assumption> | `<copy-ready prompt>` |

## Fit Legend

- 🟢 **Great fit** — right-sized for this project as described, nothing to second-guess
- 🟡 **Good fit** — works well, but there's a tradeoff worth knowing about
- 🔴 **Consider carefully** — works only if a specific assumption holds — see the Why column
```

## When finished

Report back to the user with:
1. The exact file path: `project-blueprint/tech-stack.md`
2. The fit-rating breakdown as counts, e.g. "4 🟢 great fit, 2 🟡 good fit, 1 🔴 consider carefully"

Do not just say "done" — the report must include both of those explicitly so the user can verify the output without opening the file.
