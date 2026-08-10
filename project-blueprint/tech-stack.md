# Tech Stack: Bi-Weekly Progress Reporter

Based on [project-blueprint/architecture.md](architecture.md).

## Fit-Rating Key

| Icon | Meaning |
|---|---|
| 🟢 great fit | Matches this project's actual size and needs. Pick it, move on. |
| 🟡 good fit | Works, but there's a real caveat worth reading before you commit. |
| 🔴 consider carefully | Works only under an assumption that might not hold — read the caveat. |

Ratings are graded against **this project's actual scale**: one person, one machine, one report every 14 days, zero network calls, zero other readers — not against what's popular in general.

## Where This Stack Is Most Likely to Break

This stack is most likely to break at the **Markdown Ingestion Parser**, not anywhere fancier. Every downstream piece — classifying, compiling, rendering — trusts that the parser correctly carved your real `PROGRESS.md` into clean per-date records. I read your actual file, not just the architecture doc's Assumptions table, and your real writing style is messier than that table hopes for: long narrative paragraphs with nested sub-bullets ("Files added:", "Verification:", "Notes:") indented under one dated heading, not a clean one-bullet-per-line format. Everything else in this stack — plain Python already installed on this machine, plain files, Windows' own built-in scheduler — is boring and safe on purpose. The parser is the one place a convenient assumption quietly becomes a silent data-loss bug, and it's the one piece worth testing against your real file before trusting the rest of the pipeline.

**Also worth knowing before you build anything:** Node.js is **not installed** on this machine (confirmed by running `node --version`), while Python 3.14 is. Every recommendation below assumes Python for exactly this reason — it's the runtime already present, not a stylistic preference.

## Recommendations

### Things You Write
*(the deterministic logic you author yourself)*

| Component | Recommended Tech | Fit | Why | Learn More |
|---|---|:---:|---|---|
| Markdown Ingestion Parser | **Python 3.14 (stdlib `re` + `pathlib`)** | 🔴 consider carefully | Python is already installed on this machine and is good at finding patterns in text — but your real writing style is riskier for it than the plan assumes. | `Explain Python's re module (regular expressions, patterns for finding text) to me like I'm new to programming, using my Bi-Weekly Progress Reporter's Markdown Ingestion Parser as the example. My real PROGRESS.md entries are multi-line paragraphs with nested sub-bullets under one dated heading, not clean one-line bullets — how should the parser handle that?` |
| Progress Classifier | **Python (plain functions, keyword rules)** | 🟡 good fit | A short, deterministic checklist of rules — no AI involved — so it can never quietly hallucinate a status. | `Explain how to write a simple rule-based (not AI-based) text classifier in Python, using my Bi-Weekly Progress Reporter's Progress Classifier as the example — how would it decide Shipped vs In Progress vs Blocked from a narrative-style bullet point like the ones in my real PROGRESS.md?` |
| Schedule Watcher | **Python stdlib `datetime`/`date`** | 🟢 great fit | Comparing two calendar dates — "is this due before my next report" — is exactly what Python's built-in date tools are for. | `Explain Python's datetime module to me like I'm new to programming, using my Bi-Weekly Progress Reporter's Schedule Watcher as the example — how would it flag a milestone due before the next 14-day report?` |
| Bi-Weekly Report Compiler | **Python stdlib `dataclasses`** | 🟢 great fit | A small labeled container that holds "shipped," "behind," and "next" before handing them to the part that writes the file — built into Python already. | `Explain Python dataclasses to me like I'm new to programming, using my Bi-Weekly Progress Reporter's Report Compiler as the example — how would it hold the three report sections before rendering?` |

**Caveat — Markdown Ingestion Parser:** I read your actual `PROGRESS.md`, not just the architecture doc's assumption. Your real entries are long narrative paragraphs with nested sub-bullets indented under one top-level bullet — not the clean one-bullet-per-line format the architecture's Assumptions table hopes for. A naive line-by-line regex will either flatten your nested notes into the wrong bucket or silently drop them. The parser needs to treat everything between one `## YYYY-MM-DD` heading and the next as **one blob per date**, then sub-parse within that blob — not scan line by line.

