// Screen — Record a meeting live: setup (consent, details, microphone check) then the recording screen
// (large timer, "Recording" indicator, level, Pause/Resume, Add marker, Stop, upload status).
(function () {
  var ui = MA.ui, el = ui.el, append = ui.append, store = MA.store;
  var MODE = {
    in_person: { title: 'Record an in-person meeting', tip: 'Place your device in the middle of the table, screen up, away from laptop fans and coffee cups.', icon: 'users' },
    browser_capture: { title: 'Record an online meeting', tip: 'When your browser asks what to share, pick the tab with your Zoom, Teams, or Google Meet call and turn on “Share tab audio”. Your microphone is recorded too.', icon: 'monitor' },
  };

  function levelMeter(id) {
    var m = el('div', null, 'rec-level', { id: id, role: 'meter', 'aria-label': 'Microphone level', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' });
    m.appendChild(el('span', null, 'rec-level-bar'));
    return m;
  }
  /** Updated in place ~10×/s — never through a full re-render. */
  function setLevel(id, v) {
    var m = document.getElementById(id);
    if (!m) return;
    m.firstChild.style.transform = 'scaleX(' + Math.max(0.02, v).toFixed(3) + ')';
    m.setAttribute('aria-valuenow', String(Math.round(v * 100)));
  }

  function field(id, label, control, help) {
    control.id = id;
    if (help) control.setAttribute('aria-describedby', id + '-help');
    return append(el('div', null, 'field'), el('label', label, 'label', { for: id }), control, help ? el('p', help, 'help', { id: id + '-help' }) : null);
  }

  function setup(root, ctx) {
    var r = ctx.state.rec, mode = MODE[r.mode], a = ctx.actions, sup = MA.recorder.support();
    root.appendChild(ui.pageHeader(mode.title, {
      back: { label: 'Meetings', onClick: function () { a.recCancel(); } },
      meta: el('p', r.scheduled ? 'For “' + r.scheduled.title + '” — the recording is attached to this calendar meeting.' : 'Audio is saved on this device as you go and uploaded every few seconds, so nothing is lost if the connection drops.', 'meta'),
    }));
    var unsupported = !sup.mic ? 'Recording isn’t supported in this browser. Use a current version of Chrome, Edge, Firefox, or Safari — or upload a recording instead.'
      : r.mode === 'browser_capture' && !sup.display ? 'This browser can’t capture another tab’s audio (this includes phones and tablets, and Safari). Use Chrome or Edge on a computer — or record in person, or upload the meeting’s recording afterwards.' : null;
    if (unsupported) {
      root.appendChild(append(el('div', null, null, { style: 'margin-bottom:16px' }), ui.callout('danger', 'circle-alert', 'Can’t record here.', unsupported)));
    }
    if (r.error) root.appendChild(append(el('div', null, null, { style: 'margin-bottom:16px' }), ui.callout('danger', 'circle-alert', 'Recording didn’t start.', r.error)));

    var title = el('input', null, 'input', { type: 'text', maxlength: '300', autocomplete: 'off', placeholder: 'e.g. Weekly team sync' });
    title.value = r.title;
    title.addEventListener('input', function () { a.recSet({ title: title.value }); });
    var people = el('input', null, 'input', { type: 'text', autocomplete: 'off', placeholder: 'Sara Lee <sara@example.com>, Tom Ward <tom@example.com>' });
    people.value = r.attendees;
    people.addEventListener('input', function () { a.recSet({ attendees: people.value }); });

    var mic = el('select', null, 'input');
    (r.devices.length ? r.devices : [{ id: '', label: 'Default microphone' }]).forEach(function (d) { var o = el('option', d.label, null, { value: d.id }); if (d.id === r.deviceId) o.selected = true; mic.appendChild(o); });
    mic.addEventListener('change', function () { a.recSet({ deviceId: mic.value }); a.recCheckMic(); });
    var check = ui.button(r.devices.length ? 'Check again' : 'Check microphone', 'secondary', function () { a.recCheckMic(); }, { icon: 'mic', id: 'recCheckMic', disabled: !!unsupported });

    var consent = el('input', null, 'checkbox', { type: 'checkbox', id: 'recConsent', required: 'true' });
    consent.checked = r.consent;
    var start = ui.button('Start recording', 'primary', function () { a.recStart(); }, { icon: 'mic', id: 'primaryAction', disabled: !r.consent || !!unsupported || r.starting });
    start.classList.add('rec-start');
    consent.addEventListener('change', function () { a.recSet({ consent: consent.checked }); start.disabled = !consent.checked || !!unsupported || r.starting; });

    var details = append(el('section', null, 'card card-pad', { 'aria-label': 'Meeting details' }),
      field('recTitle', 'Meeting title', title),
      field('recPeople', 'Participants', people, 'Name and email, separated by commas. They’ll get the approved minutes.'));
    var steps = null;
    if (r.mode === 'browser_capture') {
      var mac = /Mac/.test(navigator.platform || '');
      steps = append(el('section', null, 'card card-pad rec-steps', { 'aria-label': 'How to record an online meeting' }), el('h2', 'How it works', 'section-title'),
        append(el('ol'),
          el('li', 'Join your Zoom, Teams, or Google Meet call in a browser tab (use the web version, not the desktop app).'),
          el('li', 'Press Start recording. Your browser asks what to share.'),
          el('li', 'Choose the “Chrome tab” (or “Tab”) option, pick the meeting tab, and turn on “Share tab audio”.'),
          el('li', 'Keep this tab open. Your own microphone is recorded too, so your voice is included.')),
        el('p', mac ? 'On a Mac, only a browser tab can share its sound — sharing a window or the whole screen records no meeting audio. If you use the Zoom or Teams desktop app, record in person instead or upload the meeting’s recording.'
          : 'On Windows you can also share the entire screen with “Share system audio” turned on — that captures desktop meeting apps too.', 'help'));
    }
    var device = append(el('section', null, 'card card-pad', { 'aria-label': 'Microphone' }),
      append(el('div', null, 'field'), el('label', 'Microphone', 'label', { for: 'recMic' }), (mic.id = 'recMic', mic)),
      append(el('div', null, 'rec-check-row'), levelMeter('recPreviewLevel'), check),
      el('p', r.devices.length ? 'Speak — the bar should move.' : 'Check your microphone before you start. Your browser will ask for permission.', 'help', { id: 'recMicHelp' }),
      ui.callout('info', MODE[r.mode].icon, null, mode.tip));
    var consentBox = append(el('label', null, 'rec-consent', { for: 'recConsent' }), consent,
      append(el('span'), el('strong', 'Everyone in this meeting knows it is being recorded.'), el('span', ' Required before recording. Tell people at the start, and say how the minutes will be shared.', 'muted')));
    root.appendChild(append(el('div', null, 'rec-setup'), details, device));
    if (steps) root.appendChild(steps);
    root.appendChild(append(el('div', null, 'rec-start-row'), consentBox, start));
  }

  function live(root, ctx) {
    var r = ctx.state.rec, a = ctx.actions;
    var stateText = r.phase === 'stopping' ? 'Stopping…' : r.paused ? 'Paused' : 'Recording';
    var card = el('section', null, 'card rec-live' + (r.paused ? ' is-paused' : ''), { 'aria-labelledby': 'recState' });
    append(card,
      append(el('div', null, 'rec-indicator'), el('span', null, 'record-dot', { 'aria-hidden': 'true' }), el('span', stateText, 'rec-state', { id: 'recState' })),
      el('div', ui.clock(a.recElapsed()), 'rec-timer', { id: 'recTimer', 'aria-hidden': 'true' }),
      levelMeter('recLevel'),
      r.meetingAudio === false ? ui.callout('warning', 'triangle-alert', 'No sound from the meeting tab.', 'If people are talking, you may have picked the wrong tab or left “Share tab audio” off. Stop and start again to fix it.') : null,
      append(el('div', null, 'rec-controls'),
        ui.button(r.paused ? 'Resume' : 'Pause', 'secondary', function () { if (r.paused) a.recResume(); else a.recPause(); }, { icon: r.paused ? 'play' : 'pause', id: 'recPause', disabled: r.phase === 'stopping' }),
        ui.button('Add marker', 'secondary', function () { a.recOpenMarker(); }, { icon: 'plus', id: 'recMarker', disabled: r.phase === 'stopping' }),
        ui.button('Stop', 'danger', function () { a.recStop(); }, { icon: 'square', id: 'recStop', disabled: r.phase === 'stopping' })));
    if (r.markerOpen) {
      var note = el('input', null, 'input', { type: 'text', id: 'recMarkerNote', maxlength: '500', placeholder: 'e.g. Decision on budget', autocomplete: 'off' });
      var add = ui.button('Add', 'primary', function () { a.recAddMarker(note.value); }, { size: 'sm' });
      note.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); a.recAddMarker(note.value); } if (e.key === 'Escape') { e.preventDefault(); a.recCloseMarker(); } });
      card.appendChild(append(el('div', null, 'rec-marker-form'), el('label', 'Marker at ' + ui.clock(r.markerAt), 'label', { for: 'recMarkerNote' }), append(el('div', null, 'rec-marker-row'), note, add)));
    }
    if (r.markers.length) {
      var list = el('ol', null, 'rec-markers', { 'aria-label': 'Markers' });
      r.markers.forEach(function (m) { list.appendChild(append(el('li'), el('span', ui.clock(m.atMs), 'mono'), el('span', m.note))); });
      card.appendChild(list);
    }
    var up = r.upload || {};
    card.appendChild(uploadLine(up));
    if (up.persistent === false) card.appendChild(el('p', 'This browser isn’t letting the app save audio on the device (private window?). Keep this tab open until the recording is uploaded.', 'help help-warning'));
    root.appendChild(ui.pageHeader(r.title || MODE[r.mode].title, { meta: el('p', r.mode === 'in_person' ? 'In-person meeting' : 'Online meeting on this computer', 'meta') }));
    root.appendChild(card);
  }

  function uploadText(up) {
    var parts = function (n) { return n + ' part' + (n === 1 ? '' : 's'); };
    if (!up.state) return 'Starting…';
    if (up.state === 'offline') return 'Offline — still recording. ' + parts(up.pending) + ' saved on this device will upload when you’re back online.';
    if (up.state === 'retrying') return 'Connection trouble — retrying. ' + parts(up.pending) + ' waiting, saved on this device.';
    return up.pending ? 'Uploading… ' + parts(up.pending) + ' waiting.' : 'All audio so far is safely on the server.';
  }
  function uploadLine(up) {
    var warn = up.state === 'offline' || up.state === 'retrying';
    // Polite live region: connection problems and recovery are announced without interrupting.
    return append(el('p', null, 'rec-upload' + (warn ? ' is-warning' : ''), { id: 'recUpload', role: 'status' }), MA.icon(warn ? 'triangle-alert' : 'shield-check'), el('span', uploadText(up)));
  }

  MA.screens.record = {
    title: 'Record meeting',
    render: function (root, ctx) {
      if (!ctx.state.rec) { root.appendChild(ui.emptyState('mic', 'Nothing to record', 'Choose “Record meeting” on the Meetings page.')); return; }
      if (ctx.state.rec.phase === 'setup') setup(root, ctx); else live(root, ctx);
    },
    setLevel: setLevel,
    /** Upload status changes every few seconds: replace just that line so focus and typing are untouched. */
    setUpload: function (up) {
      var old = document.getElementById('recUpload');
      if (old) old.replaceWith(uploadLine(up));
    },
  };
})();
