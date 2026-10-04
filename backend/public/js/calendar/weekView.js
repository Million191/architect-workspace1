// Calendar — week grid: time gutter, weekday columns, positioned meeting blocks, today + now line.
(function () {
  var ui = MA.ui, el = ui.el, append = ui.append, M = MA.cal.model;

  function hourLabel(h) { var d = new Date(2000, 0, 1, h); return d.toLocaleTimeString(undefined, { hour: 'numeric' }); }

  /** "Q4 budget review, Tuesday 11:00 AM, needs review" — what a screen reader announces for a block. */
  function blockLabel(m) {
    var s = new Date(m.start);
    return m.title + ', ' + s.toLocaleDateString(undefined, { weekday: 'long' }) + ' ' + M.fmtTime(s) + ', ' + MA.displayStatus(m.display).label.toLowerCase();
  }

  function tooltip(m) {
    var lines = [M.fmtDayLong(new Date(m.start)) + ', ' + M.fmtTime(new Date(m.start)) + ' – ' + M.fmtTime(new Date(m.end))];
    (m.participants || []).forEach(function (p) { var r = MA.people.resolve(p); lines.push(r.email ? r.name + ' · ' + r.email : r.name); });
    if (m.display === 'postponed' && m.originalStart) lines.push('Originally ' + M.fmtDayLong(new Date(m.originalStart)) + ', ' + M.fmtTime(new Date(m.originalStart)));
    if (m.external) lines.push('Synced from ' + (m.external.provider === 'google' ? 'Google Calendar' : 'Outlook'));
    return { title: m.title, lines: lines.concat(MA.displayStatus(m.display).label) };
  }

  var tipNode = null;
  function showTip(target, tip) {
    hideTip();
    tipNode = append(el('div', null, 'cal-tip', { role: 'tooltip', id: 'calTip' }), el('strong', tip.title));
    tip.lines.forEach(function (l) { tipNode.appendChild(el('div', l)); });
    document.body.appendChild(tipNode);
    var r = target.getBoundingClientRect ? target.getBoundingClientRect() : { left: 0, bottom: 0 };
    tipNode.style.left = Math.min(r.left, window.innerWidth - 300) + 'px';
    tipNode.style.top = (r.bottom + 6) + 'px';
    target.setAttribute('aria-describedby', 'calTip');
  }
  function hideTip() { if (tipNode) { tipNode.remove(); tipNode = null; } }
  function withTip(node, tip) {
    node.addEventListener('mouseenter', function () { showTip(node, tip); });
    node.addEventListener('focus', function () { showTip(node, tip); });
    node.addEventListener('mouseleave', hideTip);
    node.addEventListener('blur', function () { hideTip(); node.removeAttribute('aria-describedby'); });
  }

  function render(ctx) {
    var days = ctx.days, hours = ctx.hours, hourPx = 56, span = hours.to - hours.from;
    var root = el('div', null, 'cal-grid', { role: 'grid', 'aria-label': 'Week of ' + M.rangeLabel(days[0], days[days.length - 1]) });
    root.style.gridTemplateColumns = 'var(--cal-gutter) repeat(' + days.length + ', minmax(0, 1fr))';

    // Header row
    root.appendChild(el('div', null, 'cal-dayhead', { 'aria-hidden': 'true' }));
    days.forEach(function (d) {
      var today = M.sameDay(d, ctx.today);
      root.appendChild(append(el('div', null, 'cal-dayhead' + (today ? ' is-today' : ''), { role: 'columnheader' }), M.fmtDay(d), el('span', String(d.getDate()), 'num'), today ? el('span', ' (today)', 'sr-only') : null));
    });

    // All-day row: processed recordings (no time of day)
    if (ctx.processed.length) {
      root.appendChild(el('div', 'Recorded', 'cal-allday-label'));
      days.forEach(function (d) {
        var cell = el('div', null, 'cal-allday');
        ctx.processed.filter(function (p) { return p.date === M.dayKey(d); }).forEach(function (p) {
          var chip = append(el('button', null, 'cal-chip is-' + p.display, { type: 'button', 'aria-label': (p.title || 'Untitled meeting') + ', recorded ' + M.fmtDayLong(d) + ', ' + MA.displayStatus(p.display).label.toLowerCase() }),
            (p.title || 'Untitled meeting') + ' · ' + MA.displayStatus(p.display).label);
          chip.addEventListener('click', function () { ctx.onOpenProcessed(p); });
          cell.appendChild(chip);
        });
        root.appendChild(cell);
      });
    }

    // Time gutter
    var gutter = el('div', null, 'cal-gutter', { 'aria-hidden': 'true' });
    gutter.style.height = span * hourPx + 'px';
    for (var h = hours.from; h <= hours.to; h++) {
      var label = el('span', hourLabel(h % 24), 'cal-hour-label');
      label.style.top = (h - hours.from) * hourPx + 'px';
      if (h > hours.from) gutter.appendChild(label);
    }
    root.appendChild(gutter);

    var minuteTop = function (mins) { return ((mins - hours.from * 60) / 60) * hourPx; };
    days.forEach(function (d) {
      var col = el('div', null, 'cal-col' + (M.sameDay(d, ctx.today) ? ' is-today' : ''), { role: 'gridcell', 'data-day': M.dayKey(d) });
      col.style.height = span * hourPx + 'px';
      if (ctx.renderSlots) ctx.renderSlots(col, d, hours, hourPx);

      // Faded outline where a postponed meeting used to be
      if (ctx.showChanges) {
        ctx.ghosts.filter(function (m) { return M.sameDay(new Date(m.originalStart), d); }).forEach(function (m) {
          var os = new Date(m.originalStart), oe = new Date(m.originalEnd || m.originalStart);
          var ghost = el('div', m.start ? 'Moved to ' + M.fmtDay(new Date(m.start)) + ' ' + M.fmtTime(new Date(m.start)) : 'Postponed — date TBD', 'cal-ghost');
          ghost.style.top = minuteTop(M.minutesIntoDay(os)) + 'px';
          ghost.style.height = Math.max(20, ((oe - os) / 60000 / 60) * hourPx - 2) + 'px';
          ghost.style.left = '2px'; ghost.style.right = '2px';
          col.appendChild(ghost);
        });
      }

      var items = ctx.meetings.filter(function (m) { return m.start && M.sameDay(new Date(m.start), d); }).map(function (m) {
        var s = new Date(m.start), e = new Date(m.end);
        return { m: m, s: M.minutesIntoDay(s), e: M.sameDay(s, e) ? Math.max(M.minutesIntoDay(e), M.minutesIntoDay(s) + 15) : 24 * 60 };
      });
      M.layoutDay(items).forEach(function (it) {
        var m = it.m, status = MA.displayStatus(m.display);
        var block = el('button', null, 'cal-block is-' + m.display, { type: 'button', 'aria-label': blockLabel(m), 'data-id': m.id });
        block.style.top = minuteTop(it.s) + 1 + 'px';
        block.style.height = Math.max(22, ((it.e - it.s) / 60) * hourPx - 3) + 'px';
        block.style.left = 'calc(' + (it.col / it.cols) * 100 + '% + 2px)';
        block.style.width = 'calc(' + 100 / it.cols + '% - 4px)';
        append(block, el('span', m.title, 'cal-block-title'),
          el('span', M.fmtTime(new Date(m.start)) + ' · ' + status.label, 'cal-block-meta'),
          m.display === 'postponed' ? el('span', 'Postponed', 'tag') : null,
          MA.cal.syncedTag ? MA.cal.syncedTag(m) : null,
          m.participants && m.participants.length ? ui.avatarStack(m.participants, { interactive: false }) : null,
          ctx.blockExtras ? ctx.blockExtras(m) : null);
        withTip(block, tooltip(m));
        block.addEventListener('click', function () { hideTip(); ctx.onOpen(m, block); });
        if (ctx.decorateBlock) ctx.decorateBlock(block, m, hours, hourPx);
        col.appendChild(block);
      });

      if (M.sameDay(d, ctx.now)) {
        var nowMin = M.minutesIntoDay(ctx.now);
        if (nowMin >= hours.from * 60 && nowMin <= hours.to * 60) {
          var line = el('div', null, 'cal-now', { 'aria-hidden': 'true' });
          line.style.top = minuteTop(nowMin) + 'px';
          col.appendChild(line);
        }
      }
      root.appendChild(col);
    });
    return append(el('div', null, 'cal-scroll'), root);
  }

  MA.cal.weekView = { render: render, hideTip: hideTip, blockLabel: blockLabel };
})();
