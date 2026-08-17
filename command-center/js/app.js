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
    { id: 'overview', label: 'Overview' },
    { id: 'outcomes', label: 'Outcomes' },
    { id: 'users', label: 'Users & Use Case' },
    { id: 'guardrails', label: 'Guardrails' },
    { id: 'systems', label: 'Systems' },
    { id: 'pm', label: 'Project Management' },
    { id: 'agents', label: 'AI Agents' },
    { id: 'kb', label: 'Knowledge Base' },
    { id: 'datamodel', label: 'Data Model' }
  ];

  var TAB_RENDERERS = {
    overview: renderOverviewTab,
    outcomes: renderOutcomesTab,
    users: renderUsersTab,
    guardrails: renderGuardrailsTab,
    systems: renderSystemsTab,
    pm: renderPmTab,
    agents: renderAgentsTab,
    kb: renderKbTab,
    datamodel: renderDataModelTab
  };

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

    main.innerHTML = TAB_RENDERERS[tab.id](route.rest);
    wireInteractiveBits(tab.id, route.rest);
    window.scrollTo(0, 0);
  }

  function wireInteractiveBits(tabId, rest) {
    if (tabId === 'kb' && !rest.length) wireChat();
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
     Sample overlay — one coherent fictional scenario, used only
     when the Sample toggle is on. Never touches real-mode output.
     ============================================================ */
  var SAMPLE_STORY_STATES = {
    'STORY-000': { state: 'verified', points: 100 },
    'STORY-001': { state: 'verified', points: 65 },
    'STORY-002': { state: 'verified', points: 65 },
    'STORY-003': { state: 'verified', points: 65 },
    'STORY-004': { state: 'verified', points: 65 },
    'STORY-018': { state: 'verified', points: 65 },
    'STORY-005': { state: 'verified', points: 65 },
    'STORY-006': { state: 'verified', points: 65 },
    'STORY-007': { state: 'verified', points: 65 },
    'STORY-008': { state: 'in_progress', points: 0 },
    'STORY-009': { state: 'in_progress', points: 0 },
    'STORY-010': { state: 'not_started', points: 0 },
    'STORY-011': { state: 'not_started', points: 0 },
    'STORY-019': { state: 'not_started', points: 0 },
    'STORY-012': { state: 'not_started', points: 0 },
    'STORY-013': { state: 'not_started', points: 0 },
    'STORY-014': { state: 'not_started', points: 0 },
    'STORY-015': { state: 'not_started', points: 0 },
    'STORY-016': { state: 'not_started', points: 0 },
    'STORY-017': { state: 'not_started', points: 0 }
  };

  var SAMPLE_SYSTEMS = {
    'Zoom': { status: 'connected', lastChecked: '2 minutes ago' },
    'Microsoft Teams': { status: 'error', lastChecked: '14 minutes ago' },
    'Google Meet': { status: 'not_connected', lastChecked: 'never' },
    'Outlook Calendar': { status: 'connected', lastChecked: '1 hour ago' },
    'Trello': { status: 'not_connected', lastChecked: 'never' }
  };

  var SAMPLE_AGENT_RUNS = {
    'Development Team': { runs: 142, successRate: '96%', lastRun: '3 hours ago' },
    'System Auditor': { runs: 8, successRate: '100%', lastRun: '2 days ago' },
    'Meeting Participant': { runs: 0, successRate: null, lastRun: null }
  };

  var SAMPLE_MEASURES = [
    { id: 'sample-1', statement: 'Reduce average time from meeting end to published minutes to under 2 hours.', current: '3.5 hours (avg, last 4 weeks)' },
    { id: 'sample-2', statement: 'Increase action-item on-time completion rate to 85%.', current: '61% (last 4 weeks)' },
    { id: 'sample-3', statement: 'Cut participant follow-up emails that need manual editing before send by 70%.', current: '40% require edits' }
  ];

  function storyState(id) {
    if (state.dataMode === 'sample') {
      var s = SAMPLE_STORY_STATES[id];
      return s ? s.state : 'not_started';
    }
    var ps = progressStoryById(id);
    return (ps && ps.verification && ps.verification.state) || 'not_started';
  }

  function slugify(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }

  /* ============================================================
     1. Overview tab
     ============================================================ */
  function renderOverviewTab(rest) {
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

  function crumbTo(href, label) {
    return '<a href="' + href + '" class="cc-crumb">← ' + esc(label) + '</a>';
  }

  function crumb() {
    return crumbTo('#/overview', 'Overview');
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
      html += '<tr><td>' + esc(ps.id) + '</td><td>' + esc(title) + '</td><td>' + esc(release) + '</td><td>' + esc(due) + '</td><td>' + storyStateBadge(storyState(ps.id)) + '</td></tr>';
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
    html += '<p style="color:var(--text-muted);font-size:0.85rem;margin-top:12px;">This checklist always shows STORY-000’s real status — the Sample/Real toggle does not change it.</p>';
    return html;
  }

  function overviewPoints() {
    var html = crumb();
    html += tabHeaderHTML('Points', 'How the points total is made up.');
    html += sampleBannerHTML();
    var totals = state.dataMode === 'sample' ? SAMPLE_OVERVIEW.totals : ((state.progress && state.progress.totals) || {});
    html += '<div class="cc-card"><p style="margin:0;">Points awarded so far: <strong>' + esc(totals.points_awarded || 0) + '</strong>.</p>';
    html += '<p style="margin:8px 0 0;color:var(--text-muted);font-size:0.86rem;">Points are awarded per story once it is verified.' +
      (state.dataMode === 'sample' ? ' This is illustrative — nine sample stories are shown as verified to demonstrate the shape of this once real work lands.' : ' No story besides STORY-000 has been worked yet, and STORY-000 itself has not verified, so no points have been earned.') +
      '</p></div>';
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
      html += '<tr><td>' + esc(sid) + '</td><td>' + esc(plStory ? plStory.title : '—') + '</td><td>' + esc(plStory ? formatAbs(plStory.due_on) : '—') + '</td><td>' + storyStateBadge(storyState(sid)) + '</td></tr>';
    });
    html += '</tbody></table>';
    return html;
  }

  function emptyState(title, body) {
    return '<div class="cc-empty"><h3>' + esc(title) + '</h3><p>' + esc(body) + '</p></div>';
  }

  /* ============================================================
     2. Outcomes tab
     ============================================================ */
  function renderOutcomesTab(rest) {
    var sub = rest[0];
    if (sub) return outcomeDetail(sub);
    return outcomesMain();
  }

  function outcomesMain() {
    var html = tabHeaderHTML('Outcomes', 'The numbers this project is meant to move.');
    html += sampleBannerHTML();
    if (state.dataMode === 'sample') {
      html += '<div class="cc-grid cols-3">';
      SAMPLE_MEASURES.forEach(function (m) {
        html += statCard('#/outcomes/' + m.id, m.statement, m.current, 'sample measure');
      });
      html += '</div>';
      return html;
    }
    var measures = (state.plan && state.plan.derived && state.plan.derived.measures) || [];
    if (!measures.length) {
      html += emptyState('No numeric targets defined yet', 'plan.derived.measures is empty. Once a measure is added to the plan, a card will appear here for it — switch to Sample above to see the shape this tab will take.');
      return html;
    }
    html += '<div class="cc-grid cols-3">';
    measures.forEach(function (m) {
      html += statCard('#/outcomes/' + esc(m.id), m.statement, '—', 'no value recorded yet');
    });
    html += '</div>';
    return html;
  }

  function outcomeDetail(id) {
    var html = crumbTo('#/outcomes', 'Outcomes');
    if (state.dataMode === 'sample') {
      var m = SAMPLE_MEASURES.filter(function (x) { return x.id === id; })[0];
      html += tabHeaderHTML(m ? m.statement : 'Not found', '');
      html += sampleBannerHTML();
      if (!m) { html += emptyState('No such sample measure', ''); return html; }
      html += '<div class="cc-card"><p style="margin:0;">Current (sample): <strong>' + esc(m.current) + '</strong></p>' +
        '<p style="margin:8px 0 0;color:var(--text-muted);font-size:0.86rem;">Illustrative only — your real plan has no numeric target defined for this measure yet.</p></div>';
      return html;
    }
    var measures = (state.plan && state.plan.derived && state.plan.derived.measures) || [];
    var m2 = measures.filter(function (x) { return x.id === id; })[0];
    html += tabHeaderHTML(m2 ? m2.statement : 'Not found', '');
    if (!m2) { html += emptyState('No such measure', 'That measure id is not in plan.derived.measures.'); return html; }
    html += emptyState('No value recorded yet', 'This measure is defined in the plan but the project has not produced a value for it yet.');
    return html;
  }

  /* ============================================================
     3. Users & Use Case tab
     ============================================================ */
  function renderUsersTab(rest) {
    var sub = rest[0];
    if (sub) return roleDetail(sub);
    return usersMain();
  }

  function roleOf(story) {
    var m = /^As an? (.+?), I want/i.exec(story.narrative || '');
    return m ? m[1].toLowerCase() : null;
  }

  function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function usersMain() {
    var html = tabHeaderHTML('Users & Use Case', 'Who this is for, and what they are trying to get done.');
    html += sampleBannerHTML();
    var roles = (state.plan && state.plan.derived && state.plan.derived.roles) || [];
    if (!roles.length) { html += emptyState('No roles extracted yet', 'plan.derived.roles is empty.'); return html; }
    var stories = (state.plan && state.plan.stories) || [];
    html += '<div class="cc-grid cols-3">';
    roles.forEach(function (role) {
      var count = stories.filter(function (s) { return roleOf(s) === role; }).length;
      html += statCard('#/users/' + slugify(role), capitalize(role), String(count), count === 1 ? 'story' : 'stories');
    });
    html += '</div>';
    return html;
  }

  function roleDetail(slug) {
    var html = crumbTo('#/users', 'Users & Use Case');
    var roles = (state.plan && state.plan.derived && state.plan.derived.roles) || [];
    var role = roles.filter(function (r) { return slugify(r) === slug; })[0];
    html += tabHeaderHTML(role ? capitalize(role) : 'Not found', role ? 'Everything this role wants, in their own words.' : '');
    html += sampleBannerHTML();
    if (!role) { html += emptyState('No such role', 'That role is not in plan.derived.roles.'); return html; }
    var stories = ((state.plan && state.plan.stories) || []).filter(function (s) { return roleOf(s) === role; });
    if (!stories.length) { html += emptyState('No stories for this role', ''); return html; }
    stories.forEach(function (s) {
      html += '<div class="cc-card" style="margin-bottom:10px;"><div style="font-weight:700;font-size:0.86rem;margin-bottom:4px;">' + esc(s.id) + ' — ' + esc(s.title) + '</div><div style="color:var(--text-muted);font-size:0.86rem;">' + esc(s.narrative) + '</div></div>';
    });
    return html;
  }

  /* ============================================================
     4. Guardrails tab
     ============================================================ */
  function renderGuardrailsTab(rest) {
    var sub = rest[0];
    if (sub) return guardrailDetail(sub);
    return guardrailsMain();
  }

  function guardrailEnforcement(reqId) {
    var req = ((state.plan && state.plan.requirements) || []).filter(function (r) { return r.id === reqId; })[0];
    var storyIds = (req && req.fulfilled_by) || [];
    if (!storyIds.length) return { level: 'gap', storyIds: [] };
    var states = storyIds.map(function (sid) { return storyState(sid); });
    var allVerified = states.every(function (s) { return s === 'verified'; });
    return { level: allVerified ? 'enforced' : 'pending', storyIds: storyIds, states: states };
  }

  function enforcementBadge(info) {
    if (info.level === 'gap') return '<span class="cc-badge gap">No story implements this yet</span>';
    if (info.level === 'enforced') return '<span class="cc-badge verified">Enforced — all covering stories verified</span>';
    return '<span class="cc-badge in_progress">Not yet enforced — a promise, not yet kept</span>';
  }

  function guardrailsMain() {
    var html = tabHeaderHTML('Guardrails', 'What must never happen — and whether anything enforces it yet.');
    html += sampleBannerHTML();
    var guardrails = (state.plan && state.plan.derived && state.plan.derived.guardrails) || [];
    if (!guardrails.length) { html += emptyState('No guardrails defined', 'plan.derived.guardrails is empty — your plan currently has no SAFE requirement.'); return html; }
    html += '<div class="cc-grid cols-2">';
    guardrails.forEach(function (g) {
      var info = guardrailEnforcement(g.id);
      html += '<a href="#/guardrails/' + esc(g.id) + '" class="cc-card clickable" style="display:block;text-decoration:none;color:inherit;">' +
        '<div class="cc-stat-label">' + esc(g.id) + '</div>' +
        '<div style="font-size:0.95rem;font-weight:600;margin:4px 0 8px;">' + esc(g.statement) + '</div>' +
        enforcementBadge(info) +
        '</a>';
    });
    html += '</div>';
    return html;
  }

  function guardrailDetail(reqId) {
    var html = crumbTo('#/guardrails', 'Guardrails');
    var guardrails = (state.plan && state.plan.derived && state.plan.derived.guardrails) || [];
    var g = guardrails.filter(function (x) { return x.id === reqId; })[0];
    html += tabHeaderHTML(g ? g.id : 'Not found', g ? g.statement : '');
    html += sampleBannerHTML();
    if (!g) { html += emptyState('No such guardrail', ''); return html; }
    var info = guardrailEnforcement(g.id);
    html += '<div class="cc-card" style="margin-bottom:14px;">' + enforcementBadge(info) + '</div>';
    if (!info.storyIds.length) { html += emptyState('This is a real gap', 'No story in plan.json has this requirement in its fulfilled_by list yet.'); return html; }
    html += '<table class="cc-table"><thead><tr><th>Story</th><th>Title</th><th>State</th></tr></thead><tbody>';
    info.storyIds.forEach(function (sid) {
      var s = planStoryById(sid);
      html += '<tr><td>' + esc(sid) + '</td><td>' + esc(s ? s.title : '—') + '</td><td>' + storyStateBadge(storyState(sid)) + '</td></tr>';
    });
    html += '</tbody></table>';
    return html;
  }

  /* ============================================================
     5. Systems tab
     ============================================================ */
  function renderSystemsTab(rest) {
    var sub = rest[0];
    if (sub) return systemDetail(sub);
    return systemsMain();
  }

  function systemStatus(name) {
    if (state.dataMode === 'sample') {
      var s = SAMPLE_SYSTEMS[name];
      if (!s) return { dotClass: 'unknown', label: 'not checked from here', lastChecked: 'never' };
      var labelMap = { connected: 'connected', error: 'error', not_connected: 'not connected' };
      var dotMap = { connected: 'connected', error: 'error', not_connected: 'unknown' };
      return { dotClass: dotMap[s.status], label: labelMap[s.status], lastChecked: s.lastChecked };
    }
    return { dotClass: 'unknown', label: 'not checked from here', lastChecked: 'never' };
  }

  function systemsMain() {
    var html = tabHeaderHTML('Systems', 'What this connects to.');
    html += sampleBannerHTML();
    var systems = (state.plan && state.plan.derived && state.plan.derived.systems) || [];
    if (!systems.length) { html += emptyState('No systems listed', 'plan.derived.systems is empty.'); return html; }
    html += '<table class="cc-table"><thead><tr><th>System</th><th>Status</th><th>Last checked</th></tr></thead><tbody>';
    systems.forEach(function (name) {
      var info = systemStatus(name);
      html += '<tr class="clickable" onclick="location.hash=\'#/systems/' + slugify(name) + '\'">' +
        '<td>' + esc(name) + '</td>' +
        '<td><span class="cc-dot ' + info.dotClass + '"></span>' + esc(info.label) + '</td>' +
        '<td>' + esc(info.lastChecked) + '</td></tr>';
    });
    html += '</tbody></table>';
    return html;
  }

  function systemDetail(slug) {
    var html = crumbTo('#/systems', 'Systems');
    var systems = (state.plan && state.plan.derived && state.plan.derived.systems) || [];
    var name = systems.filter(function (n) { return slugify(n) === slug; })[0];
    html += tabHeaderHTML(name || 'Not found', '');
    html += sampleBannerHTML();
    if (!name) { html += emptyState('No such system', ''); return html; }
    var info = systemStatus(name);
    html += '<div class="cc-card"><p style="margin:0 0 8px;"><span class="cc-dot ' + info.dotClass + '"></span><strong>' + esc(info.label) + '</strong></p>' +
      '<p style="margin:0;color:var(--text-muted);font-size:0.86rem;">Last checked: ' + esc(info.lastChecked) + '.' +
      (state.dataMode === 'sample' ? ' Illustrative only.' : ' Nothing in this repo can tell whether ' + esc(name) + ' is actually connected — that is a fact about the running system, checked from there, not from this static page.') +
      '</p></div>';
    return html;
  }

  /* ============================================================
     6. Project Management tab
     ============================================================ */
  function renderPmTab(rest) {
    var sub = rest[0];
    if (sub) return pmStoryDetail(sub);
    return pmMain();
  }

  function pmMain() {
    var plan = state.plan || {};
    var html = tabHeaderHTML('Project Management', 'Releases and every task with its due date.');
    html += sampleBannerHTML();
    var releases = plan.releases || [];
    var sched = plan.schedule || {};
    if (!releases.length) { html += emptyState('No releases defined', 'plan.releases is empty.'); return html; }

    var spanStart = sched.build_start ? new Date(sched.build_start) : new Date(releases[0].starts_on);
    var spanEnd = sched.build_end ? new Date(sched.build_end) : new Date(releases[releases.length - 1].ends_on);
    var totalMs = spanEnd.getTime() - spanStart.getTime() || 1;

    html += '<div class="cc-card cc-gantt">';
    releases.forEach(function (r) {
      var left = Math.max(0, (new Date(r.starts_on).getTime() - spanStart.getTime()) / totalMs * 100);
      var width = Math.max(1, (new Date(r.ends_on).getTime() - new Date(r.starts_on).getTime()) / totalMs * 100);
      html += '<div class="cc-gantt-row"><div class="cc-gantt-label">' + esc(r.key) + ' — ' + esc(r.name) + (r.is_demo_target ? ' <span class="cc-badge must">demo target</span>' : '') + '</div>' +
        '<div class="cc-gantt-track"><div class="cc-gantt-bar' + (r.is_demo_target ? ' demo' : '') + '" style="left:' + left.toFixed(2) + '%;width:' + width.toFixed(2) + '%;"></div></div></div>';
    });
    html += '</div>';

    if (sched.demo_day) {
      html += '<p style="color:var(--text-muted);font-size:0.85rem;margin:10px 0 0;">Demo day: <strong>' + esc(formatAbs(sched.demo_day)) + '</strong>. Releases after ' + esc(sched.demo_release_key || '') + ' are the roadmap, not this term’s work.</p>';
    }

    html += '<div class="cc-section-title">Every task</div>';
    html += '<table class="cc-table"><thead><tr><th>ID</th><th>Title</th><th>Release</th><th>Due (current)</th><th>Due (baseline)</th><th>State</th></tr></thead><tbody>';
    (plan.stories || []).forEach(function (s) {
      var slip = s.due_on !== s.due_baseline_on;
      html += '<tr class="clickable" onclick="location.hash=\'#/pm/' + s.id + '\'"><td>' + esc(s.id) + '</td><td>' + esc(s.title) + '</td><td>' + esc(s.release) + '</td>' +
        '<td>' + esc(formatAbs(s.due_on)) + (slip ? ' <span class="cc-badge in_progress">slipped</span>' : '') + '</td>' +
        '<td>' + esc(formatAbs(s.due_baseline_on)) + '</td>' +
        '<td>' + storyStateBadge(storyState(s.id)) + '</td></tr>';
    });
    html += '</tbody></table>';
    return html;
  }

  function pmStoryDetail(id) {
    var html = crumbTo('#/pm', 'Project Management');
    var s = planStoryById(id);
    html += tabHeaderHTML(s ? (s.id + ' — ' + s.title) : 'Not found', '');
    html += sampleBannerHTML();
    if (!s) { html += emptyState('No such story', 'That story id is not in plan.json.'); return html; }
    html += '<div class="cc-card">';
    html += '<p style="margin:0 0 8px;">' + esc(s.narrative) + '</p>';
    html += '<p style="margin:0 0 8px;color:var(--text-muted);font-size:0.86rem;">Release <strong>' + esc(s.release) + '</strong> · Owner <strong>' + esc(s.owner || '—') + '</strong> · Due <strong>' + esc(formatAbs(s.due_on)) + '</strong> (baseline ' + esc(formatAbs(s.due_baseline_on)) + ') · ' + storyStateBadge(storyState(s.id)) + '</p>';
    if (s.acceptance_criteria && s.acceptance_criteria.length) {
      html += '<div class="cc-section-title" style="margin-top:14px;">Acceptance criteria</div><ul style="margin:0;padding-left:18px;font-size:0.86rem;">';
      s.acceptance_criteria.forEach(function (c) { html += '<li style="margin-bottom:4px;">' + esc(c) + '</li>'; });
      html += '</ul>';
    }
    html += '</div>';
    return html;
  }

  /* ============================================================
     7. AI Agents tab
     ============================================================ */
  function renderAgentsTab(rest) {
    var sub = rest[0];
    if (sub) return agentDetail(sub);
    return agentsMain();
  }

  function storyOwners() {
    var owners = [];
    ((state.plan && state.plan.stories) || []).forEach(function (s) {
      if (s.owner && owners.indexOf(s.owner) === -1) owners.push(s.owner);
    });
    return owners;
  }

  function agentsMain() {
    var html = tabHeaderHTML('AI Agents', 'Who owns each story today — and, once agents exist, their run history.');
    html += sampleBannerHTML();
    var agents = (state.plan && state.plan.agents) || [];
    var stories = (state.plan && state.plan.stories) || [];
    if (agents.length) {
      html += '<div class="cc-grid cols-3">';
      agents.forEach(function (a) {
        html += statCard('#/agents/' + slugify(a.name), a.name, String((a.owns || []).length), 'stories owned');
      });
      html += '</div>';
      return html;
    }
    html += '<div class="cc-banner"><strong>No scoped agent roster yet.</strong> plan.agents is empty. Below are the owners recorded per story — job titles, not AI agents.</div>';
    var owners = storyOwners();
    html += '<div class="cc-grid cols-3">';
    owners.forEach(function (owner) {
      var count = stories.filter(function (s) { return s.owner === owner; }).length;
      var run = state.dataMode === 'sample' ? SAMPLE_AGENT_RUNS[owner] : null;
      html += '<a href="#/agents/' + slugify(owner) + '" class="cc-card clickable" style="display:block;text-decoration:none;color:inherit;">' +
        '<div class="cc-stat-label">Owner</div><div class="cc-stat-value" style="font-size:1.3rem;">' + esc(owner) + '</div>' +
        '<div class="cc-stat-sub">' + count + ' ' + (count === 1 ? 'story' : 'stories') + '</div>' +
        '<div style="margin-top:10px;font-size:0.8rem;color:var(--text-muted);">Skills: no skills registered yet</div>' +
        '<div style="margin-top:4px;font-size:0.8rem;color:var(--text-muted);">' + (run && run.runs ? run.runs + ' runs recorded (sample), ' + run.successRate + ' success, last run ' + run.lastRun : 'No runs recorded') + '</div>' +
        '</a>';
    });
    html += '</div>';
    return html;
  }

  function agentDetail(slug) {
    var html = crumbTo('#/agents', 'AI Agents');
    var owners = storyOwners();
    var owner = owners.filter(function (o) { return slugify(o) === slug; })[0];
    html += tabHeaderHTML(owner || 'Not found', owner ? 'Owner, not a scoped AI agent.' : '');
    html += sampleBannerHTML();
    if (!owner) { html += emptyState('No such owner', ''); return html; }
    var owned = ((state.plan && state.plan.stories) || []).filter(function (s) { return s.owner === owner; });
    html += '<table class="cc-table"><thead><tr><th>ID</th><th>Title</th><th>Release</th><th>State</th></tr></thead><tbody>';
    owned.forEach(function (s) {
      html += '<tr><td>' + esc(s.id) + '</td><td>' + esc(s.title) + '</td><td>' + esc(s.release) + '</td><td>' + storyStateBadge(storyState(s.id)) + '</td></tr>';
    });
    html += '</tbody></table>';
    return html;
  }

  /* ============================================================
     8. Knowledge Base tab (+ offline Ask panel)
     ============================================================ */
  function renderKbTab(rest) {
    var sub = rest[0];
    if (sub) return requirementDetail(sub);
    return kbMain();
  }

  function kbMain() {
    var html = tabHeaderHTML('Knowledge Base', 'Requirements, stories, and traceability between them.');
    html += sampleBannerHTML();
    var reqs = (state.plan && state.plan.requirements) || [];
    if (!reqs.length) {
      html += emptyState('No requirements recorded', 'plan.requirements is empty.');
    } else {
      html += '<table class="cc-table"><thead><tr><th>ID</th><th>Statement</th><th>Kind</th><th>Priority</th><th>Covered by</th></tr></thead><tbody>';
      reqs.forEach(function (r) {
        var covered = r.fulfilled_by || [];
        var coverageHTML = covered.length
          ? covered.map(function (sid) { return esc(sid) + ' ' + storyStateBadge(storyState(sid)); }).join('<br>')
          : '<span class="cc-badge gap">gap — no story yet</span>';
        html += '<tr class="clickable" onclick="location.hash=\'#/kb/' + r.id + '\'"><td>' + esc(r.id) + '</td><td>' + esc(r.statement) + '</td><td>' + esc(r.kind) + '</td><td><span class="cc-badge must">' + esc(r.priority) + '</span></td><td>' + coverageHTML + '</td></tr>';
      });
      html += '</tbody></table>';
    }

    html += '<div class="cc-section-title">Decisions &amp; notes</div>';
    html += emptyState('None recorded yet', 'This grows over the programme as decisions get made — nothing invented here.');

    html += '<div class="cc-section-title">Ask the knowledge base</div>';
    html += '<div class="cc-card cc-chat">' +
      '<div class="cc-chat-log" id="cc-chat-log"></div>' +
      '<form class="cc-chat-form" id="cc-chat-form"><input id="cc-chat-input" type="text" placeholder="e.g. what covers REQ-013?" autocomplete="off"><button type="submit">Ask</button></form>' +
      '<p style="margin:6px 0 0;font-size:0.76rem;color:var(--text-faint);">Answers offline from the data on this page — no external API, nothing sent anywhere.</p>' +
      '</div>';
    return html;
  }

  function requirementDetail(id) {
    var html = crumbTo('#/kb', 'Knowledge Base');
    var reqs = (state.plan && state.plan.requirements) || [];
    var r = reqs.filter(function (x) { return x.id === id; })[0];
    html += tabHeaderHTML(r ? r.id : 'Not found', r ? r.statement : '');
    html += sampleBannerHTML();
    if (!r) { html += emptyState('No such requirement', ''); return html; }
    html += '<div class="cc-card" style="margin-bottom:14px;"><span class="cc-badge must">' + esc(r.priority) + '</span> <span style="color:var(--text-muted);font-size:0.82rem;">' + esc(r.kind) + ' · ' + esc(r.cluster || '—') + '</span></div>';
    var covered = r.fulfilled_by || [];
    if (!covered.length) { html += emptyState('Real gap', 'No story in plan.json lists this requirement in its fulfilled_by array yet.'); return html; }
    html += '<table class="cc-table"><thead><tr><th>Story</th><th>Title</th><th>State</th></tr></thead><tbody>';
    covered.forEach(function (sid) {
      var s = planStoryById(sid);
      html += '<tr><td>' + esc(sid) + '</td><td>' + esc(s ? s.title : '—') + '</td><td>' + storyStateBadge(storyState(sid)) + '</td></tr>';
    });
    html += '</tbody></table>';
    return html;
  }

  function buildSearchIndex() {
    var idx = [];
    var plan = state.plan || {};
    (plan.requirements || []).forEach(function (r) {
      idx.push({ text: r.id + ' ' + r.statement + ' ' + r.kind + ' ' + r.priority + ' ' + (r.cluster || ''), summary: r.id + ' — ' + r.statement, cite: 'Knowledge Base (' + r.id + ')' });
    });
    (plan.stories || []).forEach(function (s) {
      idx.push({ text: s.id + ' ' + s.title + ' ' + (s.narrative || '') + ' ' + s.release, summary: s.id + ' — ' + s.title, cite: 'Project Management (' + s.id + ')' });
    });
    ((plan.derived && plan.derived.guardrails) || []).forEach(function (g) {
      idx.push({ text: g.id + ' guardrail ' + g.statement, summary: g.id + ' — ' + g.statement, cite: 'Guardrails (' + g.id + ')' });
    });
    ((plan.derived && plan.derived.systems) || []).forEach(function (name) {
      idx.push({ text: 'system ' + name + ' connects to', summary: name + ' — not checked from here yet', cite: 'Systems' });
    });
    (plan.releases || []).forEach(function (r) {
      idx.push({ text: r.key + ' release ' + r.name, summary: r.key + ' — ' + r.name + ' (' + formatAbs(r.starts_on) + ' to ' + formatAbs(r.ends_on) + ')', cite: 'Project Management' });
    });
    return idx;
  }

  function tokenize(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean);
  }

  function answerQuestion(query) {
    var idx = buildSearchIndex();
    var qTokens = tokenize(query);
    if (!qTokens.length) return null;
    var best = null, bestScore = 0;
    idx.forEach(function (entry) {
      var eTokens = tokenize(entry.text);
      var score = 0;
      qTokens.forEach(function (t) {
        if (t.length < 2) return;
        if (eTokens.indexOf(t) !== -1) score += 2;
        else if (entry.text.toLowerCase().indexOf(t) !== -1) score += 1;
      });
      if (score > bestScore) { bestScore = score; best = entry; }
    });
    if (!best || bestScore < 2) return null;
    return best;
  }

  function appendChat(log, who, text, cite) {
    var div = document.createElement('div');
    div.className = 'cc-chat-msg ' + who;
    div.textContent = text;
    if (cite) {
      var citeEl = document.createElement('span');
      citeEl.className = 'cc-cite';
      citeEl.textContent = 'from: ' + cite;
      div.appendChild(citeEl);
    }
    log.appendChild(div);
  }

  function wireChat() {
    var form = document.getElementById('cc-chat-form');
    var input = document.getElementById('cc-chat-input');
    var log = document.getElementById('cc-chat-log');
    if (!form) return;
    form.onsubmit = function (ev) {
      ev.preventDefault();
      var q = input.value.trim();
      if (!q) return;
      appendChat(log, 'user', q, null);
      var hit = answerQuestion(q);
      if (hit) {
        appendChat(log, 'bot', hit.summary, hit.cite);
      } else {
        appendChat(log, 'bot', "I can't answer that from the current data. Try asking about a requirement, story, guardrail, system, or release by name.", null);
      }
      input.value = '';
      log.scrollTop = log.scrollHeight;
    };
  }

  /* ============================================================
     9. Data Model tab
     ============================================================ */
  var DATA_MODEL_ENTITIES = [
    { name: 'Meeting', reqIds: ['REQ-001', 'REQ-002', 'REQ-004', 'REQ-008'], fields: ['id', 'title', 'meeting_type', 'source', 'format', 'platform_or_location', 'scheduled_at', 'objective'] },
    { name: 'AudioRecording', reqIds: ['REQ-001', 'REQ-002'], fields: ['id', 'meeting_id', 'source_type (virtual | physical)', 'file_ref', 'ingested_at', 'checksum'], note: 'checksum + ingested_at back STORY-018’s idempotency/audit-trail requirement.' },
    { name: 'TranscriptSegment', reqIds: ['REQ-003', 'REQ-005', 'REQ-007'], fields: ['id', 'recording_id', 'start_ts', 'end_ts', 'speaker_id', 'text', 'confidence_flag (normal | low | inaudible | unclear)'] },
    { name: 'Speaker', reqIds: ['REQ-006'], fields: ['id', 'meeting_id', 'label', 'mapped_attendee_id'] },
    { name: 'Attendee', reqIds: ['REQ-006', 'REQ-008', 'REQ-014'], fields: ['id', 'meeting_id', 'name', 'email'] },
    { name: 'DiscussionTopic', reqIds: ['REQ-009'], fields: ['id', 'meeting_id', 'topic', 'summary', 'segment_refs'] },
    { name: 'Decision', reqIds: ['REQ-010'], fields: ['id', 'meeting_id', 'description', 'rationale', 'approver_id', 'segment_ref'] },
    { name: 'ActionItem', reqIds: ['REQ-011', 'REQ-012', 'REQ-016', 'REQ-017'], fields: ['id', 'meeting_id', 'description', 'owner_id', 'due_date', 'priority', 'status', 'source_segment_ref', 'carried_over_from_id'] },
    { name: 'ReviewGate', reqIds: ['REQ-013', 'REQ-015'], fields: ['id', 'meeting_id', 'gate_number (1 | 2)', 'status', 'approved_by', 'approved_at'] },
    { name: 'EmailDraft', reqIds: ['REQ-014'], fields: ['id', 'meeting_id', 'attendee_id', 'subject', 'body', 'gate_id', 'sent_at'] },
    { name: 'TrackerExport', reqIds: ['REQ-018', 'REQ-019'], fields: ['id', 'meeting_id', 'target_system', 'payload_json', 'exported_at'] }
  ];

  function renderDataModelTab(rest) {
    var sub = rest[0];
    if (sub) return dataModelDetail(sub);
    return dataModelMain();
  }

  function dataModelMain() {
    var html = tabHeaderHTML('Data Model', 'The tables behind all of the above — a starting point derived from the requirements, not a final schema.');
    html += sampleBannerHTML();
    if (state.dataMode === 'sample') {
      html += '<p style="color:var(--text-muted);font-size:0.82rem;margin:-6px 0 14px;">This design is the same in Sample and Real — it is a proposal, not produced data.</p>';
    }
    html += '<div class="cc-grid cols-3">';
    DATA_MODEL_ENTITIES.forEach(function (e) {
      html += '<a href="#/datamodel/' + slugify(e.name) + '" class="cc-entity" style="display:block;text-decoration:none;color:inherit;">' +
        '<h4>' + esc(e.name) + '</h4>' +
        '<ul>' + e.fields.slice(0, 4).map(function (f) { return '<li><code>' + esc(f.split(' ')[0]) + '</code></li>'; }).join('') + (e.fields.length > 4 ? '<li>+ ' + (e.fields.length - 4) + ' more…</li>' : '') + '</ul>' +
        '</a>';
    });
    html += '</div>';
    return html;
  }

  function dataModelDetail(slug) {
    var html = crumbTo('#/datamodel', 'Data Model');
    var e = DATA_MODEL_ENTITIES.filter(function (x) { return slugify(x.name) === slug; })[0];
    html += tabHeaderHTML(e ? e.name : 'Not found', '');
    html += sampleBannerHTML();
    if (!e) { html += emptyState('No such entity', ''); return html; }
    html += '<div class="cc-entity"><h4 style="margin-top:0;">Fields</h4><ul>' + e.fields.map(function (f) { return '<li><code>' + esc(f) + '</code></li>'; }).join('') + '</ul>';
    if (e.note) html += '<p style="font-size:0.84rem;color:var(--text-muted);">' + esc(e.note) + '</p>';
    html += '<p style="margin:10px 0 0;font-size:0.82rem;">Derived from: ' + e.reqIds.map(function (id) { return '<a href="#/kb/' + id + '">' + esc(id) + '</a>'; }).join(', ') + '</p></div>';
    return html;
  }

  /* ============================================================
     Boot
     ============================================================ */
  window.addEventListener('hashchange', render);
  loadData().then(render);
})();
