// Screen — Meetings dashboard: header actions, summary cards, the week calendar, the meetings list
// (tabs + table), and recent activity. The pieces live in js/dashboard/.
(function () {
  var ui = MA.ui, el = ui.el, append = ui.append;

  var RECORD_OPTIONS = [
    { mode: 'in_person', label: 'Record in person', hint: 'Use this device’s microphone', icon: 'mic' },
    { mode: 'browser_capture', label: 'Record an online meeting', hint: 'Zoom, Teams, or Meet in a browser tab', icon: 'monitor' },
  ];
  function store() { return MA.store.get(); }

  /**
   * Header: "View calendar" (ghost) and one primary "New meeting" split button — the main part uploads a
   * file, the ▾ part offers Upload file / Record. Below 640px the calendar moves into a "More" menu.
   */
  function headerActions(s, a) {
    var open = s.calendar.open;
    var recordItems = RECORD_OPTIONS.map(function (o) { return { label: o.label, hint: o.hint, icon: o.icon, run: function () { a.recordMeeting(o.mode); } }; });
    var calendarButton = ui.button(open ? 'Hide calendar' : 'View calendar', 'ghost', function () { a.calToggle(); }, { icon: 'calendar', id: 'viewCalendar' });
    calendarButton.className += ' wide-only';
    calendarButton.setAttribute('aria-expanded', String(open));
    calendarButton.setAttribute('aria-controls', 'weekCalendar');
    var more = MA.menu.button(null, 'secondary', function () {
      return [{ label: store().calendar.open ? 'Hide calendar' : 'View calendar', icon: 'calendar', run: function () { a.calToggle(); } }];
    }, { icon: 'more-horizontal', id: 'moreActions', ariaLabel: 'More actions', className: 'narrow-only btn-icon-touch' });
    var main = ui.button('New meeting', 'primary', function () { a.go('upload'); }, { icon: 'plus', id: 'primaryAction' });
    main.setAttribute('aria-label', 'New meeting: upload a recording');
    var caret = MA.menu.button(null, 'primary', [{ label: 'Upload file', hint: 'Audio or video of a meeting', icon: 'upload', id: 'newUpload', run: function () { a.go('upload'); } }].concat(recordItems),
      { icon: 'chevron-down', id: 'newMeetingMenu', ariaLabel: 'More ways to add a meeting', className: 'split-caret' });
    return [calendarButton, more, append(el('div', null, 'split-button', { role: 'group', 'aria-label': 'New meeting' }), main, caret)];
  }

  function recoveredBanners(root, s, a) {
    (s.recovered || []).forEach(function (r) {
      var when = new Date(r.startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      var box = ui.callout('warning', 'triangle-alert', 'Unfinished recording' + (r.title ? ' — ' + r.title : '') + '.',
        append(el('span'), 'Started ' + when + ', ' + ui.clock(r.durationMs || 0) + ' recorded and saved on this device. ',
          append(el('span', null, 'recovered-actions'),
            ui.button('Upload and process', 'primary', function () { a.finishRecording(r.id); }, { size: 'sm', icon: 'upload' }),
            ui.button('Discard', 'ghost', function () { if (window.confirm('Discard this recording? It can’t be recovered.')) a.discardRecording(r.id); }, { size: 'sm' }))));
      box.classList.add('recovered');
      root.appendChild(append(el('div', null, null, { style: 'margin-bottom:16px' }), box));
    });
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
      recoveredBanners(root, s, ctx.actions);
      if (!s.meetings) {
        root.appendChild(append(el('div', null, 'card card-pad'), el('span', null, 'skeleton skeleton-line', { style: 'width:40%' }), el('span', null, 'skeleton skeleton-line', { style: 'width:70%' }), el('span', null, 'skeleton skeleton-line', { style: 'width:55%' })));
        return;
      }
      var meetings = s.meetings.slice();
      if (s.upload.id && !s.upload.error) {
        meetings.unshift({ runId: null, title: s.upload.title || s.form.title || (s.form.file && s.form.file.name) || 'New meeting', participants: [], status: 'processing', stage: 'processing' });
      }
      MA.dashboard.renderStats(root, ctx);
      if (s.calendar.open) MA.cal.panel.render(root, ctx);
      MA.dashboard.renderTable(root, ctx, meetings);
      MA.dashboard.renderActivity(root, ctx);
    },
  };
})();
