# Progress

## 2026-08-07

- Turned the Bi-Weekly Progress Reporter blueprint's "Build Order" page
  (`project-blueprint/05-buildorder.html`) into a real, interactive work
  breakdown structure — the user asked for "interactive schedule/timeline,
  work breakdown like MS Project." Replaced the old 5-phase proportional-bar
  illustration and simple Mermaid gantt with: 13 tasks under the 5 existing
  phases (WBS-numbered 1.1–5.2), each with a duration, dependencies, and
  computed start/finish dates on an 8-hr/day Mon–Fri calendar starting
  2026-08-10; a proper forward-pass/backward-pass critical-path (CPM)
  calculation (not eyeballed) identifying 12 of 13 tasks as critical and one
  (the Schedule Watcher task) with 2 days of float; and a custom inline-SVG
  Gantt widget (`assets/site.js`: `illustrationWbsGantt`, `layoutWbsSvg`,
  `initWbsInteractions`) with a WBS/task table + timeline pane, weekend
  shading, dependency arrows, red critical-path bars vs. teal slack bars,
  per-phase collapse/expand (with live row re-layout, not just hide/show
  gaps) and Expand-all/Collapse-all controls — same fullscreen-zoom pattern
  as the site's other diagrams.
  - Files changed: `project-blueprint/assets/{blueprint.js,site.js,site.css}`
    (`buildOrder` data model, search index, `renderBuildorder`, `tilePic`
    "buildorder" case). No new files.
  - Verification: computed the schedule and CPM pass in a standalone Python
    script first (not hand-typed dates) so the "critical path" claim is
    actually derived from durations + predecessors, not guessed. Re-verified
    all 8 HTML pages with zero console errors via headless Chrome
    (`chrome.exe --headless=new --enable-logging=stderr`) after the change.
    Also used `--dump-dom` to confirm the rendered page actually contains the
    expected structure: 18 `.wbs-row` elements (5 phases + 13 tasks), 5
    `.wbs-toggle` chevrons, 13 `.wbs-arrow` dependency lines, 12 critical-path
    (red) bars — all matching the source data exactly. Opened
    `project-blueprint/05-buildorder.html` in the default browser.
  - Notes: A hand-rolled bracket-balance checker (written earlier this
    session as a Node-less substitute for `tsc`/a linter — no Node.js on this
    machine) produced false-positive "unclosed string/bracket" reports twice
    during this work, both traced to its own regex/division-operator
    heuristic rather than real bugs; headless-Chrome console-error checking
    (validated against a deliberately broken test file) is the trustworthy
    signal here, not that script. Still no actual pipeline code (Parser,
    Classifier, etc.) — this session only extended the blueprint's schedule
    visualization.

## 2026-08-06 (2)

- Ran the `tech-stack-recommender` skill against `project-blueprint/architecture.md`
  (the Bi-Weekly Progress Reporter blueprint from earlier today) and produced a full
  tech-stack recommendation, following the user's own detailed spec for a matching
  multi-page knowledge base (Command Center + 8 section pages, one `assets/stack.js`
  data object, whole-site search, copy-to-clipboard prompt buttons, inline-SVG
  illustrations with fullscreen zoom, a two-mode Ask panel, dark theme, print
  styles). Nine components rated for fit (5 🟢 great, 3 🟡 good, 1 🔴 consider
  carefully — the Markdown Ingestion Parser), with two additional recommendations
  surfaced from tracing the data flow rather than the component list (Report
  Styling, Pipeline Orchestration).
  - Files added: `project-blueprint/tech-stack.md`, `project-blueprint/stack/index.html`,
    `project-blueprint/stack/0{1-8}-*.html`,
    `project-blueprint/stack/assets/{stack.js,site.js,site.css}`.
  - Verification: confirmed via `node --version`/`python --version` that Node.js is
    NOT installed on this machine but Python 3.14.6 is — this became the deciding
    factor behind recommending Python over Node for the whole pipeline. Read this
    file's own real 2026-08-06 entry to ground the Parser's 🔴 rating in the actual
    (narrative, nested-bullet) writing style rather than the architecture doc's
    idealized assumption. All 9 HTML pages verified with zero console
    errors/uncaught exceptions via headless Chrome (`chrome.exe --headless=new
    --enable-logging=stderr`), with the detection method itself first confirmed
    against a deliberately broken test file. Spot-checked rendered row counts
    (9 recommendation rows, 5 lock-in rows, 9 copy-ready prompts) matched the
    `STACK` data object. Opened `project-blueprint/stack/index.html` in the
    default browser for visual confirmation.
  - Notes: This session did not write any of the actual pipeline code (Parser,
    Classifier, etc.) — only the tech-stack recommendation and its knowledge base,
    per the user's request. No Node.js dependencies were introduced anywhere in
    this repo as a result of this work.

## 2026-08-06

- Designed and built a browsable architecture blueprint for a "Bi-Weekly
  Progress Reporter" idea (a personal, offline system that would read
  `PROGRESS.md`/`docs/*.md` and reliably generate a bi-weekly shipped/behind/next
  report — not yet an actual running script, just the design). Used the
  `system-architect` skill for the core design (idea → components → mermaid
  data-flow diagram), then extended it into a full multi-page knowledge base
  per the user's own detailed spec (Command Center + 7 section pages, one
  `assets/blueprint.js` data object driving all rendering, whole-site search,
  Mermaid diagrams with fullscreen zoom, data-driven inline-SVG illustrations,
  a two-mode Ask panel — offline search by default, optional Claude API mode
  needing a user-pasted key — dark theme, print styles). Plain HTML/CSS/vanilla
  JS, no build step, works from `file://`.
  - Files added: `project-blueprint/architecture.md`,
    `project-blueprint/index.html`, `project-blueprint/0{1-7}-*.html`,
    `project-blueprint/assets/{blueprint.js,site.js,site.css}`.
  - Verification: no Node available on this machine, so syntax was verified by
    headlessly loading all 8 pages in the installed Chrome
    (`chrome.exe --headless=new --enable-logging=stderr`) and confirming zero
    console errors/uncaught exceptions on each page (spot-checked the method
    first against a deliberately broken test file to confirm it actually
    surfaces `SyntaxError`s). Then opened `project-blueprint/index.html` in
    the default browser for visual confirmation.
  - Notes: Also flagged to the user that the root `CLAUDE.md` in this repo is
    the mistaken Colaberry-template copy this file's own 2026-07-31 entry
    already describes (see below) — it is not this project's real rules file,
    so this entry uses this repo's existing dated-note convention rather than
    the Colaberry Session-ID/PROGRESS.md gate format that document specifies.
    No code for an actual running report generator was built yet — this
    session produced only the design/blueprint, per the user's request.

## 2026-07-31

