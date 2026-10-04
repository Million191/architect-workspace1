// Screen — Settings: appearance, your name, and which services are connected (read-only).
(function () {
  var ui = MA.ui, el = ui.el, append = ui.append, store = MA.store;

  function section(title, description, body) {
    return append(el('section', null, 'card'), append(el('div', null, 'card-head'), append(el('div'), el('h2', title), el('p', description, 'help'))), append(el('div', null, 'card-body'), body));
  }

  var RETENTION = [
    ['after_approval', 'Delete after the minutes are approved'],
    ['30_days', 'Delete after 30 days'],
    ['keep', 'Keep until I delete it'],
  ];
  /** Raw-audio retention, saved on the server (it applies to everyone using this server). */
  function retention(ctx) {
    var box = append(el('fieldset', null, 'retention'), el('legend', 'Keep raw meeting audio', 'label'));
    var status = el('p', '', 'help', { role: 'status' });
    RETENTION.forEach(function (r) {
      var input = el('input', null, null, { type: 'radio', name: 'retention', id: 'retention-' + r[0], value: r[0] });
      input.addEventListener('change', function () {
        status.textContent = 'Saving…';
        MA.api.recordings.setRetention(r[0]).then(function (res) {
          status.textContent = 'Saved.' + (res.audioDeleted ? ' Deleted audio for ' + res.audioDeleted + ' meeting' + (res.audioDeleted === 1 ? '' : 's') + ' (minutes are kept).' : '');
        }).catch(function (err) { status.textContent = err.message; });
      });
      box.appendChild(append(el('label', null, 'retention-option', { for: 'retention-' + r[0] }), input, r[1]));
    });
    MA.api.recordings.retention().then(function (res) {
      var picked = box.querySelector('#retention-' + res.rawAudioRetention);
      if (picked) picked.checked = true;
    }).catch(function () { status.textContent = 'Recording isn’t set up on this server.'; });
    return append(el('div'), box, el('p', 'Minutes, transcripts, and action items are never deleted by this setting. Recordings are visible only to people who use this app on your server.', 'help'), status);
  }

  function integrations(ctx) {
    var card = section('Integrations', 'Sync meetings from Google Calendar or Outlook. Read-only: Meeting Assistant never changes your calendar.', MA.cal.integrations(ctx.state, ctx.actions));
    card.querySelector('h2').id = 'integrationsHeading';
    return card;
  }

  MA.screens.settings = {
    title: 'Settings',
    render: function (root, ctx) {
      var s = ctx.state;
      root.appendChild(ui.pageHeader('Settings', { meta: el('p', 'Appearance and your name are saved in this browser. Integrations and recording settings apply to everyone using this server.', 'meta') }));

      var themes = el('div', null, 'segmented', { role: 'radiogroup', 'aria-label': 'Theme' });
      [['system', 'System', 'monitor'], ['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']].forEach(function (t) {
        var input = el('input', null, null, { type: 'radio', name: 'theme', id: 'theme-' + t[0], value: t[0] });
        input.checked = s.theme === t[0];
        input.addEventListener('change', function () { ctx.actions.setTheme(t[0]); });
        append(themes, input, append(el('label', null, null, { for: 'theme-' + t[0] }), MA.icon(t[2]), t[1]));
      });

      var name = el('input', null, 'input', { id: 'settingsName', type: 'text', placeholder: 'e.g. Million Abate', autocomplete: 'name' });
      name.value = s.form.reviewer;
      name.addEventListener('input', function () { store.setForm({ reviewer: name.value }); ctx.actions.refreshShell(); });

      var st = s.status;
      var kv = el('dl', null, 'kv');
      if (st && st.providers) {
        append(kv, el('dt', 'Transcription'), el('dd', st.providers.transcription), el('dt', 'Minutes drafting'), el('dd', st.providers.analysis),
          el('dt', 'Email delivery'), append(el('dd'), ui.badge(st.emailMode === 'draft-only' ? { label: 'Off — draft only', kind: 'neutral' } : { label: 'On', kind: 'success' }), ' ', st.providers.email),
          el('dt', 'Action item tracker'), el('dd', st.providers.tracker));
      } else {
        append(kv, el('dt', 'Status'), el('dd', st ? 'Demo data — no real services connected' : 'Loading…'));
      }

      root.appendChild(append(el('div', null, 'settings-grid'),
        section('Appearance', 'Follow your system, or pick light or dark.', themes),
        section('Your name', 'Shown on your approvals and in the top bar.', append(el('div', null, 'field'), el('label', 'Name', 'label', { for: 'settingsName' }), name)),
        integrations(ctx),
        section('Recording and privacy', 'Applies to meetings recorded in the app. Everyone must be told before recording starts.', retention(ctx)),
        section('People', 'Names and photos shown for meeting participants.',
          ui.button('Manage people', 'secondary', function () { ctx.actions.go('people'); }, { icon: 'users', id: 'settingsPeople' })),
        section('Connections', 'Set on the server. Restart the server after changing them.', kv)));
    },
  };
})();
