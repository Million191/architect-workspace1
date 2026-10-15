// Dashboard — summary cards: Meetings (with a This week / This month / All time selector), Pending
// reviews ("Review now" or "All caught up ✓"), Open action items. Each card filters the table or
// navigates; second lines only appear when real data supports them.
(function () {
  var ui = MA.ui, el = ui.el, append = ui.append;
  var RANGES = { week: { label: 'This week', prev: 'last week' }, month: { label: 'This month', prev: 'last month' }, all: { label: 'All time' } };

  function pad(n) { return String(n).padStart(2, '0'); }
  function dayKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  MA.dashboard = MA.dashboard || {};
  MA.dashboard.attachStats = function (actions, store, api) {
    function dash() { return store.get().dash; }
    /**
     * The card counts the same list the table shows (MA.dashboard.sel), so nothing needs loading.
     * Kept as an action because schedule changes call it; it only redraws.
     */
    actions.dashLoadRange = function () { if (store.get().page === 'meetings') store.set({}); return Promise.resolve(); };
    actions.dashSetRange = function (range) { store.set({ dash: Object.assign({}, dash(), { range: range }) }); };
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

  function daysAgo(date) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
    if (!m) return null;
    var d = Math.floor((Date.now() - new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()) / 86400000);
    return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d + ' days ago';
  }

  /** ctx: { state, actions }; meetings: exactly the list the table draws from (including any in-progress upload). */
  MA.dashboard.renderStats = function (root, ctx, meetings) {
    var s = ctx.state, a = ctx.actions, d = s.dash;
    meetings = meetings || s.meetings || [];
    var range = RANGES[d.range];
    var rangeMenu = MA.menu.button(range.label, 'ghost', ['week', 'month', 'all'].map(function (r) {
      return { label: RANGES[r].label, icon: r === d.range ? 'check' : null, run: function () { a.dashSetRange(r); } };
    }), { size: 'sm', id: 'rangeSelect', ariaLabel: 'Meetings period: ' + range.label + '. Change period', className: 'stat-range' });
    var counts = MA.dashboard.sel.rangeCounts(meetings, d.range);

    var pending = meetings.filter(function (m) { return MA.REVIEW_STATUSES.indexOf(m.status) !== -1; }); // waiting for a person
    var oldest = pending.map(MA.dashboard.sel.localDay).filter(Boolean).sort()[0];
    var reviewNow = pending.length ? ui.button('Review now', 'primary', function () { a.openMeeting(pending[0].runId, 'review'); }, { size: 'sm', iconAfter: 'arrow-right', id: 'reviewNow' }) : null;
    if (reviewNow) reviewNow.classList.add('stat-action');

    root.appendChild(append(el('div', null, 'stats'),
      card({ id: 'meetingsCard', icon: 'calendar', label: 'Meetings', actionHint: '— show these meetings in the table', extra: rangeMenu,
        value: String(counts.count), onClick: function () { a.dashFilterRange(true); } }),
      card({ id: 'pendingCard', icon: 'clock', label: 'Pending reviews', actionHint: '— show meetings that need review', attention: pending.length > 0,
        value: pending.length ? String(pending.length) : append(el('span', null, 'stat-done'), MA.icon('circle-check'), 'All caught up'),
        secondary: pending.length && oldest ? 'Oldest from ' + daysAgo(oldest) : null, action: reviewNow,
        onClick: function () { a.dashSetTab('needs_review'); MA.dashboard.scrollToTable(); } })));
    // (No action-items card: action items aren't shown on the dashboard — user request 2026-10-09.)
  };

  MA.dashboard.RANGES = RANGES;
  MA.dashboard.scrollToTable = function () { var t = document.getElementById('meetingsHeading'); if (t && t.scrollIntoView) t.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
})();
