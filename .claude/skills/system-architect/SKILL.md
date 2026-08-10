---
name: system-architect
description: Use when the user has a project idea and wants a system architecture, a technical design, or a diagram of how it would work.
---

# System Architect

Turn a one-paragraph project idea into a concrete system architecture: the real components this specific idea needs, a Mermaid diagram of how they connect, and a plain-English explanation of each piece.

## Input

A one-paragraph description of a project idea from the user. If the paragraph is missing critical facts needed to pick real components (e.g., it's completely ambiguous whether there's a user-facing surface at all, or whether any data needs to persist), ask one targeted question before proceeding. Otherwise, proceed — most one-paragraph ideas contain enough signal (who uses it, what it does, what data is involved, what it talks to) to infer a real architecture without a clarifying round-trip.

## Process

1. **Read the idea literally.** Extract every noun and verb that implies a component: "users log in" → auth; "upload photos" → file storage; "get notified" → notification/queue service; "chat with an AI" → LLM/agent layer; "search products" → search index or DB query layer; "runs on a schedule" → a scheduled job/worker. Do not reach for components the paragraph gives no evidence for.

2. **Identify only the components this idea actually needs**, drawn from (not limited to) these categories:
   - **Frontend** — web app, mobile app, CLI, or none (e.g., a pure backend webhook service has no frontend)
   - **Backend / API** — the service(s) that own business logic and expose endpoints
   - **Database** — pick a shape (relational, document, key-value, vector) based on what the data actually looks like, not a default
   - **External services** — third-party APIs, payment processors, email/SMS providers, OAuth providers — only if the idea implies them
   - **AI / agent layer** — only if the idea involves generation, reasoning, classification, or autonomous action; specify what it does (e.g., "LLM call to summarize input," not just "AI")
   - **Supporting infrastructure** — queues, caches, schedulers, file/object storage — only if the idea's data flow or scale implies a need for them

   A generic idea does not get a generic answer. If the idea is a simple CRUD to-do app, the architecture should look like a simple CRUD to-do app (frontend, API, DB — nothing more). Do not pad with components "for completeness."

3. **Draw the data flow as a genuine Mermaid flowchart** — not a static template. The diagram must reflect this idea's actual request/response and data paths: who initiates each call, what travels between which two components, and in which direction. Use `flowchart TD` or `flowchart LR`, label edges with what's actually being sent (e.g., `-->|uploads image|`, `-->|returns JSON|`), and group related pieces with subgraphs when it aids clarity (e.g., a subgraph for "Client", one for "Backend Services").

4. **Explain each component in one plain-English sentence.** Write each sentence so a non-technical reader can follow it without needing to know what an "API" or "vector database" is by name — describe what the piece does for the user or the system, not its technical category.

5. **Save the result** to `project-blueprint/architecture.md` (relative to the project's working directory — create the `project-blueprint/` folder if it doesn't exist). The file must contain:
   - The original one-paragraph idea, quoted back
   - The component list with the one-sentence plain-English explanation for each
   - The Mermaid flowchart in a ` ```mermaid ` fenced code block
   - Nothing else — no filler sections, no generic disclaimers, no unrequested extras (deployment plans, cost estimates, tech-stack recommendations) unless the user's paragraph specifically asked for them

## Output format for `project-blueprint/architecture.md`

```markdown
# Architecture: <short project name inferred from the idea>

## Idea

> <the user's paragraph, quoted verbatim>

## Components

- **<Component name>** — <one plain-English sentence>
- **<Component name>** — <one plain-English sentence>
...

## Data Flow

​```mermaid
flowchart TD
    ...
​```
```

## When finished

Report back to the user with:
1. The exact file path the architecture was saved to
2. The final one-line description of the skill/architecture produced
3. The full component list identified for this idea

Do not just say "done" — the report must include those three things explicitly so the user can verify the output without opening the file.
