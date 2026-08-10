/* Shared rendering, nav, search, diagrams, illustrations, and the Ask agent. Renders everything from BLUEPRINT. */

const SECTIONS = [
  { id: "summary", file: "01-summary.html", title: "Summary", kicker: "Start here", desc: "The idea, in one paragraph, and what must work on day one." },
  { id: "components", file: "02-components.html", title: "Components", kicker: "Building blocks", desc: "Every piece this system needs, and the words that required it." },
  { id: "architecture", file: "03-architecture.html", title: "How It Fits Together", kicker: "Architecture", desc: "The full data-flow diagram — one trigger, one pipeline, one report." },
  { id: "dataflow", file: "04-dataflow.html", title: "Data Flow", kicker: "Step by step", desc: "What happens, in order, every time the pipeline runs." },
  { id: "buildorder", file: "05-buildorder.html", title: "Build Order", kicker: "Sequencing", desc: "What to build first, and which phase is make-or-break." },
  { id: "assumptions", file: "06-assumptions.html", title: "Assumptions", kicker: "Open questions", desc: "What was assumed, its impact if wrong, and the question that would most change the design." },
  { id: "coverage", file: "07-coverage.html", title: "Coverage", kicker: "Scope", desc: "What this design covers today, and what it deliberately leaves out." }
];

/* ===================== utils ===================== */
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const STOPWORDS = new Set(["the","a","an","of","to","and","or","in","on","for","is","it","this","that","with","as","by","be","are","was","were","from","at","its","not","no","if","so","do","does","my","me","i"]);
function stem(w) { return w.replace(/(ing|ed|es|s)$/i, ""); }
function tokenize(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(t => t && !STOPWORDS.has(t));
}
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/* ===================== search index ===================== */
function buildIndex() {
  const idx = [];
  const push = (section, id, title, text) => idx.push({ section, id, title, text: String(text || "") });

  push("summary", "summary-idea", "The Idea", BLUEPRINT.idea);
  push("summary", "summary-dayone", "Day-One Priority", BLUEPRINT.dayOnePriority);
  push("summary", "summary-oneliner", BLUEPRINT.meta.title, BLUEPRINT.meta.oneLiner);

  BLUEPRINT.components.forEach(c => push("components", "comp-" + c.id, c.name, c.sentence + " " + c.category + " " + c.requiredBy));
  BLUEPRINT.notAdded.forEach((n, i) => push("components", "notadded-" + i, "Not added: " + n.thing, n.why));

  push("architecture", "arch-interp", "Architecture diagram", BLUEPRINT.diagramInterpretation);

  BLUEPRINT.dataFlow.steps.forEach(s => push("dataflow", "step-" + s.n, "Step " + s.n + ": " + s.actor, s.action));
  push("dataflow", "dataflow-interp", "Data flow diagram", BLUEPRINT.sequenceInterpretation);

  BLUEPRINT.buildOrder.phases.forEach(p => {
    push("buildorder", "phase-" + p.id, "Phase " + p.id + ": " + p.name, p.proves + " " + p.ships);
    p.tasks.forEach(t => push("buildorder", "wbs-" + t.id, "WBS " + t.id + ": " + t.name,
      `${t.duration}d, ${t.start} to ${t.finish}. ${t.critical ? "On the critical path." : "Has " + t.float + " day(s) of slack."} Predecessors: ${t.predecessors.join(", ") || "none"}.`));
  });
  push("buildorder", "wbs-interp", "Build order schedule", BLUEPRINT.buildOrder.interpretation);

  BLUEPRINT.assumptions.forEach((a, i) => push("assumptions", "assum-" + i, a.assumption, a.impact));
  push("assumptions", "open-q", BLUEPRINT.openQuestion.question,
    BLUEPRINT.openQuestion.branchA.label + ": " + BLUEPRINT.openQuestion.branchA.changes.join("; ") + " — " +
    BLUEPRINT.openQuestion.branchB.label + ": " + BLUEPRINT.openQuestion.branchB.changes.join("; "));

  BLUEPRINT.coverage.forEach((c, i) => push("coverage", "cov-" + i, c.item, c.status + " — " + c.note));

  return idx;
}
const SEARCH_INDEX = buildIndex();

