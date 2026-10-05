// Calendar — list view: the same week grouped by day, in the meetings-list style. Used on narrow screens.
(function () {
  var ui = MA.ui, el = ui.el, append = ui.append, M = MA.cal.model;

  function render(ctx) {
    var root = el('div', null, 'cal-list', { role: 'list', 'aria-label': 'Meetings by day' });
    ctx.days.forEach(function (d) {
      var key = M.dayKey(d);
      var timed = ctx.meetings.filter(function (m) { return m.start && M.sameDay(new Date(m.start), d); });
      var recorded = ctx.processed.filter(function (p) { return p.date === key; });
      if (!timed.length && !recorded.length) return;
      var today = M.sameDay(d, ctx.today);
      root.appendChild(el('div', M.fmtDayLong(d) + (today ? ' · Today' : ''), 'cal-list-day' + (today ? ' is-today' : ''), { role: 'presentation' }));
      timed.forEach(function (m) {
        var s = new Date(m.start), e = new Date(m.end);
        var row = append(el('button', null, 'cal-list-row is-' + m.display, { type: 'button', role: 'listitem', 'aria-label': MA.cal.weekView.blockLabel(m), 'data-id': m.id }),
          el('span', M.fmtTime(s) + ' – ' + M.fmtTime(e), 'muted'),
          append(el('span'), el('strong', m.title), MA.cal.syncedTag ? MA.cal.syncedTag(m) : null, ctx.blockExtras ? ctx.blockExtras(m) : null, m.display === 'postponed' && m.originalStart ? el('span', ' · moved from ' + M.fmtDay(new Date(m.originalStart)) + ' ' + M.fmtTime(new Date(m.originalStart)), 'muted') : null),
          append(el('span', null, 'participants'), ui.avatarStack(m.participants, { interactive: false })),
          ui.badge(MA.displayStatus(m.display)));
        row.addEventListener('click', function () { ctx.onOpen(m, row); });
        root.appendChild(row);
      });
      recorded.forEach(function (p) {
        var row = append(el('button', null, 'cal-list-row', { type: 'button', role: 'listitem' }), el('span', 'Recorded', 'muted'), el('strong', p.title || 'Untitled meeting'),
          append(el('span', null, 'participants'), ui.avatarStack(p.people && p.people.length ? p.people : p.participants, { interactive: false })), ui.badge(MA.displayStatus(p.display)));
        row.addEventListener('click', function () { ctx.onOpenProcessed(p); });
        root.appendChild(row);
      });
    });
    return root;
  }

  MA.cal.listView = { render: render };
})();
