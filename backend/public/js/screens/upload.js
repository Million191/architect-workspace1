// Screen — Upload or record a meeting. Form state lives in the store, so it survives navigation and retries.
(function () {
  var ui = MA.ui, el = ui.el, append = ui.append, store = MA.store;
  var FORMATS = ['mp3', 'wav', 'm4a', 'mp4', 'webm', 'ogg'];
  var MAX_BYTES = 200 * 1024 * 1024;

  function ext(name) { var m = /\.([a-z0-9]+)$/i.exec(name || ''); return m ? m[1].toLowerCase() : ''; }

  /** What's wrong with the chosen file, in words that say how to fix it — or null. */
  function fileProblem(file) {
    if (!file) return null;
    if (FORMATS.indexOf(ext(file.name)) === -1) return 'That file type isn’t supported. Upload an MP3, WAV, M4A, MP4, WebM, or OGG recording.';
    if (file.size > MAX_BYTES) return 'That file is larger than 200 MB. Trim the recording or export it at a lower bitrate, then try again.';
    if (file.size === 0) return 'That file is empty. Choose the recording again.';
    return null;
  }
  function bareEmails(text) {
    return text.split(/[,;\n]/).map(function (e) { return e.trim(); }).filter(function (e) { return e.indexOf('@') !== -1 && e.indexOf('<') === -1; });
  }
  function missing(form) {
    var m = [];
    if (!form.file || fileProblem(form.file)) m.push('a recording');
    if (!form.attendees.trim()) m.push('participants');
    if (!form.reviewer.trim()) m.push('your name');
    return m;
  }

  function input(id, label, value, placeholder, help, onInput) {
    var f = el('div', null, 'field'), i = el('input', null, 'input', { id: id, type: 'text', placeholder: placeholder, autocomplete: 'off' });
    i.value = value;
    if (help) i.setAttribute('aria-describedby', id + '-help');
    i.addEventListener('input', function () { onInput(i.value); });
    return append(f, el('label', label, 'label', { for: id }), i, help ? append(el('div', null, null, { id: id + '-help' }), help) : null);
  }

  MA.screens.upload = {
    title: 'Upload meeting',
    render: function (root, ctx) {
      var s = ctx.state, form = s.form, rec = s.recording;
      var primary = ui.button('Upload and transcribe', 'primary', function () { ctx.actions.startUpload(); }, { icon: 'upload', id: 'primaryAction' });
      root.appendChild(ui.pageHeader('Upload meeting', {
        back: { label: 'Meetings', onClick: function () { ctx.actions.go('meetings'); } },
        meta: el('p', 'Add a recording and Meeting Assistant will draft the minutes for your review.', 'meta'),
        actions: [primary],
      }));
      var problems = (s.status && s.status.readiness && s.status.readiness.draft) || [];
      if (problems.length) {
        var list = el('ul');
        problems.forEach(function (p) { list.appendChild(el('li', p)); });
        root.appendChild(append(el('div', null, null, { style: 'margin-bottom:16px' }), ui.callout('danger', 'circle-alert', 'Setup needed before meetings can be processed.', list)));
      }

      var grid = el('div', null, 'upload-grid');
      var left = el('section', null, 'card card-pad', { 'aria-label': 'Recording' });
      var fileInput = el('input', null, 'sr-only', { type: 'file', id: 'audio', accept: '.mp3,.wav,.m4a,.mp4,.webm,.ogg,audio/*,video/mp4,video/webm' });
      fileInput.addEventListener('change', function () { ctx.actions.chooseFile(fileInput.files && fileInput.files[0]); });

      if (form.file) {
        var problem = fileProblem(form.file);
        var card = append(el('div', null, 'file-card' + (problem ? ' is-invalid' : '')),
          append(el('span', null, 'file-icon'), MA.icon('audio-lines')),
          append(el('div', null, 'file-meta'), el('span', form.file.name, 'file-name'), el('span', (ext(form.file.name) || 'unknown').toUpperCase() + ' · ' + ui.bytes(form.file.size), 'file-detail')),
          ui.button('Replace', 'ghost', function () { fileInput.click(); }, { size: 'sm' }),
          ui.button(null, 'ghost', function () { ctx.actions.chooseFile(null); }, { icon: 'x', size: 'sm', ariaLabel: 'Remove ' + form.file.name }));
        append(left, card, problem ? el('p', problem, 'help help-error', { role: 'alert', style: 'margin-top:8px' }) : null, fileInput);
      } else if (rec.active) {
        var timer = el('span', ui.clock(Date.now() - rec.startedAt), 'mono', { id: 'recTimer', 'aria-live': 'off' });
        append(left, append(el('div', null, 'record-row'), append(el('div', null, null, { style: 'display:flex;align-items:center;gap:10px' }), el('span', null, 'record-dot', { 'aria-hidden': 'true' }), el('span', 'Recording…'), timer),
          ui.button('Stop recording', 'secondary', function () { ctx.actions.stopRecording(); }, { icon: 'square' })));
      } else {
        var drop = el('label', null, 'dropzone', { for: 'audio' });
        append(drop, append(el('span', null, 'drop-icon'), MA.icon('upload', 'icon-lg')), el('span', 'Drop a recording here', 'drop-title'),
          append(el('span', null, 'muted'), 'or ', el('span', 'browse your files', 'drop-link')), el('span', 'MP3, WAV, M4A, MP4, WebM, or OGG · up to 200 MB', 'help'), fileInput);
        ['dragenter', 'dragover'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('is-over'); }); });
        ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function () { drop.classList.remove('is-over'); }); });
        drop.addEventListener('drop', function (e) { e.preventDefault(); if (e.dataTransfer && e.dataTransfer.files[0]) ctx.actions.chooseFile(e.dataTransfer.files[0]); });
        append(left, drop, el('div', 'or', 'divider-or'),
          append(el('div', null, 'record-row'), append(el('div'), el('div', 'Record in your browser', 'step-title'), el('div', 'Uploaded every few seconds, so nothing is lost if the connection drops.', 'help')),
            ui.button('Record', 'secondary', function () { ctx.actions.recordMeeting('in_person'); }, { icon: 'mic' })));
      }
      if (rec.error) left.appendChild(append(el('div', null, null, { style: 'margin-top:12px' }), ui.callout('danger', 'circle-alert', null, rec.error)));

      var right = el('section', null, 'card card-pad', { 'aria-label': 'Meeting details' });
      var hint = el('p', null, 'help help-warning', { role: 'status' });
      function updateHint(v) { var b = bareEmails(v); hint.textContent = b.length ? 'Add a name so the email greets them by name, e.g. Million <' + b[0] + '>.' : ''; hint.hidden = !b.length; }
      var why = el('p', null, 'help', { id: 'primaryHelp', style: 'margin-top:16px' });
      function refresh() {
        var m = missing(store.get().form).concat(problems.length ? ['setup'] : []);
        primary.disabled = m.length > 0 || s.busy;
        why.textContent = m.length ? 'To continue, add ' + m.join(', ') + '.' : 'Ready to upload.';
      }
      primary.setAttribute('aria-describedby', 'primaryHelp');
      append(right,
        input('title', 'Meeting title', form.title, 'e.g. Project progress', null, function (v) { store.setForm({ title: v }); }),
        input('attendees', 'Participants', form.attendees, 'Million <million@example.com>, Priya <priya@example.com>',
          append(el('div'), el('p', 'Name and email, separated by commas. Each person gets their own email draft.', 'help'), hint),
          function (v) { store.setForm({ attendees: v }); updateHint(v); refresh(); }),
        input('reviewer', 'Your name', form.reviewer, 'Recorded on your approvals', null, function (v) { store.setForm({ reviewer: v }); refresh(); ctx.actions.refreshShell(); }),
        why);
      updateHint(form.attendees);
      MA.spell.attach(right.querySelector('#title'));
      refresh();
      append(grid, left, right);
      root.appendChild(grid);
    },
    fileProblem: fileProblem,
  };
})();