function scoreEntry(entry, terms, rawQuery) {
  const titleToks = tokenize(entry.title).map(stem);
  const textToks = tokenize(entry.text).map(stem);
  let score = 0;
  terms.forEach(t => {
    const st = stem(t);
    score += textToks.filter(w => w === st).length;
    if (titleToks.includes(st)) score += 5;
  });
  const q = rawQuery.toLowerCase().trim();
  if (q.length > 2) {
    if (entry.text.toLowerCase().includes(q)) score += 10;
    if (entry.title.toLowerCase().includes(q)) score += 15;
  }
  return score;
}
function runSearch(query) {
  const terms = tokenize(query);
  if (!terms.length) return [];
  return SEARCH_INDEX
    .map(e => ({ e, score: scoreEntry(e, terms, query) }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(r => r.e);
}
function snippet(text, query) {
  const terms = tokenize(query);
  let out = esc(text.length > 160 ? text.slice(0, 160) + "…" : text);
  terms.forEach(t => {
    if (t.length < 2) return;
    out = out.replace(new RegExp("(" + escRe(t) + ")", "ig"), "<mark>$1</mark>");
  });
  return out;
}

/* ===================== chrome (topbar, sidenav, footer) ===================== */
function sectionMeta(id) { return SECTIONS.find(s => s.id === id); }

function renderTopbar(currentId) {
  const meta = sectionMeta(currentId);
  const crumbs = currentId === "index"
    ? `<span>Command Center</span>`
    : `<a href="index.html">Command Center</a><span class="sep">/</span><span>${esc(meta.title)}</span>`;
  return `
  <div class="progressbar" id="progressbar"></div>
  <div class="topbar">
    <div class="topbar-inner">
      <div class="brand">Bi-Weekly Progress Reporter <span class="dot">·</span> Blueprint</div>
      <div class="crumbs">${crumbs}</div>
      <div class="topbar-actions">
        <div class="searchbox">
          <input type="search" id="siteSearch" placeholder="Search the blueprint…" autocomplete="off" aria-label="Search the blueprint">
          <div class="search-results" id="searchResults"></div>
        </div>
        <button class="iconbtn" id="themeToggle" title="Toggle theme" aria-label="Toggle light/dark theme">◐</button>
        <button class="iconbtn" id="printBtn" title="Print" aria-label="Print this page" onclick="window.print()">⎙</button>
      </div>
    </div>
  </div>`;
}

function renderSidenav(currentId) {
  const items = SECTIONS.map(s => `<a href="${s.file}" class="${s.id === currentId ? "active" : ""}">${esc(s.title)}</a>`).join("");
  return `<nav class="sidenav"><h4>Sections</h4>${items}</nav>`;
}

function renderFooterNav(currentId) {
  const i = SECTIONS.findIndex(s => s.id === currentId);
  const prev = i > 0 ? SECTIONS[i - 1] : null;
  const next = i < SECTIONS.length - 1 ? SECTIONS[i + 1] : { file: "index.html", title: "Command Center" };
  return `<div class="nav-footer">
    ${prev ? `<a href="${prev.file}"><span class="label">← Previous</span>${esc(prev.title)}</a>` : `<a href="index.html"><span class="label">← Back</span>Command Center</a>`}
    <a class="next" href="${next.file}"><span class="label">Next →</span>${esc(next.title)}</a>
  </div>`;
}

/* ===================== figure wrapper + fullscreen modal ===================== */
let figCounter = 0;
function figureBlock(bodyHtml, caption, kind) {
  const id = "fig-" + (++figCounter);
  return `<div class="figure" data-kind="${kind || ""}">
    <div class="figure-tools"><button class="iconbtn fig-expand" data-target="${id}" title="Expand" aria-label="Expand figure">⤢</button></div>
    <div class="figure-body" id="${id}">${bodyHtml}</div>
    <p class="figure-caption">${esc(caption)}</p>
  </div>`;
}
function initFigureExpand() {
  document.addEventListener("click", e => {
    const btn = e.target.closest(".fig-expand");
    if (btn) {
      const src = document.getElementById(btn.dataset.target);
      openFigModal(src.innerHTML);
    }
    if (e.target.closest("#figClose") || e.target.id === "figModal") closeFigModal();
    if (e.target.closest("#figZoomIn")) zoomFig(1.2);
    if (e.target.closest("#figZoomOut")) zoomFig(1 / 1.2);
    if (e.target.closest("#figZoomReset")) resetFig();
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeFigModal(); });
  document.addEventListener("wheel", e => {
    if (document.getElementById("figModal")?.classList.contains("open") && e.target.closest(".figmodal-canvas")) {
      e.preventDefault();
      zoomFig(e.deltaY < 0 ? 1.1 : 1 / 1.1);
    }
  }, { passive: false });
}
let figScale = 1, figPanX = 0, figPanY = 0, figDragging = false, figDragStart = null;
function openFigModal(html) {
  let modal = document.getElementById("figModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.className = "figmodal";
    modal.id = "figModal";
    modal.innerHTML = `<div class="figmodal-canvas"><div class="zoom-wrap" id="figZoomWrap"></div></div>
      <div class="figmodal-controls">
        <button id="figZoomOut">− Zoom out</button>
        <button id="figZoomReset">Reset</button>
        <button id="figZoomIn">+ Zoom in</button>
        <button id="figClose">Esc · Close</button>
      </div>`;
    document.body.appendChild(modal);
    const wrap = modal.querySelector("#figZoomWrap");
    wrap.addEventListener("mousedown", e => { figDragging = true; figDragStart = { x: e.clientX - figPanX, y: e.clientY - figPanY }; wrap.style.cursor = "grabbing"; });
    window.addEventListener("mouseup", () => { figDragging = false; if (wrap) wrap.style.cursor = "grab"; });
    window.addEventListener("mousemove", e => { if (figDragging) { figPanX = e.clientX - figDragStart.x; figPanY = e.clientY - figDragStart.y; applyFigTransform(); } });
  }
  document.getElementById("figZoomWrap").innerHTML = html;
  figScale = 1; figPanX = 0; figPanY = 0; applyFigTransform();
  modal.classList.add("open");
}
function closeFigModal() { const m = document.getElementById("figModal"); if (m) m.classList.remove("open"); }
function zoomFig(factor) { figScale = Math.min(6, Math.max(0.3, figScale * factor)); applyFigTransform(); }
function resetFig() { figScale = 1; figPanX = 0; figPanY = 0; applyFigTransform(); }
function applyFigTransform() {
  const svg = document.querySelector("#figZoomWrap svg");
  if (svg) svg.style.transform = `translate(${figPanX}px, ${figPanY}px) scale(${figScale})`;
}

/* ===================== mermaid ===================== */
function mermaidConfigFor(theme) {
  const dark = theme === "dark";
  return {
    startOnLoad: false,
    securityLevel: "loose",
    fontFamily: "Segoe UI, system-ui, sans-serif",
    theme: dark ? "dark" : "base",
    themeVariables: dark
      ? { primaryColor: "#12314c", primaryTextColor: "#e6edf5", primaryBorderColor: "#2dd4bf", lineColor: "#93a3b8", secondaryColor: "#182338", tertiaryColor: "#0e2b28", background: "#0b1220" }
      : { primaryColor: "#e6f4f2", primaryTextColor: "#0f172a", primaryBorderColor: "#0f766e", lineColor: "#64748b", secondaryColor: "#eef1f5", tertiaryColor: "#eaf0fd", background: "#eef2f6" }
  };
}
let mermaidReady = typeof mermaid !== "undefined";
const pendingDiagrams = [];
function renderMermaidWhenReady(elId, code) {
  pendingDiagrams.push({ elId, code });
  flushMermaid();
}
function flushMermaid() {
  if (typeof mermaid === "undefined") {
    pendingDiagrams.forEach(d => {
      const el = document.getElementById(d.elId);
      if (el) el.innerHTML = `<div class="ask-hint">Diagram needs internet to load Mermaid from the CDN on first view. Once it has loaded once, it stays cached by your browser.</div>`;
    });
    return;
  }
  try { mermaid.initialize(mermaidConfigFor(currentTheme())); } catch (e) {}
  pendingDiagrams.splice(0).forEach(async d => {
    const el = document.getElementById(d.elId);
    if (!el) return;
    try {
      const { svg } = await mermaid.render(d.elId + "-svg", d.code);
      el.innerHTML = svg;
    } catch (err) {
      el.innerHTML = `<div class="ask-error">Couldn't render this diagram (${esc(err.message || "Mermaid error")}).</div>`;
    }
  });
}
function rerenderAllMermaid() {
  document.querySelectorAll("[data-mermaid-src]").forEach(el => {
    pendingDiagrams.push({ elId: el.id, code: el.dataset.mermaidSrc });
  });
  flushMermaid();
}
function mermaidFigure(code, caption) {
  const id = "mmd-" + (++figCounter);
  const html = figureBlock(`<div id="${id}" data-mermaid-src="${esc(code).replace(/"/g, "&quot;")}"></div>`, caption, "mermaid");
  renderMermaidWhenReady(id, code);
  return html;
}

/* ===================== inline SVG illustrations (generated from BLUEPRINT) ===================== */
function svgOpen(w, h) { return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:'Segoe UI',system-ui,sans-serif">`; }
function marker(id, color) { return `<defs><marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" style="fill:${color}"/></marker></defs>`; }

function illustrationPipeline() {
  const mk = "arrP" + (++figCounter);
  return `${svgOpen(720, 160)}
    ${marker(mk, "var(--muted)")}
    <rect x="20" y="46" width="180" height="68" rx="10" style="fill:var(--card);stroke:var(--border)"/>
    <text x="110" y="74" text-anchor="middle" style="fill:var(--text);font-size:13px;font-weight:600">Your Markdown</text>
    <text x="110" y="92" text-anchor="middle" style="fill:var(--muted);font-size:11.5px">PROGRESS.md, docs/*.md</text>
    <line x1="205" y1="80" x2="265" y2="80" style="stroke:var(--muted);stroke-width:2" marker-end="url(#${mk})"/>
    <rect x="270" y="40" width="180" height="80" rx="10" style="fill:var(--good-bg);stroke:var(--accent)"/>
    <text x="360" y="74" text-anchor="middle" style="fill:var(--good);font-size:13px;font-weight:700">Report Pipeline</text>
    <text x="360" y="92" text-anchor="middle" style="fill:var(--muted);font-size:11.5px">parse → classify → watch</text>
    <text x="360" y="107" text-anchor="middle" style="fill:var(--muted);font-size:11.5px">→ compile → render</text>
    <line x1="455" y1="80" x2="515" y2="80" style="stroke:var(--muted);stroke-width:2" marker-end="url(#${mk})"/>
    <rect x="520" y="46" width="180" height="68" rx="10" style="fill:var(--card);stroke:var(--border)"/>
    <text x="610" y="74" text-anchor="middle" style="fill:var(--text);font-size:13px;font-weight:600">Bi-Weekly Report</text>
    <text x="610" y="92" text-anchor="middle" style="fill:var(--muted);font-size:11.5px">shipped · behind · next</text>
  </svg>`;
}

function illustrationLayers() {
  const layers = [
    { key: "trigger", label: "Trigger", color: "info" },
    { key: "source", label: "Source", color: "neutral" },
    { key: "process", label: "Processing", color: "good" },
    { key: "output", label: "Output", color: "warn" }
  ];
  const h = layers.length * 74 + 20;
  let y = 16, rows = "";
  layers.forEach(l => {
    const comps = BLUEPRINT.components.filter(c => c.layer === l.key);
    rows += `<text x="16" y="${y + 16}" style="fill:var(--muted);font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase">${esc(l.label)}</text>`;
    let x = 16;
    comps.forEach(c => {
      const w = Math.max(120, c.name.length * 6.4 + 24);
      rows += `<rect x="${x}" y="${y + 24}" width="${w}" height="34" rx="8" style="fill:var(--${l.color}-bg);stroke:var(--${l.color})"/>
        <text x="${x + w / 2}" y="${y + 45}" text-anchor="middle" style="fill:var(--${l.color});font-size:11px;font-weight:600">${esc(c.name)}</text>`;
      x += w + 10;
    });
    y += 74;
  });
  return `${svgOpen(760, h)}${rows}</svg>`;
}

function illustrationRibbon() {
  const steps = BLUEPRINT.dataFlow.steps;
  const colorFor = t => t === "trigger" ? "info" : t === "output" ? "warn" : "good";
  const w = steps.length * 150 + 20;
  const mk = "arrR" + (++figCounter);
  let x = 20, nodes = "";
  steps.forEach((s, i) => {
    const color = colorFor(s.touches);
    nodes += `<circle cx="${x + 24}" cy="60" r="20" style="fill:var(--${color}-bg);stroke:var(--${color});stroke-width:2"/>
      <text x="${x + 24}" y="65" text-anchor="middle" style="fill:var(--${color});font-size:13px;font-weight:700">${s.n}</text>
      <text x="${x + 24}" y="98" text-anchor="middle" style="fill:var(--text);font-size:10.5px;font-weight:600">${esc(s.actor.length > 20 ? s.actor.slice(0, 18) + "…" : s.actor)}</text>`;
    if (i < steps.length - 1) {
      nodes += `<line x1="${x + 46}" y1="60" x2="${x + 128}" y2="60" style="stroke:var(--muted);stroke-width:2" marker-end="url(#${mk})"/>`;
    }
    x += 150;
  });
  return `${svgOpen(w, 116)}${marker(mk, "var(--muted)")}${nodes}</svg>`;
}

/* ===================== WBS / Gantt (interactive, MS-Project style) ===================== */
const WBS_DAY_W = 26;
const WBS_ROW_H = 28;
const WBS_HEADER_H = 40;
const WBS_CHART_X = 560;
const WBS_COLS = { id: 6, name: 50, dur: 296, start: 330, finish: 392, status: 452 };

function parseISODate(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function daysBetweenDates(a, b) { return Math.round((b - a) / 86400000); }
function fmtShortDate(iso) { return parseISODate(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
function isWeekendDate(d) { const wd = d.getDay(); return wd === 0 || wd === 6; }
function wbsXForDate(iso) { return WBS_CHART_X + daysBetweenDates(parseISODate(BLUEPRINT.buildOrder.projectStart), parseISODate(iso)) * WBS_DAY_W; }

function wbsFlatRows() {
  const rows = [];
  BLUEPRINT.buildOrder.phases.forEach(p => {
    rows.push({ type: "phase", id: p.id, phase: p.id, name: p.name, start: p.start, finish: p.finish, makeOrBreak: p.makeOrBreak });
    p.tasks.forEach(t => rows.push({ type: "task", id: t.id, phase: p.id, name: t.name, start: t.start, finish: t.finish, duration: t.duration, predecessors: t.predecessors, critical: t.critical, float: t.float }));
  });
  return rows;
}

function illustrationWbsGantt() {
  const rows = wbsFlatRows();
  const chartStart = parseISODate(BLUEPRINT.buildOrder.projectStart);
  const totalDays = daysBetweenDates(chartStart, parseISODate(BLUEPRINT.buildOrder.projectFinish)) + 1;
  const chartW = totalDays * WBS_DAY_W;
  const svgW = WBS_CHART_X + chartW + 20;
  const maxH = WBS_HEADER_H + rows.length * WBS_ROW_H + 16;
  const mkNorm = "wbsArr" + (++figCounter);

  let grid = "";
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(chartStart); d.setDate(d.getDate() + i);
    const x = WBS_CHART_X + i * WBS_DAY_W;
    if (isWeekendDate(d)) grid += `<rect x="${x}" y="0" width="${WBS_DAY_W}" height="${maxH}" style="fill:var(--neutral-bg)"/>`;
    if (i === 0 || d.getDay() === 1) {
      grid += `<line x1="${x}" y1="0" x2="${x}" y2="${maxH}" style="stroke:var(--border);stroke-width:1"/>
        <text x="${x + 3}" y="14" style="fill:var(--muted);font-size:9.5px">${esc(d.toLocaleDateString(undefined, { month: "short", day: "numeric" }))}</text>`;
    }
  }

  const colHead = (label, x) => `<text x="${x}" y="26" style="fill:var(--muted);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.03em">${label}</text>`;
  const header = `${colHead("WBS", WBS_COLS.id)}${colHead("Task", WBS_COLS.name)}${colHead("Dur", WBS_COLS.dur)}${colHead("Start", WBS_COLS.start)}${colHead("Finish", WBS_COLS.finish)}${colHead("Status", WBS_COLS.status)}
    <line x1="0" y1="34" x2="${svgW}" y2="34" style="stroke:var(--border);stroke-width:1.5"/>
    <line x1="${WBS_CHART_X - 12}" y1="0" x2="${WBS_CHART_X - 12}" y2="${maxH}" style="stroke:var(--border);stroke-width:1"/>`;

  let rowsSvg = "", arrowsSvg = "";
  rows.forEach(r => {
    const x1 = wbsXForDate(r.start), x2 = wbsXForDate(r.finish) + WBS_DAY_W;
    const barW = Math.max(4, x2 - x1);
    if (r.type === "phase") {
      rowsSvg += `<g class="wbs-row" data-row-type="phase" data-phase="${r.phase}" data-x1="${x1}" data-x2="${x2}">
        <text class="wbs-toggle" data-phase="${r.phase}" data-collapsed="0" x="${WBS_COLS.id}" y="19">▾ ${esc(r.id)}</text>
        <text x="${WBS_COLS.name}" y="19" style="fill:var(--text);font-size:11.5px;font-weight:700">${esc(r.name.length > 30 ? r.name.slice(0, 28) + "…" : r.name)}${r.makeOrBreak ? " ★" : ""}<title>${esc(r.name)}</title></text>
        <text x="${WBS_COLS.start}" y="19" style="fill:var(--muted);font-size:10.5px">${fmtShortDate(r.start)}</text>
        <text x="${WBS_COLS.finish}" y="19" style="fill:var(--muted);font-size:10.5px">${fmtShortDate(r.finish)}</text>
        ${r.makeOrBreak ? `<text x="${WBS_COLS.status}" y="19" style="fill:var(--warn);font-size:9.5px;font-weight:700">make-or-break</text>` : ""}
        <rect x="${x1}" y="${WBS_ROW_H / 2 - 5}" width="${barW}" height="10" rx="4" style="fill:var(--text);opacity:.7"/>
      </g>`;
    } else {
      const color = r.critical ? "risk" : "good";
      rowsSvg += `<g class="wbs-row" data-row-type="task" data-phase="${r.phase}" data-id="${esc(r.id)}" data-x1="${x1}" data-x2="${x2}">
        <text x="${WBS_COLS.id + 10}" y="19" style="fill:var(--muted);font-size:10.5px">${esc(r.id)}</text>
        <text x="${WBS_COLS.name}" y="19" style="fill:var(--text);font-size:10.5px">${esc(r.name.length > 34 ? r.name.slice(0, 32) + "…" : r.name)}<title>${esc(r.name)}</title></text>
        <text x="${WBS_COLS.dur}" y="19" style="fill:var(--muted);font-size:10.5px">${r.duration}d</text>
        <text x="${WBS_COLS.start}" y="19" style="fill:var(--muted);font-size:10.5px">${fmtShortDate(r.start)}</text>
        <text x="${WBS_COLS.finish}" y="19" style="fill:var(--muted);font-size:10.5px">${fmtShortDate(r.finish)}</text>
        <text x="${WBS_COLS.status}" y="19" style="fill:var(--${color});font-size:9.5px;font-weight:700">${r.critical ? "critical" : r.float + "d slack"}</text>
        <rect x="${x1}" y="6" width="${barW}" height="16" rx="4" style="fill:var(--${color}-bg);stroke:var(--${color});stroke-width:1.5"/>
      </g>`;
    }
  });
  rows.forEach(r => {
    if (r.type !== "task") return;
    (r.predecessors || []).forEach(pid => {
      arrowsSvg += `<path class="wbs-arrow" data-from="${pid}" data-to="${esc(r.id)}" style="fill:none;stroke:var(--muted);stroke-width:1.5" marker-end="url(#${mkNorm})"/>`;
    });
  });

  const svg = `<svg viewBox="0 0 ${svgW} ${maxH}" width="${svgW}" height="${maxH}" xmlns="http://www.w3.org/2000/svg" style="font-family:'Segoe UI',system-ui,sans-serif">
    ${marker(mkNorm, "var(--muted)")}
    <rect x="0" y="0" width="${svgW}" height="${maxH}" style="fill:var(--card)"/>
    ${grid}
    ${header}
    <g class="wbs-arrows">${arrowsSvg}</g>
    ${rowsSvg}
  </svg>`;

  const legend = `<div class="wbs-legend">
      <span><i class="wbs-swatch" style="background:var(--risk-bg);border-color:var(--risk)"></i>Critical path</span>
      <span><i class="wbs-swatch" style="background:var(--good-bg);border-color:var(--good)"></i>Has slack</span>
      <span><i class="wbs-swatch" style="background:var(--text);opacity:.7;border-color:transparent"></i>Phase summary</span>
    </div>`;
  const toolbar = `<div class="wbs-toolbar">
      <button class="wbs-btn" data-wbs-action="expand">Expand all</button>
      <button class="wbs-btn" data-wbs-action="collapse">Collapse all</button>
      ${legend}
    </div>`;
  const body = `<div class="wbs-widget">${toolbar}<div class="wbs-scroll">${svg}</div></div>`;
  return figureBlock(body, BLUEPRINT.buildOrder.interpretation, "wbs");
}

function layoutWbsSvg(svg) {
  if (!svg) return;
  let y = WBS_HEADER_H;
  const collapsedPhases = new Set();
  svg.querySelectorAll(".wbs-toggle").forEach(t => { if (t.dataset.collapsed === "1") collapsedPhases.add(t.dataset.phase); });
  svg.querySelectorAll(".wbs-row").forEach(row => {
    if (row.dataset.rowType === "task" && collapsedPhases.has(row.dataset.phase)) { row.style.display = "none"; return; }
    row.style.display = "";
    row.setAttribute("transform", `translate(0, ${y})`);
    row.dataset.centerY = y + WBS_ROW_H / 2;
    y += WBS_ROW_H;
  });
  const rowById = {};
  svg.querySelectorAll('.wbs-row[data-row-type="task"]').forEach(row => { rowById[row.dataset.id] = row; });
  svg.querySelectorAll(".wbs-arrow").forEach(arrow => {
    const fromRow = rowById[arrow.dataset.from], toRow = rowById[arrow.dataset.to];
    if (!fromRow || !toRow || fromRow.style.display === "none" || toRow.style.display === "none") { arrow.style.display = "none"; return; }
    arrow.style.display = "";
    const x1 = parseFloat(fromRow.dataset.x2), y1 = parseFloat(fromRow.dataset.centerY);
    const x2 = parseFloat(toRow.dataset.x1), y2 = parseFloat(toRow.dataset.centerY);
    const midX = x1 + Math.max(8, (x2 - x1) / 2);
    arrow.setAttribute("d", `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2 - 6} ${y2}`);
  });
}
function layoutAllWbsWidgets() { document.querySelectorAll(".wbs-scroll svg").forEach(layoutWbsSvg); }
function initWbsInteractions() {
  document.addEventListener("click", e => {
    const toggle = e.target.closest(".wbs-toggle");
    if (toggle) {
      toggle.dataset.collapsed = toggle.dataset.collapsed === "1" ? "0" : "1";
      toggle.textContent = (toggle.dataset.collapsed === "1" ? "▸ " : "▾ ") + toggle.dataset.phase;
      layoutWbsSvg(toggle.closest("svg"));
      return;
    }
    const btn = e.target.closest("[data-wbs-action]");
    if (btn) {
      const widget = btn.closest(".wbs-widget");
      const svg = widget.querySelector(".wbs-scroll svg");
      const collapse = btn.dataset.wbsAction === "collapse";
      svg.querySelectorAll(".wbs-toggle").forEach(t => {
        t.dataset.collapsed = collapse ? "1" : "0";
        t.textContent = (collapse ? "▸ " : "▾ ") + t.dataset.phase;
      });
      layoutWbsSvg(svg);
    }
  });
}

function illustrationFork() {
  const q = BLUEPRINT.openQuestion;
  const branchBox = (bx, by, branch, color) => {
    let rows = `<rect x="${bx}" y="${by}" width="300" height="${70 + branch.changes.length * 20}" rx="10" style="fill:var(--${color}-bg);stroke:var(--${color})"/>
      <text x="${bx + 16}" y="${by + 26}" style="fill:var(--${color});font-size:12.5px;font-weight:700">${esc(branch.label)}</text>`;
    branch.changes.forEach((c, i) => {
      rows += `<text x="${bx + 16}" y="${by + 50 + i * 20}" style="fill:var(--text);font-size:11px">• ${esc(c.length > 42 ? c.slice(0, 40) + "…" : c)}</text>`;
    });
    return rows;
  };
  const h = 70 + Math.max(q.branchA.changes.length, q.branchB.changes.length) * 20 + 60;
  const mkA = "arrFa" + (++figCounter), mkB = "arrFb" + (++figCounter);
  return `${svgOpen(680, h)}
    ${marker(mkA, "var(--info)")}${marker(mkB, "var(--warn)")}
    <rect x="190" y="10" width="300" height="46" rx="10" style="fill:var(--card);stroke:var(--border)"/>
    <text x="340" y="38" text-anchor="middle" style="fill:var(--text);font-size:11.5px;font-weight:600">${esc(q.question.length > 48 ? q.question.slice(0, 46) + "…" : q.question)}</text>
    <line x1="300" y1="56" x2="200" y2="86" style="stroke:var(--info);stroke-width:2" marker-end="url(#${mkA})"/>
    <line x1="380" y1="56" x2="480" y2="86" style="stroke:var(--warn);stroke-width:2" marker-end="url(#${mkB})"/>
    ${branchBox(50, 90, q.branchA, "info")}
    ${branchBox(380, 90, q.branchB, "warn")}
  </svg>`;
}

function illustrationCoverageGrid() {
  const cols = 2;
  const cellW = 340, cellH = 58;
  const colorFor = s => s === "covered" ? "good" : s === "partial" ? "warn" : "risk";
  let rows = "";
  BLUEPRINT.coverage.forEach((c, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = 10 + col * (cellW + 10), y = 10 + row * (cellH + 8);
    const color = colorFor(c.status);
    rows += `<rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" rx="8" style="fill:var(--${color}-bg);stroke:var(--${color})"/>
      <text x="${x + 12}" y="${y + 22}" style="fill:var(--${color});font-size:11.5px;font-weight:700">${esc(c.item.length > 40 ? c.item.slice(0, 38) + "…" : c.item)}</text>
      <text x="${x + 12}" y="${y + 40}" style="fill:var(--text);font-size:10px">${esc(c.status.replace("-", " "))}</text>`;
  });
  const totalRows = Math.ceil(BLUEPRINT.coverage.length / cols);
  return `${svgOpen(cellW * cols + 30, totalRows * (cellH + 8) + 12)}${rows}</svg>`;
}

/* compact tile previews for the Command Center */
function tilePic(sectionId) {
  const s = c => `style="fill:${c}"`;
  switch (sectionId) {
    case "summary":
      return `${svgOpen(220, 90)}${marker("t1", "var(--muted)")}
        <rect x="8" y="30" width="60" height="30" rx="6" style="fill:var(--card);stroke:var(--border)"/>
        <line x1="70" y1="45" x2="90" y2="45" style="stroke:var(--muted);stroke-width:2" marker-end="url(#t1)"/>
        <rect x="94" y="24" width="60" height="42" rx="6" style="fill:var(--good-bg);stroke:var(--accent)"/>
        <line x1="156" y1="45" x2="176" y2="45" style="stroke:var(--muted);stroke-width:2" marker-end="url(#t1)"/>
        <rect x="180" y="30" width="34" height="30" rx="6" style="fill:var(--card);stroke:var(--border)"/></svg>`;
    case "components": {
      let x = 8, r = "";
      BLUEPRINT.components.slice(0, 6).forEach((c, i) => { r += `<rect x="${x}" y="${10 + (i % 2) * 40}" width="60" height="28" rx="6" style="fill:var(--good-bg);stroke:var(--accent)"/>`; x += i % 2 ? 70 : 0; });
      return `${svgOpen(220, 90)}${r}</svg>`;
    }
    case "architecture":
      return `${svgOpen(220, 90)}${marker("t3", "var(--muted)")}
        <circle cx="30" cy="45" r="12" style="fill:var(--info-bg);stroke:var(--info)"/>
        <circle cx="110" cy="20" r="12" style="fill:var(--good-bg);stroke:var(--accent)"/>
        <circle cx="110" cy="70" r="12" style="fill:var(--good-bg);stroke:var(--accent)"/>
        <circle cx="190" cy="45" r="12" style="fill:var(--warn-bg);stroke:var(--warn)"/>
        <line x1="41" y1="45" x2="99" y2="24" style="stroke:var(--muted)" marker-end="url(#t3)"/>
        <line x1="41" y1="45" x2="99" y2="66" style="stroke:var(--muted)" marker-end="url(#t3)"/>
        <line x1="121" y1="20" x2="179" y2="41" style="stroke:var(--muted)" marker-end="url(#t3)"/>
        <line x1="121" y1="70" x2="179" y2="49" style="stroke:var(--muted)" marker-end="url(#t3)"/></svg>`;
    case "dataflow": {
      let r = "", x = 14;
      for (let i = 0; i < 7; i++) { r += `<circle cx="${x}" cy="45" r="10" style="fill:var(--good-bg);stroke:var(--accent)"/><text x="${x}" y="49" text-anchor="middle" style="fill:var(--accent);font-size:9px;font-weight:700">${i + 1}</text>`; if (i < 6) r += `<line x1="${x + 12}" y1="45" x2="${x + 20}" y2="45" style="stroke:var(--muted)"/>`; x += 32; }
      return `${svgOpen(220, 90)}${r}</svg>`;
    }
    case "buildorder": {
      let x = 8, r = "";
      BLUEPRINT.buildOrder.phases.forEach(p => {
        const days = daysBetweenDates(parseISODate(p.start), parseISODate(p.finish)) + 1;
        const w = days * 8;
        r += `<rect x="${x}" y="34" width="${w}" height="22" rx="4" style="fill:${p.makeOrBreak ? "var(--warn-bg)" : "var(--good-bg)"};stroke:${p.makeOrBreak ? "var(--warn)" : "var(--accent)"}"/>`;
        x += w + 4;
      });
      return `${svgOpen(220, 90)}${r}</svg>`;
    }
    case "assumptions":
      return `${svgOpen(220, 90)}${marker("t6", "var(--muted)")}
        <rect x="80" y="6" width="60" height="24" rx="6" style="fill:var(--card);stroke:var(--border)"/>
        <line x1="100" y1="30" x2="60" y2="50" style="stroke:var(--info)" marker-end="url(#t6)"/>
        <line x1="120" y1="30" x2="160" y2="50" style="stroke:var(--warn)" marker-end="url(#t6)"/>
        <rect x="16" y="54" width="88" height="28" rx="6" style="fill:var(--info-bg);stroke:var(--info)"/>
        <rect x="116" y="54" width="88" height="28" rx="6" style="fill:var(--warn-bg);stroke:var(--warn)"/></svg>`;
    case "coverage": {
      let r = "", i = 0;
      BLUEPRINT.coverage.slice(0, 8).forEach(c => { const col = i % 4, row = Math.floor(i / 4); const color = c.status === "covered" ? "good" : "risk"; r += `<rect x="${8 + col * 52}" y="${10 + row * 36}" width="44" height="26" rx="5" style="fill:var(--${color}-bg);stroke:var(--${color})"/>`; i++; });
      return `${svgOpen(220, 90)}${r}</svg>`;
    }
    default: return "";
  }
}

/* ===================== section renderers ===================== */
function renderSummary() {
  const c = BLUEPRINT.components.length;
  return `
  <div class="section-head"><div class="kicker">Start here</div><h1>Summary</h1><p class="lede">${esc(BLUEPRINT.meta.oneLiner)}</p></div>
  <div class="card" data-sid="summary-idea"><h2>The Idea</h2><blockquote class="quote">${esc(BLUEPRINT.idea)}</blockquote></div>
  <div class="card" data-sid="summary-dayone"><h2>Day-One Priority</h2><p>${esc(BLUEPRINT.dayOnePriority)}</p></div>
  <div class="card"><h2>At a glance</h2>
    <p><span class="pill good">${c} components</span> &nbsp; <span class="pill neutral">${BLUEPRINT.notAdded.length} deliberately not added</span> &nbsp; <span class="pill info">${BLUEPRINT.buildOrder.phases.length} build phases</span></p>
    ${figureBlock(illustrationPipeline(), "Your notes go in one end; a bi-weekly report comes out the other. Everything between the two exists only to make that reliable.", "svg")}
  </div>`;
}

function renderComponents() {
  const rows = BLUEPRINT.components.map(c => `<tr data-sid="comp-${c.id}">
      <td><strong>${esc(c.name)}</strong><br><span class="pill neutral">${esc(c.category)}</span></td>
      <td>${esc(c.sentence)}</td>
      <td style="color:var(--muted);font-size:12.5px">${esc(c.requiredBy)}</td>
    </tr>`).join("");
  const notAdded = BLUEPRINT.notAdded.map(n => `<tr data-sid="notadded-${BLUEPRINT.notAdded.indexOf(n)}"><td><strong>${esc(n.thing)}</strong></td><td colspan="2">${esc(n.why)}</td></tr>`).join("");
  return `
  <div class="section-head"><div class="kicker">Building blocks</div><h1>Components</h1><p class="lede">Every piece traces back to a specific phrase in the idea paragraph — nothing was added "for completeness."</p></div>
  <div class="card">${figureBlock(illustrationLayers(), "Components grouped by the role they play: what triggers the run, what's read, what processes it, and what comes out.", "svg")}</div>
  <div class="card"><h2>What was built</h2><table class="dtable"><thead><tr><th>Component</th><th>What it does here</th><th>Required by</th></tr></thead><tbody>${rows}</tbody></table></div>
  <div class="card"><h2>What was deliberately left out</h2><table class="dtable"><thead><tr><th>Not added</th><th colspan="2">Why</th></tr></thead><tbody>${notAdded}</tbody></table></div>`;
}

function renderArchitecture() {
  return `
  <div class="section-head"><div class="kicker">Architecture</div><h1>How It Fits Together</h1><p class="lede">One trigger, one straight-through pipeline, one output.</p></div>
  <div class="card" data-sid="arch-interp">
    ${mermaidFigure(BLUEPRINT.diagram, BLUEPRINT.diagramInterpretation)}
  </div>`;
}

function renderDataflow() {
  const rows = BLUEPRINT.dataFlow.steps.map(s => `<div class="card" data-sid="step-${s.n}" style="margin-bottom:10px">
      <strong>${s.n}. ${esc(s.actor)}</strong>
      <p style="margin:6px 0 0;color:var(--muted)">${esc(s.action)}</p>
    </div>`).join("");
  return `
  <div class="section-head"><div class="kicker">Step by step</div><h1>Data Flow</h1><p class="lede">What happens, in order, every single time the pipeline runs.</p></div>
  <div class="card">${figureBlock(illustrationRibbon(), "Seven steps, color-coded by what they touch: trigger, processing, or output. Nothing branches — it's a straight line.", "svg")}</div>
  <div class="card" data-sid="dataflow-interp">${mermaidFigure(BLUEPRINT.dataFlow.sequence, BLUEPRINT.sequenceInterpretation)}</div>
  <h2 style="font-size:15px;margin:20px 0 10px">Walkthrough</h2>
  ${rows}`;
}

function renderBuildorder() {
  const rows = BLUEPRINT.buildOrder.phases.map(p => `<tr data-sid="phase-${p.id}">
      <td><strong>${p.id}. ${esc(p.name)}</strong>${p.makeOrBreak ? ' <span class="pill warn">make-or-break</span>' : ""}</td>
      <td>${esc(p.proves)}</td>
      <td>${esc(p.ships)}</td>
    </tr>`).join("");
  const taskCount = BLUEPRINT.buildOrder.phases.reduce((a, p) => a + p.tasks.length, 0);
  return `
  <div class="section-head"><div class="kicker">Sequencing</div><h1>Build Order</h1><p class="lede">A full work breakdown structure — ${BLUEPRINT.buildOrder.phases.length} phases, ${taskCount} tasks, scheduled with dependencies and a computed critical path, ${esc(fmtShortDate(BLUEPRINT.buildOrder.projectStart))} → ${esc(fmtShortDate(BLUEPRINT.buildOrder.projectFinish))}.</p></div>
  <div class="card" data-sid="wbs-interp">${illustrationWbsGantt()}</div>
  <div class="card"><h2>Why each phase exists</h2><table class="dtable"><thead><tr><th>Phase</th><th>Proves</th><th>Ships</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderAssumptions() {
  const rows = BLUEPRINT.assumptions.map((a, i) => `<tr data-sid="assum-${i}"><td>${esc(a.assumption)}</td><td style="color:var(--muted)">${esc(a.impact)}</td></tr>`).join("");
  return `
  <div class="section-head"><div class="kicker">Open questions</div><h1>Assumptions</h1><p class="lede">Where this design guessed, and what breaks if the guess is wrong.</p></div>
  <div class="card"><table class="dtable"><thead><tr><th>Assumption</th><th>Impact if wrong</th></tr></thead><tbody>${rows}</tbody></table></div>
  <div class="card" data-sid="open-q"><h2>The one question that would most change the design</h2>
    <p class="lede" style="max-width:none">${esc(BLUEPRINT.openQuestion.question)}</p>
    ${figureBlock(illustrationFork(), "Both branches keep the same components — only the scheduler trigger and the compiler's windowing logic change.", "svg")}
  </div>`;
}

function renderCoverage() {
  const rows = BLUEPRINT.coverage.map((c, i) => {
    const pill = c.status === "covered" ? '<span class="pill good">covered</span>' : c.status === "partial" ? '<span class="pill warn">partial</span>' : '<span class="pill risk">not covered</span>';
    return `<tr data-sid="cov-${i}"><td>${esc(c.item)}</td><td>${pill}</td><td style="color:var(--muted)">${esc(c.note)}</td></tr>`;
  }).join("");
  return `
  <div class="section-head"><div class="kicker">Scope</div><h1>Coverage</h1><p class="lede">What this design handles today, stated plainly — including what it doesn't.</p></div>
  <div class="card">${figureBlock(illustrationCoverageGrid(), "Teal is covered today; red is explicitly out of scope. A miss here may itself be the answer to a question you're asking.", "svg")}</div>
  <div class="card"><table class="dtable"><thead><tr><th>Item</th><th>Status</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

const RENDERERS = { summary: renderSummary, components: renderComponents, architecture: renderArchitecture, dataflow: renderDataflow, buildorder: renderBuildorder, assumptions: renderAssumptions, coverage: renderCoverage };

/* ===================== command center ===================== */
function renderIndex() {
  document.getElementById("app").innerHTML = `
  ${renderTopbar("index")}
  <div class="wrap">
    <div class="hero">
      <div class="kicker">${esc(BLUEPRINT.meta.title)}</div>
      <h1>Command Center</h1>
      <p>${esc(BLUEPRINT.meta.oneLiner)}</p>
      <blockquote class="quote">${esc(BLUEPRINT.idea)}</blockquote>
    </div>
    <div class="tilegrid">
      ${SECTIONS.map(s => {
        const countMap = { summary: "1 idea, 1 priority", components: BLUEPRINT.components.length + " components", architecture: "1 pipeline diagram", dataflow: BLUEPRINT.dataFlow.steps.length + " steps", buildorder: BLUEPRINT.buildOrder.phases.length + " phases", assumptions: BLUEPRINT.assumptions.length + " assumptions", coverage: BLUEPRINT.coverage.filter(c => c.status !== "covered").length + " not covered" };
        return `<a class="tile" href="${s.file}">
          <div class="tile-pic">${tilePic(s.id)}</div>
          <h3>${esc(s.title)}</h3>
          <p>${esc(s.desc)}</p>
          <span class="tile-count">${esc(countMap[s.id])}</span>
        </a>`;
      }).join("")}
    </div>
  </div>
  ${askPanelHtml()}
  <button class="iconbtn back-top" id="backTop" title="Back to top" aria-label="Back to top">↑</button>`;
}

/* ===================== ask panel ===================== */
function askPanelHtml() {
  return `
  <div class="ask-panel">
    <button class="ask-toggle" id="askToggle">Ask ⌘</button>
    <div class="ask-window" id="askWindow">
      <div class="ask-head">
        <strong>Ask the blueprint</strong>
        <div class="ask-modes">
          <button class="active" data-mode="search" id="modeSearchBtn">Search · no key</button>
          <button data-mode="claude" id="modeClaudeBtn">Claude · needs key</button>
        </div>
      </div>
      <div class="ask-body" id="askBody">
        <div class="ask-config" id="askConfig">
          <input type="password" id="askKey" placeholder="Paste your Anthropic API key (stored only in this browser)">
          <select id="askModel">
            <option value="claude-opus-5">claude-opus-5</option>
            <option value="claude-sonnet-5">claude-sonnet-5</option>
            <option value="claude-haiku-4-5">claude-haiku-4-5</option>
          </select>
          <div class="ask-scope">
            <label><input type="radio" name="askScope" value="section" ${document.body.dataset.section && document.body.dataset.section !== "index" ? "checked" : ""}> This section</label>
            <label><input type="radio" name="askScope" value="whole" ${!document.body.dataset.section || document.body.dataset.section === "index" ? "checked" : ""}> Whole blueprint</label>
          </div>
        </div>
        <p class="ask-hint">Search mode answers from the same index as the nav search box — no key, no network, works offline. Switch to Claude mode to ask in your own words using your own API key.</p>
      </div>
      <div class="ask-foot">
        <input type="text" id="askInput" placeholder="Ask a question…">
        <button id="askSend">Ask</button>
      </div>
    </div>
  </div>`;
}

function getSectionData(sectionId) {
  switch (sectionId) {
    case "summary": return { idea: BLUEPRINT.idea, dayOnePriority: BLUEPRINT.dayOnePriority, meta: BLUEPRINT.meta };
    case "components": return { components: BLUEPRINT.components, notAdded: BLUEPRINT.notAdded };
    case "architecture": return { diagram: BLUEPRINT.diagram, interpretation: BLUEPRINT.diagramInterpretation };
    case "dataflow": return BLUEPRINT.dataFlow;
    case "buildorder": return BLUEPRINT.buildOrder;
    case "assumptions": return { assumptions: BLUEPRINT.assumptions, openQuestion: BLUEPRINT.openQuestion };
    case "coverage": return { coverage: BLUEPRINT.coverage };
    default: return BLUEPRINT;
  }
}

function initAskPanel() {
  const toggle = document.getElementById("askToggle");
  const win = document.getElementById("askWindow");
  const body = document.getElementById("askBody");
  const config = document.getElementById("askConfig");
  const input = document.getElementById("askInput");
  const sendBtn = document.getElementById("askSend");
  let mode = "search";

  const savedKey = localStorage.getItem("bp_ask_key");
  if (savedKey) document.getElementById("askKey").value = savedKey;
  const savedModel = localStorage.getItem("bp_ask_model");
  if (savedModel) document.getElementById("askModel").value = savedModel;

  toggle.addEventListener("click", () => win.classList.toggle("open"));

  document.getElementById("modeSearchBtn").addEventListener("click", () => setMode("search"));
  document.getElementById("modeClaudeBtn").addEventListener("click", () => setMode("claude"));
  function setMode(m) {
    mode = m;
    document.getElementById("modeSearchBtn").classList.toggle("active", m === "search");
    document.getElementById("modeClaudeBtn").classList.toggle("active", m === "claude");
    config.classList.toggle("show", m === "claude");
  }

  document.getElementById("askKey").addEventListener("change", e => localStorage.setItem("bp_ask_key", e.target.value));
  document.getElementById("askModel").addEventListener("change", e => localStorage.setItem("bp_ask_model", e.target.value));

  function clearAnswers() { body.querySelectorAll(".ask-answer, .ask-error").forEach(n => n.remove()); }

  function renderSearchAnswer(query) {
    clearAnswers();
    const hits = runSearch(query).slice(0, 6);
    if (!hits.length) {
      const div = document.createElement("div");
      div.className = "ask-error";
      div.innerHTML = `No matching passages for "${esc(query)}". That gap may itself be the answer — check <a href="${sectionMeta("coverage").file}">Coverage</a>.`;
      body.prepend(div);
      return;
    }
    hits.forEach(h => {
      const div = document.createElement("div");
      div.className = "ask-answer";
      const meta = sectionMeta(h.section);
      div.innerHTML = `<div class="hit-section">${esc(meta.title)}</div><strong>${esc(h.title)}</strong><div>${snippet(h.text, query)}</div><div class="ask-src"><a href="${meta.file}?q=${encodeURIComponent(query)}">Open in ${esc(meta.title)} →</a></div>`;
      body.prepend(div);
    });
  }

  async function askClaude(query) {
    clearAnswers();
    const key = document.getElementById("askKey").value.trim();
    if (!key) { showAskError("Paste your Anthropic API key above, or switch to Search mode."); return; }
    const model = document.getElementById("askModel").value;
    const scope = document.querySelector('input[name="askScope"]:checked')?.value || "whole";
    const sectionId = document.body.dataset.section;
    const data = scope === "section" && sectionId && sectionId !== "index" ? getSectionData(sectionId) : BLUEPRINT;
    const system = `You are answering questions about a software architecture blueprint. Answer ONLY using the JSON below — if the answer isn't in it, say so plainly and suggest checking the Coverage section or Search mode. Be concise.\n\nBLUEPRINT JSON:\n${JSON.stringify(data)}`;
    const reqBody = { model, max_tokens: 16000, system, messages: [{ role: "user", content: query }] };
    if (model === "claude-opus-5" || model === "claude-sonnet-5") reqBody.output_config = { effort: "low" };

    const thinking = document.createElement("div");
    thinking.className = "ask-answer";
    thinking.id = "askThinking";
    thinking.textContent = "Asking Claude…";
    body.prepend(thinking);

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify(reqBody)
      });
      document.getElementById("askThinking")?.remove();
      if (!res.ok) {
        if (res.status === 401) throw new Error("Bad API key (401). Check the key you pasted, or switch to Search mode.");
        if (res.status === 429) throw new Error("Rate limited (429) by the Anthropic API. Wait a moment, or switch to Search mode.");
        throw new Error(`Anthropic API returned ${res.status}. Switch to Search mode if this keeps happening.`);
      }
      const data2 = await res.json();
      if (data2.stop_reason === "refusal") throw new Error("Claude declined to answer that. Try rephrasing, or switch to Search mode.");
      const text = (data2.content || []).filter(b => b.type === "text").map(b => b.text).join("\n").trim();
      const div = document.createElement("div");
      div.className = "ask-answer";
      div.innerHTML = `${esc(text || "Claude returned no text.")}<div class="ask-src">Claude · ${esc(model)} · ${esc(scope === "section" ? "this section" : "whole blueprint")}</div>`;
      body.prepend(div);
    } catch (err) {
      document.getElementById("askThinking")?.remove();
      showAskError((err && err.message) || "Lost connection to the Anthropic API. Switch to Search mode.");
    }
  }
  function showAskError(msg) {
    const div = document.createElement("div");
    div.className = "ask-error";
    div.textContent = msg;
    body.prepend(div);
  }

  function submit() {
    const q = input.value.trim();
    if (!q) return;
    if (mode === "search") renderSearchAnswer(q); else askClaude(q);
  }
  sendBtn.addEventListener("click", submit);
  input.addEventListener("keydown", e => { if (e.key === "Enter") submit(); });
}

/* ===================== nav search box + in-page filtering ===================== */
function initNavSearch() {
  const input = document.getElementById("siteSearch");
  const results = document.getElementById("searchResults");
  const currentSection = document.body.dataset.section;

  function apply(query) {
    const hits = runSearch(query);
    const currentHits = hits.filter(h => h.section === currentSection);
    const otherHits = hits.filter(h => h.section !== currentSection);

    document.querySelectorAll("[data-sid]").forEach(el => {
      if (!query.trim()) { el.style.display = ""; return; }
      const match = currentHits.some(h => h.id === el.dataset.sid);
      el.style.display = match ? "" : "none";
    });

    if (!query.trim()) { results.classList.remove("open"); results.innerHTML = ""; return; }
    if (!otherHits.length) {
      results.innerHTML = `<div class="search-empty">No matches in other sections.</div>`;
    } else {
      results.innerHTML = otherHits.slice(0, 8).map(h => {
        const meta = sectionMeta(h.section);
        return `<a class="search-hit" href="${meta.file}?q=${encodeURIComponent(query)}">
          <div class="hit-section">${esc(meta.title)}</div>
          <div class="hit-title">${esc(h.title)}</div>
          <div class="hit-snip">${snippet(h.text, query)}</div>
        </a>`;
      }).join("");
    }
    results.classList.add("open");
  }

  let t;
  input.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => apply(input.value), 80); });
  input.addEventListener("focus", () => { if (input.value.trim()) results.classList.add("open"); });
  document.addEventListener("click", e => { if (!e.target.closest(".searchbox")) results.classList.remove("open"); });

  const q = new URLSearchParams(location.search).get("q");
  if (q) { input.value = q; apply(q); }
}

