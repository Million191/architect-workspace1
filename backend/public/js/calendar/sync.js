// Calendar sync (Google / Outlook) in the page: Settings → Integrations, "Sync calendar" in the
// calendar panel, "Synced from …" labels, and automatic sync every 15 minutes while the app is open.
// Sign-in happens on the server; the page never sees a token.
(function () {
  var ui = MA.ui, el = ui.el, append = ui.append;
  var AUTO_MS = 15 * 60 * 1000;
  var NAME = { google: 'Google Calendar', microsoft: 'Outlook' };
  var SHORT = { google: 'Google', microsoft: 'Outlook' };

  /** "just now", "5 min ago", "2 h ago", or a date. */
  function ago(iso) {
    if (!iso) return 'never';
    var s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function connections(state) {
    var st = state.calendarSync && state.calendarSync.status;
    return st ? st.providers.filter(function (p) { return p.connection; }) : [];
  }

  MA.cal.attachSync = function (actions, store, api) {
    function setSync(patch) { store.set({ calendarSync: Object.assign({}, store.get().calendarSync, patch) }); }

    actions.calSyncLoad = function () {
      return api.calendar.status().then(function (status) { store.quiet({ calendarSync: Object.assign({}, store.get().calendarSync, { status: status }) }); actions.refreshShell(); if (['settings', 'meetings'].indexOf(store.get().page) !== -1) store.set({}); return status; })
        .catch(function () { store.quiet({ calendarSync: Object.assign({}, store.get().calendarSync, { unavailable: true }) }); return null; });
    };

    /** Sync now (all connected calendars). Quiet = the 15-minute background run (no toast unless it fails). */
    actions.calSyncNow = function (quiet) {
      var cs = store.get().calendarSync || {};
      if (cs.syncing) return Promise.resolve();
      setSync({ syncing: true });
      return api.calendar.sync().then(function (res) {
        setSync({ syncing: false, status: res.status });
        var failed = Object.keys(res.results).filter(function (p) { return res.results[p].error; });
        var changed = Object.keys(res.results).reduce(function (n, p) { var r = res.results[p]; return n + (r.added || 0) + (r.updated || 0) + (r.cancelled || 0); }, 0);
        if (failed.length) ui.toast(NAME[failed[0]] + ': ' + res.results[failed[0]].error, 'error');
        else if (!quiet) ui.toast(changed ? 'Calendar synced — ' + changed + ' change' + (changed === 1 ? '' : 's') : 'Calendar is up to date');
        if (actions.calReload && store.get().calendar.open) actions.calReload();
        if (actions.calLoadSummary) actions.calLoadSummary();
        if (actions.calRefreshNow) actions.calRefreshNow();
      }).catch(function (err) { setSync({ syncing: false }); ui.toast(err.message, 'error'); });
    };

    actions.calConnect = function (provider) { window.location.href = '/api/calendar/oauth/' + provider + '/start'; };
    actions.calDisconnect = function (provider) {
      if (!window.confirm('Disconnect ' + NAME[provider] + '? Synced meetings without a recording are removed from Meeting Assistant. Your calendar isn’t changed.')) return Promise.resolve();
      return api.calendar.disconnect(provider).then(function (r) {
        ui.toast(NAME[provider] + ' disconnected' + (r.removedMeetings ? ' — removed ' + r.removedMeetings + ' synced meeting' + (r.removedMeetings === 1 ? '' : 's') : ''));
        if (actions.calReload && store.get().calendar.open) actions.calReload();
        return actions.calSyncLoad();
      }).catch(function (err) { ui.toast(err.message, 'error'); });
    };
    actions.calSaveSyncSettings = function (provider, patch) {
      return api.calendar.update(provider, patch).then(function () {
        ui.toast('Calendar settings saved');
        if (actions.calReload && store.get().calendar.open) actions.calReload();
        return actions.calSyncLoad();
      }).catch(function (err) { ui.toast(err.message, 'error'); return actions.calSyncLoad(); });
    };

    // Back from the provider's sign-in page: say what happened, then tidy the address bar.
    var params = new URL(window.location.href).searchParams;
    if (params.get('calendarConnected')) setTimeout(function () { ui.toast((NAME[params.get('calendarConnected')] || 'Calendar') + ' connected and synced'); }, 300);
    if (params.get('calendarError')) setTimeout(function () { ui.toast(params.get('calendarError'), 'error'); }, 300);

    // Load status; sync on open when the last sync is older than 15 minutes, then every 15 minutes.
    actions.calSyncLoad().then(function (status) {
      if (!status) return;
      var stale = status.providers.some(function (p) { return p.connection && (!p.connection.lastSyncedAt || Date.now() - Date.parse(p.connection.lastSyncedAt) > AUTO_MS); });
      if (stale) actions.calSyncNow(true);
    });
    setInterval(function () { if (connections(store.get()).length) actions.calSyncNow(true); }, AUTO_MS);
  };

  /** Settings → Integrations: one card per provider. */
  MA.cal.integrations = function (s, actions) {
    var cs = s.calendarSync || {}, box = el('div', null, 'integrations');
    if (cs.unavailable) { box.appendChild(el('p', 'Calendar sync isn’t available on this server.', 'help')); return box; }
    if (!cs.status) { box.appendChild(el('span', null, 'skeleton skeleton-line', { style: 'width:60%' })); return box; }
    if (!cs.status.encryption) box.appendChild(ui.callout('warning', 'triangle-alert', 'Set up needed on the server.', cs.status.encryptionProblem + ' See docs/CALENDAR_SYNC_SETUP.md.'));
    cs.status.providers.forEach(function (p) {
      var c = p.connection, card = el('div', null, 'integration', { 'aria-labelledby': 'int-' + p.provider });
      var head = append(el('div', null, 'integration-head'), append(el('div'), el('strong', p.label, null, { id: 'int-' + p.provider }),
        el('span', c ? 'Connected as ' + c.accountEmail + ' · Last synced ' + ago(c.lastSyncedAt) : p.configured ? 'Read-only access to events. Imports the next 4 weeks.' : 'Not set up on this server yet — an admin adds its client id and secret (docs/CALENDAR_SYNC_SETUP.md).', 'help')));
      if (!c) {
        head.appendChild(ui.button('Connect', 'primary', function () { actions.calConnect(p.provider); }, { icon: 'calendar', disabled: !p.configured, id: 'connect-' + p.provider }));
        card.appendChild(head);
        box.appendChild(card);
        return;
      }
      head.appendChild(append(el('div', null, 'integration-actions'),
        ui.button(cs.syncing ? 'Syncing…' : 'Sync now', 'secondary', function () { actions.calSyncNow(false); }, { icon: 'refresh-cw', size: 'sm', disabled: cs.syncing, id: 'syncNow-' + p.provider }),
        ui.button('Disconnect', 'danger', function () { actions.calDisconnect(p.provider); }, { size: 'sm', id: 'disconnect-' + p.provider })));
      card.appendChild(head);
      if (c.lastError) card.appendChild(ui.callout('danger', 'circle-alert', c.lastError.needsReconnect ? 'Reconnect needed.' : 'Last sync failed.', c.lastError.message));
      if (c.lastError && c.lastError.needsReconnect) card.appendChild(ui.button('Reconnect', 'primary', function () { actions.calConnect(p.provider); }, { size: 'sm' }));
      var cals = append(el('fieldset', null, 'integration-cals'), el('legend', 'Calendars to sync', 'label'));
      c.calendars.forEach(function (cal) {
        var id = 'cal-' + p.provider + '-' + cal.id.replace(/[^a-z0-9]/gi, '').slice(0, 40);
        var box2 = el('input', null, 'checkbox', { type: 'checkbox', id: id });
        box2.checked = c.selectedCalendarIds.indexOf(cal.id) !== -1;
        box2.addEventListener('change', function () {
          var picked = Array.prototype.slice.call(cals.querySelectorAll('input:checked')).map(function (i) { return i.getAttribute('data-id'); });
          actions.calSaveSyncSettings(p.provider, { selectedCalendarIds: picked });
        });
        box2.setAttribute('data-id', cal.id);
        cals.appendChild(append(el('label', null, 'integration-option', { for: id }), box2, cal.name + (cal.primary ? ' (main)' : '')));
      });
      var solo = el('input', null, 'checkbox', { type: 'checkbox', id: 'solo-' + p.provider });
      solo.checked = c.options.skipSolo;
      solo.addEventListener('change', function () { actions.calSaveSyncSettings(p.provider, { options: { skipSolo: solo.checked } }); });
      var filters = append(el('fieldset', null, 'integration-cals'), el('legend', 'Skip', 'label'),
        append(el('label', null, 'integration-option', { for: 'solo-' + p.provider }), solo, 'Events with no one else invited'),
        el('p', 'All-day events (holidays, out of office) are always skipped. Changes and cancellations in your calendar appear here on the next sync — every 15 minutes while the app is open.', 'help'));
      card.appendChild(append(el('div', null, 'integration-body'), cals, filters));
      box.appendChild(card);
    });
    return box;
  };

  /** Calendar panel header: "Sync calendar" (connect → Settings, or sync now) and "Last synced …". */
  MA.cal.syncControl = function (s, actions) {
    var cs = s.calendarSync || {}, list = connections(s);
    if (cs.unavailable) return null;
    if (!list.length) return ui.button('Sync calendar', 'secondary', function () { actions.go('settings'); setTimeout(function () { var t = document.getElementById('integrationsHeading'); if (t && t.scrollIntoView) t.scrollIntoView({ block: 'start' }); }, 50); }, { icon: 'refresh-cw', size: 'sm', id: 'calSync' });
    var last = list.map(function (p) { return p.connection.lastSyncedAt; }).filter(Boolean).sort().pop();
    return append(el('span', null, 'cal-sync'),
      el('span', cs.syncing ? 'Syncing…' : 'Last synced ' + ago(last), 'cal-sync-status', { role: 'status' }),
      ui.button(null, 'ghost', function () { actions.calSyncNow(false); }, { icon: 'refresh-cw', size: 'sm', id: 'calSync', ariaLabel: 'Sync calendar now', disabled: cs.syncing }));
  };

  /** Small "Google"/"Outlook" tag for synced meetings (text, so it never relies on a logo or colour). */
  MA.cal.syncedTag = function (m) {
    if (!m || !m.external) return null;
    return append(el('span', null, 'synced-tag', { title: 'Synced from ' + NAME[m.external.provider] }), MA.icon('refresh-cw'), el('span', SHORT[m.external.provider]), el('span', ' (synced from ' + NAME[m.external.provider] + ')', 'sr-only'));
  };
  MA.cal.syncAgo = ago;
})();
