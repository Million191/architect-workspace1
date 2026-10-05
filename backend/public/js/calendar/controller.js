// Calendar — controller: open/close, loading a week, navigation, view/toggle changes, opening meetings.
// Adds its actions onto the app's `actions` object; later steps (add/edit/postpone/…) add more here.
(function () {
  var M = MA.cal.model;

  MA.cal.attach = function (actions, store, api) {
    function cal() { return store.get().calendar; }
    // Start on the current week; a panel left open earlier this session reopens with it.
    store.quiet({ calendar: Object.assign({}, store.get().calendar, { weekStart: M.startOfWeek(new Date()).toISOString() }) });
    function setCal(patch) { store.set({ calendar: Object.assign({}, cal(), patch) }); }
    function weekBounds(weekStartIso) {
      var start = new Date(weekStartIso);
      return { from: start.toISOString(), to: M.addDays(start, 7).toISOString() };
    }
    function remember(open) { try { window.sessionStorage.setItem('ma.calendarOpen', open ? '1' : '0'); } catch (e) { /* convenience only */ } }

    /** Loads a week; stale responses (from a week the user already left) are ignored. */
    function loadWeek(weekStartIso) {
      var b = weekBounds(weekStartIso);
      setCal({ loading: true, error: null });
      return api.schedule.week(b.from, b.to).then(function (data) {
        data.weekStart = weekStartIso;
        if (cal().weekStart === weekStartIso) setCal({ data: data, loading: false });
        else store.set({});
      }).catch(function (err) {
        if (cal().weekStart === weekStartIso) setCal({ loading: false, error: err.message });
      });
    }

    /** After the schedule changes: refresh the dashboard's Meetings count, and the open panel's week (without a loading flash). */
    actions.calLoadSummary = function () {
      if (actions.dashLoadRange) actions.dashLoadRange();
      if (!cal().open || !cal().weekStart) return Promise.resolve();
      var weekStart = cal().weekStart, b = weekBounds(weekStart);
      return api.schedule.week(b.from, b.to).then(function (data) {
        data.weekStart = weekStart;
        if (cal().open && cal().weekStart === weekStart) store.quiet({ calendar: Object.assign({}, cal(), { data: data, loading: false }) });
        if (store.get().page === 'meetings') store.set({});
      }).catch(function () { /* the panel keeps what it shows */ });
    };
    actions.calReload = function () { return loadWeek(cal().weekStart); };

    actions.calToggle = function () { if (cal().open) actions.calClose(); else actions.calOpen(); };
    actions.calOpen = function () {
      var weekStart = cal().weekStart || M.startOfWeek(new Date()).toISOString();
      remember(true);
      var needsLoad = !cal().data || cal().data.weekStart !== weekStart;
      setCal({ open: true, closing: false, weekStart: weekStart });
      if (needsLoad) loadWeek(weekStart);
    };
    actions.calClose = function () {
      if (!cal().open) return;
      remember(false);
      MA.cal.weekView.hideTip();
      // Focus goes back to whichever control closed it ("View calendar" or "More"); otherwise "View calendar".
      var active = document.activeElement, returnId = active && ['viewCalendar', 'moreActions'].indexOf(active.id) !== -1 ? active.id : 'viewCalendar';
      setCal({ closing: true });
      setTimeout(function () {
        setCal({ open: false, closing: false });
        var back = document.getElementById(returnId), more = document.getElementById('moreActions');
        if (back) back.focus();
        if (more && document.activeElement !== back) more.focus(); // "View calendar" is hidden on phones
      }, 200);
    };
    actions.calWeek = function (delta) {
      var next = delta === 0 ? M.startOfWeek(new Date()) : M.addDays(new Date(cal().weekStart), 7 * delta);
      var iso = next.toISOString();
      setCal({ weekStart: iso });
      if (!cal().data || cal().data.weekStart !== iso) loadWeek(iso);
    };
    actions.calSetView = function (view) { setCal({ view: view }); };
    actions.calSetToggle = function (name, value) { var p = {}; p[name] = value; setCal(p); };

    /** Needs review → straight to review; approved/sent → the approved meeting; scheduled → details. */
    actions.calOpenMeeting = function (m, anchor) {
      if (m.runId && ['needs_review', 'emails_drafted', 'approved', 'sent'].indexOf(m.display) !== -1) { actions.openMeeting(m.runId); return; }
      MA.cal.details.open({ meeting: m, anchor: anchor, actions: actions.calDetailActions ? actions.calDetailActions(m) : [], extra: actions.calDetailExtra ? actions.calDetailExtra(m) : null });
    };

    // Esc closes the panel when no dialog or menu is open.
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || !cal().open || store.get().page !== 'meetings') return;
      if (MA.cal.dialog.isOpen() || MA.menu.isOpen()) return;
      e.preventDefault();
      actions.calClose();
    });
    // Week ↔ list when crossing the narrow breakpoint.
    if (window.matchMedia) {
      var mq = window.matchMedia('(max-width: 720px)');
      var onChange = function () { if (cal().open && store.get().page === 'meetings') store.set({}); };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
    }
  };
})();
