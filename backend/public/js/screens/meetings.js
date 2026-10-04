// Screen — Meetings dashboard: summary cards, meetings table, friendly empty state.
(function () {
  var ui = MA.ui, el = ui.el, append = ui.append;

  function isThisWeek(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return false;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    var now = new Date(), start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
    return d >= start && d <= now;
  }

  function stat(iconName, label, value) {
    return append(el('div', null, 'card stat'), append(el('div', null, 'stat-label'), MA.icon(iconName), label), el('div', String(value), 'stat-value'));
  }
  /** "Meetings this week" doubles as the button that opens the week calendar. */
  function weekStat(value, open, onToggle) {
    var b = append(el('button', null, 'card stat stat-button', { type: 'button', id: 'weekCard', 'aria-expanded': String(open), 'aria-controls': 'weekCalendar' }),
      append(el('div', null, 'stat-label'), MA.icon('calendar'), 'Meetings this week'), el('div', String(value), 'stat-value'),
      MA.icon('chevron-down', 'stat-chevron'), el('span', open ? 'Hide this week’s calendar' : 'Show this week’s calendar', 'sr-only'));
    b.addEventListener('click', onToggle);
    return b;
  }

  var RECORD_OPTIONS = [
    { mode: 'in_person', label: 'In-person meeting', hint: 'Use this device’s microphone', icon: 'users' },
    { mode: 'browser_capture', label: 'Online meeting on this computer', hint: 'Zoom, Teams, or Meet in a browser tab', icon: 'monitor' },
  ];

  /**
   * Header: "View calendar" and "Record meeting" (secondary) + "Upload meeting" (primary). Below 640px the
   * secondary buttons collapse into one "More" menu so the header never wraps awkwardly.
   */
  function headerActions(s, a) {
    var open = s.calendar.open;
    var recordItems = RECORD_OPTIONS.map(function (o) { return { label: o.label, hint: o.hint, icon: o.icon, run: function () { a.recordMeeting(o.mode); } }; });
    var calendarButton = ui.button(open ? 'Hide calendar' : 'View calendar', 'secondary', function () { a.calToggle(); }, { icon: 'calendar', id: 'viewCalendar' });
    calendarButton.className += ' wide-only';
    calendarButton.setAttribute('aria-expanded', String(open));
    calendarButton.setAttribute('aria-controls', 'weekCalendar');
    var record = MA.menu.button('Record meeting', 'secondary', recordItems, { icon: 'mic', id: 'recordMeeting', className: 'wide-only' });
    var more = MA.menu.button(null, 'secondary', function () {
      return [{ label: store().calendar.open ? 'Hide calendar' : 'View calendar', icon: 'calendar', run: function () { a.calToggle(); } }].concat(recordItems);
    }, { icon: 'more-horizontal', id: 'moreActions', ariaLabel: 'More actions', className: 'narrow-only btn-icon-touch' });
    return [calendarButton, record, more, ui.button('Upload meeting', 'primary', function () { a.go('upload'); }, { icon: 'upload', id: 'primaryAction' })];
  }
  function store() { return MA.store.get(); }

  /** Platform label + icon for a meeting link (Zoom/Teams/Meet); nothing for in-person or unknown. */
  var PLATFORM = { zoom: 'Zoom', teams: 'Microsoft Teams', meet: 'Google Meet' };
  function platformBadge(platform) {
    if (!PLATFORM[platform]) return null;
    return append(el('span', null, 'platform-tag', { title: PLATFORM[platform] }), MA.icon('monitor'), el('span', PLATFORM[platform], 'platform-name'));
  }

  function copyLink(runId) {
    var url = new URL(window.location.href);
    url.search = '?run=' + encodeURIComponent(runId);
    var done = function () { ui.toast('Link copied'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url.toString()).then(done, function () { ui.toast('Couldn’t copy the link. Copy it from the address bar after opening the meeting.', 'error'); });
    else ui.toast('Copying isn’t supported in this browser. Open the meeting and copy the address bar.', 'error');
  }

  /**
   * Phone layout (below 640px): one card per meeting — title, date, status, avatar stack, platform.
   * Tapping the card opens the meeting; the ⋯ menu holds the secondary actions.
   */
  function meetingCards(meetings, ctx) {
    var list = el('ul', null, 'meeting-cards narrow-only-block', { 'aria-label': 'Meetings' });
    meetings.forEach(function (m) {
      var li = el('li', null, 'meeting-card' + (m.runId ? ' is-link' : ''));
      var titleNode = m.runId ? el('a', m.title || 'Untitled meeting', 'meeting-card-title', { href: '?run=' + encodeURIComponent(m.runId) }) : el('span', m.title || 'New meeting', 'meeting-card-title');
      if (m.runId) titleNode.addEventListener('click', function (e) { e.preventDefault(); ctx.actions.openMeeting(m.runId); });
      var top = append(el('div', null, 'meeting-card-top'), titleNode,
        m.runId ? MA.menu.button(null, 'ghost', [
          { label: m.status === 'needs_review' ? 'Review minutes' : 'Open meeting', icon: 'file-text', run: function () { ctx.actions.openMeeting(m.runId); } },
          { label: 'Copy link', icon: 'send', run: function () { copyLink(m.runId); } },
        ], { icon: 'more-horizontal', ariaLabel: 'More actions for ' + (m.title || 'this meeting'), className: 'btn-icon-touch meeting-card-menu' }) : null);
      var meta = append(el('div', null, 'meeting-card-meta'), el('span', ui.longDate(m.date) || 'Date not set', 'muted'), ui.badge(MA.statusOf(m.stage)));
      var foot = append(el('div', null, 'meeting-card-foot'), ui.avatarStack(m.people && m.people.length ? m.people : m.participants), platformBadge(m.platform));
      append(li, top, meta, foot);
      // The whole card is the tap target; the link inside stays the keyboard/screen-reader target.
      if (m.runId) li.addEventListener('click', function (e) { if (!e.target.closest('button, a')) ctx.actions.openMeeting(m.runId); });
      list.appendChild(li);
    });
    return list;
  }

  MA.screens.meetings = {
    title: 'Meetings',
    render: function (root, ctx) {
      var s = ctx.state;
      root.appendChild(ui.pageHeader('Meetings', {
        meta: el('p', 'Review AI-drafted minutes and approve them before anything goes out.', 'meta'),
        actions: headerActions(s, ctx.actions),
      }));

      var now = MA.cal.nowBanner(s, ctx.actions);
      if (now) root.appendChild(now);
      (s.recovered || []).forEach(function (r) {
        var when = new Date(r.startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        var box = ui.callout('warning', 'triangle-alert', 'Unfinished recording' + (r.title ? ' — ' + r.title : '') + '.',
          append(el('span'), 'Started ' + when + ', ' + ui.clock(r.durationMs || 0) + ' recorded and saved on this device. ',
            append(el('span', null, 'recovered-actions'),
              ui.button('Upload and process', 'primary', function () { ctx.actions.finishRecording(r.id); }, { size: 'sm', icon: 'upload' }),
              ui.button('Discard', 'ghost', function () { if (window.confirm('Discard this recording? It can’t be recovered.')) ctx.actions.discardRecording(r.id); }, { size: 'sm' }))));
        box.classList.add('recovered');
        root.appendChild(append(el('div', null, null, { style: 'margin-bottom:16px' }), box));
      });
      if (!s.meetings) {
        root.appendChild(append(el('div', null, 'card card-pad'), el('span', null, 'skeleton skeleton-line', { style: 'width:40%' }), el('span', null, 'skeleton skeleton-line', { style: 'width:70%' }), el('span', null, 'skeleton skeleton-line', { style: 'width:55%' })));
        return;
      }
      var meetings = s.meetings.slice();
      if (s.upload.id && !s.upload.error) {
        meetings.unshift({ runId: null, title: s.form.title || (s.form.file && s.form.file.name) || 'New meeting', participants: [], status: 'processing', stage: 'processing' });
      }
      var openItems = (s.actionItems || []).filter(function (a) { return a.status !== 'Done'; }).length;
      var weekCount = s.weekSummary ? s.weekSummary.count : s.meetings.filter(function (m) { return isThisWeek(m.date); }).length;
      root.appendChild(append(el('div', null, 'stats'),
        weekStat(weekCount, s.calendar.open, function () { ctx.actions.calToggle(); }),
        stat('clock', 'Pending reviews', s.meetings.filter(function (m) { return m.status === 'needs_review'; }).length),
        stat('list-checks', 'Open action items', openItems)));
      if (s.calendar.open) MA.cal.panel.render(root, ctx);

      var card = el('section', null, 'card', { 'aria-labelledby': 'meetingsHeading' });
      card.appendChild(append(el('div', null, 'card-head'), append(el('h2', null, 'section-title', { id: 'meetingsHeading' }), 'All meetings', el('span', String(s.meetings.length), 'count'))));
      if (!meetings.length) {
        card.appendChild(ui.emptyState('inbox', 'No meetings yet', 'Upload a recording and Meeting Assistant will transcribe it and draft the minutes for you to review.',
          ui.button('Upload meeting', 'secondary', function () { ctx.actions.go('upload'); }, { icon: 'upload' })));
        root.appendChild(card);
        return;
      }
      var q = s.query.trim().toLowerCase();
      var shown = meetings.filter(function (m) {
        var who = (m.people || []).map(function (p) { var r = MA.people.resolve(p); return r.name + ' ' + (r.email || ''); }).join(' ') + ' ' + (m.participants || []).join(' ');
        return !q || (m.title || '').toLowerCase().indexOf(q) !== -1 || who.toLowerCase().indexOf(q) !== -1;
      });
      if (!shown.length) {
        card.appendChild(ui.emptyState('search', 'No matching meetings', 'Nothing matches “' + s.query + '”. Try a different title or participant name.',
          ui.button('Clear search', 'secondary', function () { ctx.actions.search(''); })));
        root.appendChild(card);
        return;
      }
      var table = el('table', null, 'table meetings-table');
      var head = el('tr');
      [['Date', ''], ['Title', ''], ['Participants', 'col-participants'], ['Status', ''], ['', 'col-chevron']].forEach(function (h) { head.appendChild(el('th', h[0], h[1] || null, { scope: 'col' })); });
      append(table, append(el('thead'), head));
      var body = el('tbody');
      shown.forEach(function (m) {
        var tr = el('tr', null, m.runId ? 'row-link' : '');
        var titleCell = el('td');
        if (m.runId) {
          var a = el('a', m.title || 'Untitled meeting', null, { href: '?run=' + encodeURIComponent(m.runId) });
          a.addEventListener('click', function (e) { e.preventDefault(); ctx.actions.openMeeting(m.runId); });
          titleCell.appendChild(a);
          tr.addEventListener('click', function (e) { if (e.target === tr || e.target.tagName === 'TD') ctx.actions.openMeeting(m.runId); });
        } else {
          titleCell.appendChild(el('span', m.title));
        }
        append(tr, el('td', ui.longDate(m.date) || '—', 'muted'), titleCell,
          append(el('td', null, 'participants col-participants'), ui.avatarStack(m.people && m.people.length ? m.people : m.participants)),
          append(el('td'), ui.badge(MA.statusOf(m.stage))), append(el('td', null, 'subtle col-chevron'), m.runId ? MA.icon('chevron-right') : null));
        body.appendChild(tr);
      });
      table.appendChild(body);
      card.appendChild(append(el('div', null, 'table-wrap wide-only-block'), table));
      card.appendChild(meetingCards(shown, ctx));
      root.appendChild(card);
    },
  };
})();
