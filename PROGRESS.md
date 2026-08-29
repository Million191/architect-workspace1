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
