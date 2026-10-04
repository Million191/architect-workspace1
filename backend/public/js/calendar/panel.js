// Calendar — the "This week" panel under the summary cards: header, toggles, week/list body, legend, TBD list.
(function () {
  var ui = MA.ui, el = ui.el, append = ui.append, M = MA.cal.model;
  var LEGEND = ['upcoming', 'needs_review', 'approved', 'sent', 'postponed', 'cancelled'];

  function narrow() { return !!(window.matchMedia && window.matchMedia('(max-width: 720px)').matches); }

  /** Splits server data into what the views show, honouring the header toggles. */
  function viewData(cal) {
    var all = cal.data.meetings;
    return {
      timed: all.filter(function (m) { return m.start && (cal.showCancelled || m.display !== 'cancelled'); }),
      ghosts: all.filter(function (m) { return m.display === 'postponed' && m.originalStart; }),
      tbd: all.filter(function (m) { return m.display === 'postponed' && !m.start; }),
      processed: cal.data.processed.map(function (p) { return Object.assign({ display: p.status }, p); }),
    };
  }

  function toggle(id, label, checked, onChange) {
    var input = el('input', null, 'checkbox', { type: 'checkbox', id: id });
    input.checked = checked;
    input.addEventListener('change', function () { onChange(input.checked); });
    return append(el('label', null, null, { for: id }), input, label);
  }

  function header(cal, a, weekStart, days) {
    var view = narrow() ? 'list' : cal.view;
    var seg = el('div', null, 'segmented segmented-sm', { role: 'radiogroup', 'aria-label': 'Calendar view' });
    [['week', 'Week'], ['list', 'List']].forEach(function (v) {
      var input = el('input', null, null, { type: 'radio', name: 'calView', id: 'calView-' + v[0], value: v[0] });
      input.checked = view === v[0];
      input.disabled = v[0] === 'week' && narrow();
      input.addEventListener('change', function () { a.calSetView(v[0]); });
      append(seg, input, el('label', v[1], null, { for: 'calView-' + v[0], title: input.disabled ? 'Week view needs a wider screen' : '' }));
    });
    var head = el('div', null, 'cal-head');
    append(head,
      append(el('div', null, 'cal-title'), append(el('h2', null, null, { id: 'calHeading' }), MA.icon('calendar'), M.weekTitle(weekStart, new Date())), el('span', M.rangeLabel(days[0], days[days.length - 1]), 'cal-range')),
      ui.button(null, 'ghost', function () { a.calWeek(-1); }, { icon: 'arrow-left', size: 'sm', ariaLabel: 'Previous week' }),
      ui.button('Today', 'secondary', function () { a.calWeek(0); }, { size: 'sm' }),
      ui.button(null, 'ghost', function () { a.calWeek(1); }, { icon: 'arrow-right', size: 'sm', ariaLabel: 'Next week' }),
      seg,
      MA.cal.syncControl ? MA.cal.syncControl(MA.store.get(), a) : null,
      a.calNewMeeting ? ui.button('New meeting', 'primary', function () { a.calNewMeeting(); }, { icon: 'plus', size: 'sm', id: 'calNew' }) : null,
      ui.button(null, 'ghost', function () { a.calClose(); }, { icon: 'x', size: 'sm', ariaLabel: 'Close calendar' }));
    return head;
  }

  function legend() {
    var foot = el('div', null, 'cal-foot', { 'aria-label': 'Legend' });
    LEGEND.forEach(function (d) {
      var sw = el('span', null, 'legend-swatch cal-chip is-' + d, { 'aria-hidden': 'true' });
      foot.appendChild(append(el('span', null, 'legend-item'), sw, MA.displayStatus(d).label));
    });
    return foot;
  }

  function render(container, ctx) {
    var s = ctx.state, cal = s.calendar, a = ctx.actions;
    var weekStart = new Date(cal.weekStart);
    var panel = el('section', null, 'card cal-panel' + (cal.closing ? ' is-closing' : ''), { id: 'weekCalendar', 'aria-labelledby': 'calHeading' });
    var data = cal.data && cal.data.weekStart === cal.weekStart ? viewData(cal) : null;
    // Weekend columns appear when a scheduled meeting or a recording falls on them.
    var dated = data ? data.timed.concat(data.processed.map(function (p) { return { start: p.date + 'T12:00:00' }; })) : [];
    var days = M.visibleDays(weekStart, dated);
    panel.appendChild(header(cal, a, weekStart, days));
    panel.appendChild(append(el('div', null, 'cal-toggles'),
      toggle('calShowChanges', 'Show changes', cal.showChanges, function (v) { a.calSetToggle('showChanges', v); }),
      toggle('calShowCancelled', 'Show cancelled', cal.showCancelled, function (v) { a.calSetToggle('showCancelled', v); })));

    if (cal.error) {
      panel.appendChild(append(el('div', null, 'card-pad'), ui.callout('danger', 'circle-alert', 'Couldn’t load this week.', cal.error + ' ')));
    } else if (!data) {
      var sk = el('div', null, 'cal-skeleton', { 'aria-label': 'Loading this week', role: 'status' });
      sk.appendChild(el('span'));
      for (var i = 0; i < 5; i++) sk.appendChild(el('span', null, 'skeleton'));
      panel.appendChild(sk);
    } else if (!data.timed.length && !data.processed.length && !data.tbd.length && (narrow() || cal.view === 'list')) {
      panel.appendChild(ui.emptyState('calendar', 'No meetings this week', 'Schedule a meeting, or upload a recording from a meeting that already happened.',
        a.calNewMeeting ? ui.button('New meeting', 'secondary', function () { a.calNewMeeting(); }, { icon: 'plus' }) : null));
    } else {
      // Week view stays visible when empty, so empty slots can still be clicked or dragged.
      if (!data.timed.length && !data.processed.length && !data.tbd.length) {
        panel.appendChild(append(el('div', null, 'cal-empty-inline', { role: 'status' }), append(el('span'), el('strong', 'No meetings this week'), ' — click or drag on the grid to add one.'),
          a.calNewMeeting ? ui.button('New meeting', 'secondary', function () { a.calNewMeeting(); }, { icon: 'plus', size: 'sm' }) : null));
      }
      var vctx = {
        days: days, hours: M.hourRange(data.timed), meetings: data.timed, processed: data.processed, ghosts: data.ghosts,
        today: new Date(), now: new Date(), showChanges: cal.showChanges,
        onOpen: a.calOpenMeeting, onOpenProcessed: function (p) { a.openMeeting(p.runId); },
        renderSlots: a.calRenderSlots, decorateBlock: a.calDecorateBlock, blockExtras: a.calBlockExtras,
      };
      panel.appendChild(narrow() || cal.view === 'list' ? MA.cal.listView.render(vctx) : MA.cal.weekView.render(vctx));
    }
    if (data && data.tbd.length) {
      var tbd = append(el('div', null, 'cal-tbd'), el('h3', 'Postponed, date TBD', 'section-title'));
      var ul = el('ul');
      data.tbd.forEach(function (m) {
        ul.appendChild(append(el('li'), append(el('span'), el('strong', m.title), el('span', m.originalStart ? ' · was ' + M.fmtDayLong(new Date(m.originalStart)) + ', ' + M.fmtTime(new Date(m.originalStart)) : '', 'muted')),
          a.calReschedule ? ui.button('Reschedule', 'secondary', function (e) { a.calReschedule(m, e.currentTarget); }, { size: 'sm' }) : ui.button('Details', 'ghost', function (e) { a.calOpenMeeting(m, e.currentTarget); }, { size: 'sm' })));
      });
      panel.appendChild(append(tbd, ul));
    }
    panel.appendChild(legend());
    container.appendChild(panel);
  }

  MA.cal.panel = { render: render, narrow: narrow };
})();
