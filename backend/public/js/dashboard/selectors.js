// Dashboard — the ONE place that decides which meetings fall in a period. The Meetings card, its
// "vs last week" line, the tab counts and the table rows all come from these functions, so they can
// never disagree. Periods are in the viewer's local time zone; weeks start on Monday.
(function () {
  function pad(n) { return String(n).padStart(2, '0'); }
  function dayKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  /**
   * When a meeting happened, as a real instant. The server sends `date` (YYYY-MM-DD) and `time` (HH:MM)
   * in UTC, so they are read as UTC — reading them as local time put evening meetings on the wrong day
   * (and in the wrong week) for anyone west of Greenwich. A date with no time is taken as midday UTC,
   * which is the same calendar day everywhere from UTC−11 to UTC+11. The in-progress upload uses `startedAt`.
   */
  function instant(m) {
    if (m.startedAt) { var s = new Date(m.startedAt); return isNaN(s) ? null : s; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date || '')) return null;
    var t = /^\d{2}:\d{2}$/.test(m.time || '') ? m.time : '12:00';
    var d = new Date(m.date + 'T' + t + ':00Z');
    return isNaN(d) ? null : d;
  }
  /** The meeting's calendar day in the viewer's time zone ("2026-10-05"), or '' when unknown. */
  function localDay(m) { var d = instant(m); return d ? dayKey(d) : ''; }

  function startOfWeek(d) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x; }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }

  /** [from, to) for a range in local time, plus prevFrom (the period just before; none for All time). */
  function bounds(range, now) {
    now = now || new Date();
    if (range === 'all') return { from: null, to: null };
    if (range === 'month') return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: new Date(now.getFullYear(), now.getMonth() + 1, 1), prevFrom: new Date(now.getFullYear(), now.getMonth() - 1, 1) };
    var w0 = startOfWeek(now);
    return { from: w0, to: addDays(w0, 7), prevFrom: addDays(w0, -7) };
  }

  /** Is the meeting inside [from, to)? Null bounds = no limit. Undated meetings belong to no period. */
  function within(m, from, to) {
    if (!from && !to) return true;
    var d = instant(m);
    return !!d && (!from || d >= from) && (!to || d < to);
  }
  function inPeriod(meetings, from, to) { return meetings.filter(function (m) { return within(m, from, to); }); }

  /** The Meetings card: how many meetings the table lists for this range, and for the period before. */
  function rangeCounts(meetings, range, now) {
    var b = bounds(range, now);
    return { range: range, count: inPeriod(meetings, b.from, b.to).length, prev: b.prevFrom ? inPeriod(meetings, b.prevFrom, b.from).length : null };
  }

  /**
   * What the table shows. opts: { tab (a TABS entry), query (lower case), range, rangeFilter, now, matchesQuery }.
   * The period filter applies only when the card's filter chip is on.
   */
  function base(meetings, opts) {
    var b = opts.rangeFilter && opts.range !== 'all' ? bounds(opts.range, opts.now) : { from: null, to: null };
    return meetings.filter(function (m) { return within(m, b.from, b.to) && (!opts.matchesQuery || opts.matchesQuery(m, opts.query)); });
  }
  function rows(meetings, opts) { return base(meetings, opts).filter(opts.tab.match); }
  /** Tab badges count the same filtered list the table draws from. */
  function tabCounts(meetings, opts, tabs) {
    var list = base(meetings, opts), out = {};
    tabs.forEach(function (t) { out[t.id] = list.filter(t.match).length; });
    return out;
  }

  MA.dashboard = MA.dashboard || {};
  MA.dashboard.sel = { instant: instant, localDay: localDay, bounds: bounds, within: within, inPeriod: inPeriod, rangeCounts: rangeCounts, rows: rows, tabCounts: tabCounts, dayKey: dayKey };
})();
