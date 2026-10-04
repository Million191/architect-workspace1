// Calendar — date helpers and layout maths (pure functions; no DOM). Times are shown in the browser's zone.
(function () {
  var DAY = 24 * 3600 * 1000;

  function startOfWeek(d) {
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var dow = (x.getDay() + 6) % 7; // Monday = 0
    x.setDate(x.getDate() - dow);
    return x;
  }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function dayKey(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function minutesIntoDay(d) { return d.getHours() * 60 + d.getMinutes(); }

  var fmtTime = function (d) { return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };
  var fmtDay = function (d) { return d.toLocaleDateString(undefined, { weekday: 'short' }); };
  var fmtDayLong = function (d) { return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }); };

  /** "Oct 5 – 9, 2026" or "Sep 29 – Oct 3, 2026". */
  function rangeLabel(first, last) {
    var m1 = first.toLocaleDateString(undefined, { month: 'short' }), m2 = last.toLocaleDateString(undefined, { month: 'short' });
    return m1 + ' ' + first.getDate() + ' – ' + (m1 === m2 ? '' : m2 + ' ') + last.getDate() + ', ' + last.getFullYear();
  }
  function weekTitle(weekStart, today) {
    var diff = Math.round((weekStart - startOfWeek(today)) / (7 * DAY));
    return diff === 0 ? 'This week' : diff === 1 ? 'Next week' : diff === -1 ? 'Last week' : 'Week of ' + weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  /** Mon–Fri, plus Sat/Sun only when something falls on them this week. */
  function visibleDays(weekStart, meetings) {
    var days = [0, 1, 2, 3, 4].map(function (i) { return addDays(weekStart, i); });
    [5, 6].forEach(function (i) {
      var d = addDays(weekStart, i);
      if (meetings.some(function (m) { return m.start && sameDay(new Date(m.start), d); })) days.push(d);
    });
    return days;
  }

  /** Hour range shown: 9 AM–5 PM, widened to fit any meeting in view. */
  function hourRange(meetings) {
    var from = 9, to = 17;
    meetings.forEach(function (m) {
      if (!m.start || !m.end) return;
      var s = new Date(m.start), e = new Date(m.end);
      from = Math.min(from, s.getHours());
      to = Math.max(to, e.getHours() + (e.getMinutes() > 0 ? 1 : 0), sameDay(s, e) ? 0 : 24);
    });
    return { from: from, to: Math.min(24, to) };
  }

  /** Side-by-side layout for overlapping meetings in one day: each gets {col, cols}. */
  function layoutDay(items) {
    var sorted = items.slice().sort(function (a, b) { return a.s - b.s || b.e - a.e; });
    var clusters = [], current = null, clusterEnd = -1;
    sorted.forEach(function (it) {
      if (!current || it.s >= clusterEnd) { current = []; clusters.push(current); clusterEnd = it.e; }
      current.push(it);
      clusterEnd = Math.max(clusterEnd, it.e);
    });
    clusters.forEach(function (cluster) {
      var colEnds = [];
      cluster.forEach(function (it) {
        var col = colEnds.findIndex(function (end) { return end <= it.s; });
        if (col === -1) { col = colEnds.length; colEnds.push(it.e); } else colEnds[col] = it.e;
        it.col = col;
      });
      cluster.forEach(function (it) { it.cols = colEnds.length; });
    });
    return sorted;
  }

  /** Next free half-hour today (from now), avoiding existing meetings; falls back to now rounded up. */
  function nextFreeSlot(meetings, now) {
    var t = new Date(now);
    t.setSeconds(0, 0);
    t.setMinutes(t.getMinutes() < 30 ? 30 : 60);
    for (var i = 0; i < 48; i++) {
      var s = t.getTime(), e = s + 30 * 60000;
      var busy = meetings.some(function (m) { return m.start && m.end && m.display !== 'cancelled' && Date.parse(m.start) < e && Date.parse(m.end) > s; });
      if (!busy) return { start: new Date(s), end: new Date(e) };
      t = new Date(e);
    }
    return { start: new Date(now), end: new Date(now.getTime() + 30 * 60000) };
  }

  MA.cal = MA.cal || {};
  MA.cal.model = {
    DAY: DAY, startOfWeek: startOfWeek, addDays: addDays, sameDay: sameDay, dayKey: dayKey, minutesIntoDay: minutesIntoDay,
    fmtTime: fmtTime, fmtDay: fmtDay, fmtDayLong: fmtDayLong, rangeLabel: rangeLabel, weekTitle: weekTitle,
    visibleDays: visibleDays, hourRange: hourRange, layoutDay: layoutDay, nextFreeSlot: nextFreeSlot,
  };
})();
