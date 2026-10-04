// Review — AI help per section (suggestion preview: Replace / Keep mine), transcript corrections
// (words and speaker names, then "Update minutes with corrected names"), and who else is viewing.
(function () {
  var ui = MA.ui, el = ui.el, append = ui.append;
  var MODES = [['regenerate', 'Regenerate', 'Rewrite from the transcript'], ['shorter', 'Make shorter', 'Same facts, fewer words'], ['formal', 'Make more formal', 'Board-ready wording']];

  function reviewer() { return (MA.store.get().form.reviewer || '').trim(); }

  /** Transcript window for a section: from its start to the next section's start. */
  function windowFor(section) {
    if (typeof section.startMs !== 'number') return {};
    var later = MA.minutes.get().content.sections.map(function (s) { return s.startMs; }).filter(function (ms) { return typeof ms === 'number' && ms > section.startMs; }).sort(function (a, b) { return a - b; });
    return { startMs: section.startMs, endMs: later[0] };
  }

  /** Renders sanitized suggestion HTML without ever putting it into the live document as markup. */
  function previewNode(html) {
    var doc = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html'), box = el('div', null, 'assist-preview');
    Array.prototype.forEach.call(doc.body.childNodes, function (n) { box.appendChild(document.importNode(n, true)); });
    box.querySelectorAll('*').forEach(function (n) { Array.prototype.slice.call(n.attributes).forEach(function (a) { if (a.name !== 'href' && a.name !== 'data-list') n.removeAttribute(a.name); }); });
    return box;
  }

  function assist(section, mode, label) {
    var q = MA.review.sections.editors[section.id];
    if (!q) return;
    var before = q.root.innerHTML, win = windowFor(section);
    var body = append(el('div'), el('p', 'Asking for a suggestion…', 'help', { role: 'status' }));
    var dialog = MA.cal.dialog.open({ title: label + ': ' + (section.title || 'section'), body: body, variant: 'dialog' });
    MA.api.minutes.assist(MA.minutes.get().runId, { mode: mode, title: section.title || '', html: before, startMs: win.startMs, endMs: win.endMs }).then(function (res) {
      if (!dialog.root.isConnected) return;
      var changed = q.root.innerHTML !== before;
      body.replaceChildren.apply(body, [
        el('p', res.provider === 'demo' ? 'Suggestion (demo mode — not from Claude). Nothing changes unless you choose Replace.' : 'Suggestion from Claude. Nothing changes unless you choose Replace.', 'help'),
        previewNode(res.html),
        changed ? ui.callout('warning', 'triangle-alert', 'You edited this section while the suggestion was being made.', 'Replacing would overwrite those edits.') : null].filter(Boolean));
      var actions = dialog.root.querySelector('.cal-dialog-actions') || dialog.root.appendChild(el('div', null, 'cal-dialog-actions'));
      actions.replaceChildren(
        ui.button('Keep mine', 'secondary', function () { MA.cal.dialog.close(); q.focus(); }, { id: 'assistKeep' }),
        ui.button('Replace', 'primary', function () {
          MA.cal.dialog.close();
          q.setContents(q.clipboard.convert({ html: res.html }), 'user'); // a normal edit: autosaves, and Ctrl+Z undoes it
          q.focus();
          ui.toast('Replaced “' + (section.title || 'section') + '” — Ctrl+Z to undo');
        }, { id: 'assistReplace' }));
      actions.querySelector('#assistReplace').focus();
    }).catch(function (err) {
      if (!dialog.root.isConnected) return;
      body.replaceChildren(ui.callout('danger', 'circle-alert', 'No suggestion.', err.message));
    });
  }

  /** "AI help" menu in each editable section's header. */
  MA.review.sectionExtras = function (section) {
    if (!MA.minutes.editable()) return null;
    return MA.menu.button(null, 'ghost', MODES.map(function (m) { return { label: m[1], hint: m[2], icon: 'sparkles', run: function () { assist(section, m[0], m[1]); } }; }),
      { icon: 'sparkles', size: 'sm', ariaLabel: 'AI help for ' + (section.title || 'this section'), className: 'md-ai' });
  };

  // ---- Transcript corrections ---------------------------------------------------------------------
  function replaceNames(html, from, to) {
    var re = new RegExp('\\b' + from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
    return html.split(/(<[^>]+>)/).map(function (part) { return part.charAt(0) === '<' ? part : part.replace(re, to); }).join('');
  }
  /** After renaming "Speaker 2" → "Sara Lee": the same swap in the minutes text and owners (as an edit). */
  function updateMinutesNames(from, to) {
    if (!MA.minutes.editable()) { ui.toast('The minutes are approved — choose “Edit approved minutes” to update names.', 'error'); return; }
    MA.minutes.edit(function (c) {
      c.sections.forEach(function (s) { s.html = replaceNames(s.html, from, to); s.title = s.title.split(from).join(to); });
      c.actionItems.forEach(function (a) { if (a.owner === from) a.owner = to; a.task = a.task.split(from).join(to); });
    });
    MA.app.actions.redrawReview();
    ui.toast('Updated the minutes: “' + from + '” → “' + to + '”');
  }

  function openCorrections(run) {
    var labels = [], seen = {};
    run.transcript.forEach(function (s) { if (!seen[s.speakerLabel]) { seen[s.speakerLabel] = true; labels.push(s.speakerLabel); } });
    var attendees = run.minutes.meetingSummary.attendees;
    var listId = 'speakerNames';
    var datalist = el('datalist', null, null, { id: listId });
    attendees.forEach(function (n) { datalist.appendChild(el('option', null, null, { value: n })); });
    var renames = el('div', null, 'corr-speakers');
    labels.forEach(function (label, i) {
      var input = el('input', null, 'input', { id: 'rename-' + i, type: 'text', list: listId, placeholder: label, autocomplete: 'off' });
      var go = ui.button('Rename', 'secondary', function () { submit({ rename: { from: label, to: input.value.trim() } }, label, input.value.trim()); }, { size: 'sm' });
      renames.appendChild(append(el('div', null, 'corr-row'), el('label', label + ' →', 'label', { for: 'rename-' + i }), input, go));
    });
    var lines = el('ol', null, 'corr-lines');
    run.transcript.forEach(function (s, i) {
      var t = el('textarea', null, 'textarea', { rows: '2', 'aria-label': 'Line ' + (i + 1) + ', ' + s.speakerLabel + ' at ' + ui.clock(s.startMs), 'data-index': String(i) });
      t.value = s.text;
      lines.appendChild(append(el('li'), el('span', ui.clock(s.startMs) + ' · ' + s.speakerLabel, 'help'), t));
    });
    var error = el('p', '', 'help help-error', { role: 'alert' });
    function submit(body, from, to) {
      if (!reviewer()) { error.textContent = 'Add your name in Settings first — it’s recorded on the correction.'; return; }
      body.editedBy = reviewer();
      MA.api.minutes.correctTranscript(run.runId, body).then(function (res) {
        if (!res.changed) { error.textContent = 'Nothing changed.'; return; }
        MA.cal.dialog.close();
        return MA.api.getRun(run.runId).then(function (fresh) {
          MA.store.set({ run: fresh });
          if (from && to) ui.toast('Renamed “' + from + '” to “' + to + '”', null, { label: 'Update minutes with corrected names', run: function () { updateMinutesNames(from, to); } });
          else ui.toast(res.reason + ' — the original is kept in version history');
        });
      }).catch(function (err) { error.textContent = err.message; });
    }
    var save = ui.button('Save corrections', 'primary', function () {
      var changed = Array.prototype.slice.call(lines.querySelectorAll('textarea')).filter(function (t) { return t.value.trim() !== run.transcript[Number(t.getAttribute('data-index'))].text; })
        .map(function (t) { return { index: Number(t.getAttribute('data-index')), text: t.value }; });
      submit({ lines: changed });
    }, { id: 'saveCorrections' });
    MA.cal.dialog.open({ title: 'Correct transcript', variant: 'dialog', body: append(el('div', null, 'corrections'), el('h3', 'Speaker names', 'section-title'), el('p', 'Rename a speaker everywhere they appear, e.g. “Speaker 2” → a participant.', 'help'), renames, datalist,
      el('h3', 'Words', 'section-title'), el('p', 'Fix words the transcription got wrong. The original transcript is kept in version history.', 'help'), lines, error), actions: [ui.button('Close', 'secondary', function () { MA.cal.dialog.close(); }), save] });
    document.querySelector('.cal-dialog').classList.add('cal-dialog-wide');
  }

  MA.review.transcriptExtras = function (run) {
    return ui.button('Correct', 'ghost', function () { openCorrections(run); }, { icon: 'pencil', size: 'sm', id: 'correctTranscript', ariaLabel: 'Correct the transcript' });
  };

  // ---- Who else is viewing -------------------------------------------------------------------------
  var presenceTimer = null;
  function viewerId() {
    try { var id = window.sessionStorage.getItem('ma.viewerId'); if (!id) { id = MA.minutes.newId(); window.sessionStorage.setItem('ma.viewerId', id); } return id; } catch (e) { return 'tab-' + Math.random().toString(36).slice(2, 12); }
  }
  function ping(runId) {
    if (MA.store.get().page !== 'review' || !MA.store.get().run || MA.store.get().run.runId !== runId) { clearInterval(presenceTimer); presenceTimer = null; return; }
    MA.api.minutes.presence(runId, { viewerId: viewerId(), name: reviewer() }).then(function (res) {
      var slot = document.getElementById('presence');
      if (!slot) return;
      slot.replaceChildren();
      if (!res.viewers.length) return;
      append(slot, ui.avatarStack(res.viewers.map(function (v) { return { name: v.name }; }), { interactive: false }), el('span', 'Also viewing', 'help'));
      slot.setAttribute('aria-label', 'Also viewing: ' + res.viewers.map(function (v) { return v.name; }).join(', '));
    }).catch(function () { /* presence is informational */ });
  }
  MA.review.watchPresence = function (runId) {
    clearInterval(presenceTimer);
    ping(runId);
    presenceTimer = setInterval(function () { ping(runId); }, 15000);
  };
})();
