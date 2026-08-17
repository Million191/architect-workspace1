(function () {
  'use strict';

  /* ============================================================
     Config
     ============================================================ */
  var DATA_PATHS = {
    plan: '.colaberry/plan.json',
    progress: '.colaberry/progress.json',
    manifest: '.colaberry/manifest.json',
    profile: '.colaberry/profile.json'
  };

  var TABS = [
    { id: 'overview', label: 'Overview', built: true },
    { id: 'outcomes', label: 'Outcomes', built: false, desc: 'The numeric measures this project is meant to move (plan.derived.measures).' },
    { id: 'users', label: 'Users & Use Case', built: false, desc: 'Who this is for and what they are trying to get done, taken from your story roles (plan.derived.roles) and narratives.' },
    { id: 'guardrails', label: 'Guardrails', built: false, desc: 'The promises this system makes and whether anything currently enforces them (plan.derived.guardrails).' },
    { id: 'systems', label: 'Systems', built: false, desc: 'What this connects to, and an honest connection status for each (plan.derived.systems).' },
    { id: 'pm', label: 'Project Management', built: false, desc: 'A Gantt of your releases and every task with its due date (plan.releases, plan.schedule, story due dates).' },
    { id: 'agents', label: 'AI Agents', built: false, desc: 'The design of who/what owns each story, and — once agents exist — their run history (plan.agents).' },
    { id: 'kb', label: 'Knowledge Base', built: false, desc: 'Requirements, stories, traceability, and a chat panel that answers from this data (plan.requirements, plan.stories).' },
    { id: 'datamodel', label: 'Data Model', built: false, desc: 'The tables behind all of the above, derived from your requirements.' }
  ];

  var STATE_LABEL = {
    verified: 'Verified',
    submitted: 'Submitted',
    in_progress: 'In progress',
    not_started: 'Not started'
  };

  var SAMPLE_OVERVIEW = {
    totals: { stories_total: 20, stories_verified: 9, criteria_total: 47, criteria_passed: 33, points_awarded: 620 }
  };

  var state = {
    plan: null,
    progress: null,
    manifest: null,
    profile: null,
    dataMode: localStorage.getItem('cc_data_mode') === 'sample' ? 'sample' : 'real',
    loadError: null
  };

  /* ============================================================
     Data loading
     ============================================================ */
  function fetchJSON(path) {
    return fetch(path, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error(path + ' responded ' + res.status);
      return res.json();
    });
  }

  function loadData() {
    return Promise.all([
      fetchJSON(DATA_PATHS.plan),
      fetchJSON(DATA_PATHS.progress),
      fetchJSON(DATA_PATHS.manifest),
      fetchJSON(DATA_PATHS.profile).catch(function () { return null; })
    ]).then(function (results) {
      state.plan = results[0];
      state.progress = results[1];
      state.manifest = results[2];
      state.profile = results[3];
    }).catch(function (err) {
      state.loadError = err;
    });
  }

  /* ============================================================
     Helpers
     ============================================================ */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function formatAbs(dateStr) {
    if (!dateStr) return 'unknown';
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }

  function daysBetween(a, b) {
    var msPerDay = 24 * 60 * 60 * 1000;
    var ad = new Date(a); var bd = new Date(b);
    return Math.round((bd.getTime() - ad.getTime()) / msPerDay);
  }

  function formatRelativeAge(dateStr) {
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    var now = new Date();
    var days = daysBetween(d, now);
    if (days <= 0) return 'today';
    if (days === 1) return '1 day ago';
    return days + ' days ago';
  }

  function ageInDays(dateStr) {
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return 0;
    return daysBetween(d, new Date());
  }

  function dateStampInfo() {
    if (!state.manifest || !state.manifest.generated_at) {
      return { text: 'No manifest.json found — sync from the portal.', warn: true };
    }
    var gen = state.manifest.generated_at;
    var days = ageInDays(gen);
    var text = 'Data as of ' + formatAbs(gen) + ' (' + formatRelativeAge(gen) + ')';
    if (days > 7) text += ' — sync from the portal to refresh.';
    return { text: text, warn: days > 7 };
  }

  function dateStampHTML() {
    var info = dateStampInfo();
    return '<span class="cc-datestamp' + (info.warn ? ' warn' : '') + '">' + esc(info.text) + '</span>';
  }

  function storyStateBadge(state_) {
    var s = state_ || 'not_started';
    var label = STATE_LABEL[s] || s;
    return '<span class="cc-badge ' + esc(s) + '">' + esc(label) + '</span>';
  }

  function progressStoryById(id) {
    var list = (state.progress && state.progress.stories) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function planStoryById(id) {
    var list = (state.plan && state.plan.stories) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function currentRelease() {
    if (!state.plan || !state.plan.releases) return null;
    var now = new Date();
    var releases = state.plan.releases;
    for (var i = 0; i < releases.length; i++) {
      var r = releases[i];
      if (new Date(r.starts_on) <= now && now <= new Date(r.ends_on)) return r;
    }
    // fall back: the next upcoming release, or the last one if the term is over
    for (var j = 0; j < releases.length; j++) {
      if (new Date(releases[j].starts_on) > now) return releases[j];
    }
    return releases[releases.length - 1] || null;
  }

  function sampleBannerHTML() {
    if (state.dataMode !== 'sample') return '';
    return '<div class="cc-sample-banner">⚠ Sample data — not from your real project</div>';
  }

  function tabHeaderHTML(title, subtitle) {
    return '<div class="cc-tab-header"><h1>' + esc(title) + '</h1>' +
      (subtitle ? '<p>' + esc(subtitle) + '</p>' : '') +
      '<div style="margin-top:8px;">' + dateStampHTML() + '</div></div>';
  }

  /* ============================================================
     Router
     ============================================================ */
  function parseHash() {
    var h = (location.hash || '#/overview').replace(/^#\/?/, '');
    var parts = h.split('/').filter(Boolean);
    return { tab: parts[0] || 'overview', rest: parts.slice(1) };
  }

  function navigate(hash) {
    location.hash = hash;
  }

  function render() {
    renderNav();
    renderToggle();
    var globalStamp = document.getElementById('cc-datestamp-global');
    if (globalStamp) {
      var info = dateStampInfo();
      globalStamp.textContent = info.text;
      globalStamp.className = 'cc-datestamp' + (info.warn ? ' warn' : '');
    }

    if (state.loadError) {
      renderLoadError();
      return;
    }

    var route = parseHash();
    var main = document.getElementById('cc-main');
    var tab = TABS.filter(function (t) { return t.id === route.tab; })[0];
    if (!tab) { navigate('#/overview'); return; }

    if (tab.id === 'overview') {
      main.innerHTML = renderOverview(route.rest);
    } else {
      main.innerHTML = renderStub(tab);
    }

    window.scrollTo(0, 0);
  }

  function renderNav() {
    var route = parseHash();
    var nav = document.getElementById('cc-nav');
    nav.innerHTML = TABS.map(function (t) {
      var active = t.id === route.tab ? ' active' : '';
      return '<a href="#/' + t.id + '" class="' + active.trim() + '">' + esc(t.label) + '</a>';
    }).join('');
  }

  function renderToggle() {
    var wrap = document.getElementById('cc-mode-toggle');
    var buttons = wrap.querySelectorAll('button');
    buttons.forEach(function (b) {
      var isActive = b.getAttribute('data-mode') === state.dataMode;
      b.className = isActive ? (b.getAttribute('data-mode') === 'sample' ? 'active sample-active' : 'active') : '';
      b.onclick = function () {
        state.dataMode = b.getAttribute('data-mode');
        localStorage.setItem('cc_data_mode', state.dataMode);
        render();
      };
    });
  }

  function renderLoadError() {
    document.getElementById('cc-main').innerHTML =
      '<div class="cc-fetch-error">' +
      '<strong>Could not load .colaberry data files.</strong><br>' +
      'This page fetches <code>.colaberry/plan.json</code>, <code>progress.json</code> and <code>manifest.json</code> at runtime. ' +
      'If you opened this file directly (<code>file://</code>), most browsers block that fetch. Serve the folder over HTTP instead, e.g. ' +
      '<code>python -m http.server</code> from the repo root, then open <code>http://localhost:8000/</code>. ' +
      'On GitHub Pages this loads normally.<br><br>' +
      '<code>' + esc(state.loadError && state.loadError.message) + '</code>' +
      '</div>';
  }

  /* ============================================================
     Overview tab
     ============================================================ */
  function renderOverview(rest) {
    var sub = rest[0];
    if (sub === 'stories') return overviewStories();
    if (sub === 'criteria') return overviewCriteria();
    if (sub === 'points') return overviewPoints();
    if (sub === 'release') return overviewRelease();
    return overviewMain();
  }

  function overviewMain() {
    var plan = state.plan, progress = state.progress;
    var project = (plan && plan.project) || { name: 'Meeting Assistant', descriptor: '' };
    var totals = state.dataMode === 'sample' ? SAMPLE_OVERVIEW.totals : ((progress && progress.totals) || { stories_total: 0, stories_verified: 0, criteria_total: 0, criteria_passed: 0, points_awarded: 0 });
    var rel = currentRelease();
    var sched = (plan && plan.schedule) || {};

    var html = '';
    html += tabHeaderHTML(project.name, project.descriptor);
    html += '<div class="cc-banner"><strong>Build paused for review.</strong> The Overview tab is built; the other eight tabs are reachable but not built yet. Say "build the rest" to continue.</div>';
    html += sampleBannerHTML();

    html += '<div class="cc-grid cols-4">';
    html += statCard('#/overview/stories', 'Stories', totals.stories_verified + ' of ' + totals.stories_total, 'verified');
    html += statCard('#/overview/criteria', 'Acceptance criteria', totals.criteria_passed + ' of ' + totals.criteria_total, 'passed');
    html += statCard('#/overview/points', 'Points awarded', String(totals.points_awarded), 'total to date');
    html += statCard('#/overview/release', 'Current release', rel ? rel.name : '—', rel ? (rel.key + ' · ' + formatAbs(rel.starts_on) + ' – ' + formatAbs(rel.ends_on)) : 'no release data');
    html += '</div>';

    html += '<div class="cc-section-title">Where we are in the term</div>';
    html += '<div class="cc-card">';
    if (sched.build_start) {
      html += '<p style="margin:0 0 6px;">Build runs <strong>' + esc(formatAbs(sched.build_start)) + '</strong> to <strong>' + esc(formatAbs(sched.build_end)) + '</strong>. ' +
        'Demo day is <strong>' + esc(formatAbs(sched.demo_day)) + '</strong> (the week after build end is demo prep).</p>';
      html += '<p style="margin:0;">Demo target release: <strong>' + esc(sched.demo_release_key || '—') + '</strong>. ' +
        (rel ? 'Currently in <strong>' + esc(rel.key) + ' — ' + esc(rel.name) + '</strong>.' : 'No release covers today’s date.') + '</p>';
    } else {
      html += '<p style="margin:0;color:var(--text-muted);">No schedule data in plan.json yet.</p>';
    }
    html += '</div>';

    return html;
  }

  function statCard(href, label, value, sub) {
    return '<a href="' + href + '" class="cc-card clickable" style="display:block;text-decoration:none;color:inherit;">' +
      '<div class="cc-stat-label">' + esc(label) + '</div>' +
      '<div class="cc-stat-value">' + esc(value) + '</div>' +
      '<div class="cc-stat-sub">' + esc(sub) + '</div>' +
      '</a>';
  }

  function crumb() {
    return '<a href="#/overview" class="cc-crumb">← Overview</a>';
  }

  function overviewStories() {
    var html = crumb();
    html += tabHeaderHTML('Stories', 'Every story tracked for this project, joined from plan.json and progress.json.');
    html += sampleBannerHTML();
    var progStories = (state.progress && state.progress.stories) || [];
    if (!progStories.length) {
      html += emptyState('No stories yet', 'progress.json has no stories recorded.');
      return html;
    }
    html += '<table class="cc-table"><thead><tr><th>ID</th><th>Title</th><th>Release</th><th>Due</th><th>State</th></tr></thead><tbody>';
    progStories.forEach(function (ps) {
      var plStory = planStoryById(ps.id);
      var title = ps.id === 'STORY-000' ? 'Build the Command Center' : (plStory ? plStory.title : '(not in plan.json)');
      var release = plStory ? plStory.release : '—';
      var due = plStory ? formatAbs(plStory.due_on) : '—';
      html += '<tr><td>' + esc(ps.id) + '</td><td>' + esc(title) + '</td><td>' + esc(release) + '</td><td>' + esc(due) + '</td><td>' + storyStateBadge(ps.verification && ps.verification.state) + '</td></tr>';
    });
    html += '</tbody></table>';
    return html;
  }

  function overviewCriteria() {
    var html = crumb();
    html += tabHeaderHTML('STORY-000 acceptance criteria', 'The Done-means lines for the Command Center build itself.');
    html += sampleBannerHTML();
    var story0 = progressStoryById('STORY-000');
    if (!story0 || !story0.criteria) {
      html += emptyState('No criteria recorded', 'STORY-000 has no criteria list in progress.json.');
      return html;
    }
    html += '<table class="cc-table"><thead><tr><th>Criterion</th><th>Status</th></tr></thead><tbody>';
    story0.criteria.forEach(function (c) {
      html += '<tr><td>' + esc(c.text) + '</td><td>' + (c.passed ? '<span class="cc-badge verified">Passed</span>' : '<span class="cc-badge not_started">Not yet</span>') + '</td></tr>';
    });
    html += '</tbody></table>';
    html += '<p style="color:var(--text-muted);font-size:0.85rem;margin-top:12px;">The first criterion needs all nine tabs to exist, so it cannot pass while the build is paused here. That’s expected.</p>';
    return html;
  }

  function overviewPoints() {
    var html = crumb();
    html += tabHeaderHTML('Points', 'How the points total is made up.');
    html += sampleBannerHTML();
    var totals = state.dataMode === 'sample' ? SAMPLE_OVERVIEW.totals : ((state.progress && state.progress.totals) || {});
    html += '<div class="cc-card"><p style="margin:0;">Points awarded so far: <strong>' + esc(totals.points_awarded || 0) + '</strong>.</p>';
    html += '<p style="margin:8px 0 0;color:var(--text-muted);font-size:0.86rem;">Points are awarded per story once it is verified. No story besides STORY-000 has been worked yet, and STORY-000 itself has not verified, so no points have been earned.</p></div>';
    return html;
  }

  function overviewRelease() {
    var html = crumb();
    var rel = currentRelease();
    if (!rel) {
      html += tabHeaderHTML('Current release', '');
      html += emptyState('No release data', 'plan.json has no releases defined.');
      return html;
    }
    html += tabHeaderHTML(rel.key + ' — ' + rel.name, formatAbs(rel.starts_on) + ' → ' + formatAbs(rel.ends_on) + (rel.is_demo_target ? ' · demo target' : ''));
    html += sampleBannerHTML();
    html += '<table class="cc-table"><thead><tr><th>ID</th><th>Title</th><th>Due</th><th>State</th></tr></thead><tbody>';
    (rel.story_ids || []).forEach(function (sid) {
      var plStory = planStoryById(sid);
      var ps = progressStoryById(sid);
      html += '<tr><td>' + esc(sid) + '</td><td>' + esc(plStory ? plStory.title : '—') + '</td><td>' + esc(plStory ? formatAbs(plStory.due_on) : '—') + '</td><td>' + storyStateBadge(ps && ps.verification && ps.verification.state) + '</td></tr>';
    });
    html += '</tbody></table>';
    return html;
  }

  function emptyState(title, body) {
    return '<div class="cc-empty"><h3>' + esc(title) + '</h3><p>' + esc(body) + '</p></div>';
  }

  /* ============================================================
     Stub tabs (not built yet)
     ============================================================ */
  function renderStub(tab) {
    var html = tabHeaderHTML(tab.label, '');
    html += sampleBannerHTML();
    html += '<div class="cc-empty">' +
      '<h3>Not built yet</h3>' +
      '<p>Say <strong>build the rest</strong> when Overview looks right and this tab will be built.</p>' +
      (tab.desc ? '<p style="margin-top:10px;font-size:0.82rem;">Planned: ' + esc(tab.desc) + '</p>' : '') +
      '<a href="#/overview" class="cc-back">← Back to Overview</a>' +
      '</div>';
    return html;
  }

  /* ============================================================
     Boot
     ============================================================ */
  window.addEventListener('hashchange', render);
  loadData().then(render);
})();