/* ===================== theme, scroll progress, back-to-top ===================== */
function currentTheme() {
  return document.documentElement.getAttribute("data-theme") || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}
function initTheme() {
  const saved = localStorage.getItem("bp_theme");
  if (saved) document.documentElement.setAttribute("data-theme", saved);
  const btn = document.getElementById("themeToggle");
  if (btn) btn.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("bp_theme", next);
    rerenderAllMermaid();
  });
}
function initScrollChrome() {
  const bar = document.getElementById("progressbar");
  const backTop = document.getElementById("backTop");
  window.addEventListener("scroll", () => {
    const h = document.documentElement;
    const pct = h.scrollHeight > h.clientHeight ? (h.scrollTop / (h.scrollHeight - h.clientHeight)) * 100 : 0;
    if (bar) bar.style.width = pct + "%";
    if (backTop) backTop.classList.toggle("show", h.scrollTop > 420);
  });
  if (backTop) backTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
}

/* ===================== boot ===================== */
document.addEventListener("DOMContentLoaded", () => {
  const sectionId = document.body.dataset.section;
  if (sectionId === "index") {
    renderIndex();
  } else {
    const renderer = RENDERERS[sectionId];
    document.getElementById("app").innerHTML = `
      ${renderTopbar(sectionId)}
      <div class="page">
        ${renderSidenav(sectionId)}
        <main>${renderer()}${renderFooterNav(sectionId)}</main>
      </div>
      ${askPanelHtml()}
      <button class="iconbtn back-top" id="backTop" title="Back to top" aria-label="Back to top">↑</button>`;
  }
  initFigureExpand();
  initTheme();
  initScrollChrome();
  initNavSearch();
  initAskPanel();
  initWbsInteractions();
  flushMermaid();
  layoutAllWbsWidgets();
});
