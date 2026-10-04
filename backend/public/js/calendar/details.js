// Calendar — meeting details popover: when, who, link, agenda, status, change history, and actions.
(function () {
  var ui = MA.ui, el = ui.el, append = ui.append, M = MA.cal.model;

  function when(m) {
    if (!m.start) return 'Date to be decided';
    var s = new Date(m.start), e = new Date(m.end);
    return M.fmtDayLong(s) + ', ' + M.fmtTime(s) + ' – ' + M.fmtTime(e);
  }
  function rangeText(r) { return r && r.start ? M.fmtDay(new Date(r.start)) + ' ' + M.fmtTime(new Date(r.start)) : 'date TBD'; }

  /** One readable history line, e.g. "Postponed from Tue 11:00 AM to Thu 1:00 PM by Million, reason: …". */
  function historyLine(h) {
    var verb = { created: 'Created', updated: 'Edited', rescheduled: 'Moved', postponed: 'Postponed', cancelled: 'Cancelled', restored: 'Restored', undone: 'Change undone', recording_linked: 'Recording added', notified: 'Notice', notify_failed: 'Notice failed' }[h.action] || h.action;
    var text = verb;
    if ((h.action === 'rescheduled' || h.action === 'postponed' || (h.action === 'updated' && h.from)) && h.from) text += ' from ' + rangeText(h.from) + ' to ' + rangeText(h.to);
    if (h.by) text += ' by ' + h.by;
    if (h.reason) text += ', reason: ' + h.reason;
    if (h.note) text += ' — ' + h.note;
    return text + ' · ' + new Date(h.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function row(icon, content) { return append(el('div', null, 'cal-detail-row'), MA.icon(icon), content); }

  /** opts: { meeting, anchor, actions: Node[] (footer buttons), extra: Node (e.g. a menu) } */
  function open(opts) {
    var m = opts.meeting;
    var body = el('div');
    append(body,
      append(el('div', null, 'cal-detail-row'), ui.badge(MA.displayStatus(m.display)), m.display === 'postponed' && m.originalStart ? el('span', 'Originally ' + when({ start: m.originalStart, end: m.originalEnd }), 'muted') : null),
      row('clock', el('span', when(m))),
      row('users', m.participants && m.participants.length ? ui.peopleList(m.participants.map(MA.people.resolve)) : el('span', 'No participants added')),
      m.link ? row('send', append(el('span'), (function () { var a = el('a', m.link, null, { href: m.link, target: '_blank', rel: 'noopener noreferrer' }); return a; })())) : null,
      m.agenda ? row('file-text', el('span', m.agenda, null, { style: 'white-space:pre-wrap' })) : null,
      m.statusReason ? row('circle-alert', el('span', 'Reason: ' + m.statusReason)) : null,
      m.external ? row('refresh-cw', el('span', 'Synced from ' + (m.external.provider === 'google' ? 'Google Calendar' : 'Outlook') + '. Change it there — updates arrive on the next sync.', 'muted')) : null,
      opts.extra || null);
    if (m.history && m.history.length) {
      var list = el('ol', null, 'cal-history', { 'aria-label': 'Change history' });
      m.history.slice().reverse().forEach(function (h) { list.appendChild(el('li', historyLine(h))); });
      body.appendChild(append(el('details', null, null, { style: 'margin-top:8px' }), el('summary', 'Change history (' + m.history.length + ')', 'help'), list));
    }
    return MA.cal.dialog.open({ title: m.title, body: body, actions: opts.actions || [], anchor: opts.anchor, variant: 'popover' });
  }

  MA.cal.details = { open: open, historyLine: historyLine, when: when };
})();
