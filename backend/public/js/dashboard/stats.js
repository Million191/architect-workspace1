// Dashboard — summary cards: Meetings (with a This week / This month / All time selector), Pending
// reviews ("Review now" or "All caught up ✓"), Open action items. Each card filters the table or
// navigates; second lines only appear when real data supports them.
(function () {
  var ui = MA.ui, el = ui.el, append = ui.append;
  var RANGES = { week: { label: 'This week', prev: 'last week' }, month: { label: 'This month', prev: 'last month' }, all: { label: 'All time' } };

  function pad(n) { return String(n).padStart(2, '0'); }
  function dayKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  /** [from, to) for a range, and the period just before it (none for All time). */
  function bounds(range, now) {
    now = now || new Date();
    if (range === 'all') return { from: new Date(2000, 0, 1), to: new Date(2100, 0, 1) };
    if (range === 'month') {
      var m0 = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: m0, to: new Date(now.getFullYear(), now.getMonth() + 1, 1), prevFrom: new Date(now.getFullYear(), now.getMonth() - 1, 1) };
    }
    var w0 = MA.cal.model.startOfWeek(now);
    return { from: w0, to: MA.cal.model.addDays(w0, 7), prevFrom: MA.cal.model.addDays(w0, -7) };
  }
  /** Is a recorded meeting's date (YYYY-MM-DD) inside [from, to)? */
  function inRange(date, b) { return !!date && date >= dayKey(b.from) && date < dayKey(b.to); }

  /** Meetings in a period: scheduled (not cancelled, starting in it) + recordings dated in it — from the schedule API. */
  function countFrom(data, from, to) {
    var f = from.getTime(), t = to.getTime();
    return data.meetings.filter(function (m) { return m.display !== 'cancelled' && m.start && Date.parse(m.start) >= f && Date.parse(m.start) < t; }).length + data.processed.length;
  }

  MA.dashboard = MA.dashboard || {};
  MA.dashboard.attachStats = function (actions, store, api) {
    function dash() { return store.get().dash; }
    /** Loads the meeting count for the chosen range (and the period before, for the comparison line). */
    actions.dashLoadRange = function () {
      var range = dash().range, b = bounds(range);
      var current = api.schedule.week(b.from.toISOString(), b.to.toISOString());
      var previous = b.prevFrom ? api.schedule.week(b.prevFrom.toISOString(), b.from.toISOString()) : Promise.resolve(null);
      return Promise.all([current, previous]).then(function (r) {
        if (dash().range !== range) return; // the user picked another range meanwhile
        store.quiet({ dash: Object.assign({}, dash(), { counts: { range: range, count: countFrom(r[0], b.from, b.to), prev: r[1] ? countFrom(r[1], b.prevFrom, b.from) : null } }) });
        if (store.get().page === 'meetings') store.set({});
      }).catch(function () {
        // Without the schedule (not set up), count recordings only — still real data.
        var meetings = store.get().meetings || [];
        store.quiet({ dash: Object.assign({}, dash(), { counts: { range: range, count: meetings.filter(function (m) { return inRange(m.date, b); }).length, prev: null } }) });
        if (store.get().page === 'meetings') store.set({});
      });
    };
    actions.dashSetRange = function (range) {
      store.set({ dash: Object.assign({}, dash(), { range: range, counts: null }) });
      actions.dashLoadRange();
    };
    /** Clicking the Meetings card: show only meetings from that range in the table. */
    actions.dashFilterRange = function (on) { store.set({ dash: Object.assign({}, dash(), { rangeFilter: on, tab: on ? 'all' : dash().tab }) }); MA.dashboard.scrollToTable(); };
    actions.dashSetTab = function (tab) { store.set({ dash: Object.assign({}, dash(), { tab: tab }) }); };
  };

  /** A card whose title is a button stretched over the whole card; other controls sit above it. */
  function card(opts) {
    var c = el('section', null, 'card stat stat-card' + (opts.attention ? ' is-attention' : ''), { 'aria-labelledby': opts.id + '-label' });
    var main = append(el('button', null, 'stat-main', { type: 'button', id: opts.id, 'aria-describedby': opts.id + '-value' + (opts.secondary ? ' ' + opts.id + '-secondary' : '') }),
      append(el('span', null, 'stat-label', { id: opts.id + '-label' }), MA.icon(opts.icon), opts.label), el('span', opts.actionHint, 'sr-only'));
    main.addEventListener('click', opts.onClick);
    append(c, main, opts.extra || null,
      append(el('div', null, 'stat-value', { id: opts.id + '-value' }), opts.value),
      opts.secondary ? el('div', opts.secondary, 'stat-secondary', { id: opts.id + '-secondary' }) : null,
      opts.action || null);
    return c;
  }

  function comparison(counts) {
    if (!counts || counts.prev === null || counts.prev === undefined) return null;
    var diff = counts.count - counts.prev, prev = RANGES[counts.range].prev;
    return diff === 0 ? 'Same as ' + prev : (diff > 0 ? '+' : '−') + Math.abs(diff) + ' vs ' + prev;
  }

  function daysAgo(date) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
    if (!m) return null;
    var d = Math.floor((Date.now() - new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()) / 86400000);
    return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d + ' days ago';
  }

  /** ctx: { state, actions }; meetings: the list including any in-progress upload. */
  MA.dashboard.renderStats = function (root, ctx) {
    var s = ctx.state, a = ctx.actions, d = s.dash, meetings = s.meetings || [];
    var range = RANGES[d.range];
    var rangeMenu = MA.menu.button(range.label, 'ghost', ['week', 'month', 'all'].map(function (r) {
      return { label: RANGES[r].label, icon: r === d.range ? 'check' : null, run: function () { a.dashSetRange(r); } };
    }), { size: 'sm', id: 'rangeSelect', ariaLabel: 'Meetings period: ' + range.label + '. Change period', className: 'stat-range' });
    var count = d.counts && d.counts.range === d.range ? d.counts.count : null;

    var pending = meetings.filter(function (m) { return m.status === 'needs_review'; });
    var oldest = pending.map(function (m) { return m.date; }).filter(Boolean).sort()[0];
    var reviewNow = pending.length ? ui.button('Review now', 'primary', function () { a.openMeeting(pending[0].runId, 'review'); }, { size: 'sm', iconAfter: 'arrow-right', id: 'reviewNow' }) : null;
    if (reviewNow) reviewNow.classList.add('stat-action');

    var items = s.actionItems || [], open = items.filter(function (i) { return i.status !== 'Done'; });
    var today = dayKey(new Date());
    var overdue = open.filter(function (i) { return i.dueDate && i.dueDate < today; }).length;

    root.appendChild(append(el('div', null, 'stats'),
      card({ id: 'meetingsCard', icon: 'calendar', label: 'Meetings', actionHint: '— show these meetings in the table', extra: rangeMenu,
        value: count === null ? el('span', null, 'skeleton skeleton-line stat-skeleton', { 'aria-label': 'Loading' }) : String(count),
        secondary: comparison(d.counts && d.counts.range === d.range ? d.counts : null), onClick: function () { a.dashFilterRange(true); } }),
      card({ id: 'pendingCard', icon: 'clock', label: 'Pending reviews', actionHint: '— show meetings that need review', attention: pending.length > 0,
        value: pending.length ? String(pending.length) : append(el('span', null, 'stat-done'), MA.icon('circle-check'), 'All caught up'),
        secondary: pending.length && oldest ? 'Oldest from ' + daysAgo(oldest) : null, action: reviewNow,
        onClick: function () { a.dashSetTab('needs_review'); MA.dashboard.scrollToTable(); } }),
      card({ id: 'itemsCard', icon: 'list-checks', label: 'Open action items', actionHint: '— go to Action items',
        value: s.actionItems ? String(open.length) : el('span', null, 'skeleton skeleton-line stat-skeleton', { 'aria-label': 'Loading' }),
        secondary: s.actionItems && open.length ? (overdue ? overdue + ' overdue' : 'None overdue') : null,
        onClick: function () { a.go('action-items'); } })));
  };

  MA.dashboard.bounds = bounds;
  MA.dashboard.inRange = inRange;
  MA.dashboard.RANGES = RANGES;
  MA.dashboard.scrollToTable = function () { var t = document.getElementById('meetingsHeading'); if (t && t.scrollIntoView) t.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
})();