- Reviewed the root CLAUDE.md and repo structure; found the 41KB "Colaberry
  Agent Project Rules" doc had been mistakenly copied into `Colabbery
  Project/CLAUDE.md` (a duplicate of the archived
  `docs/CLAUDE.colaberry-template.md.bak`, unrelated to this project).
  `Colabbery Project/` is orphaned and still unresolved — no action taken
  pending a decision on whether to delete it.
- Proposed a folder-tree architecture for the site. Conclusion: the existing
  structure (`src/`, `src/css`, `src/js`, `src/data`, `src/assets`, `docs`,
  `tests`) already covers everything the project needs; no new top-level
  folders were justified. Proposal is documented in conversation, not yet
  approved — no files or folders were created or modified as part of it.
- Identified the first Week 3 candidate task: extract the `CONFIG` object
  (chairs, services, shop hours) hardcoded at `src/js/app.js:7-19` into
  `src/data/config.js`, loaded via a new `<script>` tag in `index.html`
  before `app.js`. Not yet implemented.
- Ran a foundation audit on the architecture proposal above: no new folders
  had actually been created (the proposal was documented in conversation
  only), so "documented responsibility" and "progress tracking updated"
  came back as gaps. Closed both: added `docs/ARCHITECTURE.md` (persisted
  per-folder responsibility table, supersedes the chat-only proposal) and
  `tests/README.md` (documents the empty `tests/` folder's future role,
  matching the existing `src/data/` and `src/assets/` README convention).
  No app code or dependencies added; `Colabbery Project/` and the archived
  `.bak` template remain untouched.

## 2026-07-30

- Added two empty placeholder folders ahead of a Week 3 feature: `src/assets/`
  (static media) and `src/data/` (seed/config data for app.js), each with a
  one-line README. No code or dependencies added yet.

- Dark mode was already fully wired up (header toggle in index.html, CSS
  variables in style.css, persistence + `prefers-color-scheme` fallback in
  app.js) — checked contrast ratios and found text colors already meet
  WCAG AA/AAA in both themes, but the dark theme never overrode `--bar`,
  so the header/hero/footer band was nearly invisible against the page
  background (1.07:1). Added a dark-mode `--bar` value and a hairline
  border under the sticky header so the band reads clearly; light mode
  is untouched.

## 2026-07-29

- Built the barber shop website in `src/` (index.html, css/style.css, js/app.js).
- Static site, no backend: appointments and seat availability are stored in
  the browser via localStorage. Node.js isn't installed on this machine, so
  a server-backed version wasn't set up — revisit if persistence across
  devices is ever needed.
- Features: services list, seat/chair availability grid by date, appointment
  request form, and a cancellable list of requested appointments.

## 2026-08-09

- [x] Connect project to GitHub (init, first commit, push)
  - Date: 2026-08-09
  - Session: CC-20260809-h4k9
  - What changed: Ran `git init`, added a `.gitignore` (node_modules, env
    files, build output, OS cruft, `/tmp`), made the first commit (40 files
    incl. `CLAUDE.md`, `PROGRESS.md`, `project-blueprint/`, `src/`), added
    `origin` remote pointing at the new private GitHub repo
    `https://github.com/Million191/architect-workspace1`, and pushed `main`.
    Also created the GitHub account and repo for the (non-technical) user,
    walked through GitHub's signup/repo-creation UI with them step by step.
  - Verification: `git push -u origin main` returned
    `* [new branch] main -> main`; repo confirmed live at
    https://github.com/Million191/architect-workspace1.
  - Notes: Local push initially failed with an SSL cert-lookup error
    (`unable to get local issuer certificate`), likely from AV/network
    software intercepting TLS on this machine. Fixed by setting
    `git config --global http.sslBackend schannel` (uses Windows' native
    cert store instead of Git's bundled CA bundle) — safe, standard fix,
    no repo-level change. Auth used Git Credential Manager's browser-based
    GitHub login (no PAT stored in the repo or logs).

## 2026-08-12

- [x] Build the Project Manager Field Guide knowledge-base deliverable
  - Date: 2026-08-12
  - Session: CC-20260812-q7m2
  - What changed: Added `docs/ProjectManager_FieldGuide.html` — a single
    self-contained knowledge-base HTML file for the Colaberry accelerator's
    Week 3 AI Solution Architect track. Worked example: Insurance —
    "ClaimSense AI" (an FNOL triage & fraud-signal assistant) for a fictional
    carrier, Meridian Mutual Insurance. Contains: a left topic nav + live
    search + an offline "Ask" assistant (28-entry keyword-matched Q&A bank,
    no external API); 12 concise PM-foundations sections (triangle, WBS,
    critical path, gates, RAID, RACI, agile/waterfall/hybrid, velocity,
    RAG status, KPIs, an "Architect's Review Lens" checklist); and all 8
    requested project documents (Charter, WBS, Milestone Timeline/Gantt,
    RAID Log, RACI Matrix, Sprint Plan, Status Report, Budget/Burn), each
    with Colaberry-branded doc chrome (cover w/ fetched-and-embedded
    Colaberry logo, doc-control strip, sign-off block, footer), a
    Download-HTML button, a Print/Save-as-PDF button, and — for the four
    tabular docs — a Download-CSV button. Six inline-SVG diagrams/charts
    (WBS tree, Gantt timeline, dependency network, sprint burndown, budget
    burn line, milestone RAG donut), no external chart libraries. Built via
    a Python generator script (`build_field_guide.py`, kept in the session
    scratchpad, not committed) so chart coordinates and the WBS/RAID/RACI/
    budget numbers are computed and cross-checked rather than hand-typed.
  - Verification: WBS work-package percentages sum to exactly 100% (checked
    in-script and printed at generation time); RACI matrix checked
    programmatically for exactly one Accountable per row (18/18 pass, 0
    failures); table row counts (WBS 20, RAID 14, RACI 18, Sprint 10,
    Budget 7) confirmed against source data by parsing the rendered DOM.
    JS correctness verified with a hand-rolled Chrome DevTools Protocol
    client (`cdp_check.py`, raw WebSocket, no external deps — Node isn't
    installed on this machine) that listens for real
    `Runtime.exceptionThrown`/console-error events; validated the harness
    first against a file with a deliberate `SyntaxError` (caught correctly)
    before confirming zero exceptions/console errors on the real file
    (`--dump-dom` + stderr grepping was tried first but proved unreliable
    for this page — it missed the same deliberate error the CDP client
    caught cleanly, so the CDP method was used as the authoritative check).
    Visually confirmed via CDP-driven screenshots (scrolled to specific
    sections) that the hero, WBS document (cover/table/tree diagram),
    RACI matrix (color-coded chips), and Budget document (PV/EV/AC/SPI/CPI
    tiles, chart) all render correctly against the Colaberry palette.
    Opened the file in the default browser for the user.
  - Notes: Colaberry logo fetched live from
    `https://enterprise.colaberry.ai/colaberry-logo-transparent.png` and
    embedded as a base64 data URI (no external image dependency at
    runtime). Google Fonts (Roboto/Roboto Mono) linked per the brand spec's
    "optionally the Roboto webfont" allowance; a system-ui/Arial fallback
    stack is declared so the page still reads correctly fully offline.

## 2026-08-17

- [x] Build the Meeting Assistant Command Center (STORY-000) — Overview checkpoint
  - Date: 2026-08-17
  - Session: CC-20260817-k4n7
  - What changed: Started the "Meeting Assistant" Colaberry accelerator project.
    Take-stock found nothing pre-existing (no `.colaberry/`, no Command Center,
    no `docs/stories/`), so built from scratch, paused at the Overview
    checkpoint per the brief. Added `.colaberry/{plan,progress,manifest,profile}.json`
    (plan/progress data constructed from the requirements, stories, releases,
    roles, and guardrails given directly in the task brief, since no portal
    sync had populated these files yet). Added `index.html` at repo root plus
    `command-center/{css/style.css,js/app.js}`: a static, no-build-step SPA
    with hash routing, a Real/Sample data-mode toggle (persisted to
    localStorage), a "Data as of" freshness stamp (warns past 7 days) shown
    on every tab, and all 9 tabs reachable from nav. Only Overview is fully
    built (headline stats + 4 drill-down pages, all reading live from the
    fetched JSON, no hardcoded plan content); the other 8 tabs render an
    honest "Not built yet — say build the rest" stub with a one-line
    description of what's planned, per the brief's explicit pause point.
    `.colaberry/progress.json` carries STORY-000 with all 5 Done-means
    criteria present and `"passed": false` on all of them (build is
    intentionally incomplete at this checkpoint). GitHub push webhook setup
    (brief's Step 1) was offered and explicitly skipped by the user.
  - Verification: Served the site locally (`python -m http.server`) and
    loaded every route (Overview + its 4 drill-downs, all 8 stub tabs)
    headlessly via `chrome.exe --headless=new --enable-logging=stderr`,
    confirming no console errors/exceptions on any route. Spot-checked
    rendered DOM (`--dump-dom`) for the Overview stats grid, the Stories
    drill-down table (20 rows, joined from plan.json + progress.json), and
    a stub tab's empty state. Screenshotted the Overview tab — headline
    cards read "0 of 20" stories verified, "0 of 5" criteria, "0" points,
    correctly computed "Initial Audio Processing (r0)" as the current
    release from today's date against `plan.releases`. Confirmed no
    `COLABERRY:BEGIN`/`END` markers exist in root `CLAUDE.md` so it was left
    untouched, and `docs/stories/STORY-000.md` was deliberately not created
    since `docs/` is platform-owned and rewritten on sync.
  - Notes: Not yet committed/pushed — awaiting the user's review of the
    Overview tab before proceeding to "build the rest" (the other 8 tabs)
    and Step 3 (tick genuinely-true criteria, commit naming STORY-000,
    push). GitHub Pages (Step 4) also not yet turned on, pending the same
    go-ahead.

- [x] Build the Meeting Assistant Command Center (STORY-000) — build the rest + Step 3
  - Date: 2026-08-17
  - Session: CC-20260817-k4n7
  - What changed: User approved "build the rest." Implemented the remaining
    8 tabs in `command-center/js/app.js`, all reading `.colaberry/plan.json`
    and `progress.json` at runtime, no plan content hardcoded: Outcomes
    (real = honest empty state since `plan.derived.measures` is empty;
    sample = 3 illustrative measure cards, clearly labelled); Users & Use
    Case (roles grouped by parsing "As a &lt;role&gt;, I want" out of each
    story's own `narrative` field — nothing hardcoded); Guardrails (REQ-013/
    REQ-015 enforcement computed live from `fulfilled_by` → story
    `verification.state`, worded "not yet enforced" rather than a false
    green); Systems (all 5 systems render grey "not checked from here" /
    "never" in real mode — no fabricated green); Project Management (inline
    SVG-free CSS Gantt of the 5 releases positioned by date math, r1 marked
    demo target, full task table with due/baseline dates and per-story
    drill-down); AI Agents (plan.agents is empty, so built from `story.owner`
    grouping instead, explicitly labelled "owners, not scoped AI agents";
    real mode shows "No runs recorded", never a fake 0% success rate);
    Knowledge Base (full requirements↔stories traceability table, surfaces
    REQ-019's empty `fulfilled_by` as a real gap; added an offline
    keyword-matching "Ask" panel — pure client-side token-overlap search
    over the loaded plan data, no external API/key, answers "I can't answer
    that from the current data" when nothing matches well enough); Data
    Model (11 entities derived from the requirements — `Meeting`,
    `AudioRecording`, `TranscriptSegment`, `Speaker`, `Attendee`,
    `DiscussionTopic`, `Decision`, `ActionItem`, `ReviewGate`, `EmailDraft`,
    `TrackerExport` — domain terms, not vendor names, each card linking back
    to the requirements that justify it). Added a coherent sample-data
    overlay (`SAMPLE_STORY_STATES`, `SAMPLE_SYSTEMS`, `SAMPLE_AGENT_RUNS`,
    `SAMPLE_MEASURES`) shared across all tabs so Sample mode tells one
    consistent story instead of disjointed fake numbers per tab; refactored
    the two existing Overview drill-downs (Stories, Release) to route
    through the same `storyState()` helper so they respect the toggle too.
    Removed the "build paused" banner from Overview now that all 9 tabs are
    real. Then finished Step 3: reconciled `.colaberry/progress.json` —
    all 5 STORY-000 criteria flipped `false → true` (see verification),
    `criteria_passed` 0→5, STORY-000 `verification.state` `in_progress` →
    `submitted` (verified is the platform's call, not mine); bumped
    `.colaberry/manifest.json` `generated_at` since the underlying data
    genuinely changed.
  - Verification: Headless-Chrome swept every route in both Real and Sample
    mode (all 9 tabs × their drill-downs — 30 routes real, 21 routes
    sample) via `chrome.exe --headless=new --enable-logging=stderr`,
    zero JS errors/exceptions on any of them (Sample mode driven through a
    persistent `--user-data-dir` profile since `localStorage` needed to
    survive across separate headless launches). Explicitly ran the brief's
    own trust test: removed STORY-005 from `plan.json` via the Edit tool,
    reloaded the Project Management tab, confirmed STORY-005 vanished from
    both the Gantt task table and the route sweep — then restored the file
    and diffed it byte-for-byte against the last commit to confirm an exact
    match. (Caught and fixed a real bug in that process: an earlier
    Python-based version of the same test round-tripped the file through
    Windows' default non-UTF-8 text encoding and corrupted the em dash in
    REQ-007/STORY-007 into mojibake — caught via `grep -c "u00e2\|u20ac"`,
    fixed by rewriting the file with the Write tool instead of Python, and
    the delete-test was then redone with the Edit tool to avoid the same
    class of bug.) Screenshotted Overview, Project Management (Gantt +
    task table), Knowledge Base (traceability table + Ask panel), and
    Systems (all 5 rows grey/"never") — visually confirmed the em dash
    renders correctly, REQ-019 shows red "gap — no story yet", and Systems
    shows no fabricated green.
  - Notes: All 5 Done-means criteria are now `true` and genuinely verified
    against the finished build, not assumed. `docs/stories/STORY-000.md`
    still deliberately not created (platform-owned, rewritten on sync).
    Not yet committed/pushed — that's the very next step, with a commit
    message naming STORY-000 per the brief. GitHub Pages (Step 4) still
    not turned on.

## 2026-08-19

- [x] STORY-001 — Ingest audio from virtual sources (Zoom, Teams, Meet)
  - Date: 2026-08-19
  - Session: CC-20260818-t9v2
  - What changed: Built the backend foundation for the Meeting Assistant
    project (nothing existed before this — `backend/` is new) and
    implemented REQ-001: live audio ingestion from Zoom, Microsoft Teams,
    and Google Meet, worked as a paced co-pilot (one small step at a time,
    confirmed before each). Node.js/npm were not installed on this machine;
    installed Node LTS (v24.19.0) via `winget install OpenJS.NodeJS.LTS`
    (first attempt failed on the `msstore` source's cert check — same TLS
    interception noted in the 2026-08-09 GitHub-push entry — retried scoped
    to `--source winget`, which succeeded) so the backend could follow
    CLAUDE.md's Node+Express+TypeScript stack with real `tsc`/test
    execution instead of working around the gap in Python. Stack: Express
    4 + TypeScript 5 (strict) + Zod request validation + Jest/ts-jest/
    supertest, Node's native `fetch` (no HTTP client dependency added).
    Structure: `backend/src/server.ts` (app + `/health`), `backend/src/
    routes/audioIngestion.ts` (`POST /api/audio/ingest/{zoom,teams,meet}`,
    Zod-validated `{ meetingRef }` body, one shared error→HTTP-status
    handler), `backend/src/services/audioIngestion/` — `types.ts` (shared
    `PlatformClient`/`PlatformRecording` contract every platform client
    implements), `errors.ts` (typed error hierarchy — Unsupported
    Format/CorruptedAudio/UpstreamTimeout/UpstreamUnavailable/
    UpstreamRejected/ContractViolation/Configuration — each with a stable
    `errorClass` per the Observability rules, no generic `Error` in logs),
    `withTimeoutAndRetry.ts` (explicit per-attempt timeout + capped
    retries + backoff for every outbound call), `zoomClient.ts` (Zoom
    Server-to-Server OAuth + Cloud Recording API), `teamsClient.ts`
    (Microsoft Graph client-credentials OAuth + onlineMeetings recordings,
    HEAD request for size since Graph's list response omits it),
    `meetClient.ts` (Google service-account JWT-bearer OAuth, hand-signed
    with Node's `crypto.createSign('RSA-SHA256')` rather than adding the
    `googleapis` dependency, + Meet API + Drive metadata lookup for size),
    and `audioIngestionService.ts` (format/corruption validation, source
    logging, and — added during the hardening pass — an in-flight-request
    map that coalesces concurrent identical `(platform, meetingRef)`
    requests into one upstream call). Idempotency is keyed on
    `${platform}:${sourceRecordingId}` in an in-memory `Map`; explicitly
    commented as a `TODO(pre-persistence)` since there's no database layer
    yet to hold a real unique constraint — dedup only holds within one
    running process, not across restarts. `backend/.env.example` documents
    every required env var per platform (names only, no values).
  - Verification: `tsc --noEmit` clean throughout. `npm test` (Jest):
    61/61 passing across 8 suites, covering per platform: happy path
    (201, `available_for_transcription`), unsupported-format rejection
    (422, matches acceptance criterion 2), corrupted file — zero-byte and
    missing-download-URL (422), upstream timeout (504) and 5xx (502) not
    swallowed, missing-body validation (400) with zero upstream calls,
    idempotent double-ingest (no duplicate, dedup logged, matches Trust
    criterion via the source-logging assertion), and missing-credentials
    fails loud with `ConfigurationError` (500) naming the missing env
    vars rather than crashing. Ran an explicit BREAK-phase probe (per
    CLAUDE.md's Build-Break-Harden loop) that found two real bugs before
    they shipped: (1) two concurrent requests for the same meeting hit
    the upstream API twice — fixed with the in-flight-request coalescing
    described above, verified by a test asserting the upstream call count
    drops from 2 to 1; (2) malformed JSON bodies already 400'd via
    Express's default handler but with an empty, inconsistent body —
    added explicit JSON-parse-error middleware in `server.ts` so it
    matches the `{error, message}` shape used everywhere else, verified
    by a new `server.test.ts` case (this maps to the "network failure
    during upload" failure path in spirit — malformed/interrupted request
    bodies — the literal network-failure case is covered by the upstream
    timeout/5xx tests above). Acceptance criteria 1 and 2 verified
    directly by the route tests; the Trust criterion (source is logged)
    verified by asserting on the structured `audio_ingested` log event's
    `platform` field in `audioIngestionService.test.ts`.
  - Notes: Two decisions made without stopping to ask, logged here per
    the autonomy rules (both implementation-level, reversible, low blast
    radius): (1) request field named `meetingRef` rather than
    `meetingId`, since Teams/Meet identify a recording by an online-
    meeting/conference-record reference, not a numeric meeting id like
    Zoom's — a shared generic name fits the now-common `PlatformClient`
    contract better. (2) Added `mp4` to `SUPPORTED_AUDIO_FORMATS` — Teams
    and Meet cloud recordings are always delivered as MP4 (video
    container, AAC audio track); there's no separate audio-only export
    like Zoom's M4A type, so without this, Teams/Meet ingestion could
    never succeed against real data. Genuinely stopped and asked the user
    twice this session per the story's own "stop and ask" rule rather
    than assuming: once when Node.js wasn't installed (stack choice —
    user chose "install Node" over "build in Python"), and once when the
    user said they need live platform API integration, which requires
    Zoom/Azure AD/Google Cloud developer credentials nobody has yet (user
    chose "build all three now, credential-ready" over "one platform at a
    time"). **All three platform integrations are verified only against
    each platform's documented API shape (mocked HTTP), not a live
    account — no real Zoom, Azure AD, or Google Cloud credentials exist
    for this project.** `backend/.env.example` names what's needed to
    close that gap. STORY-002 (physical-source ingestion) and STORY-003
    (low-confidence-segment flagging) were deliberately left untouched,
    per the brief. Not yet committed — commit is the very next step, with
    a message naming STORY-001 per the brief.

- [x] STORY-002 — Ingest audio from physical sources (room mic, phone)
  - Date: 2026-08-20
  - Session: CC-20260818-t9v2
  - What changed: Implemented REQ-002 by extending STORY-001's backend
    rather than rebuilding it, per the brief's explicit "reuse it, do not
    rebuild it" instruction. New `POST /api/audio/ingest/physical`
    (`backend/src/routes/physicalAudioIngestion.ts`) accepts a multipart
    file upload (`multer`, memory storage, 200MB cap) with a `source`
    field (`room_mic`|`phone`). Before writing any multer code, `npm
    install` flagged multer 1.x as carrying known CVEs patched in 2.x, so
    used `multer@^2.2.0`/`@types/multer@^2.2.0` instead of the originally
    planned 1.x — 0 vulnerabilities on the final install. Stopped and
    asked the user first (per the story's own "stop and ask" rule) about
    a real contradiction in the brief: STORY-002's acceptance criteria
    requires low-confidence flagging for noisy audio, but the same brief
    lists STORY-003 as owning that exact capability and says not to build
    it yet. User chose "build a minimal flag now"; documenting that choice
    here rather than silently picking a side. Two new validation layers,
    kept deliberately distinct so they map to the two different failure
    paths this story lists: `backend/src/services/audioIngestion/
    audioFormatSniffer.ts` reads magic bytes (RIFF/WAVE, ID3/MPEG frame
    sync, ISO-BMFF ftyp brand) to identify the file's real format,
    independent of its claimed extension — extension not in
    `SUPPORTED_AUDIO_FORMATS` → `UnsupportedFormatError`; content doesn't
    match any signature, or mismatches the claimed extension →
    `CorruptedAudioError` (this one check covers empty files, truncated
    uploads, and mislabeled files at once).
    `audioQualityAssessment.ts` implements the low-confidence heuristic:
    for 16-bit PCM WAV it parses the real `fmt `/`data` chunk structure
    with plain `Buffer` math (no new dependency) and computes RMS
    amplitude + clipping ratio against fixed thresholds; for compressed
    formats (mp3/m4a/mp4), which can't be decoded without a real decoder
    library, it flags conservatively with an honest "no decoder available"
    reason rather than fabricating a pass — logged as a known limitation,
    not hidden. `physicalAudioIngestionService.ts` wires validation +
    quality assessment together and switched idempotency to a SHA-256
    content hash (`physical:${source}:${hash}`) instead of a
    platform-supplied id, since there isn't one for an upload — re-posting
    identical bytes is a natural no-op. Extended the shared `IngestedAudio`
    type with optional `lowConfidence`/`lowConfidenceReason` fields
    (absent, not `false`, for virtual sources — STORY-001 doesn't assess
    quality, so "absent" means "not assessed" rather than "assessed and
    fine"; kept optional specifically so STORY-001's existing service file
    didn't need touching, honoring the brief's "don't change a file
    outside this story" rule). Also extracted the error→HTTP-status
    mapping that STORY-001 had inlined in `routes/audioIngestion.ts` into
    a new shared `routes/errorResponse.ts`, since the physical route
    needed the identical mapping and copy-pasting it a second time was the
    wrong call — both routers use it now, behavior unchanged.
  - Verification: `tsc --noEmit` clean. `npm test`: 100/100 passing across
    12 suites (up from 61 after STORY-001), covering: happy path (201,
    `available_for_transcription`, `lowConfidence: false`) for both
    `room_mic` and `phone`; the noisy-recording acceptance criterion
    proven twice — once at the service layer and once over a real HTTP
    round-trip — with a synthetic quiet WAV coming back
    `lowConfidence: true` plus a human-readable reason; unsupported
    extension (422); empty file (422 corrupted); extension/content
    mismatch, e.g. an MP3 byte stream named `.wav` (422 corrupted);
    missing `source`/missing file (400); idempotent re-upload (same id,
    no duplicate). Ran an explicit BREAK-phase probe pass per CLAUDE.md's
    Build-Break-Harden loop against three scenarios: an oversized upload
    (correctly 413, not a crash), a malformed multipart body (correctly
    400 via multer's own error path, not a 500), and two concurrent
    identical uploads (correctly deduped, store size stayed at 1). Unlike
    STORY-001's virtual-platform code, all three already behaved
    correctly — no new bugs found, so no new hardening code was needed;
    reasoned through why concurrency is safe here (unlike STORY-001):
    `ingestPhysicalRecording` never `await`s internally, so two requests
    can't interleave mid-check the way STORY-001's async
    `client.fetchRecording()` call allowed. All three probes were kept as
    permanent regression tests rather than thrown away (made the upload
    size limit configurable on the router specifically so the 413 case
    could be tested without a real 200MB upload).
  - Notes: Confidence 70% — slightly lower than STORY-001's 75%, for two
    reasons specific to this story. First, the low-confidence heuristic
    only does real signal analysis for 16-bit PCM WAV; compressed formats
    (which real phone recordings very often are) get a conservative
    always-flagged placeholder, not real analysis — this satisfies the
    acceptance criterion's letter but not its spirit for a large fraction
    of realistic physical-source uploads, and STORY-003 may be expected to
    close that gap with a real decoder. Second, the idempotency store
    remains in-memory only (same `TODO(pre-persistence)` as STORY-001) —
    now proven race-free within a process, but still not safe across
    restarts or multiple server instances. What would raise confidence:
    a real decoder (even a small one) for compressed-format quality
    analysis, and a persisted uniqueness constraint once a database layer
    exists. Not yet committed — commit is the very next step, with a
    message naming STORY-002 per the brief.

## 2026-08-21

- [x] STORY-001 — carry download URL through, mark acceptance criteria passing
  - Date: 2026-08-21
  - Session: CC-20260821-b7q3
  - What changed: Re-verified STORY-001 (already implemented in
    `1dcbc1f`, 100/100 tests passing) against its Definition of Done and
    found one real gap: `audioIngestionService.ts` validated that each
    platform recording file had a `downloadUrl` before accepting it, then
    discarded that URL — the returned `IngestedAudio` gave a downstream
    transcription step no way to actually fetch the audio bytes. Added
    `downloadUrl` to `IngestedAudio` (`types.ts`) and populated it in
    `audioIngestionService.ts`. Made the field optional rather than
    required, specifically to avoid touching
    `physicalAudioIngestionService.ts` (STORY-002's file, uploaded audio
    has no remote URL to carry) — required would have forced an
    out-of-story edit, which CLAUDE.md's guardrails call out as a stop-
    and-ask condition. Added a test assertion for the carried URL and
    flipped `.colaberry/progress.json`'s three STORY-001 acceptance
    criteria to `passed: true` (all three independently verified: happy
    path 201 + `available_for_transcription`, unsupported-format 422,
    and source logging via the `audio_ingested`/`audio_ingestion_failed`
    structured log events).
  - Verification: `tsc --noEmit` clean. `npx jest`: 100/100 passing
    across 12 suites (unchanged count — this was a type/field addition
    plus one new assertion on an existing test, not new test files).
  - Notes: Confidence 85% unchanged from the prior check-in — the gap
    closed here was a real but narrow one; the credential-verification
    gap noted then (no live Zoom/Azure AD/Google Cloud creds to test
    against) still stands and is the main thing that would raise it
    further. `points_awarded: 24` for STORY-001 in progress.json is an
    assumption (8 pts/criterion, matching STORY-000's 40/5 ratio — no
    explicit per-story point value exists in `plan.json`); flagged here
    since the portal, not Claude Code, may own that computation.

## 2026-08-22

- [x] STORY-003 — Flag low-confidence segments in physical audio (crosstalk)
  - Date: 2026-08-22
  - Session: CC-20260822-r5n8
  - What changed: Implemented REQ-003 by extending STORY-002's existing
    quality-assessment code rather than rebuilding it, per the brief's
    "reuse, do not rebuild" instruction. Before building, stopped and
    asked the user how to handle a real gap between the brief's literal
    wording and what's measurable: "crosstalk" (overlapping speakers) is
    a speech/diarization phenomenon, and no real decoder or diarization
    library exists in this project — the existing STORY-002 heuristic
    only reads raw PCM signal properties (RMS loudness, clipping). User
    chose the stereo channel-overlap heuristic option: for stereo WAV,
    `audioQualityAssessment.ts` now parses `numChannels` from the `fmt `
    chunk (previously parsed but discarded) and a new
    `assessStereoCrosstalk()` splits the segment into 10 equal time
    frames, flagging low-confidence when both channels carry
    above-silence energy in the same frame more than 60% of the time —
    a genuine signal-overlap check, not real diarization, and documented
    as such in the function's comment. Mono files (most real room-mic/
    phone recordings) fall straight through to the existing silence/
    clipping check unchanged, since there's no second channel to compare
    against — this honest limitation is called out in code rather than
    hidden. Also added a distinct `audio_segment_flagged_for_review` log
    event in `physicalAudioIngestionService.ts`, fired only when a
    segment is actually flagged (not on the idempotent-dedup path, so
    re-uploads don't duplicate the review-log side effect), to satisfy
    the Trust criterion with a clearly-named, filterable event rather
    than relying on a field buried inside the general `audio_ingested`
    line.
  - Verification: `tsc --noEmit` clean. `npx jest`: 103/103 passing
    across 12 suites (up from 100 after STORY-002/STORY-001 fixes — 3 new
    tests: a stereo segment loud on both channels throughout flags with a
    `/crosstalk/i` reason; a stereo segment where channels take turns
    (never simultaneously active) does not flag; a flagged segment emits
    `audio_segment_flagged_for_review` with source/filename/reason, while
    a clean segment emits no such event). All 6 pre-existing
    `audioQualityAssessment` tests (mono silence/clipping/compressed/
    malformed/non-16-bit cases) pass unchanged, confirming the new
    stereo path didn't regress mono behavior.
  - Notes: Confidence 65% — lower than STORY-002's 70%, and for a
    specific reason worth being upfront about: the stereo crosstalk
    heuristic only fires on stereo WAV files, but most real physical
    recordings (a single room mic, a phone call) are mono, where
    crosstalk genuinely cannot be distinguished from one loud continuous
    speaker using signal amplitude alone — the acceptance criteria pass
    against the synthetic stereo test fixtures used here, but the
    heuristic would not catch crosstalk in the more common mono case.
    The 10-frame/60%-overlap thresholds are also untuned constants, not
    derived from real recordings. What would raise confidence: real
    audio test fixtures (not synthetic square waves) to validate the
    thresholds, and either a mono-compatible crosstalk signal (if one
    exists without full diarization) or an explicit product decision that
    mono crosstalk detection is out of scope until a real diarization
    dependency is approved. Not yet committed — commit is the next step,
    with a message naming STORY-003 per the brief.

- [x] STORY-004 — Tag output with meeting type and source
  - Date: 2026-08-22
  - Session: CC-20260822-q7mv
  - What changed: Implemented REQ-004 as a new pure module,
    `outputTagging.ts` (`buildOutputTag()`), wired into both existing
    ingestion paths rather than rebuilt. A real gap surfaced before
    building: the acceptance criteria need `[In-Person — Location]` for
    physical recordings, but nothing in the system captured a location —
    physical ingestion only knew the capture device (`room_mic`/`phone`),
    not a place. Added an optional `location` field to physical
    ingestion (route → `IngestPhysicalOptions` → `buildOutputTag`) as a
    genuinely new, in-scope piece of metadata, kept as an options-object
    field rather than a new positional parameter specifically to keep
    the change low-blast-radius (no existing call sites had to shift).
    Virtual sources needed no new input — `source` already maps to a
    platform display name (`zoom`→Zoom, `teams`→Teams, `meet`→Google
    Meet). Put `OutputTag`/`MeetingType` in `types.ts` rather than
    `outputTagging.ts`, since `outputTagging.ts` already depends on
    `types.ts` for `AudioSource` — defining the new types there too
    avoids a circular import between the two modules. Added `outputTag:
    OutputTag` to `IngestedAudio` (required, not optional — unlike
    `lowConfidence`/`downloadUrl`, every ingestion of either kind can
    always be tagged, so there's no "not applicable" case to leave
    absent). Logged a new `output_tagged` event (Trust criterion) right
    after `audio_ingested`, only on the fresh-ingest path (not on
    idempotent-dedup hits), matching STORY-003's convention for
    `audio_segment_flagged_for_review`. Handled the three failure paths
    explicitly: incorrect tagging (a new `TaggingError`, added to
    `errors.ts` alongside the existing `IngestionError` subclasses, when
    a source doesn't match any known meeting type), missing metadata (a
    blank/absent `location` falls back to an honest `"Location unknown"`
    placeholder rather than a fabricated place, and the route accepts a
    blank location rather than rejecting the upload over it — flagged via
    a `locationUnknown` boolean on the tag), and tagging system failure
    (verified, not just argued: added unit tests at the service layer for
    both ingestion paths that force `buildOutputTag` to throw and confirm
    it propagates cleanly with no partial state — no idempotency-store
    write, no misleading `audio_ingested` log).
  - Verification: `tsc --noEmit` clean. `npx jest`: 120/120 passing
    across 13 suites (up from 112 before this story — 8 new tests: 3
    virtual-route acceptance tests proving `[Virtual — Zoom/Teams/Google
    Meet]` over real HTTP for all three platforms; 2 physical-route tests
    proving `[In-Person — Conference Room A]` with a supplied location
    and the `[In-Person — Location unknown]` fallback without one; 1
    service-level test asserting the exact `outputTag` shape for a
    supplied physical location; 2 service-level "tagging system failure"
    tests (one per ingestion path) proving a forced `TaggingError`
    propagates without leaving partial state). Also strengthened 2
    existing happy-path tests to assert the actual `output_tagged` log
    payload content (source/platform, meetingType, header,
    locationUnknown), not just that the event fired, and updated 2
    pre-existing idempotency tests whose hardcoded log-sequence
    assertions didn't yet expect the new event.
  - Notes: Confidence 80%. This is a genuine walking skeleton: the tag is
    computed and returned on the ingestion response today, but there is
    no "minutes output" or rendered header yet for it to actually appear
    on — that's STORY-008+ territory, correctly out of scope here per the
    brief's "leave room for it, do NOT build it now." What would raise
    confidence: seeing `outputTag` actually consumed once STORY-005+
    exists, and a product decision on whether physical `location` should
    become a required upload field (vs. today's optional-with-fallback)
    once real usage shows how often it's left blank. Not yet committed —
    commit is the next step, with a message naming STORY-004 per the
    brief.

- [x] STORY-018 — Ensure idempotency and audit trail for audio ingestion
  - Date: 2026-08-22
  - Session: CC-20260822-k9x2
  - What changed: Added `backend/src/services/audioIngestion/auditLog.ts`
    exposing `recordAuditEvent()`, a single write path for the
    audio-ingestion audit trail. Every call generates a fresh
    `crypto.randomUUID()` as `auditEventId`, independent of the
    ingestion's `resourceId` (which repeats across dedup hits and
    repeated failures on the same file), so each audit entry is
    individually identifiable — satisfying the Trust acceptance
    criterion. Entries carry `timestamp`, `event`, `outcome`
    (success/failure), `resourceId`, optional top-level `error_class`
    (matching CLAUDE.md's Observability Framework field name), and
    `context`; failures route to `console.error`, successes to
    `console.log`. Wired it into all four existing call sites rather
    than building new ingestion logic (idempotency itself already
    existed from STORY-001–004 and needed no changes — dedup on
    `platform:fileId` for virtual, SHA-256 content hash for physical):
    `audioIngestionService.ts` and `physicalAudioIngestionService.ts`'s
    `defaultLogger.info()` now call `recordAuditEvent()` instead of raw
    `console.log` (the injectable `AudioIngestionLogger` interface used
    by ~9 existing tests was left untouched, so no existing test needed
    to change); `audioIngestion.ts` and `physicalAudioIngestion.ts`
    routes' failure-path `console.error` blocks now call
    `recordAuditEvent()` with `outcome: 'failure'`, the error's
    `errorClass`, and a best-effort `resourceId`
    (`platform:meetingRef` or `source:filename`, since a failed
    ingestion never gets a real resource id). Added `auditLog.test.ts`
    (4 tests: unique `auditEventId` per call even with identical
    `resourceId`; structured entry shape; failure routes to
    `console.error`/success to `console.log`; `error_class` present
    only on failures). Added one audit-trail integration test each to
    `audioIngestionService.test.ts` and
    `physicalAudioIngestionService.test.ts`: ingest the same file twice
    through the real default logger (`console.log` spy, not a mock),
    assert the `audio_ingested` and `audio_ingestion_deduplicated`
    entries share `resourceId` but have distinct `auditEventId`s —
    proving the unique-identifier guarantee end-to-end through
    production wiring, not just the module in isolation.
  - Verification: `tsc --noEmit` clean. `npx jest`: 127/127 passing
    across 14 suites (up from 120/13 before this story — 7 new tests: 4
    for `auditLog.ts` in isolation, 2 audit-trail integration tests
    (virtual + physical dedup produces distinct `auditEventId` with
    same `resourceId`), 1 covering `error_class`).
  - Notes: Confidence 85%. All three acceptance criteria pass: (1)
    duplicate ingestion doesn't duplicate data — pre-existing
    idempotency, unchanged; (2) failure logged with timestamp —
    pre-existing, now routed through the same audit module; (3) Trust:
    ingestion event recorded in audit log with unique identifier — new,
    and proven via a real (non-mocked) console spy rather than just
    asserting the module's own unit tests. What would raise confidence:
    the audit log is still process-local (console output), matching the
    existing `TODO(pre-persistence)` markers already in
    `audioIngestionService.ts`/`physicalAudioIngestionService.ts` for
    the idempotency stores — once a real data layer exists, the audit
    trail should move to durable storage (a DB table or log aggregator)
    rather than stdout, per CLAUDE.md's Idempotency & Replayability
    section. Not yet committed — commit is the next step, with a
    message naming STORY-018 per the brief.

- [x] Track pre-existing prompt-evaluation harness (untracked files, not authored this session)
  - Date: 2026-08-22
  - Session: CC-20260822-k9x2
  - What changed: Committed `requirements.txt`, `prompts/tag-audio-source/`
    (`prompt.md`, `v1.0.0.md`, `eval.jsonl`), and `scripts/score_prompt.py`
    — a prompt + eval-set + scoring script for classifying an incoming
    recording's `source_type`/`confidence`. These files already existed,
    untracked, in the working tree at session start (file timestamps
    predate this session); no changes were made to their content. Adding
    a `PROGRESS.md` entry here only because CLAUDE.md's hard gate
    requires any commit touching `/scripts` to also touch `PROGRESS.md`
    — this entry does not claim authorship of the prompt/eval work
    itself.
  - Verification: user confirmed — explicit instruction to commit these
    files after being shown their contents (no secrets, `.env` already
    gitignored).
  - Notes: Not tied to a story; no functional relationship to STORY-018
    beyond both touching audio-source classification conceptually. If
    this harness belongs to a specific story or directive, worth linking
    it there in a follow-up.

- [x] STORY-005: Transcribe audio with timestamps
  - Date: 2026-08-27
  - Session: CC-20260827-pma0
  - What changed: Added `backend/src/services/transcription/` — `types.ts`
    (`TranscriptSegment`, `Transcript`, `TranscriptionClient` provider
    contract), `errors.ts` (`AudioDecodingError`,
    `TimestampMisalignmentError`, `ContractViolationError`), `auditLog.ts`
    (parallel to `audioIngestion/auditLog.ts` but tagged
    `service: 'transcription'` — reusing the ingestion one as-is would
    have mislabeled every transcription log line), and
    `transcriptionService.ts`'s `transcribeAudio()`. It sniffs the audio
    buffer's real bytes against its claimed format before ever calling a
    provider (reused `sniffAudioFormat` from `audioIngestion`,
    read-only) so a corrupted file fails deterministically without
    depending on a fake client's behavior; wraps the provider call in
    `withTimeoutAndRetry` (also reused read-only from `audioIngestion`,
    not duplicated or relocated — kept the diff scoped to this story);
    validates every returned segment is chronological and non-zero-length
    before accepting it, rejecting anything else as
    `TimestampMisalignmentError`; and dedupes on `audioId` so
    re-transcribing the same audio never re-calls a (paid) provider.
    Every attempt, dedup hit, success, and failure writes an audit event.
    No real speech-to-text provider is wired in — `TranscriptionClient`
    is the seam a provider integration will implement later, since
    introducing a paid external service is a CLAUDE.md escalation
    trigger, not an implementation detail for this story. No HTTP route
    added either (discussed with user; acceptance criteria don't require
    one, and it wasn't part of what was approved step-by-step) — this
    story is service-layer only, matching STORY-006/007's explicit
    "leave room, don't build yet" scope note for what comes next.
  - Verification: `tsc --noEmit` clean across the backend. `npx jest`:
    135/135 passing across 15 suites (up from 127/14 before this story —
    8 new tests in `transcriptionService.test.ts`: happy path with
    timestamped segments, corrupted audio rejected without calling the
    provider, provider timeout exhausts retries, out-of-order timestamps
    rejected, zero-length/reversed segment rejected, non-array provider
    response rejected, idempotency on repeat `audioId`, and an audit-trail
    test using real `console.log`/`console.error` spies — not a mocked
    logger — asserting distinct `auditEventId`s across a success and a
    failure).
  - Notes: Confidence 80%. All three acceptance criteria pass: (1) every
    segment in the returned transcript carries `startMs`/`endMs`; (2) a
    corrupted audio file fails gracefully with `AudioDecodingError` and a
    clear message; (3) Trust — attempts and results (success and
    failure) are recorded to the audit trail, proven via real console
    spies. What would raise confidence: this has never run against a
    real speech-to-text provider or real (non-synthetic) audio, so
    provider response shapes this service hasn't anticipated (e.g. a
    provider that returns confidence scores, word-level timestamps, or
    a different unit than milliseconds) could surface a
    `ContractViolationError` in practice that these tests don't cover
    yet; that's expected to sharpen once a real provider is wired up in
    a later story. Also: per the audioIngestion precedent, failure-path
    audit logging normally lives at the route layer, not the service —
    here it's in the service itself since no route exists yet for this
    story; if/when a route is added, check for double-logging before
    reusing this service's failure path underneath it.

- [x] STORY-006 — Perform speaker diarization and map speakers
  - Date: 2026-08-28
  - Session: CC-20260828-x3f8
  - What changed: Added `backend/src/services/diarization/` — `types.ts`
    (`Attendee`, `RawSpeakerSegment`, `DiarizationClient` and
    `NameMappingClient` provider seams, `DiarizedSegment`,
    `SpeakerMapping`, `UNIDENTIFIED_SPEAKER_LABEL`), `errors.ts`
    (`DiarizationError` base, `DiarizationFailedError`,
    `NameMappingServiceError`, `ContractViolationError`), `auditLog.ts`
    (parallel to `transcription/auditLog.ts`, tagged
    `service: 'diarization'`), and `diarizationService.ts`'s
    `diarizeAndMapSpeakers(transcript, buffer, attendees, options)`. It
    calls an injectable `DiarizationClient` via `withTimeoutAndRetry`
    (reused read-only from `audioIngestion`, same as STORY-005) to get
    raw speaker-tagged segments, validates the response shape, aligns
    each transcript segment to whichever raw speaker segment overlaps it
    most by timestamp, then — only if an attendee list was given —
    resolves raw speaker tags to real names via an injectable
    `NameMappingClient`. Three failure paths handled: a diarization
    provider failure/timeout after retries has no safe fallback and
    throws `DiarizationFailedError` (audited); a name-mapping service
    failure/timeout degrades every speaker to `'Unidentified Speaker'`
    rather than failing the whole result (audited, not thrown); a
    mapping response naming someone not on the attendee list is dropped
    as untrusted rather than applied (audited as
    `incorrect_speaker_mapping`). No attendee list at all skips name
    mapping entirely and everyone is `'Unidentified Speaker'`. Dedupes
    on `transcript.id` so re-diarizing the same transcript never
    re-calls either provider. Every attempt, dedup hit, success, and
    failure writes an audit event. No real diarization or name-mapping
    provider is wired in — same paid-external-dependency governance
    boundary STORY-005 drew for `TranscriptionClient`. No HTTP route
    added (service-layer only, per discussion, same scope note STORY-005
    left for STORY-006/007).
  - Verification: `tsc --noEmit` clean across the backend. `npx jest`:
    142/142 passing across 16 suites (up from 135/15 before this story —
    7 new tests in `diarizationService.test.ts`: happy path mapping
    speakers to attendee names, no-attendee-list path labeling everyone
    `'Unidentified Speaker'` without ever calling the name-mapping
    provider, diarization-provider timeout exhausting retries and
    throwing `DiarizationFailedError` without calling the name-mapping
    provider, a name-mapping-service timeout degrading every speaker to
    `'Unidentified Speaker'`, an untrusted mapped name being dropped
    rather than applied, idempotency on repeat `transcript.id`, and an
    audit-trail trust test using real `console.log`/`console.error`
    spies asserting distinct `auditEventId`s across a success and a
    failure).
  - Notes: Confidence 80%. All three acceptance criteria pass: (1) given
    an attendee list, speakers map to real names; (2) given no attendee
    list, speakers are labeled `'Unidentified Speaker'`; (3) Trust —
    attempts and results are recorded to the audit trail, proven via
    real console spies. What would raise confidence: this has never run
    against a real diarization or name-mapping provider, so real
    response shapes (word-level speaker confidence scores, a different
    tag format, fuzzy/partial name matches instead of exact
    attendee-name strings) could surface a `ContractViolationError` or
    an unnecessarily strict "not on the attendee list" rejection in
    practice that these tests don't cover. Also flagging: this session
    found `.colaberry/progress.json` had STORY-006's three criteria
    pre-marked `passed: true` with empty `files_touched`/`tests_added`
    before any code existed — that flag was stale; this entry's
    verification is grounded in the actual test run above, not that
    pre-existing value.

- [x] STORY-007 — Mark inaudible or uncertain segments
  - Date: 2026-08-28
  - Session: CC-20260828-h6t2
  - What changed: Added `backend/src/services/segmentMarking/` — `types.ts`
    (`SegmentAudibility`, the exact `[inaudible]`/`[unclear — verify]` marker
    strings REQ-007 specifies, confidence thresholds, `MarkedSegment`/
    `MarkedTranscript`), `errors.ts` (`SegmentMarkingError` base,
    `ContractViolationError`), `auditLog.ts` (parallel to
    `diarization/auditLog.ts`, tagged `service: 'segmentMarking'`), and
    `segmentMarkingService.ts`'s `markSegments(transcript)`. Before building,
    flagged and got explicit sign-off on the real design gap: with no real
    speech-to-text provider wired in yet (same seam STORY-005/006 left open),
    nothing existing could independently judge audibility. Extended
    `TranscriptSegment`/`RawTranscriptSegment` in `transcription/types.ts`
    with an optional `confidence` field (0-1, provider-supplied, absent
    means unscored) — the same "extend an existing type when the story
    genuinely needs a new signal" precedent STORY-003/004 set — and fixed
    `transcriptionService.ts`'s `validateSegments` map, which previously
    destructured `{ startMs, endMs, text }` and would have silently dropped
    `confidence` even if a provider supplied it. Marking uses two
    independent signals: empty/whitespace-only `text` is a direct,
    provider-independent "couldn't be heard" signal (`inaudible` regardless
    of `confidence`); `confidence` bands apply when a provider reports one
    (`< 0.3` → `inaudible`, `< 0.6` → `unclear`, else `clear`). A segment
    with neither signal tripped defaults to `clear` — absence of trouble is
    never guessed into `unclear`, satisfying the "clear segment is not
    marked inaudible" criterion directly. Unlike STORY-005/006,
    `markSegments` is synchronous with no external client — it judges
    audibility purely from data the transcript already carries, so there's
    no provider call to wrap in `withTimeoutAndRetry`; documented as a
    deliberate scope call in the function's doc comment, not an oversight.
    Malformed input (non-array `segments`, non-string `text`, out-of-range/
    NaN `confidence`) throws `ContractViolationError` rather than guessing a
    mark — this is the story's "marking system failure" failure path. The
    "failure to detect inaudible segments" failure path isn't an
    exception-throwing case (same as STORY-003's mono-crosstalk limitation)
    — it's an honest heuristic limitation, documented in code and in the
    Notes below rather than hidden. Dedupes on `transcript.id` so
    re-marking the same transcript is a no-op. Every attempt, dedup hit,
    success, and failure writes an audit event. No HTTP route added
    (service-layer only, matching STORY-005/006's scope note).
  - Verification: `tsc --noEmit` clean across the backend. `npx jest`:
    151/151 passing across 17 suites (up from 142/16 before this story — 9
    new tests in `segmentMarkingService.test.ts`: a clear segment with no
    confidence reported stays unmarked, a clear high-confidence segment
    stays unmarked, an empty-text segment marks `[inaudible]`, a
    low-confidence segment marks `[inaudible]`, a mid-confidence segment
    marks `[unclear — verify]` — distinct from `[inaudible]`, an
    out-of-range confidence throws `ContractViolationError`, non-string
    text throws `ContractViolationError`, idempotency on repeat
    `transcript.id`, and an audit-trail trust test using real
    `console.log`/`console.error` spies asserting distinct `auditEventId`s
    across a success and a failure). Also re-ran the full pre-existing
    suite after the `transcription/types.ts` and `transcriptionService.ts`
    edits to confirm the `confidence` field addition didn't regress
    STORY-005's behavior — all pre-existing tests passed unchanged.
  - Notes: Confidence 65% — lower than STORY-005/006, and for a specific,
    named reason: the `inaudible`/`unclear` confidence bands only do
    anything once a real transcription provider actually reports
    per-segment `confidence` scores, which none does yet (same gap
    STORY-005 left open). Today, the only signal that fires against
    realistic data is the empty-text case — a provider returning nothing
    for a segment it couldn't transcribe — so the acceptance criteria pass
    against synthetic fixtures exercising both signals, but only the
    empty-text path is proven against what a real provider is likely to
    actually produce. What would raise confidence: a real provider
    integration (STORY-005's open gap) whose `confidence` values validate
    the 0.3/0.6 thresholds against real inaudible/uncertain audio rather
    than untuned constants. Also worth flagging: this session found
    `.colaberry/progress.json` had STORY-007's three criteria manually
    marked `passed: true` with empty `files_touched`/`tests_added` before
    any code existed for this story (same stale-flag pattern STORY-006's
    entry called out) — asked the user directly, who confirmed intent to
    have the story actually built; `.colaberry/progress.json` is corrected
    in this commit to reflect the real verification above.

- [x] STORY-008 — Generate meeting summary
  - Date: 2026-08-28
  - Session: CC-20260828-q7m4
  - What changed: Added `backend/src/services/meetingSummary/` —
    `types.ts` (`MeetingContext` for caller-supplied `title`/`objective`/
    `scheduledAt`, since no calendar-invite ingestion story exists yet;
    `MeetingSummary` output with a `missingFields: SummaryFieldName[]`
    array), `errors.ts` (`MeetingSummaryError` base, `ContractViolationError`,
    `SummaryGenerationTimeoutError`), `auditLog.ts` (parallel to
    `diarization/auditLog.ts` and `segmentMarking/auditLog.ts`, tagged
    `service: 'meetingSummary'`), and `meetingSummaryService.ts`'s
    `generateMeetingSummary(input)`. Before building, worked out that two of
    REQ-008's seven fields — title and objective — have no data source
    anywhere in the codebase (no calendar/invite ingestion story exists),
    so they're only ever caller-supplied via the new optional
    `MeetingContext` and flagged missing when absent, never inferred from
    transcript text — matching the architecture doc's "grounded only in
    what the transcript actually contains, never fabricate" rule. The other
    five fields reuse data STORY-001–006 already compute: `format` and
    `platform/location` come from `IngestedAudio.outputTag`
    (`meetingType`/`sourceLabel`), including its existing `locationUnknown`
    flag for physical recordings with no location — `platformOrLocation` is
    left unset (and flagged) rather than shipping the `"Location unknown"`
    placeholder string as if it were real data; `attendees` reuses the same
    `Attendee[]` list STORY-006's diarization already accepts; `date`/`time`
    prefer `MeetingContext.scheduledAt` (a real calendar timestamp) when
    supplied, else fall back to `IngestedAudio.ingestedAt`, and are flagged
    missing (not defaulted to a wrong value) if that timestamp turns out
    unparseable. Dedupes on `transcript.id`. Assembly is wrapped in
    `withTimeoutAndRetry` (`maxAttempts: 1` — retrying deterministic sync
    logic against a timeout can't change the outcome) so
    `SummaryGenerationTimeoutError` exists as an explicit, capped boundary
    per CLAUDE.md's Failure-First Design; documented honestly in `errors.ts`
    as a defensive guard on an in-memory step, not a real external call —
    the same "no external client to wrap" scope note STORY-007 made.
    Malformed input (non-array `attendees`, missing transcript/audio id or
    outputTag) throws `ContractViolationError` rather than guessing a
    summary. Every attempt, dedup hit, success, and failure writes an audit
    event. No HTTP route added (service-layer only, matching
    STORY-005/006/007's scope note).
  - Verification: `tsc --noEmit` clean across the backend. `npx jest`:
    157/157 passing across 18 suites (up from 151/17 before this story — 6
    new tests in `meetingSummaryService.test.ts`: a happy path with a full
    `MeetingContext` populating all seven fields, missing information (no
    context, no attendees, an unknown physical location) flagging exactly
    `title`/`platformOrLocation`/`attendees`/`objective` in `missingFields`
    (`date`/`time` still resolve from `ingestedAt`), an unparseable
    timestamp flagging `date`/`time` too rather than shipping a bad value,
    malformed input (`attendees` not an array) throwing
    `ContractViolationError`, idempotency on repeat `transcript.id`, and an
    audit-trail trust test using real `console.log`/`console.error` spies
    asserting distinct `auditEventId`s across a success and a failure).
  - Notes: The "summary generation timeout" failure path is real,
    reachable code (`SummaryGenerationTimeoutError`, wired through
    `withTimeoutAndRetry`), but not independently testable today: assembly
    is purely synchronous with no `await`, so its wrapping promise always
    settles in a microtask before `withTimeoutAndRetry`'s timer (a
    macrotask) can ever fire. Documented in the test file rather than faked
    with a test that wouldn't actually exercise the path — same honesty
    call STORY-007 made for its untuned confidence thresholds. Also worth
    flagging: this session found `.colaberry/progress.json` had STORY-008's
    three criteria already flipped to `passed: true` in the uncommitted
    working tree (HEAD still had `false`) before any code existed for this
    story — same stale-flag pattern STORY-006/007's entries called out,
    here as an uncommitted edit rather than a committed one.
    `.colaberry/progress.json` is corrected in the follow-up verification
    commit to reflect the real verification above, superseding that
    pre-existing edit rather than silently trusting it.

- [x] STORY-009 — Summarize key discussion points
  - Date: 2026-08-28
  - Session: CC-20260828-rtcn
  - What changed: Added `backend/src/services/discussionSummary/` —
    `types.ts` (`RawTopicSegment`, `TopicSummarizationClient`/
    `TopicSummarizationInput` provider seam, `DiscussionTopic`,
    `DiscussionSummary`, `SummarizeDiscussionInput`), `errors.ts`
    (`DiscussionSummaryError` base, `ContractViolationError`,
    `IncorrectTopicGroupingError`, `TopicSummarizationFailedError`),
    `auditLog.ts` (parallel to `meetingSummary/auditLog.ts`, tagged
    `service: 'discussionSummary'`), and `discussionSummaryService.ts`'s
    `summarizeDiscussionPoints()`. Implemented REQ-009 with an injectable
    `TopicSummarizationClient` provider seam — the same governance
    boundary STORY-005 drew for `TranscriptionClient` and STORY-006 drew
    for `DiarizationClient` — since real topic grouping/summarization
    needs actual NLP, not a heuristic, and wiring a paid external service
    is a CLAUDE.md escalation trigger outside this story's scope. Built
    on STORY-007's `MarkedTranscript` (not a raw `Transcript`), so the
    review-flagging criterion reuses existing `audibility` marking
    instead of re-deriving it: `buildTopics()` assigns each segment to
    its containing topic range by start time, then flags a topic for
    review whenever any of its segments have `audibility !== 'clear'`,
    collecting their markers into `flagReasons`. Before the provider's
    response is trusted, `validateTopicCoverage()` confirms the returned
    ranges start at the transcript's first segment, end at its last, and
    are contiguous with no gap or overlap between consecutive
    topics — this validation *is* the "incorrect topic grouping" failure
    path, not just a shape check. Three failure paths, each with its own
    error class: `ContractViolationError` (discussion point extraction
    failure — missing transcript id, non-array/empty segments, invalid
    segment text/timestamps), `IncorrectTopicGroupingError` (provider
    succeeded but returned invalid coverage), `TopicSummarizationFailedError`
    (provider failed or timed out after exhausting retries — no heuristic
    fallback exists, same as `DiarizationFailedError`'s precedent). Fixed
    a real bug found while writing the trust test: `validateInput()` was
    originally called before the attempt log and outside the try/catch,
    so a malformed-input failure never reached the audit trail,
    contradicting the story's own Trust criterion — moved validation
    inside the try block (best-effort `transcriptId` extracted first for
    logging/dedup only, matching `meetingSummaryService.ts`'s precedent)
    so every failure, not just successes, is now audited. Dedupes on
    `transcript.id`. No HTTP route added (service-layer only, matching
    STORY-005/006/007/008's scope note).
  - Verification: `tsc --noEmit` clean across the backend. `npx jest`:
    164/164 passing across 19 suites (up from 157/18 before this story —
    7 new tests in `discussionSummaryService.test.ts`: happy path
    grouping discussion points by topic with timestamp ranges, an
    unclear segment flagging its containing topic for review while a
    fully-clear topic is not flagged, extraction failure on non-array
    segments throwing `ContractViolationError`, incorrect topic grouping
    on a gapped range throwing `IncorrectTopicGroupingError`, a provider
    timeout exhausting retries and throwing
    `TopicSummarizationFailedError`, idempotency on repeat
    `transcript.id`, and an audit-trail trust test using real
    `console.log`/`console.error` spies asserting distinct
    `auditEventId`s across a success and a (now-audited) extraction
    failure).
  - Notes: Confidence 65% — same class of limitation as STORY-005/006:
    `TopicSummarizationClient` has no real implementation, so the
    coverage-validation logic (order/contiguity/full-span checks) is
    only proven against synthetic fixtures, not a real provider's actual
    response shape. A real summarization provider might not naturally
    return clean, non-overlapping topic ranges (e.g. multiple topics
    genuinely active in the same time window, or per-utterance topic
    tags rather than contiguous ranges), which could force a redesign of
    the validation contract once a real provider is chosen — this is an
    honest design-risk flag, not a hidden gap. What would raise
    confidence: a real topic-summarization/LLM provider integration to
    validate the `RawTopicSegment` shape against reality. Not yet
    committed — commit is the next step, with a message naming
    STORY-009.

- [x] STORY-010 — List decisions made with rationale and approver
  - Date: 2026-08-29
  - Session: CC-20260829-w4k7
  - What changed: Added `backend/src/services/decisionExtraction/` —
    `types.ts` (`RawDecision`, `DecisionExtractionInput`,
    `DecisionExtractionClient` provider seam, `Decision` with
    `missingFields`/`flaggedForReview`, `DecisionListing`,
    `ListDecisionsInput`), `errors.ts` (`DecisionExtractionError` base,
    `ContractViolationError`, `IncorrectDecisionListingError`,
    `DecisionExtractionFailedError`), `auditLog.ts` (parallel to
    `discussionSummary/auditLog.ts`, tagged `service:
    'decisionExtraction'`), and `decisionExtractionService.ts`'s
    `listDecisions()`. Implemented REQ-010 with an injectable
    `DecisionExtractionClient` provider seam — the same governance
    boundary STORY-005/006 drew for `TranscriptionClient`/
    `DiarizationClient` and STORY-009 drew for
    `TopicSummarizationClient` — since real decision extraction needs
    actual NLP, not a heuristic, and wiring a paid external service is a
    CLAUDE.md escalation trigger outside this story's scope. Built on
    STORY-007's `MarkedTranscript`. Three failure paths, mapped to the
    story's three named ones: `ContractViolationError` (decision
    extraction failure at the input boundary — missing transcript id,
    non-array/empty segments, invalid segment text/timestamps),
    `IncorrectDecisionListingError` (incorrect decision listing —
    provider response not an array, a decision missing its label, or a
    timestamp outside the transcript's own segment span),
    `DecisionExtractionFailedError` (decision extraction failure at the
    provider boundary — provider fails or times out after exhausting
    retries, no heuristic fallback exists, same seam STORY-005/006/009
    left open). The "missing decision fields" path is handled
    differently from the other two: rather than throwing, a decision
    missing rationale/approver/timestamp is listed anyway with those
    gaps named in `missingFields` and `flaggedForReview` set true —
    satisfying the acceptance criterion literally ("flag the missing
    fields for review") without dropping the decision from the minutes.
    Dedupes on `transcript.id`. No HTTP route added (service-layer only,
    matching STORY-005/006/008/009's scope note).
  - Verification: `tsc --noEmit` clean across the backend. `npx jest`:
    171/171 passing across 20 suites (up from 164/19 before this story —
    7 new tests in `decisionExtractionService.test.ts`: happy path with
    a complete decision, missing-fields flagging without rejection,
    `ContractViolationError` on non-array segments,
    `IncorrectDecisionListingError` on an out-of-range timestamp,
    `DecisionExtractionFailedError` after a hanging provider exhausts
    retries, idempotency on repeat `transcriptId`, and an audit-trail
    trust test using real `console.log`/`console.error` spies asserting
    distinct `auditEventId`s across a success and a failure).
  - Notes: Confidence 65% — same class of limitation as
    STORY-005/006/009: `DecisionExtractionClient` has no real
    implementation, so the structural validation (array shape,
    timestamp-in-range) is only proven against synthetic fixtures, not a
    real NLP/LLM provider's actual response shape. A real provider might
    not naturally return a clean array of decision objects (e.g.
    decisions embedded in free text needing a separate parse step),
    which could force a redesign of the validation contract once a real
    provider is chosen. What would raise confidence: a real
    decision-extraction/LLM provider integration to validate
    `RawDecision` against reality, plus product input on whether
    "missing fields flagged but still listed" vs "excluded until
    reviewer fills gaps" is the right UX for the minutes document. Not
    yet committed — commit is the next step, with a message naming
    STORY-010.

- [x] STORY-011 — Extract action items into a table format
  - Date: 2026-08-29
  - Session: CC-20260829-t8qz
  - What changed: Added `backend/src/services/actionItemExtraction/` —
    `types.ts` (`RawActionItem`, `ActionItemExtractionClient` provider
    seam, `ActionItem` with `missingFields`/`flaggedForReview`,
    `ActionItemTable`, `ExtractActionItemsInput`), `errors.ts`
    (`ActionItemExtractionError` base, `ContractViolationError`,
    `IncorrectActionItemExtractionError`,
    `ActionItemExtractionFailedError`), `auditLog.ts` (parallel to
    `decisionExtraction/auditLog.ts`, tagged `service:
    'actionItemExtraction'`), and `actionItemExtractionService.ts`'s
    `extractActionItems()`. Implemented REQ-011 with an injectable
    `ActionItemExtractionClient` provider seam — the same governance
    boundary STORY-005/006 drew for `TranscriptionClient`/
    `DiarizationClient` and STORY-009/010 drew for
    `TopicSummarizationClient`/`DecisionExtractionClient`, since real
    action-item extraction needs actual NLP, not a heuristic, and wiring
    a paid external service is a CLAUDE.md escalation trigger outside
    this story's scope. Built on STORY-007's `MarkedTranscript`, reused
    rather than rebuilt. Three failure paths, mapped to the story's three
    named ones: `ContractViolationError` (missing action item fields at
    the input boundary — missing transcript id, non-array/empty
    segments, invalid segment text/timestamps), and note this is
    distinct from a single item's own missing owner/dueDate/priority/
    status, which is handled by flagging, not throwing (see below);
    `IncorrectActionItemExtractionError` (incorrect action item
    extraction — provider response not an array, an item missing its
    task text, an unrecognized `priority`/`status` enum value, or a
    `sourceTimestampMs` outside the transcript's own segment span — this
    last check is a new validation beyond STORY-010's precedent, since
    `RawDecision` had no enum fields to validate);
    `ActionItemExtractionFailedError` (action item extraction failure at
    the provider boundary — provider fails or times out after exhausting
    retries, no heuristic fallback exists, same seam
    STORY-005/006/009/010 left open). A decision item missing
    owner/dueDate/priority/status/sourceTimestampMs is listed anyway with
    those gaps named in `missingFields` and `flaggedForReview` set true —
    satisfying "flag unclear action items for review" without dropping
    the item from the minutes, same pattern STORY-010 set for decisions.
    Dedupes on `transcript.id`. No HTTP route added (service-layer only,
    matching STORY-005/006/008/009/010's scope note).
  - Verification: `tsc --noEmit` clean across the backend. `npx jest`:
    179/179 passing across 21 suites (up from 171/20 before this story —
    8 new tests in `actionItemExtractionService.test.ts`: happy path with
    a complete action item, missing-fields flagging without rejection,
    `ContractViolationError` on non-array segments,
    `IncorrectActionItemExtractionError` on an out-of-range timestamp,
    `IncorrectActionItemExtractionError` on an unrecognized priority
    value (new case beyond STORY-010's precedent),
    `ActionItemExtractionFailedError` after a hanging provider exhausts
    retries, idempotency on repeat `transcriptId`, and an audit-trail
    trust test using real `console.log`/`console.error` spies asserting
    distinct `auditEventId`s across a success and a failure). Corrected
    `.colaberry/progress.json`'s STORY-011 criteria in this same commit:
    they had been pre-marked `passed: true` in the uncommitted working
    tree before any code for this story existed — same stale-flag pattern
    STORY-006/007/008 already called out — flagged to the user at session
    start rather than trusted, now replaced with the real verification
    above.
  - Notes: Confidence 65% — same class of limitation as
    STORY-005/006/009/010: `ActionItemExtractionClient` has no real
    implementation, so the structural validation (array shape, enum
    values, timestamp-in-range) is only proven against synthetic
    fixtures, not a real NLP/LLM provider's actual response shape. A real
    provider might return priority/status vocabulary that doesn't match
    the three/three enum values assumed here (an implementation-level
    choice made and logged at the start of this session, not yet
    confirmed against any real usage), which could force either a looser
    validation contract or a normalization step once a real provider is
    chosen. What would raise confidence: a real action-item-extraction/
    LLM provider integration to validate `RawActionItem` against reality,
    plus product input on whether the assumed priority/status vocabulary
    matches what PMs actually expect in the minutes table. Not yet
    committed — commit is the next step, with a message naming
    STORY-011.

- [x] STORY-019 — Propose next meeting date/time and carry over open items
  - Date: 2026-08-29
  - Session: CC-20260829-m3vq
  - What changed: Added `backend/src/services/nextMeetingProposal/`
    (`types.ts`, `errors.ts`, `auditLog.ts`,
    `nextMeetingProposalService.ts`) implementing REQ-012. Before writing
    code, found and flagged a genuine conflict between two authoritative
    sources for this story: REQ-012's literal wording and `plan.json`'s
    stored acceptance say to propose a next-meeting date/time only when
    one is mentioned in the transcript, with open-item carry-over as a
    separate always-on behavior for recurring meetings; this task's brief
    and `progress.json`'s tracked criteria instead say to propose
    whenever the concluded meeting has open items, with no
    transcript-mention condition at all. These don't reconcile as one
    rule. Asked the user; they chose the open-items-driven rule, which is
    what's built. `progress.json`'s STORY-019 block already matched that
    rule; `plan.json`'s stored acceptance text was left untouched (not
    confirmed as this repo's file to edit) — worth reconciling later if
    the portal treats `plan.json` as authoritative. "Open item" reuses
    `actionItemExtraction`'s `ActionItem` type; an item counts as open
    unless `status` is exactly `'done'` (a missing status — STORY-011's
    own "flagged for review" case — is treated as still open, not assumed
    done). The proposed date/time is a documented placeholder heuristic
    (`concludedAt + 7 days`) — a real scheduling algorithm would need a
    calendar integration, an external dependency outside this story's
    scope. Unlike STORY-005/006/009/010/011, no injectable provider seam
    was needed: the decision is pure, deterministic logic over data the
    caller already has, so the only failure path is malformed input
    (`ContractViolationError`), same scope call STORY-007's
    `segmentMarkingService` made for skipping `withTimeoutAndRetry`.
    Every attempt, dedup hit, proposal, and no-proposal decision writes
    an audit event.
  - Verification: `tsc --noEmit` clean across the backend. `npx jest`:
    188/188 passing across 22 suites (up from 179/21 before this story —
    9 new tests in `nextMeetingProposalService.test.ts`: happy path
    proposing one week out and carrying items over, no-open-items path
    proposing nothing, an item with no status still counting as open, a
    `'done'` item excluded from carry-over, `ContractViolationError` on a
    missing `meetingId`/unparseable `concludedAt`/an item missing `task`
    text, idempotency on repeat `meetingId`, and an audit-trail trust
    test using real `console.log`/`console.error` spies asserting
    distinct `auditEventId`s and that `proposedDateTime`/`carriedOverItems`
    land in the log context).
  - Notes: Confidence 80%. Both acceptance-criteria directions and the
    Trust criterion pass exactly as tracked in `progress.json`. What
    would raise confidence: product confirmation that `plan.json`'s
    divergent acceptance text for this story should be updated to match
    (rather than the two files quietly disagreeing going forward), and
    real usage data on whether "+7 days" is a sensible default interval
    versus something meeting-cadence-aware. Not yet committed — commit is
    the next step, with a message naming STORY-019.

- [x] Scaffold the `meeting-assistant` MCP server and add its first tool, `search_action_items`
  - Date: 2026-08-29
  - Session: CC-20260829-r4kx
  - What changed: Catch-up entry — this work was done across two sessions
    (toolchain check + scaffold on 2026-08-27, the tool on 2026-08-29)
    without a PROGRESS.md entry along the way; logging it now per the
    catch-up rule. Verified the local toolchain (Python 3.14.6, Node
    v24.19.0, uv 0.12.5 — all already present, nothing installed). Scaffolded
    a new uv-managed project at `meeting-assistant/` (separate from the
    Node/TS `backend/` — this is a standalone Python MCP server) with
    `mcp[cli]>=2.1.0`. The installed SDK (v2.1.1) has fully renamed
    `FastMCP` → `MCPServer` with no back-compat alias, so `server.py` uses
    `MCPServer("meeting-assistant")` on the stdio transport, matching the
    same SDK version already in use by the pre-existing
    `order-status-lookup/` sibling project. Removed a stale
    `[project.scripts]` entry `uv init` left pointing at a deleted `src/`
    package, and set `[tool.uv] package = false` since this is a script,
    not a distributable package (the same latent defect is still present,
    untouched, in `order-status-lookup/pyproject.toml`). Added
    `meeting-assistant/uv.toml` (`system-certs = true`) to work around this
    machine's TLS-interception breaking `uv`'s PyPI fetches — same root
    cause as the 2026-08-09 git-push cert fix, this time for `uv`. Verified
    the bare server boots clean (no output/traceback) and connects via the
    MCP Inspector (`uv run mcp dev server.py`); one snag along the way — a
    stray Inspector `node.exe` from an earlier run had squatted on port
    6274, causing `PORT IS IN USE` on relaunch, found via
    `Get-NetTCPConnection`/`Stop-Process` and cleared.
    Added the server's first tool, `search_action_items` (`owner:
    str|None` [min_length=1, max_length=100], `status:
    Literal["open","in_progress","done"]|None`, `limit: int` [ge=1, le=20,
    default=5]), matching the real `ActionItem` contract already defined
    in `backend/src/services/actionItemExtraction/types.ts` (STORY-011)
    rather than the architecture doc's aspirational Stale/Carried-over
    status language, which isn't implemented in code. That backend service
    has no queryable/persisted data (in-memory `Map` only, no extraction
    provider wired), so — per explicit instruction — generated a small
    realistic sample dataset at `meeting-assistant/data/action_items.json`
    (8 action items across 4 meetings drawn from this project's own
    storyline: the STORY-018 audit-trail task, the Acme Corp onboarding/
    check-in thread, STORY-004/006 references) for the tool to read from.
    Returns a structured dict (`count` + `items`, never a formatted
    paragraph) and a structured empty result with a `message` on a miss,
    rather than raising.
  - Verification: `uv run python -c "import server; ..."` confirmed the
    module imports cleanly and the tool is directly callable:
    `owner="Priya"` returns `count: 3` with the 3 expected items;
    `owner="Praya"` (a deliberate misspelling — raised after the user
    pasted a result that couldn't have come from that input) correctly
    returns `count: 0` with the empty-result message, confirming the
    substring-match filter behaves as coded, not as mis-typed into the
    Inspector's UI. Also verified live through the MCP Inspector: the tool
    appears in the Tools list after reconnecting, and calling it with
    `owner: "Priya"` via the Inspector's generated form logged
    `TOOLS/CALL` in the protocol pane with status `OK` and the exact
    expected JSON.
  - Notes: Bare server plus this one tool — no resources or prompts yet,
    per explicit instruction. A "primitive map" the user referenced as
    "agreed earlier in this session" was not actually present in this
    session's context (not in conversation history, not in memory, not in
    `project-blueprint/meeting-assistant-architecture.md`); flagged this
    directly rather than guessing, and had the user pick from candidate
    tools grounded in the real architecture doc — they chose
    `search_action_items`. Not yet committed.

- [x] Verify `search_action_items` live via the MCP Inspector (CP1 gate) and add a second tool, `get_meeting_summary`
  - Date: 2026-08-29
  - Session: CC-20260829-r4kx
  - What changed: Relaunched the MCP Inspector against `meeting-assistant/server.py`
    after a stray `node.exe` from an earlier run was found squatting on port 6274
    (`Get-NetTCPConnection`/`Stop-Process`, same pattern as before) and walked the
    user through the CP1 gate hands-on rather than clicking through it myself: which
    tab to open, what the tool should be listed as, and where the input schema
    (owner min/max length, status enum dropdown, limit number spinner) should show up
    in the generated form. The user reported one real anomaly along the way — the
    tool's description rendered as just "why." (the literal last word of the
    docstring) instead of the full approved text — flagged as a genuine Inspector
    rendering discrepancy rather than agreed with; it did not reproduce on the next
    screenshot, left open as something to watch for rather than chased down further
    tonight. Confirmed both the happy path (`owner: "Marcus"` → 3 correct, structured
    results including the one item with `dueDate`/`priority` null and
    `flaggedForReview: true`) and the CP1 boundary (`owner: ""`, an explicit empty
    string) live in the browser: Pydantic rejected it with `string_too_short` before
    the function body ran, traced to the `min_length=1` constraint on `owner`,
    confirming the schema-validation layer — not a try/except in the tool body — is
    what enforces that boundary.
    Then added a second tool, `get_meeting_summary(meeting_id: str, min_length=1,
    max_length=100)`, matching the real `MeetingSummary`
    (`backend/src/services/meetingSummary/types.ts` — title/date/time/format/
    platformOrLocation/attendees/objective/`missingFields`) and `DiscussionTopic`
    (`backend/src/services/discussionSummary/types.ts` — topic/summary/
    `flaggedForReview`) contracts, both real backend services with no persisted or
    queryable data (same in-memory-only situation `search_action_items` hit).
    Generated `meeting-assistant/data/meeting_summaries.json`, deliberately reusing
    the same 4 meeting ids already in `action_items.json` (`mtg-2026-08-11-roadmap`,
    `mtg-2026-08-19-acme-onboarding`, `mtg-2026-08-22-eng-standup`,
    `mtg-2026-08-25-acme-checkin`) so the two sample datasets describe one consistent
    set of meetings rather than disjointed fake data; two entries deliberately carry
    non-empty `missingFields` (one missing `time`/`objective`, one missing
    `platformOrLocation`) to exercise that field honestly, matching the real type's
    "flagged, not guessed" contract. Unlike `search_action_items` (a multi-field
    filter search), this tool is a single-id direct lookup — one required parameter,
    no default — returning `found: true` + the summary, or `found: false` + a
    `message` on a miss, never raising for a normal no-match.
  - Verification: `uv run python -c "import server; ..."` confirmed
    `get_meeting_summary(meeting_id="mtg-2026-08-19-acme-onboarding")` returns the
    exact expected summary (including both `missingFields` and the one
    `flaggedForReview: true` topic), and `meeting_id="mtg-does-not-exist"` returns
    `found: false` with a clear message rather than raising. Not yet re-verified live
    through the Inspector — that's the next step in the conversation, not done as of
    this entry.
  - Notes: Two tools now (`search_action_items`, `get_meeting_summary`), still no
    resources or prompts. Not yet committed.

- [x] Verify `get_meeting_summary` live via the Inspector, then add the server's first resource + resource template
  - Date: 2026-08-29
  - Session: CC-20260829-r4kx
  - What changed: Reconnected the Inspector after editing `server.py` (same
    respawn-on-reconnect pattern as the first tool) and walked the user
    through the CP1 gate for `get_meeting_summary`: both tools listed
    correctly, the input schema showed `Meeting Id` as required (red `*`,
    `Execute Tool` disabled until filled — confirming the SDK correctly
    marked it non-optional, unlike the all-optional `search_action_items`
    params), and — notably — the tool's full docstring rendered correctly
    this time, with no repeat of the earlier "why."-truncation glitch, so
    that appears to have been transient rather than a real bug. Verified the
    happy path (`meeting_id: "mtg-2026-08-25-acme-checkin"` → exact expected
    JSON) and the miss path live: a well-formed but non-existent id returned
    a clean `status: OK` with `{"found": false, "message": "..."}` — no
    error banner — explicitly contrasted against the schema-violation error
    seen in the previous session's `owner: ""` test, to make the point that
    a valid-input miss and an invalid-input rejection are different failure
    classes handled at different layers (tool body vs. Pydantic schema).
    Then added the server's first resource plus its first resource
    template, since a plain tool wasn't what was asked for this time. Before
    writing anything, read the installed SDK's actual source
    (`mcp/server/mcpserver/server.py`'s `resource()` decorator and
    `mcp/server/mcpserver/exceptions.py`) rather than assuming API shape —
    confirmed `@mcp.resource(uri, mime_type=...)`, that a `{param}` in the
    URI auto-registers a template whose function parameter must match the
    `{param}` name exactly, and that the idiomatic miss-handling for a
    resource is to raise `ResourceNotFoundError` (a real `-32602`
    protocol-level error), deliberately different from how the tools handle
    a miss (a structured `found: false`/`count: 0` return) — resources are
    addressed by URI, so a URI that doesn't resolve is a 404-style protocol
    error, not a semantically-empty success. Added `meetings://catalog`
    (static resource, `list_meetings_catalog()`, `mime_type=
    "application/json"`, a lightweight index of all 4 meetings — id, title,
    date, format) and `meetings://{meeting_id}` (template,
    `get_meeting_resource(meeting_id)`, same MIME type, full summary for one
    meeting, raising `ResourceNotFoundError` on a miss). Both read-only —
    each only opens `data/meeting_summaries.json`, no writes, no mutation, so
    neither should have been a tool. The `meetings://` scheme names the
    actual domain (meeting records), matching the `docs://`/`crm://`-style
    convention the user specified.
  - Verification: `uv run python -c "import server; ..."` confirmed all
    three behaviors directly: the catalog returns all 4 meetings with the
    right fields; `get_meeting_resource("mtg-2026-08-22-eng-standup")`
    returns the exact full summary; `get_meeting_resource("mtg-does-not-
    exist")` raises `ResourceNotFoundError` rather than returning a value.
    Also called `await server.mcp.list_resources()` /
    `list_resource_templates()` directly to confirm the SDK registered the
    URI and `mime_type` exactly as intended on both. Then verified live
    through the Inspector: `meetings://catalog` read back the 4-meeting
    index with `application/json` shown as its MIME type in the UI; the
    left panel correctly split the two into separate **URIs (1)** /
    **Templates (1)** sections, itself confirming the SDK registered them as
    the two different primitive kinds intended; `get_meeting_resource`
    resolved `{meeting_id}` correctly for a real id
    (`mtg-2026-08-19-acme-onboarding`) and returned the exact expected JSON;
    and the miss case (`mtg-does-not-exist`) surfaced as a red "Read Error:
    No meeting found with id 'mtg-does-not-exist'." in the Inspector — a
    protocol-level read failure, not a JSON body, confirming the
    `ResourceNotFoundError` design decision behaves correctly end-to-end,
    not just in isolated Python calls.
  - Notes: Server now has two tools (`search_action_items`,
    `get_meeting_summary`) and one resource + one resource template
    (`meetings://catalog`, `meetings://{meeting_id}`); no prompts yet. Not
    yet committed.

- [x] Commit the meeting-assistant work, then add the server's first prompt, `meeting_recap`
  - Date: 2026-08-29
  - Session: CC-20260829-r4kx
  - What changed: Committed everything built so far in `meeting-assistant/`
    (commit `1735c06`) — first checked `git status`, found no `.venv/` rule
    in the root `.gitignore` (would have staged the entire virtual
    environment), added one, then staged only the intended files by
    explicit path (`.gitignore`, `PROGRESS.md`, and the 8 real
    `meeting-assistant/` files) rather than `git add -A`, leaving the
    pre-existing untracked `UXDesigner_FieldGuide.html` alone since it
    isn't this session's work. Confirmed against `order-status-lookup/`'s
    own git history (6 tracked files, no `.venv`) that this matches the
    existing convention for these standalone Python MCP projects. Left the
    commit unpushed at the user's request (`main` is 1 ahead of
    `origin/main`).
    Then added the server's third primitive type, a prompt:
    `meeting_recap(meeting_id: str, owner_filter: str | None = None)`.
    Before writing it, searched the repo for a real "tested prompt" per the
    user's instruction to reuse existing wording rather than invent new
    phrasing — found `prompts/meeting_prompt_1.txt.txt` and
    `prompts/meeting_prompt_2.txt.txt` (confirmed byte-identical via `diff`,
    both already tracked in git) and used that exact wording ("You are an
    AI meeting assistant responsible for turning raw audio from virtual or
    physical meetings into accurate transcripts, structured minutes,
    tracked action items, and participant-specific email distribution.
    Please summarize the key points discussed in the meeting.") as the
    prompt's opening framing, told the user which file it came from. Read
    the installed SDK's actual `prompt()` decorator source
    (`mcp/server/mcpserver/server.py`) before writing anything, confirming
    `@mcp.prompt()` takes no required arguments itself — the function's own
    parameters become the prompt's arguments — and that the return type can
    be plain text or a `list[Message]` for multi-turn; added a comment
    noting the latter option per the user's explicit ask. `meeting_id` has
    no sensible default (required); `owner_filter` defaults to `None`
    ("every owner"), the one argument with a real default. The generated
    text encodes the full workflow: read `meetings://{meeting_id}` for the
    meeting's summary/topics, call `search_action_items` (with the owner
    filter if given) and keep only items whose `meetingTitle` matches, then
    produce a recap — with explicit instructions for both miss cases (no
    such meeting id → say so, stop, don't fabricate; meeting exists but no
    matching action items → say so rather than inventing any), matching the
    project's own no-fabrication rule from the architecture doc.
  - Verification: `uv run python -c "import server; print(server.
    meeting_recap(...))"` confirmed the template expands correctly with
    real arguments. A raw terminal print of the expanded text showed a
    garbled character where the em dash should be; rather than assume it
    was fine, read the file's raw bytes directly and confirmed
    `\xe2\x80\x94` (a correct UTF-8 em dash) — the garbling was this
    terminal's console codepage mangling `print()` output, not real
    corruption in `server.py` (worth checking explicitly given this
    project's own 2026-08-17 entry describes a real instance of exactly
    this class of encoding bug). Then verified live through the Inspector:
    the `Prompts` tab listed `meeting_recap`, and rendering it caught a
    genuine user-input typo on the first two attempts (`meeting_id` typed
    with a double dash, `mtg-2026-08--19-acme-onboarding`, not a real id) —
    flagged plainly rather than treated as a pass, walked the user through
    retyping it, and the corrected render matched the direct-Python
    expansion exactly: correct resource URI, `owner="Priya"` carried
    through to step 2, tested wording and the no-fabrication instructions
    all intact.
  - Notes: Server now has all three MCP primitive types — two tools, one
    resource + template, one prompt — every one verified live through the
    Inspector, not just in isolated Python calls. This new prompt work is
    not yet committed (the commit above only covers what existed before
    this entry); committing it is the natural next step if the user asks.

- [x] STORY-012 — Implement mandatory review gate before email drafting
  - Date: 2026-08-29
  - Session: CC-20260829-p8w3
  - What changed: Added `backend/src/services/reviewGate/` — Gate #1 from
    `project-blueprint/meeting-assistant-architecture.md` ("no AI/LLM step is
    allowed to run past Gate #1 ... unsupervised"), built as a paced,
    one-step-at-a-time session per the story brief. `types.ts` defines
    `DraftMinutes` (an aggregate of the already-built `MeetingSummary` +
    `DiscussionTopic[]` + `Decision[]` + `ActionItem[]` from STORY-008/009/
    010/011, not re-derived), `ReviewGateStatus` (`pending_review` |
    `approved` — deliberately no separate "revision requested" state, since
    the acceptance criteria describe receiving edits and re-presenting the
    draft as one action), `ReviewGateSession`, and `RevisionRecord` for
    audit history. `errors.ts` adds `ContractViolationError`,
    `SessionNotFoundError`, `SessionAlreadyApprovedError`, and
    `ReviewNotApprovedError`. `auditLog.ts` mirrors every other service's
    `recordAuditEvent()`, tagged `service: 'reviewGate'`.
    `reviewGateService.ts` implements four functions: `submitForReview`
    (opens a session, idempotent on `transcriptId` while pending, rejects
    resubmission after approval rather than silently reopening the gate),
    `requestRevision` (validates the revised draft matches the session's
    transcript, records a `RevisionRecord`, and puts the session straight
    back into `pending_review`), `approve` (records who approved and when;
    rejects a second approval), and `assertApprovedForEmailDrafting` — the
    actual seam STORY-013 (email drafting, not built yet, per the brief's
    "leave room, don't build it now") must call before running; it throws
    unless an explicit `approve()` already happened, making "failure to
    wait for approval" structurally impossible rather than merely
    documented. Sessions live in an in-memory `Map`, same
    `TODO(pre-persistence)` convention every other service in this project
    already carries. No HTTP route added, matching the service-layer-only
    convention established since STORY-005.
  - Verification: `tsc --noEmit` clean across the backend. `npx jest`:
    206/206 passing across 23 suites (up from 188/22 before this story — 18
    new tests in `reviewGateService.test.ts`), covering all three
    acceptance criteria directly: (1) happy path — draft minutes submitted
    reach `pending_review` and require an explicit `approve()` before
    `assertApprovedForEmailDrafting` will return normally; (2) requested
    edits — `requestRevision` swaps in the revised draft, appends to
    `revisions`, and returns the session to `pending_review`, with separate
    tests for a revision against the wrong transcript id and a revision
    attempted on an already-approved session; (3) Trust — a real
    (non-mocked) `console.log`/`console.error` spy test asserts a
    `review_submitted` and a `review_approved` entry, plus a blocked
    `gate_check_blocked` entry (`outcome: 'failure'`,
    `error_class: 'SessionNotFoundError'`) for a gate-check against a
    session that was never submitted — all with distinct `auditEventId`s.
    The three named failure paths are each covered directly: "failure to
    wait for approval" (`ReviewNotApprovedError` on a still-pending session,
    `SessionNotFoundError` on one never submitted), "incorrect handling of
    requested edits" (wrong-transcript revision, empty `changesRequested`,
    revision on an approved session all rejected), and "review gate logic
    failure" (double-approve, approve/revise on a nonexistent session,
    missing `approvedBy`, resubmitting an approved session all rejected
    with typed errors, none silently swallowed).
  - Notes: Confidence 85%. This is a genuine walking skeleton for Gate #1:
    the mechanism is real and fully tested, but nothing calls it yet — 
    STORY-013 (email drafting) doesn't exist, so `assertApprovedForEmailDrafting`
    is a seam with no caller in production code, only in tests. What would
    raise confidence: seeing STORY-013 actually call this function and a
    test proving it refuses to draft an email when the gate throws. Also
    flagged directly to the user this session: the task brief's "workspace
    repo not provisioned yet" framing didn't match reality — this repo
    already has 9 built-out backend services through STORY-019 — so this
    story was built against the real, existing `backend/` codebase and its
    established per-service pattern (`types.ts`/`errors.ts`/`auditLog.ts`/
    `<name>Service.ts`) rather than a fresh scaffold. Two pre-existing
    uncommitted files (`meeting-assistant/server.py`,
    `UXDesigner_FieldGuide.html`) were left untouched — not part of this
    story.

- [x] STORY-013 — Draft individualized emails for participants
  - Date: 2026-08-29
  - Session: CC-20260829-q7t2
  - What changed: Added `backend/src/services/emailDrafting/` (`types.ts`,
    `errors.ts`, `auditLog.ts`, `emailDraftingService.ts`,
    `emailDraftingService.test.ts`), implementing `draftEmails()` (REQ-014).
    Built as a paced, one-step-at-a-time session per the story brief,
    following the exact per-service pattern every prior story in this tree
    has used since STORY-005. `draftEmails()` calls reviewGate's
    `assertApprovedForEmailDrafting` (the seam STORY-012 built specifically
    for this story) before drafting anything — `SessionNotFoundError`/
    `ReviewNotApprovedError` propagate unchanged rather than being
    re-wrapped, since those are already the correctly-typed "failure to
    wait for approval" errors. For each name in the approved draft's
    `meetingSummary.attendees`, it builds one `DraftedEmail` containing the
    shared discussion topics and decisions plus only that attendee's own
    action items (case-insensitive `owner` match, the same matching
    convention the meeting-assistant MCP server's `search_action_items`
    tool already uses) — or the exact required sentence, "No action items
    assigned to you from this meeting.", when they have none. An action
    item whose `owner` matches no attendee (a typo, someone off the
    attendee list) is not attached to any email; it is surfaced in a
    batch-level `unmatchedActionItems` list with `flaggedForReview: true`
    rather than silently dropped or misattached — this is the story's
    "incorrect email personalization" failure path made structurally
    explicit. An approved draft with zero attendees throws
    `EmailDraftingFailedError` (the "email drafting logic failure" /
    "failure to draft emails" paths) rather than silently returning an
    empty batch that looks like a successful run. No `recipientEmail`
    field exists on `DraftedEmail` — no `Attendee` record anywhere in this
    codebase carries an email address (see `diarization/types.ts`), so one
    wasn't invented; only drafting is in scope here, not delivery
    (STORY-014/015). No HTTP route added, matching the service-layer-only
    convention established since STORY-005.
  - Verification: `tsc --noEmit` clean across the backend. `npx jest`:
    215/215 passing across 24 suites (up from 206/23 before this story — 9
    new tests in `emailDraftingService.test.ts`), covering all three
    acceptance criteria directly: (1) happy path — an approved draft with
    action items for two different attendees produces two emails, each
    containing only its own attendee's task and never the other's; (2) the
    no-action-items participant gets the exact required sentence, verified
    with a literal string match, not a paraphrase check; (3) Trust — a
    fake-logger test asserts the `email_drafting_attempted` →
    `emails_drafted` event sequence, and a real (non-mocked)
    `console.error` spy test asserts a `email_drafting_failed` audit entry
    with `outcome: 'failure'` and `error_class: 'SessionNotFoundError'` for
    a gate-check against a session that was never submitted. The three
    named failure paths are each covered directly: "incorrect email
    personalization" (unmatched-owner-name case, asserted absent from both
    real attendees' emails and present in `unmatchedActionItems` with
    `flaggedForReview: true`), "failure to draft emails" (zero-attendee
    approved draft throws `EmailDraftingFailedError`; missing
    `reviewGateSessionId` throws `ContractViolationError`), and "email
    drafting logic failure" (both Gate #1 block paths — still-`pending_review`
    and never-submitted — propagate `ReviewNotApprovedError`/
    `SessionNotFoundError` unchanged, with no emails drafted).
  - Notes: Confidence 90%. `.colaberry/progress.json`'s STORY-013 block had
    all three `criteria[].passed` already pre-set to `true` before any code
    for this story existed — the same pre-existing stale-flag issue a prior
    session already caught and corrected for STORY-011 — flagged to the
    user at session start, now grounded in the real verification above
    rather than trusted as-is. What would raise confidence to higher:
    STORY-014 (Gate #2, mandatory review before sending) actually calling
    into this batch and a test proving *it* refuses to send past an
    unapproved `EmailDraftBatch`, the same way this story proved Gate #1
    can't be skipped. Also worth flagging: this service currently
    round-trips discussion topics/decisions into email body text as plain
    strings (no HTML/markdown rendering, no subject-line templating
    beyond the meeting title) — sufficient for this story's acceptance
    criteria, but a real "review the draft email" UI (Gate #2, STORY-014)
    will likely want a richer body shape than one flat string; not built
    here since the brief said to leave STORY-014 room, not build it.

## 2026-08-29 (3)

- [x] STORY-014: implement mandatory review gate before email sending
  - Date: 2026-08-29
  - Session: CC-20260829-n5xh
  - What changed: Added `backend/src/services/reviewGateSending/` — Gate #2
    from the architecture doc, mirroring Gate #1's shape 1:1 but keyed on
    `EmailDraftBatch` (STORY-013's output) instead of `DraftMinutes`.
    `types.ts` (`SendingReviewGateSession`, keyed on `EmailDraftBatch.id`,
    which is itself `== reviewGateSessionId` — confirmed against
    `emailDraftingService.ts:142,144`), `errors.ts` (`ContractViolationError`,
    `SessionNotFoundError`, `SessionAlreadyApprovedError`, and
    `SendingNotApprovedError` in place of Gate #1's `ReviewNotApprovedError`),
    `auditLog.ts` (`service: 'reviewGateSending'`, same structured-event
    shape as Gate #1's), and `reviewGateSendingService.ts` implementing
    `submitForReview`, `requestRevision`, `approve`, and the key seam
    `assertApprovedForSending` — the function a future Email Delivery
    Service (not built here; out of scope per the architecture doc, same
    way STORY-012 didn't build email drafting itself) must call before
    dispatching any mail, and which throws unless an explicit approval is
    on record. `requestRevision` applies a caller-supplied `revisedBatch`
    and moves the session straight back to `pending_review` in one action
    (no separate "revision requested" state), matching the story's
    "revise and re-present" acceptance criterion and Gate #1's precedent.
    `validateBatch` additionally rejects a batch with zero emails
    (boundary case — nothing to send for review).
  - Verification: `tsc --noEmit` clean. 19/19 new tests passing
    (`reviewGateSendingService.test.ts`), 234/234 total across 25 suites
    (was 215/215 before this story). Tests cover: happy path (submit →
    revise → re-present → approve), idempotency (re-submitting the same
    batch id while pending is a no-op; re-submitting after approval is
    rejected, not reopened), and all three story failure paths — "failure
    to wait for approval" (`assertApprovedForSending` throws
    `SendingNotApprovedError` while pending, `SessionNotFoundError` when
    never submitted), "incorrect handling of requested adjustments" (a
    revised batch for the wrong session throws `ContractViolationError`
    rather than silently attaching to the wrong session), and "review gate
    logic failure" (malformed input, missing session, already-approved
    session all fail loud on submit/revise/approve). The Trust criterion
    (logs review gate interactions and approvals) is verified directly:
    a test asserts `sending_review_submitted`, `sending_review_approved`,
    and a blocked `sending_gate_check_blocked` entry all appear in the
    audit trail with distinct `auditEventId`s and the correct
    `error_class`.
  - Notes: Confidence 90%. Scope was deliberately limited to the gate
    itself, not the not-yet-specified Email Delivery Service that will
    call `assertApprovedForSending` — matching STORY-012's precedent and
    the "leave room for it, do not build it now" instruction for
    STORY-015/016. What would raise confidence: a real caller (the
    delivery service, once specified) exercising `assertApprovedForSending`
    end-to-end against a live batch, and a decision on whether
    `requestRevision`'s caller-supplied `revisedBatch` should instead be
    produced by re-invoking `emailDrafting`'s `draftEmails()` internally —
    kept as caller-supplied here to match Gate #1's existing
    `requestRevision(revisedDraft)` convention exactly, but the
    architecture doc's "Gate #2 no → EmailDraft" arrow could also be read
    as this service owning that call itself.

- [x] STORY-015 — Log action items to tracker after email send confirmation
  - Date: 2026-08-29
  - Session: CC-20260829-j2vd
  - What changed: Added `backend/src/services/actionItemTracker/` (`types.ts`,
    `errors.ts`, `auditLog.ts`, `actionItemTrackerService.ts`), implementing
    the architecture doc's "Action Item Tracker" component (REQ-016). Built
    as a paced, one-step-at-a-time session per the story brief. Since the
    Email Delivery Service the architecture doc's "send confirmation" arrow
    comes from doesn't exist yet (out of scope, per STORY-014's own notes),
    `logActionItems()` accepts a caller-supplied `EmailSendConfirmation`
    (`sendingReviewGateSessionId`, `sentAt`, `confirmedRecipients`) and
    trusts nothing about "the emails were sent" beyond what Gate #2 itself
    already proved: it calls STORY-014's `assertApprovedForSending` first,
    and wraps whatever that throws (`SessionNotFoundError`/
    `SendingNotApprovedError`) into `SendConfirmationNotVerifiedError` rather
    than logging anyway — the same "reuse the existing gate as the trust
    boundary" pattern STORY-013 set for Gate #1. Every action item in the
    approved `EmailDraftBatch` is logged, not just the ones that reached a
    real attendee: both `email.actionItems` across every drafted email and
    `batch.unmatchedActionItems` are collected, each stamped
    `status: 'Not Started'` (a tracker-specific vocabulary, deliberately
    distinct from `ActionItem.status`, matching the architecture doc's
    "Not Started / Stale / Carried-over" language — this story only ever
    produces `'Not Started'`; the other two are STORY-016's concern, left
    untouched). Writes go through an injectable `ActionItemTrackerClient`
    provider seam (no real tracker — Jira/Asana/a DB — wired in yet, the
    same external-dependency governance boundary STORY-005/006/009/010/011
    drew for their own provider seams) wrapped in `withTimeoutAndRetry`
    (reused read-only from `audioIngestion`). One deliberate deviation from
    every prior provider-seam story: those all restrict retries to
    `UpstreamTimeoutError` via a custom `isRetryable`; this service uses
    `withTimeoutAndRetry`'s default retry-everything policy instead, since
    the acceptance criterion is "a logging failure ... should retry," not
    "a hung logging call should retry" — caught by re-reading the criterion
    against the copy-pasted precedent before writing tests, not after.
    On exhausted retries, an injectable `notifyUserOfFailure` hook fires
    before `ActionItemLoggingFailedError` is thrown — defaulted to a
    structured `user_notified_of_logging_failure` audit event, flagged
    honestly as a walking-skeleton stand-in since no real notification
    channel (email, in-app alert) exists in this project yet, same class of
    scope boundary as the tracker client itself. Dedupes on
    `confirmation.sendingReviewGateSessionId`. No HTTP route added, matching
    the service-layer-only convention established since STORY-005.
  - Verification: `tsc --noEmit` clean across the backend. `npx jest`:
    243/243 passing across 26 suites (up from 234/25 before this story — 9
    new tests in `actionItemTrackerService.test.ts`), covering all three
    acceptance criteria directly: (1) happy path — every action item from an
    approved batch (both per-participant and unmatched) is logged with
    `status: 'Not Started'`; (2) logging failure — one test proves a retry
    actually happens (client fails once, succeeds on attempt 2, result still
    returns correctly), a second proves exhausted retries throw
    `ActionItemLoggingFailedError` and call `notifyUserOfFailure` exactly
    once; (3) Trust — a real (non-mocked) `console.log`/`console.error` spy
    test asserts `action_item_logging_attempted` →
    `action_items_logged` on a success run and
    `action_item_logging_failed` (`outcome: 'failure'`,
    `error_class: 'ActionItemLoggingFailedError'`) →
    `user_notified_of_logging_failure` on a failing run, all with distinct
    `auditEventId`s. The "incorrect action item logging" failure path is
    covered at both boundaries named in the story brief: input
    (`ContractViolationError` on a missing `sendingReviewGateSessionId` or a
    non-array `confirmedRecipients`) and trust (`SendConfirmationNotVerifiedError`
    on a confirmation referencing a session that was never submitted to
    Gate #2, or one still `pending_review`).
  - Notes: Confidence 85%. `.colaberry/progress.json` had STORY-015's three
    criteria pre-marked `passed: true` with empty `files_touched`/
    `tests_added` before any code for this story existed — the same
    stale-flag pattern STORY-006/007/008/011/013 already caught and
    corrected — flagged here rather than trusted, corrected in the
    follow-up verification commit against the real test run above. What
    would raise confidence: a real tracker system (Jira/Asana/a DB) wired
    into `ActionItemTrackerClient` to prove the retry/timeout behavior
    against an actual flaky integration rather than a synthetic
    always-fails/always-succeeds fake, and product input on whether logging
    should filter out items already `flaggedForReview`/missing an owner
    (currently logged as-is, gaps and all — no item is silently dropped from
    the tracker just because it was incomplete in the minutes). STORY-016
    (stale/carried-over flagging) and STORY-017 (JSON export) were
    deliberately left untouched, per the brief. Not yet committed — commit
    is the next step, with a message naming STORY-015.

## 2026-08-30

- [x] STORY-016 — Compare against prior open items and flag stale items
  - Date: 2026-08-30
  - Session: CC-20260830-t7m2
  - What changed: Added `backend/src/services/actionItemTracker/staleItemComparison.ts`
    implementing REQ-017. `compareOpenItems({ priorOpenItems, currentOpenItems, now })`
    matches items across two occurrences of a recurring meeting by
    `(actionItem.task, actionItem.owner)` case-insensitive — the same convention
    `emailDraftingService` already uses for owner matching — and ages each current item
    from the *earliest* `loggedAt` seen across both lists (its true first-seen date, not
    just this run's), flagging anything open more than 14 days as `'Stale'`. `now` is
    injectable so tests don't depend on the real clock. `TrackedActionItem.status`
    (`types.ts`) widened from the literal `'Not Started'` to `'Not Started' | 'Stale'`,
    with three new types added for the comparison's input/output shape
    (`StaleComparisonInput`, `StaleComparisonResultItem`, `StaleComparisonResult`).
    `errors.ts` gained one new class, `StaleComparisonFailedError`, for the "comparison
    logic failure" path (an unparseable `loggedAt` on either list); malformed top-level
    input (a non-array list) reuses the existing `ContractViolationError` rather than
    adding a redundant class. No persistent store of "prior open items" was built —
    the architecture doc's recurring-meeting tracking has no data layer yet in this
    project (that's a future story, same governance boundary STORY-005/006/009/010/011/015
    already drew for their own provider seams), so the function takes the prior list as a
    caller-supplied input rather than querying anything itself. This deliberately does not
    touch STORY-017 (JSON export) or STORY-018 (audio ingestion idempotency/audit), per the
    brief's "leave room, don't build" instruction. Built one step at a time (types →
    errors → comparison logic → audit logging → tests), confirming with the user before
    each edit, per this session's explicit paced-co-pilot instruction.
  - Verification: `tsc --noEmit` clean across the backend. `npx jest`: 251/251 passing
    across 27 suites (up from 243/26 before this story — 9 new tests in
    `staleItemComparison.test.ts` plus 1 pre-existing suite untouched), covering both
    acceptance criteria directly: (1) a happy-path test with a matched prior+current item
    aged past 14 days from the earlier `loggedAt` asserts `status: 'Stale'`, plus a
    boundary test proving an item open for *exactly* 14 days is not yet stale (the
    criterion says "more than 2 weeks"); (2) an all-current test with only recent items
    asserts `allCurrent: true` and `staleCount: 0`. Trust is verified with a real
    (non-mocked) `console.log`/`console.error` spy test asserting the
    `stale_item_comparison_attempted` → `stale_items_flagged`/`all_items_current`
    →/`stale_item_comparison_failed` sequence across a flagged run, an all-current run,
    and a failing run, each with a distinct `auditEventId`. The three named failure paths
    are each covered: "comparison logic failure" (an unparseable `loggedAt` on either the
    prior or the current list throws `StaleComparisonFailedError`, verified separately for
    each list), "failure to detect stale items" and "incorrect stale item flagging" are
    covered together by one test proving the `(task, owner)` match key does not cross-flag
    a same-task-different-owner item as stale off the wrong meeting's history, plus the
    input-boundary test (`ContractViolationError` on a non-array `priorOpenItems`).
  - Notes: Confidence 85%. Same pre-existing stale-flag pattern already caught and
    corrected for STORY-006/007/008/011/013/015 was present again here:
    `.colaberry/progress.json`'s STORY-016 block had all three `criteria[].passed`
    pre-set to `true` with empty `files_touched`/`tests_added` before any code for this
    story existed — flagged to the user at session start, now corrected in the
    verification commit against the real test run above. What would raise confidence:
    product input on what actually supplies `priorOpenItems` in production — this story
    assumes a caller (a future recurring-meeting scheduler/store) hands in the prior
    occurrence's still-open tracked items, but no such caller or persistence layer exists
    yet, so the matching/aging logic is proven correct in isolation but not yet exercised
    end-to-end against a real second meeting occurrence. Also worth flagging: the
    architecture doc's `'Carried-over'` status and "carried-over agenda" output are still
    untouched — out of scope per the brief, but the next piece of this component to build
    once a story specifies it.

- [x] STORY-017 — Output structured data in JSON format for integration
  - Date: 2026-08-30
  - Session: CC-20260830-f9k3
  - What changed: Added `backend/src/services/dataExport/` (`types.ts`, `errors.ts`,
    `auditLog.ts`, `jsonFormatter.ts`, `dataExportService.ts`), implementing REQ-018.
    No "Meeting Records Store" aggregate exists yet in this project (the architecture
    doc's dual text/JSON output is a cross-cutting concern with no data layer built for
    it), so rather than invent that aggregate, `MeetingDataExportInput` is a generic,
    all-optional-except-`meetingId` shape the caller populates from whatever structured
    pieces of the pipeline it already has (`meetingSummary`, `decisionExtraction`,
    `actionItemTracker` output) — nothing is fabricated or re-derived, same scope
    boundary STORY-015/016 drew for the tracker's own persistence. Logged as an explicit
    assumption at session start (confidence ~0.75, no governance boundary crossed).
    `jsonFormatter.ts`'s `formatMeetingDataAsJson()` is the core of acceptance criterion
    #1: a recursive scan rejects anything `JSON.stringify` would either throw on
    (circular references, BigInt) or silently corrupt into invalid data (`NaN`/`Infinity`
    silently becoming `null`) *before* serialization, then proves the result round-trips
    through `JSON.parse` — this is the story's "incorrect JSON formatting" failure path,
    caught loud rather than shipping corrupted numeric fields to an external tracker.
    `dataExportService.ts`'s `exportMeetingData()` follows the exact provider-seam
    pattern STORY-015 established: validates `meetingId` is present
    (`ContractViolationError`), dedupes on `meetingId` via an injectable idempotency
    store (`TODO(pre-persistence)`, same as every other provider seam in this project),
    formats the data, then sends it through an injectable `DataOutputClient` (the
    external-tracker integration — Jira/Asana/a webhook — undecided, no implementation
    wired in yet, same governance boundary as `ActionItemTrackerClient`) wrapped in
    `withTimeoutAndRetry` reused read-only from `audioIngestion`. One deliberate
    distinction from the tracker's own retry logic: a formatting failure
    (`InvalidJsonFormatError`) is never retried, since it's deterministic and a retry
    would fail identically on the same data — only the output-client call itself
    (`DataOutputFailedError`) is retried, matching the story's "data output retry
    failure" wording specifically. On exhausted retries, an injectable
    `notifyUserOfFailure` hook fires before `DataOutputFailedError` is thrown — same
    structured-audit-event stand-in as STORY-015, flagged honestly as a walking-skeleton
    placeholder since no real notification channel exists in this project yet. Built one
    step at a time (types → errors → auditLog → jsonFormatter → service → tests),
    confirming with the user before each file, per this session's explicit paced-co-pilot
    instruction.
  - Verification: `tsc --noEmit` clean across the backend. `npx jest`: 263/263 passing
    across 29 suites (up from 251/27 before this story — 12 new tests: 5 in
    `jsonFormatter.test.ts`, 7 in `dataExportService.test.ts`), covering all three
    acceptance criteria directly: (1) happy path — meeting data is formatted into a
    `{ meetingId, exportedAt, data }` JSON envelope that parses back cleanly and is
    handed to the output client; (2) data output failure — one test proves a retry
    actually happens (client fails once, succeeds on attempt 2), a second proves
    exhausted retries throw `DataOutputFailedError` and call `notifyUserOfFailure`
    exactly once; (3) Trust — a real (non-mocked) `console.log`/`console.error` spy test
    asserts `data_export_attempted` → `data_export_completed` on a success run and
    `data_export_failed` (`outcome: 'failure'`, `error_class: 'DataOutputFailedError'`) →
    `user_notified_of_export_failure` on a failing run, all with distinct
    `auditEventId`s. "Incorrect JSON formatting" is covered at three levels in
    `jsonFormatter.test.ts` (circular reference, `NaN`, `Infinity`, each throwing
    `InvalidJsonFormatError` before serialization) plus one test proving a shared
    non-circular reference between two array entries is *not* mistaken for a cycle — a
    real risk given `TrackedActionItem` entries can share an underlying `ActionItem`.
    Also covered: input-boundary `ContractViolationError` on a missing `meetingId`, and
    idempotency (re-exporting the same `meetingId` is a no-op, output client called
    once).
  - Notes: Confidence 85%. `.colaberry/progress.json`'s STORY-017 block was already
    correctly `passed: false` with empty `files_touched`/`tests_added` at session
    start — unlike STORY-006/007/008/011/015/016, no pre-existing stale-flag bug to
    correct here (STORY-016's own verification commit had already reverted STORY-017's
    flags back to `false`, per its notes). What would raise confidence: a real external
    tracker integration (Jira/Asana/a webhook) wired into `DataOutputClient` to prove
    the retry/timeout behavior against an actual flaky integration rather than a
    synthetic always-fails/always-succeeds fake, and product input on exactly what
    "meeting data" a caller is expected to assemble in production once the Records Store
    (or an equivalent aggregation point) exists — today the shape is caller-assembled
    from whichever of `meetingSummary`/`decisionExtraction`/`actionItemTracker` output
    it has on hand, which is a reasonable but unconfirmed reading of an intentionally
    generic acceptance criterion. Not yet committed — commit is the next step, with a
    message naming STORY-017.

## 2026-09-03

- [x] Add `assess_meeting_risk` reasoning tool to the standalone `meeting-assistant/`
  Python MCP server
  - Date: 2026-09-03
  - Session: CC-20260903-9k2v
  - What changed: Brought the pre-existing `meeting-assistant/server.py` MCP server
    (a separate, untracked Python/`uv`/`mcp[cli]` artifact — NOT the same project as
    the `/backend` TypeScript "Meeting Assistant" tracked in the STORY-001–018 entries
    above; the two share a name only) up under the MCP Inspector (`uv run mcp dev
    server.py`) as a verified baseline, then added one new tool,
    `assess_meeting_risk(meeting_id)`. Unlike the three existing lookup tools
    (`search_action_items`, `get_meeting_summary`, `read_meeting_attachment`), this one
    requires judgment: it fetches a meeting's summary + its action items directly from
    the JSON data files (no model call for that part), then requests a reasoned risk
    verdict from the client's own model via MCP sampling
    (`ctx.session.create_message(...)` at `meeting-assistant/server.py:559`) with a
    short system prompt and `max_tokens=300`. No API key or model name appears
    anywhere in the server — both are the client's responsibility. Degrades instead of
    crashing in three distinct cases, each logged via `ctx.log("warning", ...)`: client
    doesn't declare the sampling capability (checked via
    `ctx.client_capabilities.sampling` before ever sending the request), the client
    raises/refuses the sampling request (`except Exception` around `create_message`,
    tagged with the real `error_class`), and — the one bug actually caught during manual
    testing — the client returns a syntactically successful but empty completion, which
    the first version of this code let through silently as `degraded: false` with a
    blank `assessment`. Added an explicit blank-text check that reclassifies that case
    as a degraded result too. Every degraded path returns a real, non-empty answer
    built from the raw signals already fetched (flagged topics, action items missing
    an owner/due date, still-open items) rather than an empty string.
    `sampling_request_started`/`sampling_request_finished` (or `_failed`) log
    notifications carry `duration_ms`.
  - Verification: Manually driven end-to-end through the MCP Inspector (v2.5.0) against
    `meeting_id: mtg-2026-08-19-acme-onboarding`: (1) confirmed all 4 tools list in the
    Inspector's Tools tab after the change, proving the running process picked up the
    new code; (2) first run surfaced the empty-completion bug live (`degraded: false`,
    `assessment: ""`) against the Inspector's own mock sampling client; (3) after the
    fix, re-ran the same call and got `degraded: true` with a populated `assessment`
    ("No model judgment available (the client returned an empty completion). Raw risk
    signals: 1 topic(s) flagged for review...") and `riskLevel: "unknown"` — the
    intended, non-empty degraded output. `uv run python -c "import server"` confirmed
    clean imports after each edit. No automated test suite exists for this Python
    server (it's outside `/backend`'s Jest setup); verification here is manual
    Inspector-driven only.
  - Notes: Also cleaned up a process-management mess from mid-session: an earlier
    `taskkill` (intended to force a restart onto the fixed code) killed only the
    top-level `mcp dev` launcher, not its full child tree, leaving orphaned `uv`/`mcp`/
    `node` processes that kept the Inspector UI alive against stale/duplicate backend
    connections. Resolved by explicitly enumerating and killing every related process
    (by command line and by the actual TCP listeners on ports 6274/6275) before
    relaunching a single clean instance. No automated tests were added for this
    server — flagged as a gap if this tool graduates beyond manual smoke-testing.

## 2026-09-05

- [x] Draft transport decision document for the `mcp-server` MCP server
  - Date: 2026-09-05
  - Session: CC-20260905-h4tz
  - What changed: Added `docs/TRANSPORT_DECISION_MCP_SERVER.md`, a standalone
    decision doc scoped only to `mcp-server/src/server.py` (separate from the
    pre-existing `docs/TRANSPORT_DECISION.md`, which is scoped only to
    `meeting-assistant/server.py`). Decision: STDIO, single-user/single-process, no
    persisted session state — `mcp-server` is a local single-client dev scaffold with
    no concurrent-client requirement, confirmed by direct user answer rather than
    assumed. Document includes a STDIO vs StreamableHTTP comparison table, rationale
    tied to this server's actual (not hypothetical) performance/scalability needs, the
    unenforced single-user runtime assumption, and explicit criteria for revisiting the
    decision if a real multi-client requirement ever appears.
  - Verification: File created; content cross-checked directly against
    `mcp-server/src/server.py`, `meeting-assistant/server.py`, and
    `order-status-lookup/server.py` (all read in-session) to confirm every existing MCP
    server in this repo currently uses STDIO, and against the existing
    `docs/TRANSPORT_DECISION.md` for structural consistency.
  - Notes: Documentation only — no code changed, no tests apply. Scope explicitly
    does not extend to `meeting-assistant/`, `mcp-tutorial/`, or `order-status-lookup/`.

- [x] Verify meeting-assistant transport for multi-user readiness and write its missing README
  - Date: 2026-09-05
  - Session: CC-20260905-h4tz
  - What changed: No transport code change was needed — `meeting-assistant/server.py`
    already runs `mcp.run(transport="stdio")`, matching the pre-existing
    `docs/TRANSPORT_DECISION.md` for this server. Wrote `meeting-assistant/README.md`
    (previously empty) with accurate setup/start instructions
    (`uv run mcp dev server.py`), the real tool/resource/prompt inventory
    (`search_action_items`, `get_meeting_summary`, `read_meeting_attachment`,
    `summarize_meeting_note`, `assess_meeting_risk`; `meetings://catalog`,
    `meetings://{meeting_id}`; `meeting_recap`), and the `ANTHROPIC_API_KEY` note.
  - Verification: Restarted the server (`uv run mcp dev server.py`, port conflict on
    the default 6274 from an unrelated pre-existing process worked around with
    `CLIENT_PORT=6280`; Inspector came up clean at `http://127.0.0.1:6280`).
    Independently confirmed all three surfaces over the real stdio transport with a
    scripted MCP Python client (`mcp.client.Client` + `StdioServerParameters` spawning
    `server.py` fresh via the project's own venv): `tools/list` returned all 5 tools
    and `get_meeting_summary` returned correct data; `resources/list` +
    `read_resource("meetings://catalog")` returned the meeting index;
    `prompts/list` + `get_prompt("meeting_recap", ...)` returned the expected recap
    text. Script completed with "ALL THREE VERIFIED OK" — nothing broke, no fixes
    needed. No automated test suite exists for this Python server.
  - Notes: An unrelated, pre-existing `node.exe` process (PID 45640, started
    2026-09-03, not started this session) was found holding port 6274; left untouched
    per intern-safety/unfamiliar-process rules rather than killed. User may want to
    close it themselves.

- [x] Build the Trello integration adapter in mcp-server/
  - Date: 2026-09-05
  - Session: CC-20260905-h4tz
  - What changed: Read `.colaberry/plan.json` (REQ-019: Teams, Zoom, Google Meet,
    Outlook Calendar, Trello) and recommended Trello over the other four — least setup
    (personal key+token vs. OAuth app registration/admin consent for the Microsoft
    Graph and Zoom Marketplace options, or Google Meet's Workspace-gated API) and
    clearest value since STORY-015/016/017 already produce the exact action-item JSON
    STORY-017 says is meant for "external trackers like Trello." Added
    `log_action_item_to_trello` to `mcp-server/src/server.py`: inputs (task, owner,
    due_date, priority, list_id) declared via Annotated + pydantic Field (length
    limits, a Literal for priority, a 24-hex-char pattern for list_id) so malformed
    calls are rejected by schema validation before the tool body runs, plus an
    explicit `datetime.fromisoformat` check on due_date before any network call. Every
    Trello call goes through stdlib `urllib` (no new dependency) with an explicit 10s
    timeout, off the event loop via `asyncio.to_thread`. Missing config, a timeout, an
    HTTP error (classified 401/403 AuthError, 429 RateLimitError, 5xx
    UpstreamUnavailable, other 4xx ValidationError), or a dead connection all return a
    safe `{"success": false, "message": ...}` dict, never a crash. Added a
    dedup-by-title check (GET open cards before POST) per this repo's non-negotiable
    idempotency rule (same pattern as the documented Basecamp-todo-create case).
    Updated `mcp-server/README.md` (previously "empty shell — no tools yet") to
    document both tools and the required Trello env vars.
  - Verification: A direct-call script exercised all three required failure paths —
    no credentials configured (clean message, zero network calls), an invalid
    due_date (rejected pre-network), and Trello unreachable (TRELLO_API_BASE pointed
    at a closed local port, simulating the system being down) — all returned safe
    error dicts, printed "ALL TROELLO-TOOL CHECKS PASSED". A second script drove the
    real stdio MCP protocol (spawning `src/server.py` via the project's own venv
    python): confirmed `tools/list` includes the new tool with the correct JSON
    schema, a malformed `list_id` is rejected by the framework's own pydantic
    validation before any tool code runs (no `tool_started` log line emitted), the
    not-configured case returns a clean non-error result, and `ping` is unaffected —
    printed "MCP-SERVER STDIO PROTOCOL CHECKS PASSED". No automated test suite exists
    for this Python server; verification is scripted-client-driven.
  - Notes: No new dependency added (stdlib `urllib`, not a new HTTP client package).
    Dedup-before-create was not explicitly requested by the user but is required by
    this repo's non-negotiable idempotency rule for side-effecting external calls.

- [x] Audit mcp-server/src/server.py for cross-call state and fix the resulting race
  - Date: 2026-09-05
  - Session: CC-20260905-h4tz
  - What changed: Audited every module-scope item in `mcp-server/src/server.py` for
    what persists between calls: `TRELLO_API_BASE`/`TRELLO_TIMEOUT_SECONDS`
    (read-only constants), the `mcp` tool registry (built once at import, never
    mutated), the implicit thread pool behind `asyncio.to_thread` (created once per
    process, holds no data), and confirmed credentials are re-read from `os.environ`
    fresh on every call rather than cached; also confirmed there is no pooled
    connection to Trello and no file this server appends to. Found the actual
    cross-call risk was not a variable but a check-then-act race in
    `log_action_item_to_trello`: the dedup GET and the create POST were not atomic,
    so two concurrent calls for the same `(list_id, task)` could both pass the dedup
    check before either created a card, both report `success: true`, and silently
    leave two duplicate cards in Trello — worse than an error because nothing signals
    it happened. Fixed it by adding a per-`(list_id, task)` `asyncio.Lock`
    (`_dedup_locks` + `_dedup_locks_guard`) and wrapping the GET-check + create-POST
    sequence in that lock, so only calls for the same item ever serialize. Documented
    the non-risky items plus the new lock's own residual limitations (single-process
    only; dict never evicted) in a new "What this server assumes" section in
    `mcp-server/README.md`.
  - Verification: A scripted concurrency test (in-memory fake Trello via a
    monkeypatched `_call_trello`, with a deliberate 50ms delay in the GET to force
    real interleaving) launched two asyncio-concurrent calls for the identical
    `(list_id, task)` and confirmed exactly one card was created and the second call
    correctly returned `deduped: true` — printed "RACE CLOSED: exactly one card
    created, the concurrent duplicate call deduped instead". Re-ran both pre-existing
    verification scripts from the prior Trello-tool change (direct-call
    config/validation/down-Trello checks; full stdio-protocol client script) — both
    still pass unchanged, confirming no regression. No automated test suite exists
    for this Python server; verification is scripted-client-driven.
  - Notes: The new `_dedup_locks` dict is itself a piece of cross-call state (by
    design) — it grows by one entry per distinct action item ever logged by this
    process and is never evicted; acceptable only because this server is short-lived
    and single-client per `docs/TRANSPORT_DECISION_MCP_SERVER.md`.

## 2026-09-07

- [x] Add recording -> transcript -> draft -> risk -> email-draft pipeline to the
  standalone `meeting-assistant/` MCP server
  - Date: 2026-09-07
  - Session: CC-20260907-q3xk
  - What changed: User wants to test Meeting Assistant end to end against real Zoom/
    Microsoft Teams/Google Meet recordings, through to a reviewable follow-up email,
    without any step auto-sending. Confirmed scope with the user first (three
    governance-relevant choices, since a speech-to-text engine and a Gmail-send path
    are both new external dependencies per this repo's Autonomy Model): (1) the user
    exports/downloads the recording from each platform themselves and hands this
    server a local file — no per-platform OAuth/API integration; (2) transcription
    runs via a local Whisper model (`faster-whisper`), not a paid cloud API; (3) the
    pipeline stops at a reviewable email draft for now — no real Gmail send is wired
    up. Added `faster-whisper` (+ `truststore`, to fix a `CERTIFICATE_VERIFY_FAILED`
    this machine hit downloading the Whisper model — routes the one-time Hugging Face
    download through the OS cert store instead of the bundled certifi list) to
    `pyproject.toml`. Added four tools and one prompt to `meeting-assistant/server.py`:
    `transcribe_meeting_recording` (local Whisper, off the event loop via
    `asyncio.to_thread`, explicit load/transcribe timeouts, rejects unsupported
    extensions and out-of-bounds/missing files via the existing
    `_check_within_declared_roots` sandbox); `draft_meeting_from_transcript` (Claude
    API call extracting summary/decisions/action items/unresolved issues as strict
    JSON — an action item with no stated owner or due date comes back `null` +
    `flaggedForReview: true`, never guessed, mirroring the existing action-item
    convention); `assess_draft_risk` (delivery-risk judgment on a fresh draft that has
    no stored `meeting_id` yet — refactored `assess_meeting_risk`'s basis-to-verdict
    core into a shared `_assess_risk_from_basis` helper so both tools share the exact
    same degrade-to-raw-signals guardrail instead of duplicating it); and
    `draft_followup_email` (deliberately deterministic — no model call, so nothing in
    the email can be hallucinated — builds `{to, subject, body}` and explicitly labels
    any still-unowned action item "UNASSIGNED -- needs an owner" rather than omitting
    it; never sends anything, never calls Gmail or any mail provider). Added
    `meeting_pipeline_from_recording`, a guided prompt chaining all five steps that is
    explicit it must stop at the draft and never claim something was sent. Generated a
    short synthetic sample recording (`data/attachments/sample-standup-recording.wav`,
    via Windows SAPI TTS: one decision, one action item with an owner+deadline, one
    action item with no owner) so the pipeline could be verified against real speech
    end to end without waiting on the user's own Zoom/Teams/Meet export. Updated
    `meeting-assistant/README.md` with the new tool/prompt inventory, the Whisper
    model-download/offline note, and a step-by-step "Testing a recording end to end"
    section walking through the same five steps for any of Zoom/Teams/Meet.
  - Verification: `uv run python -c "import server"` clean after each edit. Full
    stdio-protocol scripted client (spawning `server.py` via the project's own venv,
    with a mock sampling callback and a `list_roots` callback declaring the project
    directory) drove the real pipeline end to end against the synthetic sample
    recording: `tools/list` shows all 4 new tools alongside the 5 pre-existing ones;
    `transcribe_meeting_recording` correctly transcribed the sample audio (confirmed
    against the known scripted text) and correctly failed closed on a missing filename
    and on an unsupported extension (a real `.txt` attachment); `draft_meeting_from_transcript`
    produced the expected structured draft, with the legal-followup item correctly
    coming back `owner: null, flaggedForReview: true` (not fabricated); `assess_draft_risk`
    returned a real (non-degraded, `degraded: false`) "medium" verdict from the mock
    sampling client citing the actual unowned item; `draft_followup_email` produced a
    draft whose body explicitly calls out "UNASSIGNED -- needs an owner" for that item
    and correctly rejected a malformed recipient address (`found: false`) without
    throwing. Script printed "ALL PIPELINE CHECKS PASSED". No automated test suite
    exists for this Python server; verification is scripted-client-driven, same
    precedent as every prior change to this file.
  - Notes: Confidence ~80%, logged as an assumption rather than escalated (implementation-
    level, reversible, local blast radius, no governance boundary crossed once the three
    scope questions above were answered): `assess_draft_risk` and `draft_followup_email`
    accept `draft` as a loosely-typed `dict` rather than a fully-specified nested pydantic
    model, validated defensively (`.get()` with fallbacks) instead of at the MCP schema
    boundary — reasonable given `draft` is produced by this same server's own
    `draft_meeting_from_transcript` moments earlier, but a stricter contract would catch
    a malformed hand-authored `draft` earlier. Real Gmail sending remains explicitly out
    of scope per the user's own choice — the pipeline's last real step is a draft, and
    sending is a deliberate action the user takes themselves; if they want an actual
    send-after-approval tool later, it requires them to first set up a Google Cloud
    project + OAuth consent screen (a governance-boundary external-dependency decision,
    not one for Claude to make silently). WHISPER_MODEL_SIZE defaults to "base" as a
    speed/accuracy balance for short clips — a noisier/longer real Zoom/Teams/Meet
    recording may warrant "small" or "medium" via that env var.

- [x] Add headless Claude Code routine for backend build validation
  - Date: 2026-09-16
  - Session: CC-20260916-v8j3
  - What changed: Created `scripts/headless-build-check.sh`, a headless (`claude -p`)
    routine that runs `npm run typecheck --prefix backend` and `npm test --prefix backend`
    via allowlisted Bash tool calls, requests JSON-only output from Claude, and
    translates the result into a process exit code for CI/git-hook use.
  - Verification: `bash -n scripts/headless-build-check.sh` passed (syntax check only).
  - Notes: Not executed live — running it would spawn a second, API-billed Claude Code
    process unattended, which wasn't authorized. Script is ready to run once the user
    invokes it directly.

- [x] Add GitHub Actions workflow for automated PR code review
  - Date: 2026-09-16
  - Session: CC-20260916-q7k2
  - What changed: Committed and pushed `.github/workflows/pr-code-review.yml` (it already
    existed untracked in the working tree, written previously but never saved to git) — a
    workflow that runs the official `anthropics/claude-code-action` on every pull request,
    reads the API key from the GitHub Actions secret `ANTHROPIC_API_KEY` (never hardcoded
    in the file), and posts inline review comments without auto-approving or merging.
  - Verification: Pushed successfully to `origin/main` (commit `f62e123`, `e59ce8f..f62e123`).
    No application code or tests apply to a CI-only YAML file.
  - Notes: The `ANTHROPIC_API_KEY` secret itself still needs to be added by the user in
    GitHub's repo Settings > Secrets and variables > Actions — `gh` CLI is not installed
    on this machine, so that step cannot be automated from here and requires the user's
    own action.

- [x] Add /meeting-recap command and action-item-gate hook
  - Date: 2026-09-16
  - Session: CC-20260916-r4t9
  - What changed: Created `.claude/commands/meeting-recap.md`, a slash command that runs
    the transcript review -> minutes -> action-item extraction -> risk/gap identification
    -> follow-up drafting pipeline on demand (prefers the meeting-assistant MCP tools when
    connected, falls back to doing the same steps directly from transcript text; stops at
    a reviewable draft, never sends). Created `.claude/hooks/action-item-gate.sh`, a
    PreToolUse hook on the Write tool, scoped to meeting-artifact file paths
    (minutes/meeting/action-item/recap/follow-up), that parses JSON action-item objects
    and Markdown "Action Items" tables and blocks (exit 2) the write if any item is
    missing an owner or due date and isn't already marked flagged. Registered it in
    `.claude/settings.json` under `PreToolUse` alongside the existing `commit-guard.sh`
    Bash matcher.
  - Verification: Ran `action-item-gate.sh` directly against 5 hand-built PreToolUse
    payloads — JSON item missing owner (exit 2), JSON with `flaggedForReview: true`
    (exit 0), Markdown table missing due date (exit 2), same bad content on an
    out-of-scope file path (exit 0), fully-filled Markdown table (exit 0). All five
    matched the expected exit code.
  - Notes: No automated test harness exists for `.claude/hooks/*.sh` in this repo
    (same as `commit-guard.sh`, which also has no test file), so verification was manual
    invocation with representative payloads. Did not register the meeting-assistant MCP
    server in `.mcp.json` — not requested, and the command works without it.

- [x] Rename the meeting command to a user-chosen name and run it on a real transcript
  - Date: 2026-09-16
  - Session: CC-20260916-r4t9
  - What changed: Deleted `.claude/commands/meeting-recap.md` (generic label the user
    rejected) and replaced it with `.claude/commands/check-action-items-and-draft-followups.md`,
    same pipeline scope (review -> minutes -> action items -> risks -> follow-up drafts,
    stops before send) but explicit that it must do the whole job and ask for missing
    input (e.g. a recipient's email address) rather than returning a partial result.
    `.claude/hooks/action-item-gate.sh` and its `settings.json` registration were not
    touched.
  - Verification: Ran the new command against the real, previously-unprocessed transcript
    `meeting-assistant/data/attachments/sample-standup-transcript.txt` (confirmed via grep
    that no `meetingId` in `meeting_summaries.json`/`action_items.json` corresponds to it).
    It correctly flagged the one action item with no stated owner (the legal/DPA
    follow-up) and the other's owner-stated-but-relative due date ("Friday", no anchor
    date in the transcript), and correctly found no email address for Priya anywhere in
    the repo (`grep -i priya` across `meeting-assistant/` returned no `@` address) — user
    confirmed the report and was asked for that address as the one open input, matching
    the "ask, don't fabricate" rule in the command.
  - Notes: On an 8-line sample transcript this did not save meaningful time over reading
    it directly — the value shown was catching the missing-owner item, not speed. Full
    assessment of effort saved (and what's missing) given directly to the user in-chat.

- [x] Narrow action-item-gate.sh to least privilege
  - Date: 2026-09-16
  - Session: CC-20260916-r4t9
  - What changed: Hardened `.claude/hooks/action-item-gate.sh` two ways, at the user's
    request to name and remove permissions it didn't need. (1) The embedded `node -e`
    call now runs as `node --permission` with no `--allow-fs-read`/`--allow-fs-write`/
    `--allow-child-process`/`--allow-worker`/`--allow-addons` flags, so the interpreter
    itself refuses (`ERR_ACCESS_DENIED`) any future attempt to touch the filesystem or
    spawn a process, instead of that only being true because today's code happens not to
    do it. (2) Added a path-containment check (via `path.resolve`, which needs no fs
    permission) so a keyword match on a path outside `$CLAUDE_PROJECT_DIR` is now
    explicitly out of scope, not just implicitly ignored by the keyword regex.
  - Verification: Confirmed on this machine's Node 24 runtime that `node --permission`
    with no allow-flags throws `ERR_ACCESS_DENIED` on `fs.writeFileSync`,
    `fs.readFileSync`, and `child_process.execSync`, while stdin/stdout/stderr and
    `process.env` still work normally. Re-ran the full block/pass test matrix against the
    hardened script (in-project JSON missing owner -> exit 2; outside-project path with
    identical bad content -> exit 0; `flaggedForReview: true` -> exit 0; Markdown table
    missing due date -> exit 2; unrelated in-project file path -> exit 0) — all five
    matched, no regression from the pre-hardening behavior logged earlier this session.
  - Notes: Node's permission model has no `--allow-env` gate, so `process.env` access
    was not and could not be restricted this way; that was disclosed to the user rather
    than implied as covered.

- [x] Add loud-failure verification to the command and the hook
  - Date: 2026-09-16
  - Session: CC-20260916-r4t9
  - What changed: Created `scripts/verify-action-items.js`, a standalone checker that
    reads a drafted action-items JSON result from stdin and exits non-zero (printing
    every violation) if any item missing an owner or a real due date (including a bare
    relative date like "Friday" with no anchor) isn't marked `flaggedForReview: true`, or
    if anything is flagged that doesn't need to be. Added it as a mandatory step 7 in
    `.claude/commands/check-action-items-and-draft-followups.md`, run before the command
    may report its result as done; a non-zero exit blocks the "done" report. Added the
    same fail-loud principle to `.claude/hooks/action-item-gate.sh`: it now tracks
    whether it actually recognized any action-item structure (JSON or table), and if a
    file mentions action items/owners/due dates but matches neither recognized shape, it
    now blocks with a "could not verify" message instead of silently exiting 0 -- closing
    a real silent-pass gap the hook had before this change.
  - Verification: (1) Ran the *unmodified* hook against a bulleted-list "Action Items"
    section it doesn't parse (owner/due both stated as missing/TBD) and confirmed it
    exited 0 (silently wrong) before the fix, then confirmed the fixed hook exits 2 on the
    identical input with a "could not verify" message. Re-ran the full prior regression
    matrix (7 cases) after the fix with no change in expected outcome. (2) While writing
    `scripts/verify-action-items.js` itself, the hook's keyword-only scoping blocked that
    very Write (its own comments mention "action items"/"owner"/"due date" in prose) --
    a live false positive, fixed by additionally requiring a `.md`/`.markdown`/`.json`/
    `.txt` extension before the path-keyword check applies, since meeting artifacts are
    data files, not source code; re-ran the regression matrix again after that fix, still
    correct. (3) Ran `verify-action-items.js` against a deliberately broken table (a
    missing-owner/missing-date item left unflagged) and confirmed `VERIFY FAILED` with
    the exact violation named; ran it again with the gap flagged and got `VERIFY PASSED`;
    also confirmed it catches the reverse case (an item flagged that has no real gap) and
    rejects non-JSON input.
  - Notes: Documented in the command file and this entry what neither verifier checks --
    factual correctness of task/owner/date against the source transcript, sensible
    calendar dates, or anything outside the action-items array/table (minutes text,
    follow-up email bodies) is unverified by either check.

- [x] Add push-triggered code review workflow that always comments
  - Date: 2026-09-16
  - Session: CC-20260916-r4t9
  - What changed: Created `.github/workflows/push-code-review.yml`, separate from the
    existing PR-triggered `pr-code-review.yml`. Triggers on `push` to any branch
    (tag pushes and branch-deletion pushes excluded). Computes the pushed commit range
    (falling back to the empty-tree SHA for a brand-new branch's first push), runs
    `anthropics/claude-code-action@v1` against that diff with the same CLAUDE.md-rule
    review prompt as the PR workflow, and always -- via `if: always()` plus
    `continue-on-error: true` on the review step -- posts a commit comment on the pushed
    SHA: the review's findings on success, or an explicit tooling-failure notice (linking
    the run) if the review step errored or produced no output. `contents: write` is the
    only permission granted (needed to create the commit comment). The checkout step
    disables `persist-credentials` so the AI review step has no git-push credential at
    all; only the final, non-AI comment-posting step receives `GH_TOKEN`. No secret value
    is in the file -- `secrets.ANTHROPIC_API_KEY` is referenced by name only, and adding
    the actual key in GitHub Settings is left to the user as a deliberate next step, per
    their request.
  - Verification: Validated the YAML parses correctly (`npx js-yaml` round-tripped it to
    JSON with no error). Manually simulated the diff-range shell logic for both a normal
    before/after and an all-zero (new-branch) before, confirming the empty-tree fallback
    fires correctly in both the "SHA doesn't exist" and "literal zero SHA" cases. Not run
    against a real push yet -- that requires the `ANTHROPIC_API_KEY` secret to be added
    first, which the user is deferring deliberately.
  - Notes: Did not attempt to add the secret or trigger a real push -- both are explicitly
    the user's next, deliberate step. Plain-English trigger/scope/cost explanation given
    directly to the user in-chat rather than duplicated here.

- [x] Add unit tests for the new meeting-assistant MCP tools
  - Date: 2026-09-17
  - Session: CC-20260917-q3v8
  - What changed: Added `meeting-assistant/tests/` (`conftest.py` + `test_server.py`,
    30 tests) covering the deterministic logic added to `server.py` in the prior
    (unlogged) session: `_parse_meeting_draft_json`, `_extract_risk_level`,
    `_degraded_risk_result`, `_resolve_correlation_id`, `_check_within_declared_roots`
    (including dot-dot-traversal and sibling-directory-prefix boundary cases), and the
    two tools testable without mocking the Anthropic SDK or a Whisper model:
    `draft_followup_email` (pure formatting, no external calls) and `assess_draft_risk`'s
    degraded/no-sampling path (exercises its basis-building logic without a real model
    response). Each covered unit has happy-path, failure-path, boundary, and
    idempotency cases per this repo's Test Strategy Framework. `conftest.py` defines a
    `FakeContext`/`FakeSession` test double for `mcp.server.mcpserver.Context` (a
    pydantic model whose `.log()` needs a live session to construct for real) rather
    than mocking the real MCP transport. Added `pytest` and `pytest-asyncio` as dev
    dependencies (`uv add --dev`) and `[tool.pytest.ini_options]` (`pythonpath`,
    `asyncio_mode = "auto"`) to `pyproject.toml` -- this project had no test framework
    or test directory before. Documented the one-command test invocation and coverage
    scope in `meeting-assistant/README.md`.
  - Verification: `uv run pytest tests/ -v` — 30 passed, 0 failed (run from
    `meeting-assistant/`). One test's initial assumption about `assess_draft_risk`'s
    status handling was wrong (it marks every draft action item `"status": "open"`
    unconditionally, since a fresh draft has no persisted status yet) — the test was
    corrected to match that real behavior, plus a second boundary test added to
    document it explicitly, rather than changing the (correct) production code.
  - Notes: Out of scope for this pass: `transcribe_meeting_recording`,
    `summarize_meeting_note`, `draft_meeting_from_transcript`, and the model-available
    branch of `assess_meeting_risk`/`assess_draft_risk` — these need a mocked/real
    Whisper model or Anthropic API response to exercise meaningfully and are noted as
    a gap in both the test file's module docstring and the README, not silently
    skipped. The `server.py` feature work itself (recording→transcript→draft→risk→email
    pipeline, structured logging, roots-based path validation) landed in an earlier
    session that predates this repo's current PROGRESS.md gate and was not logged at
    the time; this entry catches up its test coverage only, per the Catch-up rule, and
    does not re-describe the feature itself (see the diff on `server.py` for that).

- [x] Generate an HTML pytest report on request and gitignore its output
  - Date: 2026-09-17
  - Session: CC-20260917-q3v8
  - What changed: Added `pytest-html` as a dev dependency (`uv add --dev`) so the user
    could view the 30-test suite's results as a browser page rather than terminal
    output. Generated `meeting-assistant/tests/report/test_report.html` via
    `uv run pytest tests/ -v --html=tests/report/test_report.html --self-contained-html`
    and opened it in the default browser. Added `.pytest_cache/` and
    `meeting-assistant/tests/report/` to the root `.gitignore` — this is a regenerable
    build artifact, not source, and shouldn't be committed.
  - Verification: Report generated with 30/30 passed (same run as the prior entry);
    opened successfully via `Start-Process` on the local file path.
  - Notes: The report file itself is gitignored and not meant to ship; only the
    `.gitignore` rule and the `pytest-html` dev dependency are durable changes.

- [x] Add reliability tests for the meeting-assistant MCP server across 7 categories
  - Date: 2026-09-17
  - Session: CC-20260917-b5n8
  - What changed: Extended `meeting-assistant/tests/conftest.py` with
    `FakeSession.create_message` (MCP sampling), `patch_whisper` (fakes
    `_get_whisper_model`/`_run_whisper_transcription`, including timeout-forcing
    delays), `patch_claude` (fakes `_get_claude_client`), and a `synthetic_data`
    fixture that monkeypatches `ACTION_ITEMS_PATH`/`MEETING_SUMMARIES_PATH`/
    `ATTACHMENTS_ROOT` to a throwaway synthetic tree so no test ever reads or writes
    the real files under `meeting-assistant/data/`. Added 7 new test files (68 tests):
    `test_transcription_reliability.py` (virtual/physical recordings, silent audio,
    corrupt file, model/transcribe timeouts), `test_summarization_and_draft_reliability.py`
    (summarization + draft extraction happy paths, missing-owner/missing-due-date
    flagging, unparseable/sparse model output, Claude timeout/rate-limit/auth/
    connection errors), `test_lookup_tools_reliability.py` (search_action_items,
    get_meeting_summary, read_meeting_attachment — previously untested),
    `test_risk_assessment_reliability.py` (model-available risk verdicts with
    evidence-based `basis`, sampling failure/empty-completion degrade paths —
    previously untested), `test_email_approval_gate.py` (asserts no registered MCP
    tool name looks send/deliver/dispatch-like, draft_followup_email always
    discloses it was not sent), `test_mcp_contract_and_empty_input.py` (empty
    transcript/text rejected via the real `mcp.call_tool` pydantic validation layer,
    not just the function body), `test_duplicate_requests_and_idempotency.py`
    (repeated calls never mutate the JSON data stores; full
    transcribe→draft→risk→email pipeline run twice with identical inputs produces
    byte-identical results). No changes to `server.py` (production code) or to the
    real files under `meeting-assistant/data/`.
  - Verification: `uv run pytest tests/ -v` from `meeting-assistant/` — 98 passed,
    0 failed (30 pre-existing + 68 new), reported on this exact run, not assumed.
  - Notes: Session ID was minted mid-task (the session started directly on the
    testing request rather than through the CLAUDE.md session-start protocol) —
    catch-up logging per the Catch-up rule, not a violation in progress. Every
    external service (faster-whisper, Anthropic Messages API, MCP client sampling)
    is mocked; no network call, no real API key, and no email send occurs anywhere
    in this suite. Remaining gaps (by design, per this repo's own mocking rule, not
    an oversight): no test exercises a *real* faster-whisper model or a *real*
    Anthropic API response — see the chat report for the full remaining-risk list,
    including that `search_action_items`/`get_meeting_summary` still have no
    negative/malformed-JSON-on-disk test, and that draft_meeting_from_transcript's
    `meeting_title` passthrough and `max_length` boundaries are untested.

- [x] Register the bold+italic reply-formatting hook
  - Date: 2026-09-20
  - Session: CC-20260920-x9q4
  - What changed: Added `.claude/hooks/bold-italic-format.sh`, a `UserPromptSubmit` hook
    that injects an `additionalContext` instruction on every turn telling Claude to wrap
    its whole text reply in Markdown bold+italics. Registered it under `UserPromptSubmit`
    in `.claude/settings.json`. That same `.claude/settings.json` diff also carried the
    `action-item-gate.sh` `Write`-matcher registration from the prior (already-logged,
    already-committed-in-PROGRESS.md-but-not-in-git) "Add /meeting-recap command and
    action-item-gate hook" entry, which had never actually been committed — this commit
    carries both registrations since they live in the same file and splitting one file's
    diff across two commits isn't possible with a plain `git add <path>`.
  - Verification: `bash -n .claude/hooks/bold-italic-format.sh` — syntax OK. Ran the
    script directly and parsed its stdout with `JSON.parse` (Node) — valid JSON, correct
    `hookEventName: "UserPromptSubmit"` shape.
  - Notes: First real run of the new `/mark-verification-complete` command. It surfaced a
    pre-existing gap it doesn't fully solve on its own: `.claude/settings.json` already
    held one prior story's uncommitted registration, so "stage exactly the files this
    piece of work touched" collapsed two stories into one commit at the file level. Flagged
    here rather than silently split or silently merged without comment.

- [ ] Add the PROGRESS.md commit gate hook (progress-gate.sh)
  - Date: 2026-09-20
  - Session: CC-20260920-x9q4
  - What changed: Added `.claude/hooks/progress-gate.sh`, a `PreToolUse`/`Bash` hook that
    blocks a `git commit` touching `backend/`, `frontend/`, `scripts/`, `nginx/`, or
    `directives/` when the same commit doesn't also include `PROGRESS.md`, per CLAUDE.md's
    PROGRESS.md hard gate. Registered it in `.claude/settings.json` alongside
    `commit-guard.sh` under the existing `Bash` matcher. Read-only by design: it only runs
    informational `git diff` plumbing, never `git add`/`commit`/`reset` or any Write/Edit —
    it can observe and block, but cannot "fix" a blocked commit by staging PROGRESS.md
    itself, since a hook that could satisfy its own gate would defeat the gate's purpose.
  - Verification: Built to fail loudly (block with a specific stderr reason) rather than
    silently allow. Live-tested against the actually-wired hook in this session (not just
    simulated payloads): (1) staged a real `scripts/` file with PROGRESS.md unstaged ->
    real `git commit` blocked, exit 2, correct reason printed; (2) same file staged
    together with a real PROGRESS.md change -> allowed; (3) an ungated `docs/` file alone
    staged -> allowed silently. Deliberately broke it on purpose: ran a real
    `git commit -am "..."` in the same Bash call as an uncommitted edit to a tracked
    `scripts/` file (no prior `git add`) -- the first hook version let this through as a
    real, uncommitted-but-live local commit (`98a5e61`), because a `PreToolUse` hook can
    only see git state as it existed *before* the tool call runs, so the file's not-yet-run
    modification and the `-am` sweep were both invisible to the pre-check. Un-did that
    commit locally with `git reset --soft HEAD~1` (nothing pushed) and fixed the hook to
    block outright (fail closed) whenever `git commit` is not the true leading statement of
    the whole command, rather than trying to guess whether an unseen prior statement was
    safe. Re-verified the fix against the exact failing case (now blocked) and against all
    three passing scenarios above (still correct, no regression).
  - Notes: A related bug was found and fixed during the same pass: the leading-statement
    check first used `grep -E '^...'`, but grep's `^` anchors per *line*, not per whole
    string, so a `git commit` starting line 3 of a multi-line command looked "leading" too.
    Switched that one check to bash's own `[[ =~ ]]`, which anchors to the whole string.
    Known, accepted limitations (fail-loud only where it can actually see state, not a
    guarantee against every bypass): (1) keyword-based detection can false-positive on a
    command that merely contains the text "git commit" in an unrelated quoted string
    (observed live during this session's own testing); (2) any `git commit` combined with
    another statement in the same call is now blocked outright rather than evaluated, even
    when that other statement was harmless (e.g. `cd dir && git commit -m ...`) -- this
    trades some false positives for closing the state-visibility gap; (3) it has no way to
    know whether a PROGRESS.md entry actually describes the change or is a placeholder --
    it only checks that the file is part of the same commit, not the content's honesty.
    This entry is left unchecked (`- [ ]`) pending the user's decision on whether/when to
    commit `progress-gate.sh` and `.claude/settings.json` themselves — not yet committed.

- [x] Add /session-start command and claude-dir-drift-warn.sh hook
  - Date: 2026-09-20
  - Session: CC-20260920-b3n7
  - What changed: Added `.claude/commands/session-start.md`, a read-only slash command
    that runs CLAUDE.md's Session start protocol in one shot (mint a fresh Session ID,
    read CLAUDE.md and PROGRESS.md in full, check the ID against PROGRESS.md for
    collisions, report the first unchecked task and any other instance's in-flight
    entries). Added `.claude/hooks/claude-dir-drift-warn.sh`, a non-blocking `PreToolUse`
    `Bash` hook that, on a leading git-commit call, compares `.claude/`'s real dirty
    state (staged/unstaged/untracked) against what that commit actually includes and
    attaches a `permissionDecisionReason` warning (never a block) when something's left
    out — the config-drift case `progress-gate.sh` doesn't cover since it only watches
    `backend/frontend/scripts/nginx/directives`. Registered the new hook in
    `.claude/settings.json` alongside `commit-guard.sh`/`progress-gate.sh` under the
    existing `Bash` matcher. Documented both in `.claude/README.md`.
  - Verification: `bash -n .claude/hooks/claude-dir-drift-warn.sh` -> syntax OK.
    `.claude/settings.json` parses as valid JSON (`JSON.parse` via `node -e`). Live-tested
    the hook against four real stdin payloads (not simulated): (1) a bare git-commit
    payload with real dirty `.claude/` files present -> warned, listing exactly those
    files; (2) same scenario after staging some of them -> warning narrowed to only the
    still-uncommitted files, correctly excluding what was now staged; (3) a compound
    two-command payload (stage-then-commit) -> skipped silently (plain allow, no
    warning), matching the documented leading-statement limitation instead of
    false-positiving; (4) an unrelated `npm test` payload -> plain allow, untouched.
    `session-start.md`'s frontmatter (`description`, `allowed-tools`) parses and matches
    the shape of the repo's other command files; it has not been live-invoked as an
    actual slash command in this session, since it is a read-only prompt file with no
    independent mechanical test.
  - Notes: Testing this hook also reproduced `progress-gate.sh`'s already-documented
    false-positive live: a test Bash command whose text merely contained the two-word
    git-commit phrase inside a quoted JSON string got blocked by that hook (not a new
    bug — confirms the existing limitation noted in the entry above). Worked around it
    in testing by writing payloads to scratch files and piping from the file instead of
    inlining that text in the Bash command, and used the Edit tool rather than a Bash
    heredoc to write this very entry for the same reason (it also names that phrase).

- [x] Add circuit breaker + composed reliability wrapper for audioIngestion external calls
  - Date: 2026-09-26
  - Session: CC-20260926-v6qz
  - What changed: Added `backend/src/services/audioIngestion/circuitBreaker.ts` (a
    `CircuitBreaker` class with closed/open/half_open states, configurable
    `failureThreshold` and `cooldownMs`, single-probe half-open gating so concurrent
    callers don't all spend their own timeout re-discovering a down upstream, and an
    `onStateChange` hook for logging/metrics), a new `CircuitOpenError` in `errors.ts`,
    and `withReliability.ts` composing the breaker AROUND the existing
    `withTimeoutAndRetry.ts` so one fully-retried operation counts as exactly one breaker
    outcome (not `maxAttempts` of them). This was the missing piece: timeout+retry
    already existed here and is used by `transcriptionService.ts`, but no circuit
    breaker existed anywhere in the backend.
  - Verification: `npm run typecheck` (backend) passes clean. `npx jest
    src/services/audioIngestion src/services/transcription` — 14 suites, 107 tests, all
    passing, no regressions. New coverage: `circuitBreaker.test.ts` (8 tests: starts
    closed, trips after `failureThreshold` consecutive failures, rejects without calling
    the operation while open, waits the full `cooldownMs` before probing, a successful
    probe closes it, a failed probe reopens and restarts the cooldown, only one probe
    runs at a time under concurrent callers, `onStateChange` fires only on real
    transitions) and `withReliability.test.ts` (4 tests, including the key composition
    behavior: an exhausted retry only trips the breaker's failure count by 1).
  - Notes: Not yet wired into a real client (`meetClient.ts`/`zoomClient.ts`/
    `teamsClient.ts`) — this session's ask was the reusable module + explanation, not an
    integration; wiring it into a specific client is a natural next step if requested.

- [x] Add idempotent user profile update demo to reliability-lab
  - Date: 2026-09-26
  - Session: CC-20260926-v6qz
  - What changed: Added `reliability-lab/profile.js` (`applyProfileUpdate`, a pure
    field-assignment merge that is idempotent by construction since every field is a "set"
    never a delta; `updateUserProfile`, which wraps it in the existing `runOnce` idempotency
    helper keyed on `(userId, requestId)` so a retried request doesn't re-stamp `updatedAt`
    or append a duplicate audit event), `reliability-lab/profileDesk.js` (CLI: `update
    <userId> <requestId> <json-updates>` / `show <userId>`), and
    `reliability-lab/check-profile-idempotency.js` (plain-script test, no framework, exits
    non-zero on failure, matching this folder's existing `check-idempotency.js` pattern).
    Wired into `reliability-lab/package.json`: `npm test` now runs both checks; added
    `test:profile` and `profile` convenience scripts.
  - Verification: `npm test` (reliability-lab) — both check scripts pass: order-confirm
    idempotency (pre-existing) and the 3 new profile checks (pure-function convergence,
    same-requestId dedup across 3 calls with 1 audit event and unchanged `updatedAt`,
    different-requestId-same-values converges on data fields while still logging a new
    event). Also manually ran `node profileDesk.js update demo-user req-1 '{"name":"Alan
    Turing","email":"alan@example.com"}'` three times by hand: first call `duplicate:
    false`, next two `duplicate: true`, stored profile byte-identical (including
    `updatedAt`) across all three.
  - Notes: `data/` in this folder is gitignored (scratch state), so `profiles.json` and
    `profile-events.jsonl` are not committed — consistent with the existing `sent.log`/
    `keys.json`/`breaker.json` files already in that folder.

- [x] Add quality-gate evaluation script for a batch of AI-generated outputs
  - Date: 2026-09-26
  - Session: CC-20260926-v6qz
  - What changed: Added `reliability-lab/evaluate-outputs.js`, which runs `vendor.js`'s
    stand-in AI outputs (`ok`/`garbage` modes) across 5 order ids each through the
    existing `scoreBreakdown()`/`QUALITY_THRESHOLD` from `reliability.js` (Accuracy =
    exact order id present, Safety = no disclaimer/refusal phrase, Relevance = length
    envelope), then adds the two axes that gate doesn't measure on its own: a
    Consistency check (same input run 5x, are scores stable?) and Performance (latency
    per call), plus a simulated User Feedback proxy (auto-accept / accept-with-edit /
    reject bucketed from score) standing in for real reviewer disposition data. User
    asked to evaluate a batch of outputs against the quality gate criteria defined
    earlier in this session and discuss production-deployment implications; there is no
    "Claude Studio" tool available in this environment (confirmed via ToolSearch — no
    matching tool exists), so this script + a direct LLM-judge write-up substituted for
    it, per the user's explicit choice when asked.
  - Verification: `node evaluate-outputs.js` — ran live. `ok` mode: 5/5 pass (score 100,
    avg latency 58ms). `garbage` mode: 0/5 pass (scores 30-60, avg latency 58ms).
    Consistency: `ok` stable across 5 runs (100 every time); `garbage` unstable (scores
    swing 30/60 run to run depending on which garbage variant `vendor.js` randomly
    picks) — output pasted in the session write-up.
  - Notes: This is a demonstration harness over the repo's existing stand-in vendor, not
    a real production output stream — it shows the gate mechanics and what the resulting
    data would inform, not a claim about any real model's actual output quality.

- [x] Connect the meeting workflow end to end + one review page
  - Date: 2026-10-03
  - Session: CC-20261003-q4tz
  - What changed: Added `backend/src/services/meetingPipeline/` (orchestrator wiring the
    existing services in order: physical audio ingestion → transcription → diarization/
    speaker mapping → meeting summary → segment marking → discussion summary → decisions →
    action items → STOP at Gate #1; then approve → email drafting → STOP at Gate #2; then
    approve → send each email once → action-item tracker "Not Started"). Added
    `backend/src/routes/meetingPipeline.ts` (`POST /api/meetings/draft`, `GET /:runId`,
    `POST /:runId/approve-minutes`, `POST /:runId/approve-emails`, Zod-validated), a single
    static page `backend/public/index.html` (upload box, draft minutes with decisions and
    action items, Approve button), `server.ts` wiring, and `npm run dev:demo`.
    Files: meetingPipeline/{types,errors,auditLog,runStage,draftMinutes,
    meetingPipelineService,demoProviders,meetingPipelineService.test}.ts,
    routes/meetingPipeline{,.test}.ts, public/index.html, server.ts, package.json.
  - Verification: `npx jest` — 33 suites / 286 tests pass (11 new: happy path, both gates
    blocking out-of-order steps, replay/concurrent double-approve sends once, failed send
    resumes only remaining recipients, stage-named provider failure, 400/404/409/422/503
    route cases, page served). `tsc --noEmit` passes. Live run of `ts-node src/server.ts
    --demo-providers` driven over HTTP: draft → early send refused 409 → approve minutes →
    personalized emails → approve emails → sent to 2, 2 action items tracked.
  - Notes: ESCALATION OPEN — no real provider exists for speech-to-text, diarization,
    topic/decision/action-item extraction, mail delivery, or the tracker (each service's
    types.ts already flags these as paid-external-dependency decisions). Only clearly
    labelled demo providers are wired (sample content regardless of upload; nothing is
    actually emailed; page shows a demo banner). Without `--demo-providers` the API answers
    503. Attendees also carry no email addresses yet. Assumptions: uploads go through the
    physical-ingestion path (room_mic default); speaker names are prefixed onto segment text
    before extraction so owners/approvers can be attributed; sends use 1 attempt (no auto
    retry, to avoid duplicates) and resume on re-approval; all state is in-process memory
    like the wrapped services.

- [x] Real meeting workflow, stage 1: real recording → local Whisper → Claude analysis → draft in UI
  - Date: 2026-10-04
  - Session: CC-20261003-q4tz
  - What changed: Added real providers under `backend/src/services/meetingPipeline/providers/`
    (`whisperTranscriptionClient.ts` spawning new `meeting-assistant/whisper_transcribe.py`
    via `uv`, no shell; `claudeAnalysisClient.ts` using the official `@anthropic-ai/sdk` with
    `claude-sonnet-5-5`, JSON-schema structured output, one memoized call per transcript,
    line-index evidence mapped to real timestamps, blanks never filled; `realProviders.ts`
    startup/config checks; `providerErrors.ts`). `npm run dev` is now real mode; sample data
    only via explicit `npm run dev:demo`. Pipeline refuses a phase with
    `ProviderNotConfiguredError` (HTTP 503 listing each missing item) instead of falling back;
    per-stage timeouts/attempts for slow providers; server request timeout raised to 45 min.
    Page shows provider status on load, blocks upload when misconfigured, shows transcript
    evidence per decision/action item. `npm audit fix` cleared prod CVEs in multer/qs.
  - Verification: `RUN_WHISPER_TEST=1 npx jest` — 35 suites / 296 tests pass (incl. real
    Whisper on sample-standup-recording.wav); `tsc --noEmit` passes; `npm audit --omit=dev`
    0 vulnerabilities. Live run of `npm run dev` on :3000: sample WAV and an MP4 built from it
    both → real transcript → Claude draft (1 decision; Priya's contract item with "by Friday"
    left as no due date; legal follow-up left ownerless — both flagged). Approve minutes →
    2 emails drafted; approve emails → 503 "SMTP sending is not connected yet".
  - Notes: Stage 2 (SMTP, `Name <email>` attendees, JSON tracker, AssemblyAI diarization) not
    started — waiting on the user's browser test of stage 1. Assumption: new action items get
    status "open" (not inferred content). Claude call opts into the server-side refusal
    fallback (`fallbacks: "default"`).

- [x] Real meeting workflow, stage 2: SMTP sending + local JSON action-item tracker
  - Date: 2026-10-04
  - Session: CC-20261003-q4tz
  - What changed: Added `providers/smtpEmailClient.ts` (nodemailer; exact missing-variable
    report for SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/MAIL_FROM; optional
    SMTP_ALLOWED_RECIPIENTS safety list; explicit connection/greeting/socket timeouts; classified
    errors that never echo credentials), `providers/jsonActionItemTracker.ts`
    (backend/data/action-items.json, atomic writes), and `jsonFileMap.ts` so the sent-email log,
    tracker log, and attendee addresses persist in backend/data/ (gitignored) and the
    duplicate-send guard survives restarts. Attendees accept `Name <email>` (parsed and validated
    in the route); the pipeline checks every pending recipient has an address and passes the
    allowlist BEFORE recording Gate #2, so a problem never half-sends. Page shows To: addresses,
    per-email sent status, send-config problems on load, and a confirm dialog listing real
    recipients before sending. `npm run dev` loads an optional gitignored backend/.env.
  - Verification: `RUN_WHISPER_TEST=1 npx jest` — 37 suites / 309 tests pass (SMTP tests use a
    fake transport — no real email sent); `tsc --noEmit` passes; `npm audit --omit=dev` 0
    vulnerabilities. Live on :3000 without SMTP vars: real draft → approve minutes → approve
    emails answered 503 naming the five missing variables; run stayed at
    emails_pending_approval with nothing sent.
  - Notes: No real email was sent (user asked to approve the first real send). AssemblyAI
    diarization still not built. Known gap: a crash between a successful SMTP send and the
    sent-log write could repeat that one email on replay.

- [x] Document SMTP settings in backend/.env.example
  - Date: 2026-10-04
  - Session: CC-20261003-q4tz
  - What changed: Added the SMTP_* / MAIL_FROM / SMTP_ALLOWED_RECIPIENTS block to
    `backend/.env.example`. Also created the user's local gitignored `backend/.env` with Gmail
    settings and an empty SMTP_PASS for the user to fill in (not committed).
  - Verification: `git check-ignore backend/.env` confirms it is ignored; server not restarted
    yet so the user's in-memory draft is preserved.

- [x] Draft-only email mode (default): final approval records + tracks, never sends
  - Date: 2026-10-04
  - Session: CC-20261003-q4tz
  - What changed: Added `EmailMode` ('send' | 'draft-only') to the pipeline. Real mode is
    draft-only unless `EMAIL_MODE=smtp` (then all SMTP_* vars are required); no SMTP
    credentials needed or read otherwise. In draft-only, Gate #2 is still required: approving
    it records a persisted `FinalApprovalRecord` (backend/data/final-approvals.json), logs
    action items to the JSON tracker as "Not Started", and never calls the delivery client
    (which itself refuses if ever called). New stage `approved_not_sent`; missing addresses do
    not block. Page shows "Email sending disabled — draft only." banner, every draft email
    open with "Would be sent to …" and full To/Subject/body, final-approval button labelled
    draft-only, and an "Approved — not sent" summary. User's `backend/.env` reset to
    `EMAIL_MODE=draft-only` with no SMTP values; `.env.example` documents EMAIL_MODE.
    Claude prompt now also keeps tasks the meeting says still need doing with no owner.
  - Verification: `RUN_WHISPER_TEST=1 npx jest` — 38 suites / 313 tests pass (new
    draftOnlyMode.test.ts: delivery client is a throwing spy, never called; replay/concurrent
    final approval records once); `tsc --noEmit` passes. Live run on a throwaway data dir
    (port 3019): sample WAV → draft → approval 1 → emails (Priya with address, Million
    without) → approval 2 → `approved_not_sent`, sentTo [], 1 action item tracked, 0
    `smtp_email_sent` log lines. After the prompt fix, the sample yields both action items
    (Priya's, and the ownerless legal follow-up). Server back on :3000 in draft-only mode.
  - Notes: A run approved in draft-only stays "approved — not sent" even if sending is turned
    on later (no retroactive sending).

- [x] Never infer gender or pronouns in generated minutes
  - Date: 2026-10-04
  - Session: CC-20261003-q4tz
  - What changed: Added `providers/genderedLanguage.ts`: `NEUTRAL_LANGUAGE_RULE` (now part of
    the Claude system prompt — use stated names, roles, speaker labels, or they/them; gendered
    pronouns/honorifics only when the transcript itself uses them) and a deterministic check,
    `findUnsupportedGenderedTerms`, over every generated topic title/summary, decision,
    rationale, and action item. On unsupported gendered words the Claude client retries once
    with a named correction; if they persist, the draft fails with `UngroundedGenderedLanguage`
    instead of showing them. Email drafts are built only from the checked minutes plus a
    neutral template.
  - Verification: `RUN_WHISPER_TEST=1 npx jest` — 39 suites / 322 tests pass (new
    genderedLanguage.test.ts: "introduces himself as Milen" flagged; neutral wording passes;
    transcript-supported "she" allowed; retry-then-accept and retry-then-fail; action items
    checked; email drafts contain no unsupported gendered words); `tsc --noEmit` passes.
    Live real draft of the sample recording on :3000: summaries use "an unidentified
    speaker"/"the speaker", no gendered words.
  - Notes: Support is checked per word family across the whole transcript, not per person (no
    speaker identity exists to do better); documented in the module header.

- [x] Keep the draft email visible after final approval (draft-only)
  - Date: 2026-10-04
  - Session: CC-20261003-q4tz
  - What changed: Root cause — the approved email batch lived only in the in-memory Gate #2
    store, so after a server restart a re-uploaded, already-approved recording showed
    "Approved — not sent" with no draft. `FinalApprovalRecord` now also saves the approved
    batch and the recipient addresses (backend/data/final-approvals.json); `getRun` falls back
    to them. Page script moved to `backend/public/app.js`; the page now shows "Draft Email"
    (collapsible, open by default: Recipient name <email>, Subject, complete body, Status
    "Draft only — not sent") followed by "Final Approval" (Approved by, Approval date/time,
    Status "Approved — not sent"). An approval saved before this change shows an explicit
    "draft was not saved" note instead of nothing. Added dev dependency
    `jest-environment-jsdom@29` for the page test.
  - Verification: `RUN_WHISPER_TEST=1 npx jest` — 40 suites / 325 tests pass (new
    reviewPage.test.ts runs the real app.js in jsdom: after final approval with zero decisions
    and zero action items, the full draft, its status, and the final-approval block render,
    draft precedes approval and still collapses; draftOnlyMode.test.ts: emails kept after
    approval and after a simulated restart). `tsc --noEmit` passes; prod audit 0. Server
    restarted on :3000 (draft-only); page and app.js serve 200.

- [x] Approved meetings persist as full records across page refresh and server restart
  - Date: 2026-10-04
  - Session: CC-20261003-q4tz
  - What changed: The final-approval record (backend/data/final-approvals.json) now also saves
    the approved minutes and the speaker-labelled transcript alongside the approved email batch
    and recipients. `getRun` serves approved meetings from that record when nothing is in
    memory; re-uploading an approved recording reopens the record without calling Whisper or
    Claude; repeated approvals on a saved record are no-ops. The page keeps `?run=<id>` in the
    address bar and reloads that meeting on refresh (clear message if a not-yet-approved draft
    was lost to a restart). Draft-only mode unchanged; nothing is sent.
  - Verification: `RUN_WHISPER_TEST=1 npx jest` — 40 suites / 328 tests pass (new: pipeline
    reload after restart with no upload + no re-transcription + no send; API GET after restart
    returns the approved draft; page reopens `?run=` and shows the saved draft and approval).
    `tsc --noEmit` passes. Live: approved the sample on a throwaway-data server (:3019),
    restarted it, `GET /api/meetings/:id` → 200, approved_not_sent, Priya's draft (623 chars),
    8 transcript lines, with 0 Whisper/Claude/SMTP calls after restart. Main server restarted on
    :3000 in draft-only mode.
  - Notes: Meetings not yet approved are still memory-only and are lost on restart (by design
    for now). The one meeting approved before drafts were saved still cannot show its draft.

- [x] Fix: draft email hidden for a re-uploaded recording with an older approval record
  - Date: 2026-10-04
  - Session: CC-20261003-q4tz
  - What changed: Root cause (from the running app's logs + backend/data): meetings are keyed by
    the audio's SHA-256, and the user's "new" meetings (02:03Z, 02:08Z) were the same audio as a
    meeting approved at 01:43Z, before drafts were saved. That incomplete approval record plus
    its tracker entry made `getRun` report `approved_not_sent` for the fresh run, so the page hid
    the Approve button; "approve minutes" was never called, so no draft was ever created (logs:
    no email-drafting events). Fix in `meetingPipelineService.getRun`/final approval: only a
    COMPLETE saved record (minutes + transcript + emails) can mark a meeting approved or supply
    its final-approval details; an incomplete one is ignored for display and replaced by the next
    final approval. Page labels the draft fields To / Subject / Body. Added dev deps `jsdom@20`,
    `@types/jsdom@20` for the end-to-end test.
  - Verification: new `draftEmailFlow.integration.test.ts` (real app + real pipeline + real
    app.js in jsdom, fetch wired to the app): draft created; API returns it; To/Subject/Body
    shown before final approval, unchanged after it with Approved by / date-time / "Approved —
    not sent" below; shown again after a simulated restart + page refresh; delivery spy and
    nodemailer.createTransport never called. Regression case seeds the exact legacy record —
    confirmed it FAILS with the old getRun logic and passes with the fix. Full suite
    `RUN_WHISPER_TEST=1 npx jest` 41 suites / 330 tests pass; `tsc --noEmit` passes. Restarted
    :3000; live sample upload → approve minutes → emails_pending_approval with Priya's draft
    (Subject "Recap and action items: Live check", 582 chars); 0 smtp sends.
  - Notes: Tracker dedupe still keys on the run id, so action items logged by the old approval
    are not re-logged when the same recording is approved again.

- [x] Redesign the Meeting Assistant demo UI into a 5-step review dashboard
  - Date: 2026-10-04
  - Session: CC-20261003-q4tz
  - What changed: Rebuilt `backend/public/` as `index.html` + `styles.css` + `ui.js` (rendering
    helpers) + `app.js` (state/requests/events): header with "Meeting Assistant" title, subtitle,
    and mode badge ("● Draft-only mode — emails are not sent"); 5-step stepper (✓ done,
    highlighted current, aria-current); drag-and-drop upload card (formats, selected filename,
    title, attendees Name <email>, reviewer, "Generate Meeting Minutes"); processing card with
    real server-reported phases + elapsed clock (no percentages); minutes as cards (summary with
    timestamps, decisions each with evidence, action-items table Task/Owner/Due date/Status with
    "Not stated" instead of invented values, collapsible "View full transcript"); email shown as
    an email preview (To/Subject/body, "DRAFT — NOT SENT" badge); completion card ("Meeting review
    complete", checklist, "Email sent: No — Draft-only mode", approved by/time) with the email
    draft kept underneath. Backend addition for real progress only: `uploadProgress.ts` tracker,
    optional `uploadId` form field, `GET /api/meetings/progress/:uploadId`, and an optional
    `onProgress` hook in `draftMinutes` (stages run exactly as before).
  - Verification: `RUN_WHISPER_TEST=1 npx jest` — 42 suites / 333 tests pass (page + end-to-end
    tests updated to the new labels/layout; new uploadProgress.test.ts and progress route test);
    `tsc --noEmit` passes. Restarted :3000; `/`, `/styles.css`, `/ui.js`, `/app.js` serve 200;
    live sample upload reported progress transcribing → analyzing → done and returned a draft.

- [x] Five-step Meeting Assistant UI (one stage at a time)
  - Date: 2026-10-04
  - Session: CC-20261003-q4tz
  - What changed: Replaced the single-page dashboard with an app shell + one-screen-at-a-time
    flow in `backend/public/`: `index.html` (header, "Draft-only mode" badge with tooltip, stepper,
    view area, sticky action bar), `styles.css` (new visual system, responsive, reduced-motion),
    `js/state.js` (single store), `js/api.js` (wrappers over existing endpoints), `js/components.js`,
    `js/views/{upload,processing,review,email,complete}.js`, `js/app.js` (navigation, ?run=&view=,
    double-submit guard, retry). Upload: drop zone → file card (type/size, Change/Remove), CTA
    disabled until ready, hint for attendees entered as a bare email. Process: six display stages
    mapped to real server stages, failed stage + Retry/Edit details keeping all inputs. Review:
    meeting info card, summary, decisions, action items (Not specified), collapsed transcript,
    "Human approval #1 of 2". Email: realistic preview, attendee tabs (arrow keys), "DRAFT ONLY •
    NOT SENT", "Human approval #2 of 2". Complete: success hero, checklist, "Not sent — Draft-only
    mode", approver/time/action-item count, View Minutes / View Email / Start New Meeting. Old
    `public/app.js`, `public/ui.js` removed. No backend changes; email template unchanged.
    Test harness `src/routes/__testutils__/pageHarness.ts` (excluded from tsc build).
  - Verification: new `meetingAssistantUi.integration.test.ts` (real page scripts in jsdom + real
    Express app + pipeline): full journey with Back preserving state, stepper navigation, one
    request per double-clicked submit/approval, attendee tabs incl. keyboard, read-only
    revisits, completion facts, draft visible after completion and after server restart + refresh,
    no delivery/nodemailer calls; failure → "Transcribing meeting — failed" → Edit details keeps
    inputs → retry succeeds; bare-email hint; legacy-record regression. Replaced reviewPage.test.ts
    and draftEmailFlow.integration.test.ts. `RUN_WHISPER_TEST=1 npx jest` 41 suites / 332 tests
    pass; `tsc --noEmit` passes. Restarted :3000; all 11 page assets serve 200.
  - Notes: Not visually inspected in a real browser in this session (no browser tool available).

- [x] Linear/Notion-style redesign: app shell, design tokens, 7 screens (+3 read/edit endpoints)
  - Date: 2026-10-04
  - Session: CC-20261003-q4tz
  - What changed: Frontend rebuilt in `backend/public/` on the same no-build stack:
    `styles/tokens.css` (all colours/spacing/radius/type/motion; light + dark via
    prefers-color-scheme or Settings), `styles/{base,layout,screens}.css`, self-hosted Inter
    (`fonts/InterVariable.woff2`, OFL licence file alongside), Lucide outline icons inlined in
    `js/core/icons.js`. Shell: sidebar (Meetings, Action items, Settings, draft-only pill), top bar
    search + ⌘K/Ctrl+K command palette + reviewer-initials avatar, toasts. Screens: Meetings
    dashboard (stat cards, table with status badges, empty/no-match states), Upload (drag-drop,
    in-browser recording encoded to 16 kHz WAV in `js/core/audio.js`, file card, validation
    copy), Processing (real byte progress via XHR + server stages, skeletons, Try again), Review
    (transcript left with clickable timestamps; editable summary/decisions/action items with
    done checkbox, owner, due date; autosave with Saved indicator; approval 1 of 2), Send
    confirmation (recipient list + email preview; "Approve (draft only)"; approved state keeps
    the email visible), Action items, Settings (theme, name, connections). Backend additions
    (approved by user): `meetingQueries.ts` (`GET /api/meetings`, `GET /api/meetings/action-items/all`,
    read-only) and `minutesEditing.ts` (`POST /api/meetings/:runId/minutes`, Zod-validated, via
    Gate #1's existing `requestRevision`; recomputes missing-field flags; no-op on identical
    edits; 409 after approval). Approvals, sending, transcription, analysis unchanged. Fixed
    two bugs the new tests found: background list refreshes redrew an open review (wiping
    in-progress edits), and Approve redrew before the last edit was saved.
  - Verification: `RUN_WHISPER_TEST=1 npx jest` — 42 suites / 337 tests pass, exits cleanly
    (new meetingQueriesAndEdits.test.ts; meetingAssistantUi.integration.test.ts rewritten:
    full journey incl. validation, double-click guards, autosave persisted server-side,
    transcript highlight, recipients incl. keyboard, read-only revisit, draft-only toast,
    lists, search, ⌘K, dark theme, restart+refresh, no delivery/nodemailer calls; failure +
    Try again; name required; WAV encoder accepted by the server; legacy regression).
    `tsc --noEmit` passes. Live on :3000 with real Whisper + Claude: all 20 assets 200; real
    draft → edit save returned updated due dates → list shows it as Needs review; server then
    restarted to clear that test draft.
  - Notes: Checkbox = "done" (user accepted recommendation). Not visually inspected in a real
    browser in this session. Old `public/js/{state,api,components,app}.js`, `js/views/*`,
    `styles.css` removed.

- [x] "This week" calendar — server side (all steps) + UI steps a (open/close panel) and b (week & list views)
  - Date: 2026-10-04
  - Session: CC-20261003-q4tz
  - What changed: New `backend/src/services/schedule/` (`types.ts`, `errors.ts`,
    `scheduleService.ts` — create/update/reschedule/postpone (new time or date TBD)/cancel/
    restore/delete/single-step Undo/link recording, version checks, locking once a recording is
    attached, overlap warnings, structured change history; `notifications.ts` — deterministic
    postponed/cancelled notices, draft-only never sends, per-(meeting,change,recipient) sent log so
    retries only send what didn't go out). New `routes/schedule.ts` (`/api/schedule` list-by-week,
    get, create, update, postpone, cancel, restore, undo, delete, notices preview, notify;
    Zod-validated; http(s)-only links). `/api/meetings/draft` accepts `scheduledMeetingId` (checked
    before processing; recording attached after). Server stores schedule in
    backend/data/schedule.json and notice log in schedule-notices.json. Frontend: `styles/calendar.css`,
    `js/calendar/{model,dialog,weekView,listView,details,panel,controller}.js`; "Meetings this week"
    card is now an aria-expanded toggle (chevron, accent active border); panel with week grid
    (Mon–Fri + weekend when needed, 9–5 widened to fit, overlaps side by side, today column + now
    line, tooltips, faded "Moved to …" outlines, recorded meetings as all-day chips), list view
    (automatic on narrow screens), prev/next/Today, Week/List, Show changes/Show cancelled, legend,
    "Postponed, date TBD" list, read-only details popover with change history; Esc/X/card close;
    session-remembered; shared status vocabulary (`MA.displayStatus`, new `badge-accent`).
  - Verification: `RUN_WHISPER_TEST=1 npx jest` — 45 suites / 348 tests pass (new
    scheduleService.test.ts, routes/schedule.test.ts, calendarUi.integration.test.ts); `tsc
    --noEmit` passes. Restarted :3000; calendar assets 200; `GET /api/schedule` answers for the
    current week.
  - Notes: The dashboard loads the current week once for the count (the count needs scheduled
    meetings), so the panel opens instantly for this week; other weeks load on demand with
    skeletons. Steps c–h (add, edit/drag, cancel UI, postpone UI, notification UI, upload link UI)
    not built yet — waiting for the user to try a+b. Weekend columns also appear for recordings
    dated on a weekend (found live: the user’s Sunday recording would otherwise be hidden).

- [x] "This week" calendar — step c: add meetings (button, click a slot, drag)
  - Date: 2026-10-04
  - Session: CC-20261003-q4tz
  - What changed: `public/js/calendar/form.js` (add/edit form as popover / bottom sheet: title
    required, date + start + end, participant email chips accepting `Name <email>` with Enter or
    comma, optional link (http/https) and agenda; inline errors via aria-describedby/aria-invalid;
    non-blocking overlap warning; single in-flight save) and `addMeeting.js` ("New meeting" = next
    free half-hour today; click a slot = 30 min at that time; drag across slots = start/end with a
    live dashed preview; on save: toast "Meeting added" (with overlap note), week reload, count
    refresh). Week view stays visible when empty so slots can be used. Fixed a duplicate id
    (`calTitle` used by both the panel heading and the form title) the tests caught.
  - Verification: `RUN_WHISPER_TEST=1 npx jest` — 45 suites / 350 tests pass (new calendar tests:
    keyboard path with validation, chips incl. invalid email, save → toast → block → count 0→1;
    slot click prefill + overlap warning still saveable; drag 1:00–3:00 PM preview + prefill; cancel
    creates nothing). `tsc --noEmit` passes. Live :3000 serves the new scripts.

## Meeting Assistant upgrades (calendar sync, people, search, spell check, recording, mobile)

- [x] Step a — Meetings header: "View calendar", "Record meeting" menu, mobile "More", search placeholder
  - Date: 2026-10-04
  - Session: CC-20261004-k7q2
  - What changed: new `backend/public/js/core/menu.js` (accessible dropdown: arrows/Home/End/Esc,
    outside click, focus return, toggle on second click); `screens/meetings.js` header now has
    "View calendar"/"Hide calendar" (aria-expanded/controls, same toggle as the summary card),
    "Record meeting" menu (In-person / Online on this computer) and primary "Upload meeting";
    below 640px the secondary buttons collapse into a 44px "More" menu. `calendar/controller.js`
    returns focus to whichever control closed the panel; Esc ignores the panel while a menu is
    open. `app.js` `recordMeeting(mode)`: in-person starts the existing browser recorder; online
    capture shows an explicit "isn't available yet" toast until step g. Search placeholder/label →
    "Search meetings, transcripts, or action items". Page header title side now shrinks before
    the actions wrap.
  - Verification: new `src/routes/meetingsHeaderUi.integration.test.ts` (4 tests) + existing UI
    suites pass (13/13); headless Chrome screenshots at 1280px light/dark and 375px — no
    horizontal scroll (scrollWidth 375), secondary buttons hidden and "More" shown on phone.
  - Notes: user approved the plan 2026-10-04 (MiniSearch, nspell + dictionary-en, single-user
    access model for now, direct-REST calendar OAuth with encrypted tokens).

- [x] Step b — Participants with names and avatars; People list
  - Date: 2026-10-04
  - Session: CC-20261004-k7q2
  - What changed: backend `services/people/` (identity.ts: readable name from email, initials,
    FNV-1a avatar colour from a 10-colour AA palette; peopleService.ts: People directory keyed by
    lower-cased email, name precedence edited > calendar > typed-with-address > derived, photo
    edited > calendar, idempotent `observe`), `routes/people.ts` (GET /api/people refreshes from
    meetings + scheduled meetings; PUT /api/people/:id, zod-validated, https-only photo links,
    404/503), server wiring (`people.json` in real mode), `MeetingListItem.people` (name + email),
    `ScheduleService.listAll()`. Frontend `core/people.js` (mirror of identity helpers, resolve,
    suggestions, avatar with image→initials fallback, avatar stacks of 3 + "+N" with spoken label
    and a names+emails popover, person chips), `screens/people.js` (People page with filter and
    per-row name/photo edit), `styles/people.css`; avatars in meetings table, calendar blocks
    (non-interactive stack), list view, tooltips (name · email), details popover, review header,
    transcript speakers, action-item owners, send screen; New-meeting participant chips now show
    avatar + name (email on hover) with a keyboard-operable suggestions list. Page-test harness
    now forwards PUT/DELETE. Calendar form time inputs no longer overflow.
  - Verification: new identity.test.ts (incl. server/browser parity + palette contrast ≥ 4.5),
    peopleService.test.ts, routes/people.test.ts, peopleUi.integration.test.ts; full suite 50
    suites / 374 passed (1 skipped); `tsc --noEmit` passes; headless Chrome screenshots (desktop
    light/dark, 375px People page, scrollWidth 375).
  - Notes: Updated one existing calendar test assertion — chips intentionally show the name only
    (address on hover). Review/send screens are not redrawn when People loads (would wipe edits).
    One full-suite run had a single transient failure that did not reproduce in 4 reruns.

- [x] Step c — Mobile layout (cards, bottom navigation, full-screen search, bottom sheets, 44px targets)
  - Date: 2026-10-04
  - Session: CC-20261004-k7q2
  - What changed: new `public/styles/mobile.css`; `shell.js` bottom navigation below 640px
    (Meetings, Action items, Record → recording menu, Settings; pending-review count; People via
    Settings → "Manage people" and the command palette) and a full-screen search overlay (focus
    trap, Esc/Cancel return focus, dialog role only while open); `meetings.js` phone cards (title,
    date, status badge, avatar stack, platform tag when known; whole card taps open; ⋯ menu with
    Review/Open + Copy link) while the table stays for wider screens; tablet hides the chevron and
    (641–860px) participants columns; `actionItems.js` folds the Meeting column under the task on
    tablet and renders cards on phone; summary cards scroll sideways with snap; calendar list
    rows restack on phones; bottom sheets get a grab handle and full-width actions; topbar shows
    brand + search button + avatar; render never steals focus from the phone search.
  - Verification: new `mobileUi.integration.test.ts` (3 tests); `tsc --noEmit` passes; full suite
    378 tests: 1 intermittent timeout in the existing upload journey test under CPU load (5s Jest
    default), then 3 clean runs; raised `testTimeout` to 20s in `backend/jest.config.js`;
    headless Chrome at 375px: scrollWidth 375 on meetings, calendar, review, people, settings,
    upload; no visible control under 44px on upload; tablet 800px screenshot checked.
  - Notes: Recommended and built bottom navigation (4 destinations, Record is a primary phone
    action) rather than a hamburger. Search overlay results are filled in step d.

- [x] Step d — Grouped, typo-tolerant search (Meetings, Transcripts, Action items)
  - Date: 2026-10-04
  - Session: CC-20261004-k7q2
  - What changed: added dependency `minisearch@7.2.0` (MIT, no transitive deps; approved in the
    plan). Backend `services/search/` — spelling.ts (tokenizer, bounded OSA edit distance,
    vocabulary built from titles/names/transcripts/minutes so names and project terms are never
    corrected), searchDocuments.ts (meetings with participants by name+email, dates as ISO/month/
    weekday words, minutes text; transcript lines with speaker + time; action items; scheduled
    meetings), searchService.ts (MiniSearch index synced by content hash — only changed docs are
    added/replaced/removed on each query, so edits are searchable immediately; prefix matching;
    "Showing results for X. Search instead for Y" when only the correction has results, "Did you
    mean X?" when both do, fuzzy fallback otherwise; groups of 3 + totals; snippets; "With …"
    for participant matches); `routes/search.ts` GET /api/search (zod: q ≤ 200, group, limit
    1–50, exact). Frontend `core/search.js` (shared by the desktop dropdown and the phone
    overlay: debounced, stale answers dropped, highlighted matches via text nodes, keyboard
    combobox with aria-activedescendant, See all / All results, recent searches, empty state,
    result count announced, Commands group on desktop), `styles/search.css`; Ctrl K / ⌘K now
    focuses the search box (phones: opens full-screen search; the palette stays on its button);
    transcript results open the review scrolled to and highlighting that line; scheduled
    meetings open their details. Dialogs without an anchor open centred instead of as a popover.
  - Verification: new spelling/search unit tests, routes/search.test.ts (incl. index follows a
    minutes edit), searchUi.integration.test.ts; full suite 401 passed (1 skipped); `tsc
    --noEmit` passes; headless Chrome: "budjet" → "Showing results for budget", grouped results
    with highlights (light/dark), phone overlay "timline" → timeline, scrollWidth 375.
  - Notes: Updated two existing tests to the new search behaviour (journey test: search dropdown
    + Ctrl K → search Commands instead of list filtering + palette; mobile overlay test). The
    meetings list no longer filters as you type — results live in the dropdown.

- [x] Step e — Spell check while writing, team dictionary, check before approval
  - Date: 2026-10-04
  - Session: CC-20261004-k7q2
  - What changed: added `nspell@2.1.5` (MIT) + `dictionary-en@4.0.0` (MIT AND BSD) and dev
    `@types/nspell@2.1.6` (approved in the plan). Backend `services/spelling/spellChecker.ts`
    (Hunspell-compatible checking; reports words + offsets + up to 5 suggestions, never edits;
    skips URLs, emails, @mentions, code, acronyms, words glued to digits; suggestion cache; reads
    dictionary-en's .aff/.dic directly so the CommonJS server needs no ESM interop),
    `teamDictionary.ts` (idempotent add/remove, `team-dictionary.json` in real mode; automatic
    words from participant names and meeting titles), `routes/spelling.ts` (POST /api/spellcheck
    batch, GET/POST/DELETE /api/spellcheck/dictionary, zod-validated, 503 if the dictionary is
    missing). Frontend `core/spellcheck.js`: transparent mirror layer draws red wavy underlines
    over inputs/textareas (browser spellcheck turned off on those fields to avoid doubles), batched
    requests, click → suggestions without stealing focus, right-click/menu key → keyboard menu,
    Ignore (session), Add to dictionary (team), a hidden per-field description for screen
    readers; attached to review topics/summaries/decisions/reasons/action-item tasks, the upload
    meeting title, and the calendar form title + agenda; transcripts are never checked. Approving
    minutes and approving/sending emails now first shows "N possible spelling mistakes — Review /
    Approve anyway (Send anyway)"; Review approves nothing and focuses the first flagged field;
    if the checker is down the approval continues with a toast. Email previews underline
    possible mistakes without changing the email text. `MA.menu.open` gained `{ focus: false }`.
  - Verification: spellChecker.test.ts, routes/spelling.test.ts, spellcheckUi.integration.test.ts
    (underline → suggestion applied only when chosen → autosaved; Ignore; Add to dictionary;
    gate Review/Approve anyway; email preview underline); full suite 414 passed (1 skipped);
    `tsc --noEmit` passes; headless Chrome: underlines align with text on desktop and 375px dark.
  - Notes: Cancel/postpone reason fields don't exist in the UI yet (calendar steps from session
    CC-20261003-q4tz not built); `MA.spell.attach(field)` is the one-line hook when they land.
    Minutes are locked after approval 1, so the email check's "Review" points at the preview.

- [x] Step f — Live in-person recording, chunked upload, offline/crash recovery
  - Date: 2026-10-04
  - Session: CC-20261004-k7q2
  - What changed: backend `services/recording/` (types, `recordingStore.ts` — per-recording folder
    with meta.json + numbered chunk files, atomic writes, streamed join; `recordingService.ts` —
    idempotent create (consent required, MediaRecorder type allowlist), idempotent chunk PUTs
    (out of order and retries OK, size/range limits), finish = verify every chunk (409 lists
    missing ones) → join → same pipeline as uploads; ready → returns the same meeting, concurrent
    finish refused, failed → retryable; raw-audio retention after approval / 30 days / keep,
    deleting audio only and idempotently), `routes/recordings.ts` (POST /, GET /:id, PUT
    /:id/chunks/:n raw ≤ 8 MB, POST /:id/finish, GET /by-run/:runId, DELETE /:id, GET/PUT
    /settings/retention; zod; links to a calendar meeting), shared upload-progress tracker so the
    processing screen works for recordings, hourly + startup retention job (default 30 days),
    audio ingestion now accepts WebM and Ogg by magic bytes (what browsers record; faster-whisper
    decodes them), `attendeesSchema` exported for reuse. Frontend `core/chunkQueue.js` (IndexedDB
    store of unsent chunks with in-memory fallback, ordered uploader with 30s timeouts, capped
    backoff 1–30s, resumes on `online`), `core/recorder.js` (MediaRecorder 5s chunks, mic picker +
    level meter, pause/resume, Screen Wake Lock, plus tab-audio capture mixed with the mic for
    step g, clear permission/unsupported messages), `screens/record.js` (setup with required
    consent checkbox, title/participants, mic check, "middle of the table" tip; recording screen
    with large timer, Recording/Paused indicator, level meter, Pause/Resume, Add marker, Stop,
    live upload status), `recordActions.js` (tab title "● Recording – mm:ss", leave-page warning,
    announcements, Stop → Uploading → Transcribing → Drafting → review, recovery banner on
    Meetings with Upload and process / Discard, retry), always-visible recording pill on other
    pages, markers shown inside the review transcript, Settings → Recording and privacy
    (retention), `styles/record.css`, pause/play icons. The upload page's Record button now opens
    the new recorder.
  - Verification: recordingService.test.ts, routes/recordings.test.ts, audio sniffer test,
    recordingUi.integration.test.ts (faked media: consent gate, chunks, network drop → retrying →
    recovered, pause, marker, leave/return via pill, Stop → review with marker; crash recovery →
    processed); full suite 430 passed (1 skipped); `tsc --noEmit` passes. Real headless Chrome
    with fake mic at 375px: real MediaRecorder `audio/webm;codecs=opus`, chunks uploaded, page
    navigated away mid-recording, recovery banner after reload, Upload and process → review with
    marker; local Whisper decoded the joined 15.06 s WebM (no speech — fake tone).
  - Notes: Access is still single-user (approved): "visible only to the owner and approved
    participants" needs sign-in, planned after Phase 1. Optional live transcription while
    recording was not built (local Whisper here is batch, not streaming).

- [x] Step g — Online meeting capture on this computer; "Start recording" from calendar meetings
  - Date: 2026-10-04
  - Session: CC-20261004-k7q2
  - What changed: `core/recorder.js` captures the meeting tab/window audio (getDisplayMedia with
    audio, video track dropped) mixed with the microphone; refuses with a clear message when no
    audio was shared ("turn on Share tab audio"; Mac windows can't share sound), explains
    unsupported browsers/phones/Safari, warns after 20 s of silence from the shared tab and
    clears the warning when sound arrives, stops and processes if sharing ends or the mic is
    unplugged; exposes live levels. `screens/record.js` adds step-by-step "How it works" for
    online capture with Mac vs Windows notes. New `calendar/recordFromCalendar.js`: meetings are
    recordable from 5 minutes before start until the end (scheduled, not cancelled, no recording
    yet); "Start recording" menu in the meeting details and in a new "Happening now" banner on
    the Meetings page (refreshes every minute; platform from the link — Zoom/Teams/Meet → online
    capture first, in person as the alternative); the recording carries the meeting's title and
    participants and is linked to it. Menus now stack above dialogs.
  - Verification: recordingUi.integration.test.ts (+2: banner → Start recording → online setup
    prefilled → no-audio share refused → capture → stop → review → schedule linked, recording mode
    browser_capture; 5-minute window rules), recordings.test.ts (recording appears in search);
    full suite 432 passed (1 skipped); `tsc --noEmit` passes. Real headless Chrome with tab
    capture auto-selected: real tab + mic capture recording, chunks on the server, silent-tab
    warning shown at 20.0 s (first attempt exposed a reset bug in the silence timer — fixed).

- [x] Step h — Calendar sync: Google Calendar and Microsoft Outlook (read-only, server-side OAuth)
  - Date: 2026-10-04
  - Session: CC-20261004-k7q2
  - What changed: backend `services/calendarSync/` — `tokenCrypto.ts` (AES-256-GCM sealing with
    TOKEN_ENCRYPTION_KEY; refuses to connect without it), `http.ts` (15 s timeouts, ≤ 3 attempts
    with backoff on 429/5xx/network, classified AuthError/RateLimit/Upstream/Timeout/Contract
    errors, redacted error logging), `providers.ts` (Google Calendar v3 and Microsoft Graph via
    plain fetch — auth URL with PKCE + one-time state, code exchange, refresh keeping the refresh
    token, account, calendar list, events/calendarView with paging, Outlook attendee photos,
    Google revoke), `meetingLinks.ts` (Zoom/Teams/Meet detection from conference data, location,
    or description), `calendarSyncService.ts` (next 4 weeks; skips all-day always and solo events
    by default; rooms excluded; upsert by provider + event id — time changes reschedule,
    cancellations and deletions show as Cancelled, unchanged events untouched; attendee names
    into People with calendar precedence; Outlook photos saved under data/photos and served by
    hash; choose calendars/filters; disconnect revokes, deletes tokens, removes synced meetings
    without a recording; concurrent syncs share one run; errors recorded with needsReconnect),
    `routes/calendarSync.ts` (GET /connections, GET /oauth/:provider/start → 302, GET
    /oauth/:provider/callback → back to Settings with result, PUT /connections/:provider, POST
    /sync, DELETE /connections/:provider; zod; tokens never in responses), photo route,
    `ScheduleService.upsertExternal/listExternal/removeExternal`, synced meetings locked against
    local edits ("change it in Google Calendar"), schedule responses include `platform`. Frontend
    `calendar/sync.js`: Settings → Integrations (Connect, "Connected as … · Last synced …",
    calendars to sync, skip-solo filter, Sync now, Disconnect, reconnect prompts), "Sync calendar"
    / "Last synced …" + sync button in the calendar panel header, "Google"/"Outlook" synced tags
    on blocks and list rows, tooltip and details lines, auto-sync on open when stale and every
    15 minutes, toasts for the OAuth result. `.env.example` + new `docs/CALENDAR_SYNC_SETUP.md`.
  - Verification: calendarSync.test.ts (11: crypto, links, mapping, OAuth/PKCE/state, import +
    filters + idempotent re-sync, reschedule/cancel/delete, refresh + retry + revoked, calendar
    choice, disconnect, not configured, Outlook photos), routes/calendarSync.test.ts (5),
    calendarSyncUi.integration.test.ts (3); full suite 451 passed (1 skipped) — one intermittent
    timing failure in peopleUi under load in 1 of 8 runs, hardened by waiting for suggestions;
    `tsc --noEmit` passes. Live server with placeholder client ids: /oauth/google/start and
    /oauth/microsoft/start 302 to accounts.google.com / login.microsoftonline.com with PKCE;
    Settings and panel screenshots checked.
  - Notes: Not tested against real Google/Microsoft accounts — needs the user's OAuth clients
    (see docs/CALENDAR_SYNC_SETUP.md). Google attendee photos aren't available with
    calendar.readonly (initials shown). All-day events are always skipped (no meeting time).

## Part H — Editable drafted minutes and action items

- [x] Step H-a — Editable minutes (sections, rich text) with autosave; drafts saved on the server
  - Date: 2026-10-04
  - Session: CC-20261004-k7q2
  - What changed: added `quill@2.0.2` (BSD-3; 2.0.3 has advisory GHSA-v3m3-f69x-jf25 — 2.0.2 is
    unaffected and the app never uses Quill's HTML export), served from node_modules at
    /vendor/quill (no bundler, no CDN). Drafts under review, their transcripts, and email drafts
    are now persisted (`minutes-drafts.json`, `transcripts.json`, `email-drafts.json`; approved by
    the user) so nothing is lost on restart. New `services/minutesDoc/` — `types.ts` (sections +
    action items + versions), `html.ts` (allowlist sanitiser: p/br/h2/h3/strong/em/u/s/lists/
    blockquote/https+mailto links only; plain-text + list readers), `convert.ts` (AI draft ↔
    editable content; edited flags), `minutesDocService.ts` (revision check → named conflicts,
    autosaves by the same person within 5 min fold into one version, pipeline draft kept in step
    so emails/search/tracker follow). `routes/minutes.ts` (zod). `meetingPipeline/
    minutesAmendments.ts` (replaceDraft, amendApprovedMinutes, correctTranscript,
    sendUpdatedMinutes). Frontend `review/minutesStore.js` (working copy, 2 s autosave, localStorage
    backup until confirmed, retry on `online`, leave-page warning, recovery after reload, stale-
    backup choice), `review/sectionsEditor.js` (one Quill per section; toolbar on focus: heading,
    bold, italic, bullet/numbered list, link dialog; Ctrl/⌘ B/I/Z/Y/Shift+Z; rename, Edited label,
    move up/down, drag, delete with Undo toast, add section), rich-text spell check via CSS Custom
    Highlights in `core/spellcheck.js`, new review screen with save status ("Saving…" → "Saved" /
    "Couldn't save · Retry", announced), `styles/editor.css`, toast action buttons, new icons.
  - Verification: minutesDoc.test.ts (9), minutesEditorUi.integration.test.ts (sections + format +
    undo + reorder + delete/undo; offline → Couldn't save → Retry); real headless Chrome: network
    switched off → "Couldn't save · Retry" + local backup, back online → saved automatically;
    reload mid-edit → "Recovered your unsaved changes" → saved; desktop/375px screenshots.

- [x] Step H-b — Editable action items
  - Date: 2026-10-04
  - Session: CC-20261004-k7q2
  - What changed: `review/actionItemsEditor.js` — inline task (spell checked), owner picker
    (attendees then People, avatar + name + email, keyboard combobox, free text allowed), due date,
    priority, done, add, delete with Undo, reorder (drag or ⋯ Move up/down), "Not an action item"
    with a restorable list, timestamp → transcript moment (switches to the Transcript tab on
    phones), Edited label; two-line rows that fit the half-width column and phones.
  - Verification: minutesEditorUi.integration.test.ts (add + owner pick + due + priority → saved to
    the pipeline draft; dismiss; delete → Undo; timestamp jump); 375px screenshot.

- [x] Step H-c — Version history and compare with the AI draft
  - Date: 2026-10-04
  - Session: CC-20261004-k7q2
  - What changed: `review/versions.js` — list (AI draft + versions, who, when, reason), preview,
    "Restore this version" (server makes it a new version; history never rewritten), "Compare
    with AI draft" (word-level LCS diff, added green / removed red, renamed and deleted sections,
    action items). Insert from transcript (selection button or a line's time button → quote or
    note with speaker + time, into any section or a new Notes section).
  - Verification: minutesEditorUi.integration.test.ts (compare shows added text, restore → editor
    shows AI text, versions list restore entry; transcript quote inserted on its own line).

- [x] Step H-d — Approval lock and editing approved minutes
  - Date: 2026-10-04
  - Session: CC-20261004-k7q2
  - What changed: minutes are read-only once approved ("Minutes approved" between the gates;
    "Approved by [name] on [date]" after the final approval). "Edit approved minutes" requires a
    reason, opens a new amendment version (edits fold into it and update the approved record),
    "Done editing", then "Send updated minutes" — emailed once per amended version (idempotency
    key run+version+participant; draft-only mode drafts without sending). Approval saves pending
    edits first and refuses on a conflict; the spelling check before approval reads the editor.
  - Verification: minutesDoc.test.ts (lock, reason required, amendment version, update sent once
    then refused), minutesEditorUi.integration.test.ts (approved → reason → edit → done → send),
    journey test (read-only after approval).

- [x] Step H-e — AI help per section, transcript corrections, multiple reviewers
  - Date: 2026-10-04
  - Session: CC-20261004-k7q2
  - What changed: `services/minutesDoc/assistant.ts` (Regenerate / Make shorter / Make more formal
    via Claude `claude-sonnet-5-5` with the same no-assumed-gender rule + one corrective retry,
    sanitised output; deterministic demo stand-in), POST /api/minutes/:runId/assist (suggestion
    only, never saved). Page: ✨ menu per section → preview with "Replace" / "Keep mine", warning
    if the section changed meanwhile, Replace is a normal undoable edit. Transcript corrections:
    PUT /api/minutes/:runId/transcript (words + speaker renames; original transcript kept on the
    document; history line; pipeline transcript updated so search follows) and a "Correct
    transcript" dialog with "Update minutes with corrected names". Presence: POST
    /api/minutes/:runId/presence every 15 s → "Also viewing" avatars; conflicts show "<name>
    updated this draft. Reload" instead of overwriting.
  - Verification: routes/minutes.test.ts (4), minutesEditorUi.integration.test.ts (AI help keep/
    replace/undo, rename → update minutes names, presence, conflict banner + reload); full suite
    474 passed (1 skipped) after fixing a background-redraw race in peopleUi; `tsc --noEmit`
    passes.
  - Notes: Part G (languages) doesn't exist yet — versions store their language and the view
    reports out-of-date translations, but there are no translations to mark. Full real-time
    co-editing is planned only (see summary). Existing tests updated to the new editor (journey,
    spell check); the page harness now maps /vendor/quill and stubs Range geometry for jsdom.

- [x] Dashboard UI/UX upgrade — review focus, status lifecycle, clickable table, real stat cards, header
  - Date: 2026-10-05
  - Session: CC-20261004-k7q2
  - What changed: Meetings dashboard split into `public/js/dashboard/{stats,table,activity}.js` +
    `styles/dashboard.css`. Pending card with accent border + "Review now" (or "All caught up");
    tabs Needs review / Approved / All with counts (ARIA tablist, arrow keys; defaults to Needs
    review when any). Status badges are icon + text for processing → needs_review → emails_drafted
    → approved (draft-only) / sent, plus failed. Table: date with "time · duration", avatar stacks,
    Action items column, whole row focusable/clickable (Enter/Space), inline rename (pencil, Enter
    saves, Esc cancels) via new PATCH /api/meetings/:runId/title. Stat cards: real range selector
    (This week / This month / All time) with a previous-period comparison, cards filter or navigate,
    second lines only from real data. Header: one primary "New meeting" split button (upload / record
    in person / record online), "View calendar" ghost; Commands palette removed (Ctrl K = search,
    whose results include commands); help menu + avatar menu (name, Settings). Sidebar "Change in
    Settings" link; "Draft-only" badge next to both approve buttons. New GET /api/activity powers
    "Recent activity". List items gain time, durationMs, emails_drafted; failed live recordings are
    listed (retry from the row). `--color-text-subtle` light → #636a76 (WCAG AA).
  - Verification: new routes/dashboard.test.ts (10) and dashboardUi.integration.test.ts (9: badges,
    tabs/filters, clickable rows, rename, stat cards, activity, settings link); updated header,
    calendar, sync, people, recording, mobile and journey tests; full suite 494 passed (1 skipped);
    `tsc --noEmit` passes; headless Chrome screenshots at 1280px and 375px, light and dark, no
    horizontal scroll.
  - Notes: No sign-out item (the app has no accounts). "Approved" tab includes Emails drafted
    (minutes approved, email awaiting approval). Failed-recording time is UTC from the server.

- [x] Meeting Assistant Phase 2: meeting notetaker bot (Recall.ai) for Zoom / Teams / Google Meet
  - Date: 2026-10-05
  - Session: CC-20261004-k7q2
  - What changed: New backend/src/services/meetingBot/ (Recall client with 15 s timeout, 3 capped
    retries and the repo's CircuitBreaker; Svix-signed webhook verification; status mapping and
    readable error messages; speaker-timeline parsing; bot service with send/stop/events/processing
    and polling fallback + restart recovery; auto-send to synced meetings; retention deletes
    Recall's media copy; simulated demo bot). New /api/notetaker routes (zod-validated, consent
    required) and a raw-body signed webhook mounted before express.json(). Pipeline accepts
    `speakerTurns` so bot speaker names label the transcript. Page: platform logos on calendar
    blocks, list rows and dashboard rows; "Send notetaker" switch (role=switch) with consent dialog
    in meeting details and the "Happening now" banner; live status Scheduled → Joining → Waiting to
    be admitted → Recording → Processing → Ready for review, with errors in words, aria-live
    announcements, and a top-bar "Notetaker recording" pill; Stop recording confirm; Retry
    processing; Settings → Meeting notetaker (automatic sending, consent). Env: RECALL_API_KEY,
    RECALL_REGION, RECALL_WEBHOOK_SECRET (server only). Guide: docs/NOTETAKER_SETUP.md.
  - Verification: new tests recallEvents (11), recallClient (10), meetingBotService (15),
    routes/notetaker (7), notetakerUi.integration (3); full suite 540 passed (1 skipped);
    `tsc --noEmit` passes; demo flow checked end to end in headless Chrome (send → recording pill →
    stop → processed into review), 375px no horizontal scroll.
  - Notes: Recall chosen by the user (cost ~$0.50/recorded hour; local Whisper transcribes).
    Not yet run against a live Recall key: `recording_config.audio_mixed_mp3`, the
    speaker_timeline_download_url field and `delete_media` are from Recall's docs and listed in the
    setup guide to confirm. Without accounts, per-person visibility of recordings is not enforced.
    Failed notetaker sessions show on the calendar/banner, not in the dashboard table.
