// Meeting Assistant — one store for the whole app. Screens read it; actions in app.js change it.
(function () {
  var listeners = [];
  function stored(key, fallback) {
    try { return window.localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
  }

  var state = {
    /** 'meetings' | 'upload' | 'processing' | 'review' | 'send' | 'action-items' | 'people' | 'settings' */
    page: 'meetings',
    /** The open meeting as returned by the server (PipelineRunView). */
    run: null,
    meetings: null,
    actionItems: null,
    status: null,
    /** People directory (null until loaded); MA.people resolves names/avatars from it. */
    people: null,
    /** Upload form — kept while moving around, and across a retry. */
    form: { file: null, title: '', attendees: '', reviewer: stored('ma.reviewer', '') },
    /** Live upload: real byte progress, then the server's reported stage. */
    upload: { id: null, sentFraction: 0, stage: null, error: null, failedStage: null, startedAt: null },
    recording: { active: false, startedAt: null, error: null },
    /** Review autosave: 'idle' | 'dirty' | 'saving' | 'saved' | 'error'. */
    save: { state: 'idle', error: null },
    query: '',
    /** Transcript moment to jump to when a meeting opens from a transcript search result. */
    focusMs: null,
    selectedRecipient: 0,
    theme: stored('ma.theme', 'system'),
    /** "This week" calendar on the dashboard; open/closed lasts for the browser session. */
    calendar: {
      open: (function () { try { return window.sessionStorage.getItem('ma.calendarOpen') === '1'; } catch (e) { return false; } })(),
      weekStart: null, view: 'week', data: null, loading: false, error: null, showChanges: true, showCancelled: true,
    },
    /** Calendar sync status ({ status, syncing, unavailable }), from /api/calendar/connections. */
    calendarSync: null,
    /** Dashboard: Meetings-card period, its counts, the chosen tab (null = automatic), and the period filter. */
    dash: { range: 'week', counts: null, tab: null, rangeFilter: false },
    /** Recent activity ({ items, total, shown }), from /api/activity. */
    activity: null,
    /** True while a request that changes something is in flight — blocks double submissions. */
    busy: false,
  };

  MA.store = {
    get: function () { return state; },
    set: function (patch) { Object.assign(state, patch); listeners.forEach(function (fn) { fn(state); }); },
    /** Updates without re-rendering — typing must never lose focus. */
    quiet: function (patch) { Object.assign(state, patch); },
    setForm: function (patch) {
      Object.assign(state.form, patch);
      if (patch.reviewer !== undefined) { try { window.localStorage.setItem('ma.reviewer', patch.reviewer); } catch (e) { /* convenience only */ } }
    },
    subscribe: function (fn) { listeners.push(fn); },
  };

  /** One status vocabulary for the whole app (dashboard, calendar, review, send). Always a text label, never colour alone. */
  // Each status has an icon and a text label, so it never relies on colour alone.
  // Meeting lifecycle: processing → needs_review → emails_drafted → approved (draft-only) | sent; or failed.
  var DISPLAY = {
    upcoming: { label: 'Upcoming', kind: 'accent', icon: 'calendar' },
    postponed: { label: 'Postponed', kind: 'accent', icon: 'calendar-clock' },
    cancelled: { label: 'Cancelled', kind: 'neutral', icon: 'ban' },
    processing: { label: 'Processing', kind: 'neutral', icon: 'refresh-cw' },
    needs_review: { label: 'Needs review', kind: 'warning', icon: 'clock' },
    emails_drafted: { label: 'Emails drafted', kind: 'accent', icon: 'mail' },
    approved: { label: 'Approved', kind: 'success', icon: 'check' },
    sent: { label: 'Sent', kind: 'success', icon: 'send' },
    failed: { label: 'Failed', kind: 'danger', icon: 'circle-alert' },
  };
  MA.displayStatus = function (display) { return DISPLAY[display] || DISPLAY.upcoming; };
  /** Status for a processed meeting, from its real server stage. */
  MA.statusOf = function (stage) {
    if (stage === 'sent') return DISPLAY.sent;
    if (stage === 'approved_not_sent' || stage === 'approved') return DISPLAY.approved;
    if (stage === 'emails_pending_approval' || stage === 'emails_drafted') return DISPLAY.emails_drafted;
    if (stage === 'processing') return DISPLAY.processing;
    if (stage === 'failed') return DISPLAY.failed;
    return DISPLAY.needs_review;
  };
  /** Dashboard tabs: which statuses count as "Approved" (minutes approved, whatever happened to the email since). */
  MA.APPROVED_STATUSES = ['emails_drafted', 'approved', 'sent'];
})();
