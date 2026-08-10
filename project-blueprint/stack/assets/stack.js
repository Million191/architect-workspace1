/* Single source of truth for the whole tech-stack knowledge base. Every page renders from this object. */
const STACK = {
  meta: {
    title: "Tech Stack: Bi-Weekly Progress Reporter",
    oneLiner: "One real technology per component, rated honestly against this exact project — one person, one machine, one report every 14 days.",
    generated: "2026-08-06"
  },

  basedOn: "project-blueprint/architecture.md",

  headline: "This stack is most likely to break at the Markdown Ingestion Parser, not anywhere fancier. Every downstream piece — classifying, compiling, rendering — trusts that the parser correctly carved your real PROGRESS.md into clean per-date records. I read your actual file, not just the architecture doc's Assumptions table, and your real writing style is messier than that table hopes for: long narrative paragraphs with nested sub-bullets (“Files added:”, “Verification:”, “Notes:”) indented under one dated heading, not a clean one-bullet-per-line format. Everything else in this stack — plain Python already installed on this machine, plain files, Windows' own built-in scheduler — is boring and safe on purpose. The parser is the one place a convenient assumption quietly becomes a silent data-loss bug, and it's the one piece worth testing against your real file before trusting the rest of the pipeline.",

  machineNote: "Node.js is NOT installed on this machine (confirmed by running `node --version`), while Python 3.14 is. Every recommendation below assumes Python for exactly this reason — it's the runtime already present, not a stylistic preference.",

  fitLegend: [
    { level: "great", icon: "🟢", label: "Great fit", desc: "Matches this project's actual size and needs. Pick it, move on." },
    { level: "good", icon: "🟡", label: "Good fit", desc: "Works, but there's a real caveat worth reading before you commit." },
    { level: "risk", icon: "🔴", label: "Consider carefully", desc: "Works only under an assumption that might not hold — read the caveat." }
  ],

  groups: [
    { id: "write", label: "Things You Write", kicker: "Your own logic", desc: "The deterministic code you author yourself — no framework does this for you." },
    { id: "touch", label: "Things You Touch", kicker: "Human-facing", desc: "What lands in front of you every 14 days." },
    { id: "store", label: "Things You Store", kicker: "Durable state", desc: "Where past reports live so nothing gets overwritten." },
    { id: "depend", label: "Things You Depend On", kicker: "Outside your code", desc: "Load-bearing, but not something you author — the OS and its tools." },
    { id: "flow", label: "What The Flow Needs", kicker: "Found, not named", desc: "Real technology choices the component list never named — found by tracing the data flow." }
  ],

  recommendations: [
    {
      id: "parser-lang",
      component: "Markdown Ingestion Parser",
      group: "write",
      tech: "Python 3.14 (stdlib re + pathlib)",
      fit: "risk",
      why: "Python is already installed on this exact machine and is good at finding patterns in text — but your real writing style is riskier for it than the plan assumes.",
      caveat: "I read your actual PROGRESS.md, not just the architecture doc's assumption. Your real entries are long narrative paragraphs with nested sub-bullets (“Files added:”, “Verification:”, “Notes:”) indented under one top-level bullet — not the clean one-bullet-per-line format the architecture's own Assumptions table hopes for. A naive line-by-line regex will either flatten your nested notes into the wrong bucket or silently drop them. The parser needs to treat everything between one “## YYYY-MM-DD” heading and the next as ONE blob per date, then sub-parse within that blob — not scan line by line.",
      prompt: "Explain Python's re module (regular expressions, patterns for finding text) to me like I'm new to programming, using my Bi-Weekly Progress Reporter's Markdown Ingestion Parser as the example. My real PROGRESS.md entries are multi-line paragraphs with nested sub-bullets under one dated heading, not clean one-line bullets — how should the parser handle that?",
      fromFlow: false
    },
    {
      id: "classifier-lang",
      component: "Progress Classifier",
      group: "write",
      tech: "Python (plain functions, keyword rules)",
      fit: "good",
      why: "A short, deterministic checklist of rules — no AI involved — so it can never quietly hallucinate a status.",
      caveat: "Keyword rules only work as well as the words they're looking for. Your real entries read like project narration (“Reviewed the root CLAUDE.md and repo structure; found…”) rather than status-line shorthand (“Shipped: X”). Expect to spend real time tuning the keyword list against your own actual writing, and to occasionally get a wrong label with nothing flagging it — there's no LLM fallback to catch ambiguous phrasing, by design.",
      prompt: "Explain how to write a simple rule-based (not AI-based) text classifier in Python, using my Bi-Weekly Progress Reporter's Progress Classifier as the example — how would it decide Shipped vs In Progress vs Blocked from a narrative-style bullet point like the ones in my real PROGRESS.md?",
      fromFlow: false
    },
    {
      id: "watcher-lang",
      component: "Schedule Watcher",
      group: "write",
      tech: "Python stdlib datetime / date",
      fit: "great",
      why: "Comparing two calendar dates — “is this due before my next report” — is exactly what Python's built-in date tools are for.",
      caveat: null,
      prompt: "Explain Python's datetime module to me like I'm new to programming, using my Bi-Weekly Progress Reporter's Schedule Watcher as the example — how would it flag a milestone due before the next 14-day report?",
      fromFlow: false
    },
    {
      id: "compiler-lang",
      component: "Bi-Weekly Report Compiler",
      group: "write",
      tech: "Python stdlib dataclasses",
      fit: "great",
      why: "A small labeled container that holds “shipped,” “behind,” and “next” before handing them to the part that writes the file — built into Python already.",
      caveat: null,
      prompt: "Explain Python dataclasses to me like I'm new to programming, using my Bi-Weekly Progress Reporter's Report Compiler as the example — how would it hold the three report sections before rendering?",
      fromFlow: false
    },
    {
      id: "renderer-lang",
      component: "Report Renderer",
      group: "touch",
      tech: "Python f-strings + one HTML template string (stdlib only) + webbrowser",
      fit: "good",
      why: "Python can build the HTML page directly out of text it already knows how to handle, and open it in your browser — nothing extra to install for a report this simple.",
      caveat: "This works cleanly ONLY because the report shape is fixed at exactly three sections. If you ever add more sections, nested lists, or conditional formatting, hand-built f-string HTML turns into unreadable spaghetti fast — that's the point to add Jinja2 (a small templating library) instead, not before.",
      prompt: "Explain how to render an HTML file from Python using f-strings and a template string, using my Bi-Weekly Progress Reporter's Report Renderer as the example — how would I generate the shipped/behind/next sections and open the result in my browser?",
      fromFlow: false
    },
    {
      id: "archive-store",
      component: "Report Archive",
      group: "store",
      tech: "Local filesystem — dated folders via pathlib (docs/reports/<date>/)",
      fit: "great",
      why: "For one person getting one report every two weeks, a dated folder is just as browsable as a database and needs nothing installed or configured.",
      caveat: null,
      prompt: "Explain why a dated folder structure is enough as a 'data store' for my Bi-Weekly Progress Reporter's Report Archive instead of a database, using my project as the example.",
      fromFlow: false
    },
    {
      id: "scheduler-depend",
      component: "Bi-Weekly Scheduler",
      group: "depend",
      tech: "Windows Task Scheduler (schtasks)",
      fit: "good",
      why: "Windows' own built-in alarm clock for programs — it already exists on your machine, so there's nothing new to install.",
      caveat: "Task Scheduler only fires if your machine is on (and not asleep) at the scheduled moment. A laptop that's closed or shut down on report day silently misses the run — enable “Run task as soon as possible after a scheduled start is missed” on the task's Settings tab, or a 14-day gap can quietly become a 20-day gap without you noticing.",
      prompt: "Explain how to set up a Windows Task Scheduler task that runs a Python script every 14 days, using my Bi-Weekly Progress Reporter as the example — and how do I make sure it catches up if my laptop was asleep at the scheduled time?",
      fromFlow: false
    },
    {
      id: "styling-flow",
      component: "Report Styling",
      group: "flow",
      tech: "One inline <style> block reusing this workspace's existing Colaberry CSS tokens",
      fit: "great",
      why: "The same colors and spacing already used elsewhere in this project, copied into the report, so it looks consistent for zero extra downloads.",
      caveat: null,
      prompt: "Explain how to embed a <style> block with reusable CSS custom properties (variables) into a Python-generated HTML report, using my Bi-Weekly Progress Reporter as the example.",
      fromFlow: true
    },
    {
      id: "orchestration-flow",
      component: "Pipeline Orchestration",
      group: "flow",
      tech: "One run_report.py entry-point script calling the five steps in order — no workflow framework",
      fit: "great",
      why: "One short script that calls the other parts in order — a full “workflow” tool built for teams running hundreds of jobs would be way more machinery than one person needs for one job every two weeks.",
      caveat: null,
      prompt: "Explain how to structure a single Python entry-point script that calls several functions in sequence, using my Bi-Weekly Progress Reporter's five pipeline steps as the example.",
      fromFlow: true
    }
  ],

  skipped: [
    { thing: "Your Markdown Docs", why: "An existing data store this system only reads — it's your own writing, not a technology choice to make." }
  ],

  leastConfident: [
    { id: "parser-lang", note: "This rating depends on your real PROGRESS.md staying representative of how you'll keep writing entries. If your future entries get terser and more structured, this could shift to 🟡." },
    { id: "classifier-lang", note: "Keyword-rule accuracy genuinely can't be verified from outside — it needs to be built and run against your real entries before anyone can say how well it actually classifies your narrative writing style." }
  ],

  learningOrder: [
    { n: 1, topic: "Python stdlib basics — reading files, pathlib, re", why: "Nothing else works until the Parser can read your real file. Matches architecture.md's own Phase 1.", relatedTech: ["parser-lang"] },
    { n: 2, topic: "datetime / date comparisons", why: "Needed for the Schedule Watcher and for the Compiler's 14-day windowing logic.", relatedTech: ["watcher-lang", "compiler-lang"] },
    { n: 3, topic: "dataclasses", why: "Needed to hold classified entries and schedule flags before rendering.", relatedTech: ["compiler-lang"] },
    { n: 4, topic: "f-strings, basic HTML templating, and webbrowser", why: "Needed to actually produce and open a report — the day-one, make-or-break deliverable per architecture.md's Phase 3.", relatedTech: ["renderer-lang", "styling-flow"] },
    { n: 5, topic: "Windows Task Scheduler (GUI or schtasks)", why: "Deliberately last — wire this up only once the script already runs correctly by hand.", relatedTech: ["scheduler-depend"] }
  ],

  alternatives: [
    { considered: "Node.js + a JS markdown library (e.g. markdown-it)", insteadOf: "Python stdlib", why: "Node isn't installed on this machine (confirmed) — this workspace's own PROGRESS.md already flagged the same gap on 2026-07-29 for the barber-shop project. Installing a whole runtime for one offline script is disproportionate when Python 3.14 is already present." },
    { considered: "SQLite", insteadOf: "Dated-folder Report Archive", why: "No query need, no concurrent writers, no relational structure across self-contained reports. A database would just be a second copy of information a folder already represents fine." },
    { considered: "Jinja2", insteadOf: "f-strings for the Renderer", why: "Overkill for exactly three fixed sections today. It's the natural upgrade path if the report format grows branchy — a rejection for now, not forever." },
    { considered: "A workflow engine (Airflow, Prefect, etc.)", insteadOf: "A plain run_report.py entry point", why: "Built for many concurrent jobs across a team. This is one job, twice a month, for one person — the framework's own overhead would exceed the thing it's orchestrating." },
    { considered: "Cron via WSL", insteadOf: "Windows Task Scheduler", why: "Adds a whole Linux subsystem dependency just to trigger a native Windows Python script, when Windows already ships a scheduler built for exactly this." },
    { considered: "A full Markdown-to-HTML library (python-markdown, mistune)", insteadOf: "Regex-based extraction in the Parser", why: "The parser only needs to find “## date” headings and bullet text, not render arbitrary Markdown to HTML. Revisit only if your docs start using richer Markdown (tables, code blocks) that the report itself needs to reflect." }
  ],

  lockIn: [
    { decision: "Python as the pipeline language", hardness: "low-now", note: "Trivial to change now (nothing's built yet); a full rewrite once the five scripts exist." },
    { decision: "f-strings vs. Jinja2 for the Renderer", hardness: "low", note: "Isolated to one file — swappable any day without touching the rest of the pipeline." },
    { decision: "Dated folders vs. a database for the Archive", hardness: "low-medium", note: "Migrating existing dated folders into a database later is a one-time import script, not a redesign." },
    { decision: "Windows Task Scheduler as the trigger", hardness: "medium", note: "architecture.md's own Assumptions table already flags this — swapping to cron/CI later means re-wiring the trigger only, not the pipeline." },
    { decision: "The Parser's regex design", hardness: "high", note: "Every other component's correctness depends on this one. Getting it wrong costs the most to unwind later." }
  ],

  notCovered: [
    "The exact regex pattern to use — that needs to be built and tested against your real PROGRESS.md, not guessed at from outside.",
    "How to package this as a standalone .exe or set up a Python virtual environment — out of scope here, ask separately if you want it.",
    "What happens if this workspace grows to track multiple separate projects — architecture.md already scoped this to “this workspace only.”",
    "Anything about sending the report anywhere (email/Slack) — architecture.md explicitly left delivery out on purpose.",
    "Performance at scale — irrelevant here; this is one person's small text files, twice a month, not a system with real load to plan for."
  ],

  topology: {
    onYourMachine: ["Markdown Ingestion Parser", "Progress Classifier", "Schedule Watcher", "Bi-Weekly Report Compiler", "Report Renderer", "Report Archive", "Windows Task Scheduler", "Your Markdown Docs"],
    onSomeoneElsesServer: [],
    note: "Every single piece of this stack runs on your own machine. Nothing here calls out to the internet, and nothing here depends on a service you don't control — a rare, deliberately “100% local” shape."
  },

  artifacts: [
    { name: "tech-stack.md", desc: "The full written recommendation this site is built from." },
    { name: "architecture.md", desc: "The architecture this stack was chosen to fit." }
  ]
};