**Caveat — Progress Classifier:** Keyword rules only work as well as the words they're looking for. Your real entries read like project narration ("Reviewed the root CLAUDE.md and repo structure; found...") rather than status-line shorthand ("Shipped: X"). Expect to spend real time tuning the keyword list against your own actual writing, and to occasionally get a wrong label with nothing flagging it — there's no LLM fallback to catch ambiguous phrasing, by design (see architecture.md's explicit no-AI-layer decision).

### Things You Touch
*(what lands in front of you every 14 days)*

| Component | Recommended Tech | Fit | Why | Learn More |
|---|---|:---:|---|---|
| Report Renderer | **Python f-strings + one HTML template string (stdlib only) + `webbrowser`** | 🟡 good fit | Python can build the HTML page directly out of text it already knows how to handle, and open it in your browser — nothing extra to install for a report this simple. | `Explain how to render an HTML file from Python using f-strings and a template string, using my Bi-Weekly Progress Reporter's Report Renderer as the example — how would I generate the shipped/behind/next sections and open the result in my browser?` |

**Caveat — Report Renderer:** This works cleanly *only* because the report shape is fixed at exactly three sections. If you ever add more sections, nested lists, or conditional formatting, hand-built f-string HTML turns into unreadable spaghetti fast — that's the point to add **Jinja2** (a small templating library) instead, not before.

### Things You Store

| Component | Recommended Tech | Fit | Why | Learn More |
|---|---|:---:|---|---|
| Report Archive | **Local filesystem — dated folders via `pathlib`** (`docs/reports/<date>/`) | 🟢 great fit | For one person getting one report every two weeks, a dated folder is just as browsable as a database and needs nothing installed or configured. | `Explain why a dated folder structure is enough as a 'data store' for my Bi-Weekly Progress Reporter's Report Archive instead of a database, using my project as the example.` |

### Things You Depend On

| Component | Recommended Tech | Fit | Why | Learn More |
|---|---|:---:|---|---|
| Bi-Weekly Scheduler | **Windows Task Scheduler** (`schtasks`) | 🟡 good fit | Windows' own built-in alarm clock for programs — it already exists on your machine, so there's nothing new to install. | `Explain how to set up a Windows Task Scheduler task that runs a Python script every 14 days, using my Bi-Weekly Progress Reporter as the example — and how do I make sure it catches up if my laptop was asleep at the scheduled time?` |

**Caveat — Bi-Weekly Scheduler:** Task Scheduler only fires if your machine is on (and not asleep) at the scheduled moment. A laptop that's closed or shut down on report day silently misses the run — enable "Run task as soon as possible after a scheduled start is missed" on the task's Settings tab, or a 14-day gap can quietly become a 20-day gap without you noticing.

### What The Data Flow Needs
*(real technology choices the component list never named — found by tracing the data flow, not the component table)*

| Component | Recommended Tech | Fit | Why | Learn More |
|---|---|:---:|---|---|
| Report Styling | **One inline `<style>` block reusing this workspace's existing Colaberry CSS tokens** | 🟢 great fit | The same colors and spacing already used elsewhere in this project, copied into the report, so it looks consistent for zero extra downloads. | `Explain how to embed a <style> block with reusable CSS custom properties (variables) into a Python-generated HTML report, using my Bi-Weekly Progress Reporter as the example.` |
| Pipeline Orchestration | **One `run_report.py` entry-point script calling the five steps in order — no workflow framework** | 🟢 great fit | One short script that calls the other parts in order — a full "workflow" tool built for teams running hundreds of jobs would be way more machinery than one person needs for one job every two weeks. | `Explain how to structure a single Python entry-point script that calls several functions in sequence, using my Bi-Weekly Progress Reporter's five pipeline steps as the example.` |

## Least Confident About

- **Markdown Ingestion Parser (🔴).** This rating depends on your real `PROGRESS.md` staying representative of how you'll keep writing entries. If your future entries get terser and more structured, this could shift to 🟡.
- **Progress Classifier (🟡).** Keyword-rule accuracy genuinely can't be verified from outside — it needs to be built and run against your real entries before anyone can say how well it actually classifies your narrative writing style.

## All Copy-Ready Prompts

| Technology | Prompt |
|---|---|
| Python `re` (Markdown Ingestion Parser) | `Explain Python's re module (regular expressions, patterns for finding text) to me like I'm new to programming, using my Bi-Weekly Progress Reporter's Markdown Ingestion Parser as the example. My real PROGRESS.md entries are multi-line paragraphs with nested sub-bullets under one dated heading, not clean one-line bullets — how should the parser handle that?` |
| Rule-based classifier (Progress Classifier) | `Explain how to write a simple rule-based (not AI-based) text classifier in Python, using my Bi-Weekly Progress Reporter's Progress Classifier as the example — how would it decide Shipped vs In Progress vs Blocked from a narrative-style bullet point like the ones in my real PROGRESS.md?` |
| Python `datetime` (Schedule Watcher) | `Explain Python's datetime module to me like I'm new to programming, using my Bi-Weekly Progress Reporter's Schedule Watcher as the example — how would it flag a milestone due before the next 14-day report?` |
| Python `dataclasses` (Report Compiler) | `Explain Python dataclasses to me like I'm new to programming, using my Bi-Weekly Progress Reporter's Report Compiler as the example — how would it hold the three report sections before rendering?` |
| f-strings + `webbrowser` (Report Renderer) | `Explain how to render an HTML file from Python using f-strings and a template string, using my Bi-Weekly Progress Reporter's Report Renderer as the example — how would I generate the shipped/behind/next sections and open the result in my browser?` |
| Dated-folder archive | `Explain why a dated folder structure is enough as a 'data store' for my Bi-Weekly Progress Reporter's Report Archive instead of a database, using my project as the example.` |
| Windows Task Scheduler | `Explain how to set up a Windows Task Scheduler task that runs a Python script every 14 days, using my Bi-Weekly Progress Reporter as the example — and how do I make sure it catches up if my laptop was asleep at the scheduled time?` |
| CSS custom properties in a generated report | `Explain how to embed a <style> block with reusable CSS custom properties (variables) into a Python-generated HTML report, using my Bi-Weekly Progress Reporter as the example.` |
| Single entry-point orchestration script | `Explain how to structure a single Python entry-point script that calls several functions in sequence, using my Bi-Weekly Progress Reporter's five pipeline steps as the example.` |

## What To Learn First, In Order

1. **Python stdlib basics — reading files, `pathlib`, `re`.** Nothing else works until the Parser can read your real file. Matches architecture.md's own Phase 1 (Parser proves ingestion first).
2. **`datetime`/`date` comparisons.** Needed for the Schedule Watcher and for the Compiler's 14-day windowing logic.
3. **`dataclasses`.** Needed to hold classified entries and schedule flags before rendering.
4. **f-strings, basic HTML templating, and `webbrowser`.** Needed to actually produce and open a report — the day-one, make-or-break deliverable per architecture.md's Phase 3.
5. **Windows Task Scheduler (GUI or `schtasks`).** Deliberately last — wire this up only once the script already runs correctly by hand.

## Alternatives Considered — and Why Not

| Considered | Instead of | Why not (for this project specifically) |
|---|---|---|
| Node.js + a JS markdown library (e.g. `markdown-it`) | Python stdlib | Node isn't installed on this machine (confirmed) — this workspace's own `PROGRESS.md` already flagged the same gap on 2026-07-29 for the barber-shop project. Installing a whole runtime for one offline script is disproportionate when Python 3.14 is already present. |
| SQLite | Dated-folder Report Archive | No query need, no concurrent writers, no relational structure across self-contained reports. A database would just be a second copy of information a folder already represents fine. |
| Jinja2 | f-strings for the Renderer | Overkill for exactly three fixed sections today. Noted above as the natural upgrade path if the report format grows branchy — not a rejection forever, a rejection for now. |
| A workflow engine (Airflow, Prefect, etc.) | A plain `run_report.py` entry point | Built for many concurrent jobs across a team. This is one job, twice a month, for one person — the framework's own overhead would exceed the thing it's orchestrating. |
| Cron via WSL | Windows Task Scheduler | Adds a whole Linux subsystem dependency just to trigger a native Windows Python script, when Windows already ships a scheduler built for exactly this. |
| A full Markdown-to-HTML library (`python-markdown`, `mistune`) | Regex-based extraction in the Parser | The parser only needs to find `## date` headings and bullet text, not render arbitrary Markdown to HTML. Revisit only if your docs start using richer Markdown (tables, code blocks) that the report itself needs to reflect. |

## How Hard Each Decision Is To Undo

| Decision | Reversibility | Note |
|---|---|---|
| Python as the pipeline language | Low today, medium-high later | Trivial to change now (nothing's built yet); a full rewrite once the five scripts exist. |
| f-strings vs. Jinja2 for the Renderer | Low | Isolated to one file — swappable any day without touching the rest of the pipeline. |
| Dated folders vs. a database for the Archive | Low-medium | Migrating existing dated folders into a database later is a one-time import script, not a redesign. |
| Windows Task Scheduler as the trigger | Medium | architecture.md's own Assumptions table already flags this — swapping to cron/CI later means re-wiring the trigger only, not the pipeline. |
| The Parser's regex design | **High** | Every other component's correctness depends on this one. Getting it wrong costs the most to unwind later — see "Where This Stack Is Most Likely to Break" above. |

## What This Document Does NOT Tell You

- The exact regex pattern to use — that needs to be built and tested against your real `PROGRESS.md`, not guessed at from outside.
- How to package this as a standalone `.exe` or set up a Python virtual environment — out of scope here, ask separately if you want it.
- What happens if this workspace grows to track multiple separate projects — architecture.md already scoped this to "this workspace only."
- Anything about sending the report anywhere (email/Slack) — architecture.md explicitly left delivery out on purpose.
- Performance at scale — irrelevant here; this is one person's small text files, twice a month, not a system with real load to plan for.
