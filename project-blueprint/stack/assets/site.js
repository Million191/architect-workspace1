/* Shared rendering, nav, search, illustrations, copy buttons, and the Ask agent. Renders everything from STACK. */

const SECTIONS = [
  { id: "summary", file: "01-summary.html", title: "Summary", kicker: "Start here", desc: "The fit-rating key, where this stack is most likely to break, and the at-a-glance count." },
  { id: "recommendations", file: "02-recommendations.html", title: "Recommendations", kicker: "One tech per component", desc: "Every component, one real technology, grouped by what kind of thing it is." },
  { id: "ratings", file: "03-ratings.html", title: "Fit Ratings", kicker: "Mean it", desc: "The whole stack as bands colored by fit, and the reds called out." },
  { id: "dataflow", file: "04-dataflow.html", title: "From The Data Flow", kicker: "Found, not named", desc: "Technology the component list never named, plus where everything actually runs." },
  { id: "learning", file: "05-learning.html", title: "Learning Path", kicker: "Order matters", desc: "What to learn first, and every copy-ready prompt in one place." },
  { id: "alternatives", file: "06-alternatives.html", title: "Alternatives", kicker: "Roads not taken", desc: "What else was considered for this project, and why it lost." },
  { id: "lockin", file: "07-lockin.html", title: "Lock-In", kicker: "Reversibility", desc: "How hard each decision is to undo later." },
  { id: "appendix", file: "08-appendix.html", title: "Appendix", kicker: "Fine print", desc: "What this document does not tell you, and the least-confident calls." }
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
function fitMeta(level) { return STACK.fitLegend.find(f => f.level === level) || STACK.fitLegend[0]; }
function fitColor(level) { return level === "great" ? "good" : level === "good" ? "warn" : "risk"; }
function groupMeta(id) { return STACK.groups.find(g => g.id === id); }
function recById(id) { return STACK.recommendations.find(r => r.id === id); }

/* ===================== search index ===================== */
function buildIndex() {
  const idx = [];
  const push = (section, id, title, text) => idx.push({ section, id, title, text: String(text || "") });

  push("summary", "sum-headline", "Where This Stack Breaks", STACK.headline);
  push("summary", "sum-machine", "Machine Note", STACK.machineNote);
  push("summary", "sum-oneliner", STACK.meta.title, STACK.meta.oneLiner);

  STACK.recommendations.forEach(r => push("recommendations", "rec-" + r.id, r.component + " — " + r.tech, r.why + " " + (r.caveat || "")));
  STACK.skipped.forEach((s, i) => push("recommendations", "skip-" + i, "Skipped: " + s.thing, s.why));

  push("ratings", "ratings-legend", "Fit legend", STACK.fitLegend.map(f => f.icon + " " + f.label + " — " + f.desc).join(" · "));

  STACK.recommendations.filter(r => r.fromFlow).forEach(r => push("dataflow", "flow-" + r.id, r.component + " — " + r.tech, r.why));
  push("dataflow", "topology-note", "Topology", STACK.topology.note);

  STACK.learningOrder.forEach(l => push("learning", "learn-" + l.n, l.n + ". " + l.topic, l.why));
  STACK.recommendations.forEach(r => push("learning", "prompt-" + r.id, "Prompt: " + r.tech, r.prompt));

  STACK.alternatives.forEach((a, i) => push("alternatives", "alt-" + i, a.considered + " (instead of " + a.insteadOf + ")", a.why));

  STACK.lockIn.forEach((l, i) => push("lockin", "lock-" + i, l.decision, l.note));

  STACK.notCovered.forEach((n, i) => push("appendix", "notcov-" + i, "Not covered", n));
  STACK.leastConfident.forEach(l => push("appendix", "conf-" + l.id, "Least confident: " + recById(l.id).component, l.note));

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
      <div class="brand">Bi-Weekly Progress Reporter <span class="dot">·</span> Tech Stack</div>
      <div class="crumbs">${crumbs}</div>
      <div class="topbar-actions">
        <div class="searchbox">
          <input type="search" id="siteSearch" placeholder="Search the stack…" autocomplete="off" aria-label="Search the tech stack">
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
  return `<nav class="sidenav"><h4>Sections</h4>${items}
    <h4 style="margin-top:18px">Blueprint</h4><a href="../index.html">← Architecture site</a></nav>`;
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

/* ===================== inline SVG illustrations (generated from STACK) ===================== */
function svgOpen(w, h) { return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:'Segoe UI',system-ui,sans-serif">`; }

function shortTech(t) { return t.length > 34 ? t.slice(0, 32) + "…" : t; }

/* whole stack as bands, colored by fit */
function illustrationFitBands() {
  const rows = STACK.recommendations;
  const rowH = 34, gap = 6, w = 640;
  let y = 10, body = "";
  rows.forEach((r, i) => {
    const color = fitColor(r.fit);
    body += `<rect x="10" y="${y}" width="${w - 20}" height="${rowH}" rx="7" style="fill:var(--${color}-bg);stroke:var(--${color})"/>
      <text x="20" y="${y + 22}" style="fill:var(--${color});font-size:12px;font-weight:700">${esc(r.component)}</text>
      <text x="${w - 20}" y="${y + 22}" text-anchor="end" style="fill:var(--text);font-size:11px">${esc(shortTech(r.tech))}</text>`;
    y += rowH + gap;
  });
  return `${svgOpen(w, y)}${body}</svg>`;
}

/* proportional bar of great/good/risk, reds called out */
function illustrationFitBar() {
  const counts = { great: 0, good: 0, risk: 0 };
  STACK.recommendations.forEach(r => counts[r.fit]++);
  const total = STACK.recommendations.length;
  const w = 640, barH = 46, y = 30;
  let x = 10, body = "";
  const order = [["great", "good"], ["good", "warn"], ["risk", "risk"]];
  order.forEach(([key, colorVar]) => {
    const segW = (counts[key] / total) * (w - 20);
    if (segW <= 0) return;
    body += `<rect x="${x}" y="${y}" width="${segW}" height="${barH}" style="fill:var(--${colorVar}-bg);stroke:var(--${colorVar})"/>
      <text x="${x + segW / 2}" y="${y + barH / 2 + 5}" text-anchor="middle" style="fill:var(--${colorVar});font-size:13px;font-weight:700">${counts[key]}</text>`;
    x += segW;
  });
  let callout = "";
  if (counts.risk > 0) {
    const riskSegW = (counts.risk / total) * (w - 20);
    const riskX = 10 + (w - 20) - riskSegW;
    const riskItems = STACK.recommendations.filter(r => r.fit === "risk").map(r => r.component).join(", ");
    callout = `<line x1="${riskX + riskSegW / 2}" y1="${y + barH}" x2="${riskX + riskSegW / 2}" y2="${y + barH + 22}" style="stroke:var(--risk);stroke-width:1.5"/>
      <text x="${riskX + riskSegW / 2}" y="${y + barH + 38}" text-anchor="middle" style="fill:var(--risk);font-size:11px;font-weight:700">${esc(riskItems.length > 40 ? riskItems.slice(0, 38) + "…" : riskItems)}</text>`;
  }
  return `${svgOpen(w, y + barH + 56)}${body}${callout}</svg>`;
}

/* topology: what runs on your machine vs. somebody else's server */
function illustrationTopology() {
  const mine = STACK.topology.onYourMachine;
  const theirs = STACK.topology.onSomeoneElsesServer;
  const boxW = 300, itemH = 22, pad = 14;
  const leftH = pad * 2 + 30 + mine.length * itemH;
  const rightH = Math.max(leftH, pad * 2 + 50);
  const w = boxW * 2 + 60;

  let leftItems = "", y = 44;
  mine.forEach((m, i) => {
    leftItems += `<text x="${pad + 10}" y="${y}" style="fill:var(--text);font-size:11px">• ${esc(m)}</text>`;
    y += itemH;
  });

  const rightBody = theirs.length
    ? theirs.map((t, i) => `<text x="${boxW + 60 + pad + 10}" y="${44 + i * itemH}" style="fill:var(--text);font-size:11px">• ${esc(t)}</text>`).join("")
    : `<text x="${boxW + 60 + boxW / 2}" y="${rightH / 2 + 6}" text-anchor="middle" style="fill:var(--muted);font-size:12px;font-style:italic">nothing lives here</text>`;

  return `${svgOpen(w, Math.max(leftH, rightH) + 10)}
    <rect x="10" y="10" width="${boxW}" height="${leftH}" rx="10" style="fill:var(--good-bg);stroke:var(--good);stroke-width:1.5"/>
    <text x="${10 + boxW / 2}" y="30" text-anchor="middle" style="fill:var(--good);font-size:12.5px;font-weight:700">Your Machine</text>
    ${leftItems}
    <rect x="${boxW + 60}" y="10" width="${boxW}" height="${rightH}" rx="10" style="fill:var(--neutral-bg);stroke:var(--border);stroke-width:1.5;stroke-dasharray:5,4"/>
    <text x="${boxW + 60 + boxW / 2}" y="30" text-anchor="middle" style="fill:var(--muted);font-size:12.5px;font-weight:700">Somebody Else's Server</text>
    ${rightBody}
  </svg>`;
}

/* groups chart: recommendations chip-grouped by group, colored by fit (bonus, mirrors architecture's layer chart) */
function illustrationGroupsChart() {
  const h = STACK.groups.length * 60 + 20;
  let y = 16, rows = "";
  STACK.groups.forEach(g => {
    const recs = STACK.recommendations.filter(r => r.group === g.id);
    rows += `<text x="16" y="${y + 14}" style="fill:var(--muted);font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase">${esc(g.label)}</text>`;
    let x = 16;
    recs.forEach(r => {
      const color = fitColor(r.fit);
      const label = shortTech(r.component);
      const w = Math.max(110, label.length * 6.2 + 22);
      rows += `<rect x="${x}" y="${y + 20}" width="${w}" height="30" rx="7" style="fill:var(--${color}-bg);stroke:var(--${color})"/>
        <text x="${x + w / 2}" y="${y + 39}" text-anchor="middle" style="fill:var(--${color});font-size:10.5px;font-weight:600">${esc(label)}</text>`;
      x += w + 8;
    });
    y += 60;
  });
  return `${svgOpen(760, h)}${rows}</svg>`;
}

/* learning ladder */
function illustrationLearningLadder() {
  const steps = STACK.learningOrder;
  const stepW = 130, stepH = 40, riseX = 40, w = steps.length * (stepW - 30) + 220;
  let body = "", x = 20, y = steps.length * 32 + 20;
  steps.forEach((s, i) => {
    body += `<rect x="${x}" y="${y}" width="${stepW}" height="${stepH}" rx="8" style="fill:var(--good-bg);stroke:var(--good)"/>
      <text x="${x + 16}" y="${y + 17}" style="fill:var(--good);font-size:12px;font-weight:700">${s.n}</text>
      <text x="${x + 16}" y="${y + 32}" style="fill:var(--text);font-size:10.5px">${esc(s.topic.length > 26 ? s.topic.slice(0, 24) + "…" : s.topic)}</text>`;
    x += riseX;
    y -= 32;
  });
  return `${svgOpen(w, steps.length * 32 + 20 + stepH)}${body}</svg>`;
}

/* lock-in scale: horizontal gauge per decision */
function illustrationLockInScale() {
  const map = { "low-now": 12, low: 20, "low-medium": 40, medium: 62, high: 90 };
  const rowH = 46, w = 660;
  let y = 10, body = "";
  STACK.lockIn.forEach(l => {
    const pct = map[l.hardness] ?? 50;
    const trackW = w - 40;
    body += `<text x="20" y="${y + 14}" style="fill:var(--text);font-size:11.5px;font-weight:600">${esc(l.decision)}</text>
      <rect x="20" y="${y + 20}" width="${trackW}" height="8" rx="4" style="fill:var(--neutral-bg)"/>
      <rect x="20" y="${y + 20}" width="${(pct / 100) * trackW}" height="8" rx="4" style="fill:var(--accent)"/>
      <circle cx="${20 + (pct / 100) * trackW}" cy="${y + 24}" r="6" style="fill:var(--accent)"/>`;
    y += rowH;
  });
  return `${svgOpen(w, y + 24)}
    ${body}
    <text x="20" y="${y + 16}" style="fill:var(--muted);font-size:10.5px">Easy to undo</text>
    <text x="${w - 20}" y="${y + 16}" text-anchor="end" style="fill:var(--muted);font-size:10.5px">Hard to undo</text>
  </svg>`;
}

/* compact tile previews for the Command Center */
function tilePic(sectionId) {
  switch (sectionId) {
    case "summary":
      return `${svgOpen(220, 90)}
        <rect x="10" y="26" width="200" height="16" rx="4" style="fill:var(--good-bg);stroke:var(--good)"/>
        <rect x="10" y="48" width="140" height="16" rx="4" style="fill:var(--warn-bg);stroke:var(--warn)"/>
        <rect x="10" y="70" width="70" height="16" rx="4" style="fill:var(--risk-bg);stroke:var(--risk)"/></svg>`;
    case "recommendations": {
      let x = 8, r = "";
      STACK.recommendations.slice(0, 6).forEach((rec, i) => { const color = fitColor(rec.fit); r += `<rect x="${x}" y="${10 + (i % 2) * 40}" width="60" height="28" rx="6" style="fill:var(--${color}-bg);stroke:var(--${color})"/>`; x += i % 2 ? 70 : 0; });
      return `${svgOpen(220, 90)}${r}</svg>`;
    }
    case "ratings": {
      const counts = { great: 0, good: 0, risk: 0 };
      STACK.recommendations.forEach(r => counts[r.fit]++);
      const total = STACK.recommendations.length, w = 200;
      let x = 10, r = "";
      [["great", "good"], ["good", "warn"], ["risk", "risk"]].forEach(([k, c]) => {
        const segW = (counts[k] / total) * w;
        if (segW > 0) { r += `<rect x="${x}" y="35" width="${segW}" height="24" style="fill:var(--${c}-bg);stroke:var(--${c})"/>`; x += segW; }
      });
      return `${svgOpen(220, 90)}${r}</svg>`;
    }
    case "dataflow":
      return `${svgOpen(220, 90)}
        <rect x="10" y="20" width="90" height="50" rx="8" style="fill:var(--good-bg);stroke:var(--good)"/>
        <text x="55" y="49" text-anchor="middle" style="fill:var(--good);font-size:10px;font-weight:700">Your Machine</text>
        <rect x="120" y="20" width="90" height="50" rx="8" style="fill:var(--neutral-bg);stroke:var(--border);stroke-dasharray:4,3"/>
        <text x="165" y="49" text-anchor="middle" style="fill:var(--muted);font-size:9px">empty</text></svg>`;
    case "learning": {
      let r = "", x = 10, y = 66;
      STACK.learningOrder.forEach((s, i) => { r += `<rect x="${x}" y="${y}" width="34" height="14" rx="4" style="fill:var(--good-bg);stroke:var(--good)"/>`; x += 20; y -= 12; });
      return `${svgOpen(220, 90)}${r}</svg>`;
    }
    case "alternatives":
      return `${svgOpen(220, 90)}
        <rect x="10" y="16" width="90" height="26" rx="6" style="fill:var(--good-bg);stroke:var(--good)"/>
        <text x="55" y="33" text-anchor="middle" style="fill:var(--good);font-size:9.5px;font-weight:700">Chosen</text>
        <rect x="120" y="16" width="90" height="26" rx="6" style="fill:var(--neutral-bg);stroke:var(--muted);opacity:.6"/>
        <text x="165" y="33" text-anchor="middle" style="fill:var(--muted);font-size:9.5px">Not chosen</text>
        <rect x="10" y="52" width="90" height="26" rx="6" style="fill:var(--neutral-bg);stroke:var(--muted);opacity:.6"/>
        <rect x="120" y="52" width="90" height="26" rx="6" style="fill:var(--neutral-bg);stroke:var(--muted);opacity:.6"/></svg>`;
    case "lockin": {
      let r = "", y = 12;
      [20, 40, 55, 75, 90].forEach(pct => { r += `<rect x="10" y="${y}" width="180" height="6" rx="3" style="fill:var(--neutral-bg)"/><rect x="10" y="${y}" width="${1.8 * pct}" height="6" rx="3" style="fill:var(--accent)"/>`; y += 16; });
      return `${svgOpen(220, 90)}${r}</svg>`;
    }
    case "appendix":
      return `${svgOpen(220, 90)}
        <rect x="10" y="14" width="200" height="14" rx="4" style="fill:var(--card);stroke:var(--border)"/>
        <rect x="10" y="34" width="170" height="14" rx="4" style="fill:var(--card);stroke:var(--border)"/>
        <rect x="10" y="54" width="190" height="14" rx="4" style="fill:var(--card);stroke:var(--border)"/>
        <rect x="10" y="74" width="130" height="14" rx="4" style="fill:var(--card);stroke:var(--border)"/></svg>`;
    default: return "";
  }
}

/* ===================== shared row/prompt renderers ===================== */
function fitPill(fit) {
  const f = fitMeta(fit);
  const cls = fit === "great" ? "good" : fit === "good" ? "warn" : "risk";
  return `<span class="pill ${cls}">${f.icon} ${esc(f.label)}</span>`;
}
function caveatBlock(rec) {
  if (!rec.caveat) return "";
  return `<div class="caveat ${rec.fit === "risk" ? "risk" : ""}"><strong>Caveat —</strong> ${esc(rec.caveat)}</div>`;
}
let promptCounter = 0;
function promptBox(promptText) {
  const id = "prompt-" + (++promptCounter);
  return `<div class="promptbox"><code id="${id}">${esc(promptText)}</code><button class="copybtn" data-copy-target="${id}">Copy</button></div>`;
}
function recRow(r) {
  const g = groupMeta(r.group);
  return `<tr data-sid="rec-${r.id}" class="fit-${r.fit}">
    <td><strong>${esc(r.component)}</strong>${r.fromFlow ? ' <span class="pill neutral">from data flow</span>' : ""}<br><span class="pill neutral">${esc(g.label)}</span></td>
    <td><strong>${esc(r.tech)}</strong></td>
    <td>${fitPill(r.fit)}</td>
    <td>${esc(r.why)}${caveatBlock(r)}</td>
  </tr>`;
}

/* ===================== section renderers ===================== */
function renderSummary() {
  const counts = { great: 0, good: 0, risk: 0 };
  STACK.recommendations.forEach(r => counts[r.fit]++);
  const legendRows = STACK.fitLegend.map(f => `<tr><td>${f.icon} <strong>${esc(f.label)}</strong></td><td>${esc(f.desc)}</td></tr>`).join("");
  return `
  <div class="section-head"><div class="kicker">Start here</div><h1>Summary</h1><p class="lede">${esc(STACK.meta.oneLiner)}</p></div>
  <div class="card"><h2>Based on</h2><p><a href="../architecture.md">${esc(STACK.basedOn)}</a> and <a href="../tech-stack.md">the full written recommendation</a>.</p></div>
  <div class="card" data-sid="sum-headline"><h2>Where This Stack Is Most Likely To Break</h2><blockquote class="quote">${esc(STACK.headline)}</blockquote></div>
  <div class="card" data-sid="sum-machine"><h2>About This Machine</h2><p>${esc(STACK.machineNote)}</p></div>
  <div class="card"><h2>Fit-rating key</h2><table class="dtable"><thead><tr><th>Rating</th><th>Meaning</th></tr></thead><tbody>${legendRows}</tbody></table></div>
  <div class="card"><h2>At a glance</h2>
    <p><span class="pill good">${counts.great} 🟢 great fit</span> &nbsp; <span class="pill warn">${counts.good} 🟡 good fit</span> &nbsp; <span class="pill risk">${counts.risk} 🔴 consider carefully</span></p>
    <p style="color:var(--muted);font-size:13px;margin-top:10px">Every component in <a href="../architecture.md">architecture.md</a> has a row — see <a href="02-recommendations.html">Recommendations</a>.</p>
  </div>`;
}

function renderRecommendations() {
  const rows = STACK.groups.map(g => {
    const recs = STACK.recommendations.filter(r => r.group === g.id);
    if (!recs.length) return "";
    return `<h2 style="font-size:15px;margin:22px 0 4px">${esc(g.label)}</h2><p style="color:var(--muted);font-size:13px;margin:0 0 10px">${esc(g.desc)}</p>
      <table class="dtable"><thead><tr><th>Component</th><th>Recommended tech</th><th>Fit</th><th>Why</th></tr></thead><tbody>${recs.map(recRow).join("")}</tbody></table>`;
  }).join("");
  const skipped = STACK.skipped.map((s, i) => `<tr data-sid="skip-${i}"><td><strong>${esc(s.thing)}</strong></td><td colspan="3">${esc(s.why)}</td></tr>`).join("");
  return `
  <div class="section-head"><div class="kicker">One tech per component</div><h1>Recommendations</h1><p class="lede">Grouped by what kind of thing each recommendation is — not by which layer of a generic web app it resembles.</p></div>
  <div class="card">${figureBlock(illustrationGroupsChart(), "Every recommendation, grouped, colored by fit rating — green is great, amber is good, red is consider-carefully.", "svg")}</div>
  <div class="card">${rows}</div>
  <div class="card"><h2>Deliberately not rated</h2><table class="dtable"><thead><tr><th>Thing</th><th colspan="3">Why no technology row</th></tr></thead><tbody>${skipped}</tbody></table></div>`;
}

function renderRatings() {
  return `
  <div class="section-head"><div class="kicker">Mean it</div><h1>Fit Ratings</h1><p class="lede">Rated against this project's actual scale — one person, one machine, one report every 14 days — not against what's popular.</p></div>
  <div class="card">${figureBlock(illustrationFitBar(), "Nine recommendations, proportional by fit. The red segment is called out below the bar — that's the one worth reading closely before you build it.", "svg")}</div>
  <div class="card">${figureBlock(illustrationFitBands(), "The whole stack, one band per recommendation, colored by fit rating.", "svg")}</div>
  <div class="card"><h2>Least confident about</h2>${STACK.leastConfident.map(l => {
    const r = recById(l.id);
    return `<div data-sid="conf-${l.id}" style="margin-bottom:12px"><strong>${esc(r.component)}</strong> ${fitPill(r.fit)}<p style="margin:6px 0 0;color:var(--muted)">${esc(l.note)}</p></div>`;
  }).join("")}</div>`;
}

function renderDataflow() {
  const flowRecs = STACK.recommendations.filter(r => r.fromFlow);
  return `
  <div class="section-head"><div class="kicker">Found, not named</div><h1>From The Data Flow</h1><p class="lede">Technology the component list never mentioned, surfaced by tracing what the data flow actually needs end to end.</p></div>
  <div class="card"><table class="dtable"><thead><tr><th>Component</th><th>Recommended tech</th><th>Fit</th><th>Why</th></tr></thead><tbody>${flowRecs.map(recRow).join("")}</tbody></table></div>
  <div class="card" data-sid="topology-note"><h2>Where everything actually runs</h2>
    ${figureBlock(illustrationTopology(), STACK.topology.note, "svg")}
  </div>`;
}

function renderLearning() {
  const ladder = STACK.learningOrder.map(l => `<div class="ladder-rung" data-sid="learn-${l.n}">
      <div class="ladder-num">${l.n}</div>
      <div class="ladder-body"><strong>${esc(l.topic)}</strong><p>${esc(l.why)}</p></div>
    </div>`).join("");
  const prompts = STACK.recommendations.map(r => `<tr data-sid="prompt-${r.id}"><td><strong>${esc(r.tech)}</strong><br><span class="pill neutral">${esc(r.component)}</span></td><td>${promptBox(r.prompt)}</td></tr>`).join("");
  return `
  <div class="section-head"><div class="kicker">Order matters</div><h1>Learning Path</h1><p class="lede">What to learn first, matched to this project's own build order in architecture.md.</p></div>
  <div class="card">${figureBlock(illustrationLearningLadder(), "Five rungs, climbed in order — each one unlocks the next component's build phase.", "svg")}</div>
  <div class="card">${ladder}</div>
  <h2 style="font-size:15px;margin:22px 0 10px">Every copy-ready prompt</h2>
  <div class="card"><table class="dtable"><thead><tr><th>Technology</th><th>Paste this</th></tr></thead><tbody>${prompts}</tbody></table></div>`;
}

function renderAlternatives() {
  const rows = STACK.alternatives.map((a, i) => `<tr data-sid="alt-${i}">
      <td><strong>${esc(a.considered)}</strong></td>
      <td style="color:var(--muted);font-size:12.5px">instead of ${esc(a.insteadOf)}</td>
      <td>${esc(a.why)}</td>
    </tr>`).join("");
  return `
  <div class="section-head"><div class="kicker">Roads not taken</div><h1>Alternatives Considered</h1><p class="lede">Every alternative was a real option for a project like this in general — here's why it lost for THIS project specifically.</p></div>
  <div class="card"><table class="dtable"><thead><tr><th>Considered</th><th>In place of</th><th>Why not, here</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderLockin() {
  const rows = STACK.lockIn.map((l, i) => `<tr data-sid="lock-${i}"><td><strong>${esc(l.decision)}</strong></td><td style="color:var(--muted)">${esc(l.note)}</td></tr>`).join("");
  return `
  <div class="section-head"><div class="kicker">Reversibility</div><h1>Lock-In</h1><p class="lede">Not every decision costs the same to walk back. This is the order to worry about them in.</p></div>
  <div class="card">${figureBlock(illustrationLockInScale(), "Dot position shows how hard each decision is to undo later — the Parser's regex design sits furthest right on purpose.", "svg")}</div>
  <div class="card"><table class="dtable"><thead><tr><th>Decision</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderAppendix() {
  const notCov = STACK.notCovered.map((n, i) => `<li data-sid="notcov-${i}">${esc(n)}</li>`).join("");
  const artifacts = STACK.artifacts.map(a => `<li><strong>${esc(a.name)}</strong> — ${esc(a.desc)}</li>`).join("");
  return `
  <div class="section-head"><div class="kicker">Fine print</div><h1>Appendix</h1><p class="lede">What this document does not tell you, stated plainly, plus where the source documents live.</p></div>
  <div class="card"><h2>What this document does NOT tell you</h2><ul>${notCov}</ul></div>
  <div class="card"><h2>Source documents</h2><ul>${artifacts}</ul></div>`;
}

const RENDERERS = { summary: renderSummary, recommendations: renderRecommendations, ratings: renderRatings, dataflow: renderDataflow, learning: renderLearning, alternatives: renderAlternatives, lockin: renderLockin, appendix: renderAppendix };

/* ===================== command center ===================== */
function renderIndex() {
  const counts = { great: 0, good: 0, risk: 0 };
  STACK.recommendations.forEach(r => counts[r.fit]++);
  document.getElementById("app").innerHTML = `
  ${renderTopbar("index")}
  <div class="wrap">
    <div class="hero">
      <div class="kicker">${esc(STACK.meta.title)}</div>
      <h1>Command Center</h1>
      <p>${esc(STACK.meta.oneLiner)}</p>
      <blockquote class="quote">${esc(STACK.machineNote)}</blockquote>
    </div>
    <div class="tilegrid">
      ${SECTIONS.map(s => {
        const countMap = {
          summary: `${STACK.recommendations.length} recommendations`,
          recommendations: STACK.groups.length + " groups",
          ratings: `${counts.risk} to watch`,
          dataflow: STACK.recommendations.filter(r => r.fromFlow).length + " found in flow",
          learning: STACK.learningOrder.length + " steps",
          alternatives: STACK.alternatives.length + " alternatives",
          lockin: STACK.lockIn.length + " decisions",
          appendix: STACK.notCovered.length + " caveats"
        };
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

/* ===================== copy buttons ===================== */
function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand("copy");
      resolve();
    } catch (e) {
      reject(e);
    } finally {
      document.body.removeChild(ta);
    }
  });
}
function initCopyButtons() {
  document.addEventListener("click", e => {
    const btn = e.target.closest(".copybtn");
    if (!btn) return;
    const src = document.getElementById(btn.dataset.copyTarget);
    if (!src) return;
    copyText(src.textContent).then(() => {
      const original = btn.textContent;
      btn.textContent = "Copied ✓";
      btn.classList.add("copied");
      setTimeout(() => { btn.textContent = original; btn.classList.remove("copied"); }, 1600);
    }).catch(() => {
      btn.textContent = "Select & copy manually";
    });
  });
}

/* ===================== ask panel ===================== */
function askPanelHtml() {
  return `
  <div class="ask-panel">
    <button class="ask-toggle" id="askToggle">Ask ⌘</button>
    <div class="ask-window" id="askWindow">
      <div class="ask-head">
        <strong>Ask the stack</strong>
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
            <label><input type="radio" name="askScope" value="whole" ${!document.body.dataset.section || document.body.dataset.section === "index" ? "checked" : ""}> Whole stack</label>
          </div>
        </div>
        <p class="ask-hint">Search mode answers from the same index as the nav search box — no key, no network, works offline. Switch to Claude mode to ask in your own words using your own API key. Claude will never talk you out of a 🔴 rating — it only explains what's already here.</p>
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
    case "summary": return { headline: STACK.headline, machineNote: STACK.machineNote, meta: STACK.meta, fitLegend: STACK.fitLegend };
    case "recommendations": return { recommendations: STACK.recommendations, groups: STACK.groups, skipped: STACK.skipped };
    case "ratings": return { recommendations: STACK.recommendations, leastConfident: STACK.leastConfident };
    case "dataflow": return { flowRecommendations: STACK.recommendations.filter(r => r.fromFlow), topology: STACK.topology };
    case "learning": return { learningOrder: STACK.learningOrder, prompts: STACK.recommendations.map(r => ({ tech: r.tech, prompt: r.prompt })) };
    case "alternatives": return { alternatives: STACK.alternatives };
    case "lockin": return { lockIn: STACK.lockIn };
    case "appendix": return { notCovered: STACK.notCovered, artifacts: STACK.artifacts };
    default: return STACK;
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

  const savedKey = localStorage.getItem("stack_ask_key");
  if (savedKey) document.getElementById("askKey").value = savedKey;
  const savedModel = localStorage.getItem("stack_ask_model");
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

  document.getElementById("askKey").addEventListener("change", e => localStorage.setItem("stack_ask_key", e.target.value));
  document.getElementById("askModel").addEventListener("change", e => localStorage.setItem("stack_ask_model", e.target.value));

  function clearAnswers() { body.querySelectorAll(".ask-answer, .ask-error").forEach(n => n.remove()); }

  function renderSearchAnswer(query) {
    clearAnswers();
    const hits = runSearch(query).slice(0, 6);
    if (!hits.length) {
      const div = document.createElement("div");
      div.className = "ask-error";
      div.innerHTML = `No matching passages for "${esc(query)}". That gap may itself be the answer — check <a href="${sectionMeta("appendix").file}">Appendix</a>.`;
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
    const data = scope === "section" && sectionId && sectionId !== "index" ? getSectionData(sectionId) : STACK;
    const system = `You are answering questions about a software tech-stack recommendation. Answer ONLY using the JSON below — if the answer isn't in it, say so plainly and suggest checking the Appendix section or Search mode. Never talk the user out of a 🔴 "consider carefully" rating — your job is to explain the caveat, not soften it. Be concise.\n\nSTACK JSON:\n${JSON.stringify(data)}`;
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
      div.innerHTML = `${esc(text || "Claude returned no text.")}<div class="ask-src">Claude · ${esc(model)} · ${esc(scope === "section" ? "this section" : "whole stack")}</div>`;
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
  const saved = localStorage.getItem("stack_theme");
  if (saved) document.documentElement.setAttribute("data-theme", saved);
  const btn = document.getElementById("themeToggle");
  if (btn) btn.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("stack_theme", next);
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
  initCopyButtons();
});
