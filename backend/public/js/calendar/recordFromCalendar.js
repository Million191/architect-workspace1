// Calendar — "Start recording" on scheduled meetings, from 5 minutes before the start until the end.
// The recording is linked to that meeting, so its title and participants carry over.
(function () {
  var ui = MA.ui, el = ui.el, append = ui.append;
  var EARLY_MS = 5 * 60 * 1000;

  /** zoom / teams / meet / none, from the meeting link. */
  function platformOf(link) {
    var l = String(link || '').toLowerCase();
    if (l.indexOf('zoom.us/') !== -1 || l.indexOf('zoom.com/') !== -1) return 'zoom';
    if (l.indexOf('teams.microsoft.com') !== -1 || l.indexOf('teams.live.com') !== -1) return 'teams';
    if (l.indexOf('meet.google.com') !== -1) return 'meet';
    return 'none';
  }
  var PLATFORM_NAME = { zoom: 'Zoom', teams: 'Teams', meet: 'Google Meet' };

  /** Scheduled, not cancelled/postponed, no recording yet, and now is within [start − 5 min, end]. */
  function recordable(m, now) {
    if (!m || !m.start || !m.end || m.runId || m.display !== 'upcoming') return false;
    var t = (now || new Date()).getTime();
    return t >= Date.parse(m.start) - EARLY_MS && t <= Date.parse(m.end);
  }

  function scheduledFrom(m) { return { id: m.id, title: m.title, participants: m.participants || [] }; }

  /** Online meetings default to capturing the meeting tab; in person is the other option. */
  function startButton(m, actions, opts) {
    var platform = platformOf(m.link), online = platform !== 'none' || !!m.link;
    var items = [
      { label: online ? 'Online meeting on this computer' : 'In-person meeting', hint: online ? (PLATFORM_NAME[platform] ? PLATFORM_NAME[platform] + ' in a browser tab' : 'Meeting in a browser tab') : 'Use this device’s microphone', icon: online ? 'monitor' : 'users',
        run: function () { MA.cal.dialog.close(); actions.recordMeeting(online ? 'browser_capture' : 'in_person', { scheduled: scheduledFrom(m) }); } },
      { label: online ? 'In-person meeting' : 'Online meeting on this computer', hint: online ? 'Use this device’s microphone' : 'Meeting in a browser tab', icon: online ? 'users' : 'monitor',
        run: function () { MA.cal.dialog.close(); actions.recordMeeting(online ? 'in_person' : 'browser_capture', { scheduled: scheduledFrom(m) }); } },
    ];
    return MA.menu.button('Start recording', (opts && opts.variant) || 'primary', items, { icon: 'mic', id: opts && opts.id, size: opts && opts.size });
  }

  MA.cal.attachRecording = function (actions, store, api) {
    // Adds "Start recording" to the meeting details popover, keeping any actions defined elsewhere.
    var previous = actions.calDetailActions;
    actions.calDetailActions = function (m) {
      var list = previous ? previous(m) : [];
      return recordable(m) ? list.concat([startButton(m, actions, { id: 'calStartRecording' })]) : list;
    };

    /** Meetings happening now (or starting within 5 minutes), for the banner on the Meetings page. */
    function refreshNow() {
      var now = new Date();
      return api.schedule.week(new Date(now.getTime() - 24 * 3600 * 1000).toISOString(), new Date(now.getTime() + 24 * 3600 * 1000).toISOString()).then(function (data) {
        var list = data.meetings.filter(function (m) { return recordable(m, now); });
        var before = JSON.stringify((store.get().nowMeetings || []).map(function (m) { return m.id; }));
        store.quiet({ nowMeetings: list });
        if (before !== JSON.stringify(list.map(function (m) { return m.id; })) && store.get().page === 'meetings') store.set({});
      }).catch(function () { /* the banner is a convenience */ });
    }
    actions.calRefreshNow = refreshNow;
    refreshNow();
    setInterval(refreshNow, 60 * 1000);
  };

  /** "Happening now" banner on the Meetings page. */
  MA.cal.nowBanner = function (s, actions) {
    var list = s.nowMeetings || [];
    if (!list.length || (s.rec && s.rec.phase !== 'setup')) return null;
    var box = el('section', null, 'card now-banner', { 'aria-label': 'Meetings happening now' });
    list.forEach(function (m) {
      var start = new Date(m.start), soon = start.getTime() > Date.now();
      var when = (soon ? 'Starts at ' : 'Now · ') + MA.cal.model.fmtTime(start) + ' – ' + MA.cal.model.fmtTime(new Date(m.end));
      var platform = platformOf(m.link);
      box.appendChild(append(el('div', null, 'now-row'),
        append(el('div', null, 'now-text'), el('strong', m.title), el('span', when + (PLATFORM_NAME[platform] ? ' · ' + PLATFORM_NAME[platform] : ''), 'muted')),
        ui.avatarStack(m.participants || []),
        startButton(m, actions, { variant: 'primary', size: 'sm' }),
        actions.notetakerControl ? actions.notetakerControl(m, { compact: true }) : null));
    });
    return box;
  };

  MA.cal.recordable = recordable;
  MA.cal.platformOf = platformOf;
})();
