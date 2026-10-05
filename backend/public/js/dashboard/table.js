// Dashboard — the meetings list: "Needs review / Approved / All" tabs, the table (whole row opens the
// meeting, keyboard included), inline title rename, and the phone card layout.
(function () {
  var ui = MA.ui, el = ui.el, append = ui.append;
  var TABS = [
    { id: 'needs_review', label: 'Needs review', match: function (m) { return m.status === 'needs_review'; } },
    { id: 'approved', label: 'Approved', match: function (m) { return MA.APPROVED_STATUSES.indexOf(m.status) !== -1; } },
    { id: 'all', label: 'All', match: function () { return true; } },
  ];
  /** The title being renamed survives background redraws (lists refreshing) while the user types. */
  var editing = { runId: null, draft: '', where: 'table' };

  function tabOf(id) { return TABS.filter(function (t) { return t.id === id; })[0] || TABS[2]; }

  /** "2:30 PM · 45 min" — only the parts that are known. */
  function timeLine(m) {
    var parts = [];
    var t = /^(\d{2}):(\d{2})$/.exec(m.time || '');
    if (t) parts.push(new Date(2000, 0, 1, Number(t[1]), Number(t[2])).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));
    if (typeof m.durationMs === 'number' && m.durationMs > 0) {
      var min = Math.round(m.durationMs / 60000);
      parts.push(min < 1 ? '< 1 min' : min < 60 ? min + ' min' : Math.floor(min / 60) + ' h' + (min % 60 ? ' ' + (min % 60) + ' min' : ''));
    }
    return parts.join(' · ');
  }

  /** Opening a row: a meeting → review/send; a failed recording → retry; the in-progress upload → its progress. */
  function opener(m, a) {
    if (m.runId) return function () { a.openMeeting(m.runId); };
    if (m.status === 'failed' && m.recordingId) return function () { a.retryFailedRecording(m); };
    if (m.status === 'processing') return function () { a.go('processing'); };
    return null;
  }
  function openLabel(m) {
    if (m.status === 'failed') return 'Try processing ' + (m.title || 'this recording') + ' again';
    if (m.status === 'processing') return 'Show progress for ' + (m.title || 'this meeting');
    return 'Open ' + (m.title || 'Untitled meeting');
  }

  MA.dashboard = MA.dashboard || {};
  MA.dashboard.attachTable = function (actions, store, api) {
    actions.renameMeeting = function (runId, title) {
      var clean = (title || '').trim(), m = (store.get().meetings || []).filter(function (x) { return x.runId === runId; })[0];
      if (!m) return Promise.resolve();
      if (!clean || clean === m.title) { actions.cancelRename(); return Promise.resolve(); }
      return api.renameMeeting(runId, clean, (store.get().form.reviewer || '').trim() || undefined).then(function (res) {
        editing.runId = null;
        store.set({ meetings: store.get().meetings.map(function (x) { return x.runId === runId ? Object.assign({}, x, { title: res.title }) : x; }) });
        ui.toast('Renamed to “' + res.title + '”');
        var back = document.getElementById('rename-' + runId + (editing.where === 'card' ? '-menu' : ''));
        if (back) back.focus();
      }).catch(function (err) { ui.toast(err.message, 'error'); var input = document.querySelector('.rename-input'); if (input) input.focus(); });
    };
    /** where: 'table' (pencil) or 'card' (phone ⋯ menu) — only that layout shows the field, so the hidden one never steals focus. */
    actions.startRename = function (runId, title, where) { editing.runId = runId; editing.draft = title || ''; editing.where = where === 'card' ? 'card' : 'table'; store.set({}); };
    actions.cancelRename = function () {
      var runId = editing.runId;
      editing.runId = null;
      store.set({});
      var back = runId && document.getElementById('rename-' + runId + (editing.where === 'card' ? '-menu' : ''));
      if (back) back.focus();
    };
    /** A live recording whose processing failed: run it again from the audio already on the server. */
    actions.retryFailedRecording = function (m) {
      if (store.get().busy) return Promise.resolve();
      store.set({ busy: true, page: 'processing', upload: { id: m.recordingId, recordingId: m.recordingId, title: m.title || 'Recorded meeting', sentFraction: 1, stage: null, error: null, failedStage: null, startedAt: Date.now() } });
      return api.recordings.finish(m.recordingId, { chunkCount: m.chunkCount || 1, durationMs: m.durationMs || undefined }).then(function (res) {
        store.set({ busy: false, run: res.run, page: 'review', upload: { id: null, sentFraction: 0, stage: null, error: null, failedStage: null, startedAt: null }, save: { state: 'idle' }, selectedRecipient: 0 });
        ui.toast('Draft minutes are ready for your review');
      }).catch(function (err) {
        var cur = store.get();
        store.set({ busy: false, upload: Object.assign({}, cur.upload, { error: err.message, failedStage: err.stage || cur.upload.stage }) });
      });
    };
  };

  /** Tabs with counts (ARIA tablist; ← → Home End move between them). */
  function tabs(meetings, current, a) {
    var list = el('div', null, 'dash-tabs', { role: 'tablist', 'aria-label': 'Filter meetings' });
    var buttons = TABS.map(function (t) {
      var on = t.id === current, n = meetings.filter(t.match).length;
      var b = append(el('button', null, 'dash-tab', { type: 'button', role: 'tab', id: 'tab-' + t.id, 'aria-selected': String(on), 'aria-controls': 'meetingsPanel', tabindex: on ? '0' : '-1' }),
        el('span', t.label), el('span', String(n), 'dash-tab-count'));
      b.addEventListener('click', function () { a.dashSetTab(t.id); });
      return b;
    });
    list.addEventListener('keydown', function (e) {
      var i = buttons.indexOf(document.activeElement), next = null;
      if (e.key === 'ArrowRight') next = (i + 1) % buttons.length;
      else if (e.key === 'ArrowLeft') next = (i - 1 + buttons.length) % buttons.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = buttons.length - 1;
      if (next === null) return;
      e.preventDefault();
      a.dashSetTab(TABS[next].id);
      var target = document.getElementById('tab-' + TABS[next].id);
      if (target) target.focus();
    });
    buttons.forEach(function (b) { list.appendChild(b); });
    return list;
  }

  /** Title cell: the name, a pencil (shown on row hover/focus) to rename; or the rename field. */
  function titleCell(m, a, where) {
    var cell = el('div', null, 'title-cell');
    if (m.runId && editing.runId === m.runId && editing.where === (where || 'table')) {
      var input = el('input', null, 'input input-sm rename-input', { id: 'renameInput-' + (where || 'table'), type: 'text', maxlength: '300', 'aria-label': 'Meeting title. Enter saves, Escape cancels' });
      input.value = editing.draft;
      var done = false;
      input.addEventListener('input', function () { editing.draft = input.value; });
      input.addEventListener('keydown', function (e) {
        e.stopPropagation(); // keep Enter/Space from opening the row
        if (e.key === 'Enter') { e.preventDefault(); done = true; a.renameMeeting(m.runId, input.value); }
        else if (e.key === 'Escape') { e.preventDefault(); done = true; a.cancelRename(); }
      });
      // Clicking elsewhere keeps the change, like most inline editors.
      input.addEventListener('blur', function () { if (!done && editing.runId === m.runId && input.isConnected) { done = true; a.renameMeeting(m.runId, input.value); } });
      input.addEventListener('click', function (e) { e.stopPropagation(); });
      cell.appendChild(input);
      setTimeout(function () { if (input.isConnected && document.activeElement !== input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); } }, 0);
      return cell;
    }
    append(cell, el('span', m.title || (m.runId ? 'Untitled meeting' : 'New meeting'), 'title-text'));
    if (m.status === 'failed' && m.error) cell.appendChild(el('span', m.error, 'title-error'));
    if (m.runId) {
      cell.appendChild(ui.button(null, 'ghost', function (e) { e.stopPropagation(); a.startRename(m.runId, m.title, 'table'); },
        { icon: 'pencil', size: 'sm', id: 'rename-' + m.runId, ariaLabel: 'Rename ' + (m.title || 'Untitled meeting') }));
      cell.lastChild.classList.add('rename-btn');
    }
    return cell;
  }

  /** True when the click/keypress came from a control inside the row (stack, pencil, rename field). */
  function fromControl(e, row) { var t = e.target.closest('button, a, input, [role="menu"]'); return !!t && t !== row && row.contains(t); }

  function table(shown, a) {
    var tbl = el('table', null, 'table meetings-table');
    var head = el('tr');
    [['Date', 'col-date'], ['Title', ''], ['Participants', 'col-participants'], ['Action items', 'col-items num'], ['Status', 'col-status'], [null, 'col-chevron']].forEach(function (h) {
      head.appendChild(h[0] ? el('th', h[0], h[1] || null, { scope: 'col' }) : append(el('td', null, h[1], { 'aria-hidden': 'true' })));
    });
    append(tbl, append(el('thead'), head));
    var body = el('tbody');
    shown.forEach(function (m) {
      var open = opener(m, a);
      var tr = el('tr', null, 'meeting-row' + (open ? ' row-link' : '') + (m.status === 'failed' ? ' is-failed' : ''), { 'data-run': m.runId || m.recordingId || '' });
      if (open) {
        tr.tabIndex = 0;
        tr.setAttribute('aria-label', openLabel(m));
        tr.addEventListener('click', function (e) { if (!fromControl(e, tr) && !(window.getSelection && String(window.getSelection()))) open(); });
        tr.addEventListener('keydown', function (e) {
          if (e.target !== tr || (e.key !== 'Enter' && e.key !== ' ')) return;
          e.preventDefault();
          open();
        });
      }
      var when = timeLine(m);
      append(tr,
        append(el('td', null, 'col-date'), el('span', ui.longDate(m.date) || '—', 'date-main'), when ? el('span', when, 'date-sub') : null),
        append(el('td'), titleCell(m, a)),
        append(el('td', null, 'participants col-participants'), ui.avatarStack(m.people && m.people.length ? m.people : m.participants)),
        el('td', typeof m.actionItemCount === 'number' && m.runId ? String(m.actionItemCount) : '—', 'col-items num'),
        append(el('td', null, 'col-status'), ui.badge(MA.statusOf(m.stage || m.status))),
        append(el('td', null, 'subtle col-chevron', { 'aria-hidden': 'true' }), open ? MA.icon(m.status === 'failed' ? 'refresh-cw' : 'chevron-right') : null));
      body.appendChild(tr);
    });
    tbl.appendChild(body);
    return append(el('div', null, 'table-wrap wide-only-block'), tbl);
  }

  function copyLink(runId) {
    var url = new URL(window.location.href);
    url.search = '?run=' + encodeURIComponent(runId);
    var done = function () { ui.toast('Link copied'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url.toString()).then(done, function () { ui.toast('Couldn’t copy the link. Copy it from the address bar after opening the meeting.', 'error'); });
    else ui.toast('Copying isn’t supported in this browser. Open the meeting and copy the address bar.', 'error');
  }

  var PLATFORM = { zoom: 'Zoom', teams: 'Microsoft Teams', meet: 'Google Meet' };
  function platformBadge(platform) {
    if (!PLATFORM[platform]) return null;
    return append(el('span', null, 'platform-tag', { title: PLATFORM[platform] }), MA.icon('monitor'), el('span', PLATFORM[platform], 'platform-name'));
  }

  /** Phone layout (below 640px): one card per meeting; tapping the card opens it, ⋯ holds the rest. */
  function cards(shown, a) {
    var list = el('ul', null, 'meeting-cards narrow-only-block', { 'aria-label': 'Meetings' });
    shown.forEach(function (m) {
      var open = opener(m, a);
      var li = el('li', null, 'meeting-card' + (open ? ' is-link' : ''));
      var titleNode;
      if (m.runId && editing.runId === m.runId && editing.where === 'card') titleNode = titleCell(m, a, 'card');
      else if (open) {
        titleNode = el('a', m.title || 'Untitled meeting', 'meeting-card-title', { href: m.runId ? '?run=' + encodeURIComponent(m.runId) : '#', 'aria-label': openLabel(m) });
        titleNode.addEventListener('click', function (e) { e.preventDefault(); open(); });
      } else titleNode = el('span', m.title || 'New meeting', 'meeting-card-title');
      var top = append(el('div', null, 'meeting-card-top'), titleNode,
        m.runId ? MA.menu.button(null, 'ghost', [
          { label: m.status === 'needs_review' ? 'Review minutes' : 'Open meeting', icon: 'file-text', run: function () { a.openMeeting(m.runId); } },
          { label: 'Rename', icon: 'pencil', run: function () { a.startRename(m.runId, m.title, 'card'); } },
          { label: 'Copy link', icon: 'send', run: function () { copyLink(m.runId); } },
        ], { icon: 'more-horizontal', id: 'rename-' + m.runId + '-menu', ariaLabel: 'More actions for ' + (m.title || 'this meeting'), className: 'btn-icon-touch meeting-card-menu' }) : null);
      var when = timeLine(m);
      var meta = append(el('div', null, 'meeting-card-meta'), el('span', (ui.longDate(m.date) || 'Date not set') + (when ? ' · ' + when : ''), 'muted'), ui.badge(MA.statusOf(m.stage || m.status)));
      var foot = append(el('div', null, 'meeting-card-foot'), ui.avatarStack(m.people && m.people.length ? m.people : m.participants),
        m.runId && m.actionItemCount ? el('span', m.actionItemCount + ' action item' + (m.actionItemCount === 1 ? '' : 's'), 'muted') : null, platformBadge(m.platform));
      append(li, top, meta, foot);
      if (open) li.addEventListener('click', function (e) { if (!e.target.closest('button, a, input')) open(); });
      list.appendChild(li);
    });
    return list;
  }

  function matchesQuery(m, q) {
    if (!q) return true;
    var who = (m.people || []).map(function (p) { var r = MA.people.resolve(p); return r.name + ' ' + (r.email || ''); }).join(' ') + ' ' + (m.participants || []).join(' ');
    return (m.title || '').toLowerCase().indexOf(q) !== -1 || who.toLowerCase().indexOf(q) !== -1;
  }

  /** The "Meetings" card section: heading, tabs, active filter chips, then the table/cards or an empty state. */
  MA.dashboard.renderTable = function (root, ctx, meetings) {
    var s = ctx.state, a = ctx.actions, d = s.dash;
    var card = el('section', null, 'card', { 'aria-labelledby': 'meetingsHeading' });
    card.appendChild(append(el('div', null, 'card-head dash-head'),
      append(el('h2', null, 'section-title', { id: 'meetingsHeading' }), 'Meetings', el('span', String(s.meetings.length), 'count')),
      meetings.length ? tabs(meetings, MA.dashboard.currentTab(d, meetings), a) : null));
    root.appendChild(card);
    if (!meetings.length) {
      card.appendChild(ui.emptyState('inbox', 'No meetings yet', 'Upload a recording and Meeting Assistant will transcribe it and draft the minutes for you to review.',
        ui.button('Upload meeting', 'secondary', function () { a.go('upload'); }, { icon: 'upload' })));
      return;
    }
    var b = MA.dashboard.bounds(d.range), q = s.query.trim().toLowerCase(), tab = tabOf(MA.dashboard.currentTab(d, meetings));
    var chips = el('div', null, 'filter-chips');
    if (d.rangeFilter && d.range !== 'all') {
      chips.appendChild(append(el('span', null, 'filter-chip'), el('span', MA.dashboard.RANGES[d.range].label),
        ui.button(null, 'ghost', function () { a.dashFilterRange(false); }, { icon: 'x', size: 'sm', id: 'clearRangeFilter', ariaLabel: 'Remove filter: ' + MA.dashboard.RANGES[d.range].label })));
    }
    if (q) chips.appendChild(append(el('span', null, 'filter-chip'), el('span', 'Search: “' + s.query.trim() + '”'),
      ui.button(null, 'ghost', function () { a.search('', { keepFocus: true }); }, { icon: 'x', size: 'sm', ariaLabel: 'Clear search' })));
    if (chips.childNodes.length) card.appendChild(chips);

    var shown = meetings.filter(function (m) {
      return tab.match(m) && matchesQuery(m, q) && (!d.rangeFilter || d.range === 'all' || !m.date || MA.dashboard.inRange(m.date, b));
    });
    var panel = el('div', null, 'dash-panel', { id: 'meetingsPanel', role: 'tabpanel', 'aria-labelledby': 'tab-' + tab.id });
    card.appendChild(panel);
    if (!shown.length) {
      if (tab.id === 'needs_review' && !q && !d.rangeFilter) {
        panel.appendChild(ui.emptyState('circle-check', 'All caught up', 'Nothing is waiting for your review.', ui.button('Show all meetings', 'secondary', function () { a.dashSetTab('all'); })));
      } else {
        panel.appendChild(ui.emptyState('search', 'No matching meetings', q ? 'Nothing matches “' + s.query + '”. Try a different title or participant name.' : 'No meetings match these filters.',
          ui.button('Show all meetings', 'secondary', function () { if (q) a.search('', { keepFocus: true }); if (d.rangeFilter) a.dashFilterRange(false); a.dashSetTab('all'); }, { id: 'clearFilters' })));
      }
      return;
    }
    append(panel, table(shown, a), cards(shown, a));
  };
  /** The chosen tab; until one is chosen, "Needs review" when something is waiting, else "All". */
  MA.dashboard.currentTab = function (d, meetings) { return d.tab || (meetings.some(TABS[0].match) ? 'needs_review' : 'all'); };
  MA.dashboard.TABS = TABS;
  MA.dashboard.timeLine = timeLine;
})();
