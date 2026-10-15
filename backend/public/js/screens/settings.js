// Screen — Settings: appearance, your name, and which services are connected (read-only).
(function () {
  var ui = MA.ui, el = ui.el, append = ui.append, store = MA.store;

  function section(title, description, body) {
    return append(el('section', null, 'card'), append(el('div', null, 'card-head'), append(el('div'), el('h2', title), el('p', description, 'help'))), append(el('div', null, 'card-body'), body));
  }

  var RETENTION = [
    ['after_approval', 'Delete after the minutes are reviewed'],
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
    return append(el('div'), box, el('p', 'Minutes and transcripts are never deleted by this setting. Recordings are visible only to people who use this app on your server.', 'help'), status);
  }

  /** Meeting notetaker (Recall.ai): whether it's set up, and automatic sending to synced meetings. */
  function notetaker(ctx) {
    var nt = ctx.state.notetaker || {};
    var box = el('div');
    if (!nt.loaded) return append(box, el('p', 'Loading…', 'help'));
    if (!nt.configured) {
      return append(box, ui.callout('info', 'circle-help', 'The meeting notetaker isn’t available yet.', 'It needs administrator setup. Once it’s set up, you can send it to your Zoom, Teams and Google Meet calls from the calendar.'));
    }
    var on = !!nt.autoSend;
    var sw = el('button', null, 'switch' + (on ? ' is-on' : ''), { type: 'button', role: 'switch', 'aria-checked': on ? 'true' : 'false', id: 'notetakerAuto', 'aria-describedby': 'notetakerAutoHint' });
    sw.appendChild(el('span', null, 'switch-thumb', { 'aria-hidden': 'true' }));
    sw.addEventListener('click', function () { ctx.actions.notetakerSetAuto(!on); });
    return append(box,
      append(el('div', null, 'notetaker-row'), sw, el('label', 'Send the notetaker to synced meetings automatically', 'notetaker-label', { for: 'notetakerAuto' })),
      el('p', 'Meetings synced from Google Calendar or Outlook with a Zoom, Teams or Google Meet link. It joins at the start time as “Meeting Assistant Notetaker” and says in the chat that it’s recording. Turn it off for any single meeting from the calendar.', 'help', { id: 'notetakerAutoHint' }),
      el('p', 'Service: ' + (nt.provider === 'demo' ? 'simulated notetaker (demo mode)' : 'Recall.ai') + '. The API key stays on the server.', 'help'));
  }

  function integrations(ctx) {
    var card = section('Integrations', 'Bring in upcoming meetings and their participants from your calendar.', MA.cal.integrations(ctx.state, ctx.actions));
    card.querySelector('h2').id = 'integrationsHeading';
    return card;
  }

  /** The computer's own setting (what "System" follows). */
  function systemDark() { return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); }
  function themeNote(theme) {
    var now = systemDark() ? 'dark' : 'light';
    if (theme === 'light') return 'Always bright and white, whatever your computer is set to.';
    if (theme === 'dark') return 'Always dark, whatever your computer is set to.';
    return 'Follows your computer (' + now + ' right now): soft grey when it’s light, dark when it’s dark. It switches by itself.';
  }
  // When the computer switches light/dark, update the note while Settings is open.
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onChange = function () {
      var note = document.getElementById('themeNote');
      if (note) note.textContent = themeNote(MA.store.get().theme);
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
  }

  MA.screens.settings = {
    title: 'Settings',
    render: function (root, ctx) {
      var s = ctx.state;
      root.appendChild(ui.pageHeader('Settings', { meta: el('p', 'Appearance is saved in this browser. Integrations and recording settings apply to everyone using this server.', 'meta') }));

      var themes = el('div', null, 'segmented', { role: 'radiogroup', 'aria-label': 'Theme' });
      [['system', 'System', 'monitor'], ['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']].forEach(function (t) {
        var input = el('input', null, null, { type: 'radio', name: 'theme', id: 'theme-' + t[0], value: t[0] });
        input.checked = s.theme === t[0];
        input.addEventListener('change', function () { ctx.actions.setTheme(t[0]); });
        var text = t[1];
        append(themes, input, append(el('label', null, null, { for: 'theme-' + t[0] }), MA.icon(t[2]), el('span', text, null, { id: 'themeLabel-' + t[0] })));
      });
      // System follows the computer's light/dark setting, so it says which one that is right now.
      var themeHelp = el('p', themeNote(s.theme), 'help theme-note', { id: 'themeNote', 'aria-live': 'polite' });
      var themeBox = append(el('div'), themes, themeHelp);

      var st = s.status;
      var kv = el('dl', null, 'kv');
      if (st && st.providers) {
        append(kv, el('dt', 'Transcription'), el('dd', st.providers.transcription), el('dt', 'Minutes drafting'), el('dd', st.providers.analysis),
          el('dt', 'Email delivery'), append(el('dd'), ui.badge(st.emailMode === 'draft-only' ? { label: 'Off — draft only', kind: 'neutral' } : { label: 'On', kind: 'success' }), ' ', st.providers.email));
      } else {
        append(kv, el('dt', 'Status'), el('dd', st ? 'Demo data — no real services connected' : 'Loading…'));
      }

      root.appendChild(append(el('div', null, 'settings-grid'),
        section('Appearance', 'Follow your system, or pick light or dark.', themeBox),
        integrations(ctx),
        section('Meeting notetaker', 'A bot that joins Zoom, Teams and Google Meet calls, records them, and drafts minutes for your review.', notetaker(ctx)),
        section('Recording and privacy', 'Applies to meetings recorded in the app. Everyone must be told before recording starts.', retention(ctx)),
        section('Connections', 'Set on the server. Restart the server after changing them.', kv)));
    },
  };
})();
