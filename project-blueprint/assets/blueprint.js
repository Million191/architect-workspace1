/* Single source of truth for the whole knowledge base. Every page renders from this object. */
const BLUEPRINT = {
  meta: {
    title: "Bi-Weekly Progress Reporter",
    oneLiner: "A personal, offline system that reads your existing PROGRESS.md/docs and reliably generates a bi-weekly shipped / behind / next report.",
    generated: "2026-08-06"
  },

  idea: "A personal project management system for my AI-Project workspace. It's for me alone — no team, no separate task list. It monitors my project schedule and tracks plan/task progress by reading the markdown I already keep (PROGRESS.md, docs/ARCHITECTURE.md, and similar docs in this repo). The one thing it must do well on day one: reliably generate a bi-weekly report — what shipped, what's behind, what's next — every two weeks, without me having to remember to run it.",

  dayOnePriority: "Reliably generate the bi-weekly report (shipped / behind / next) — every other component exists only to feed this one.",

  components: [
    {
      id: "docs",
      name: "Your Markdown Docs",
      category: "Existing data store (not built)",
      layer: "source",
      shape: "cylinder",
      sentence: "PROGRESS.md, docs/ARCHITECTURE.md, and similar files you already write — the one and only source of truth this system reads.",
      requiredBy: "“reading the markdown I already keep (PROGRESS.md, docs/ARCHITECTURE.md, and similar docs)”"
    },
    {
      id: "parser",
      name: "Markdown Ingestion Parser",
      category: "Process",
      layer: "process",
      shape: "rectangle",
      sentence: "Reads your markdown docs and pulls out each dated entry as a structured record the rest of the pipeline can use.",
      requiredBy: "“reading the markdown I already keep”"
    },
    {
      id: "classifier",
      name: "Progress Classifier",
      category: "Process",
      layer: "process",
      shape: "rectangle",
      sentence: "Labels each entry Shipped, In Progress, or Blocked and sorts it into the two-week window it belongs to.",
      requiredBy: "“tracks plan/task progress”"
    },
    {
      id: "watcher",
      name: "Schedule Watcher",
      category: "Process",
      layer: "process",
      shape: "rectangle",
      sentence: "Scans the same docs for dated milestones and flags anything overdue or due before the next report.",
      requiredBy: "“monitors my project schedule”"
    },
    {
      id: "compiler",
      name: "Bi-Weekly Report Compiler",
      category: "Process — day-one component",
      layer: "process",
      shape: "rectangle",
      sentence: "Assembles classified entries and schedule flags into exactly three sections: what shipped, what's behind, what's next.",
      requiredBy: "“the one thing it must do well on day one: reliably generate a bi-weekly report — what shipped, what's behind, what's next”"
    },
    {
      id: "renderer",
      name: "Report Renderer",
      category: "Process",
      layer: "output",
      shape: "rectangle",
      sentence: "Turns the compiled data into a styled, readable report (HTML plus a plain markdown copy) and opens it for you.",
      requiredBy: "“generate a bi-weekly report”"
    },
    {
      id: "archive",
      name: "Report Archive",
      category: "Data store",
      layer: "output",
      shape: "cylinder",
      sentence: "A dated folder (docs/reports/<date>/) holding every report ever generated, so nothing is overwritten and past reports stay browsable.",
      requiredBy: "“reliably” — a report that isn't kept isn't reliable"
    },
    {
      id: "scheduler",
      name: "Bi-Weekly Scheduler",
      category: "Third party — Windows Task Scheduler",
      layer: "trigger",
      shape: "hexagon",
      sentence: "Triggers the whole pipeline automatically every 14 days on this machine, with no manual step from you.",
      requiredBy: "“every two weeks, without me having to remember to run it”"
    }
  ],

  notAdded: [
    { thing: "Frontend app", why: "The report file itself is the surface — nothing interactive is implied by the idea." },
    { thing: "Database", why: "Your markdown files already are the durable state; a DB would just duplicate them." },
    { thing: "Queue", why: "One job, every 14 days, no burst or concurrency — nothing to queue." },
    { thing: "AI / LLM layer", why: "The report is assembled deterministically from what you already wrote. Kept deterministic on purpose — probabilistic generation isn't needed to summarize your own bullet points, and this workspace's own CLAUDE.md already argues production systems should be deterministic." },
    { thing: "Email / Slack delivery", why: "“for me alone” — no one else needs to receive it, so no delivery channel was added." }
  ],

  diagram: `flowchart TD
    Scheduler{{"Windows Task Scheduler"}} -->|"triggers every 14 days"| Parser

    subgraph Pipeline["Report Pipeline (runs locally, offline)"]
        Parser["Markdown Ingestion Parser"]
        Classifier["Progress Classifier"]
        Watcher["Schedule Watcher"]
        Compiler["Bi-Weekly Report Compiler"]
        Renderer["Report Renderer"]
        Parser -->|"parsed dated entries"| Classifier
        Classifier -->|"classified entries"| Compiler
        Watcher -->|"overdue / due-soon flags"| Compiler
        Compiler -->|"compiled report data"| Renderer
    end

    Docs[("PROGRESS.md, docs/*.md")] -->|"reads entries"| Parser
    Docs -->|"reads milestone dates"| Watcher
    Renderer -->|"writes dated report"| Archive[("docs/reports/ archive")]
    Renderer -->|"opens in browser"| You(["You"])`,

  diagramInterpretation: "One trigger, one straight-through pipeline, one output — nothing fans out to other systems because nothing else needs to know about this report but you.",

  dataFlow: {
    steps: [
      { n: 1, actor: "Windows Task Scheduler", action: "Fires the pipeline every 14 days — no action from you.", touches: "trigger" },
      { n: 2, actor: "Markdown Ingestion Parser", action: "Reads PROGRESS.md and the other repo docs, extracts each dated entry.", touches: "process" },
      { n: 3, actor: "Progress Classifier", action: "Labels each entry Shipped / In Progress / Blocked and bins it into the current window.", touches: "process" },
      { n: 4, actor: "Schedule Watcher", action: "Compares dated milestones in the docs against today and flags anything overdue or due soon.", touches: "process" },
      { n: 5, actor: "Bi-Weekly Report Compiler", action: "Merges classified entries and schedule flags into the three required sections.", touches: "process" },
      { n: 6, actor: "Report Renderer", action: "Writes a styled HTML report and a plain markdown copy into docs/reports/<date>/.", touches: "output" },
      { n: 7, actor: "Report Renderer", action: "Opens the new report in your browser so you see it immediately.", touches: "output" }
    ],
    sequence: `sequenceDiagram
    participant TS as Windows Task Scheduler
    participant P as Markdown Parser
    participant C as Progress Classifier
    participant W as Schedule Watcher
    participant Co as Report Compiler
    participant R as Report Renderer
    participant D as PROGRESS.md / docs
    participant You

    TS->>P: trigger (every 14 days)
    P->>D: read markdown files
    D-->>P: raw dated entries
    P->>C: parsed entries
    C-->>Co: classified entries
    W->>D: read milestone dates
    D-->>W: dated milestones
    W-->>Co: overdue / due-soon flags
    Co->>R: compiled report data
    R->>D: write docs/reports/<date>/
    R-->>You: opens report in browser`
  },
  sequenceInterpretation: "Everything routes through your existing markdown — nothing is asked of you mid-run, and the only thing that reaches you is the finished report.",

  /* Work breakdown structure. Dates and the critical path are computed, not guessed: forward pass (early
     start/finish, ASAP from projectStart) then backward pass (late start/finish from projectFinish) over the
     predecessor graph below, on an 8-hour/day, Mon–Fri calendar starting 2026-08-10. Float = late start − early
     start; float 0 = critical. Re-run the calc if a task's duration or predecessors change — don't hand-edit dates. */
  buildOrder: {
    projectStart: "2026-08-10",
    projectFinish: "2026-09-01",
    interpretation: "Red bars are the critical path — slip any one of them and the finish date slips. The Schedule Watcher task is the only one with slack (2 days): it can start late without moving anything else.",
    phases: [
      {
        id: "1", name: "Parser", makeOrBreak: false, start: "2026-08-10", finish: "2026-08-13",
        proves: "The system can read your real PROGRESS.md and extract structured entries without misparsing your writing style.",
        ships: "Markdown Ingestion Parser, run manually against real files.",
        tasks: [
          { id: "1.1", name: "Read & inventory PROGRESS.md's real formatting quirks", duration: 1, start: "2026-08-10", finish: "2026-08-10", predecessors: [], critical: true, float: 0 },
          { id: "1.2", name: "Build the dated-entry extraction rules", duration: 2, start: "2026-08-11", finish: "2026-08-12", predecessors: ["1.1"], critical: true, float: 0 },
          { id: "1.3", name: "Validate against the real file, fix misparses", duration: 1, start: "2026-08-13", finish: "2026-08-13", predecessors: ["1.2"], critical: true, float: 0 }
        ]
      },
      {
        id: "2", name: "Classifier + Watcher", makeOrBreak: false, start: "2026-08-14", finish: "2026-08-18",
        proves: "Entries can be reliably labeled and milestone dates correctly compared to today.",
        ships: "Progress Classifier, Schedule Watcher.",
        tasks: [
          { id: "2.1", name: "Shipped / In Progress / Blocked labeling rules", duration: 2, start: "2026-08-14", finish: "2026-08-17", predecessors: ["1.3"], critical: true, float: 0 },
          { id: "2.3", name: "Schedule Watcher: scan milestones, flag overdue/due-soon", duration: 1, start: "2026-08-14", finish: "2026-08-14", predecessors: ["1.3"], critical: false, float: 2 },
          { id: "2.2", name: "Bin classified entries into the two-week window", duration: 1, start: "2026-08-18", finish: "2026-08-18", predecessors: ["2.1"], critical: true, float: 0 }
        ]
      },
      {
        id: "3", name: "Compiler + Renderer", makeOrBreak: true, start: "2026-08-19", finish: "2026-08-26",
        proves: "A real, readable bi-weekly report can be assembled end-to-end from real data — the day-one requirement.",
        ships: "Bi-Weekly Report Compiler, Report Renderer, one report generated manually.",
        tasks: [
          { id: "3.1", name: "Report Compiler: merge entries + flags into 3 sections", duration: 2, start: "2026-08-19", finish: "2026-08-20", predecessors: ["2.2", "2.3"], critical: true, float: 0 },
          { id: "3.2", name: "Report Renderer: HTML + markdown output", duration: 2, start: "2026-08-21", finish: "2026-08-24", predecessors: ["3.1"], critical: true, float: 0 },
          { id: "3.3", name: "Manual end-to-end run against real PROGRESS.md", duration: 2, start: "2026-08-25", finish: "2026-08-26", predecessors: ["3.2"], critical: true, float: 0 }
        ]
      },
      {
        id: "4", name: "Scheduler", makeOrBreak: false, start: "2026-08-27", finish: "2026-08-28",
        proves: "The report generates itself on the 14-day cadence with zero manual steps.",
        ships: "Windows Task Scheduler trigger wired to the pipeline.",
        tasks: [
          { id: "4.1", name: "Wrap pipeline in a callable script entry point", duration: 1, start: "2026-08-27", finish: "2026-08-27", predecessors: ["3.3"], critical: true, float: 0 },
          { id: "4.2", name: "Wire Windows Task Scheduler trigger (every 14 days)", duration: 1, start: "2026-08-28", finish: "2026-08-28", predecessors: ["4.1"], critical: true, float: 0 }
        ]
      },
      {
        id: "5", name: "Archive & polish", makeOrBreak: false, start: "2026-08-31", finish: "2026-09-01",
        proves: "Reports accumulate over time and stay easy to find and re-open.",
        ships: "docs/reports/ convention, styling pass.",
        tasks: [
          { id: "5.1", name: "docs/reports/<date>/ archive convention", duration: 1, start: "2026-08-31", finish: "2026-08-31", predecessors: ["4.2"], critical: true, float: 0 },
          { id: "5.2", name: "Styling pass on the rendered report", duration: 1, start: "2026-09-01", finish: "2026-09-01", predecessors: ["5.1"], critical: true, float: 0 }
        ]
      }
    ]
  },

  assumptions: [
    { assumption: "PROGRESS.md entries keep a reasonably consistent “## YYYY-MM-DD” heading + bullet-list format going forward.", impact: "If the format drifts, the parser needs a matching rule update or entries silently get skipped." },
    { assumption: "“Bi-weekly” means every 14 calendar days from a fixed anchor date, not calendar-aligned to the 1st/15th.", impact: "If calendar-aligned periods are actually wanted, both the scheduler trigger and the compiler's windowing logic change." },
    { assumption: "No one but you ever needs to see the report — no email, no Slack, no shared drive.", impact: "If that changes, an external delivery component gets added — today's design deliberately has none." },
    { assumption: "Windows Task Scheduler is an acceptable trigger, since this runs on your own machine, not a server.", impact: "If this ever needs to run on a server or in CI instead, the scheduler component is swapped for a cron/CI-schedule equivalent." }
  ],

  openQuestion: {
    question: "Does “bi-weekly” mean a rolling 14-day cadence, or calendar-aligned to the 1st and 15th of each month?",
    branchA: {
      label: "Rolling 14-day cadence",
      changes: [
        "Scheduler trigger is a simple “every 14 days” interval from an anchor date",
        "Compiler window is a rolling 14-day slice ending today",
        "Every report covers exactly 14 days, no exceptions"
      ]
    },
    branchB: {
      label: "Calendar-aligned (1st & 15th)",
      changes: [
        "Scheduler trigger becomes two fixed monthly dates instead of an interval",
        "Compiler window snaps to calendar boundaries",
        "The first or last window of some months is shorter or longer than 14 days"
      ]
    }
  },

  coverage: [
    { item: "Bi-weekly report generation", status: "covered", note: "The day-one component — Compiler + Renderer." },
    { item: "Schedule / milestone monitoring", status: "covered", note: "Schedule Watcher flags overdue or due-soon items." },
    { item: "Progress tracking from existing docs", status: "covered", note: "Parser + Classifier read PROGRESS.md directly, no duplicate entry." },
    { item: "Runs automatically, no manual trigger", status: "covered", note: "Windows Task Scheduler." },
    { item: "Past reports stay browsable", status: "covered", note: "Report Archive, one dated folder per run." },
    { item: "Other projects outside this workspace", status: "not-covered", note: "Scope was locked to this workspace only." },
    { item: "Multiple users / sharing / permissions", status: "not-covered", note: "“for me alone” — single reader assumed." },
    { item: "Authoring or editing progress notes", status: "not-covered", note: "Read-only against your docs; never rewrites your source notes." },
    { item: "Notifications (email / Slack / push)", status: "not-covered", note: "The report is a local file you open, nothing is sent anywhere." },
    { item: "Retroactive re-classification of old reports", status: "not-covered", note: "Past reports are frozen as generated if your entry format changes later." }
  ],

  artifacts: [
    { name: "architecture.md", desc: "The full architecture write-up this site is built from." },
    { name: "docs/reports/<date>/", desc: "Where every generated bi-weekly report will land once Phase 5 ships." }
  ]
};
