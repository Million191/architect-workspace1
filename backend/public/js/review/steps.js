// Review — the steps that aren't the minutes editor: Meeting (title + participants), Transcript
// (read, or edit line by line), and Approval (Edit / Request changes / Approve minutes).
// Corrections are saved on the server and carried into the minutes, so they show everywhere.
(function () {
  var ui = MA.ui, el = ui.el, append = ui.append;
  var draft = null; // what's typed in Edit mode on the Meeting / Transcript step (survives redraws)

  function reviewer() { return (MA.store.get().form.reviewer || '').trim(); }
  function lockedReason(run) { return MA.workflow.approved(run) ? 'The minutes are reviewed, so this is read-only.' : 'Unavailable right now.'; }
  function escapeRe(t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /** Same word swap in the minutes text and action items (text only, never inside HTML tags). */
  function replaceInMinutes(pairs) {
    if (!pairs.length || !MA.minutes.editable()) return false;
    function swap(text) {
      return pairs.reduce(function (t, p) { return t.replace(new RegExp('(^|[^\\w])' + escapeRe(p.from) + '(?=$|[^\\w])', 'g'), function (_m, pre) { return pre + p.to; }); }, text);
    }
    var before = JSON.stringify(MA.minutes.get().content);
    MA.minutes.edit(function (c) {
      c.sections.forEach(function (s) { s.title = swap(s.title); s.html = s.html.split(/(<[^>]+>)/).map(function (part) { return part.charAt(0) === '<' ? part : swap(part); }).join(''); });
      c.actionItems.forEach(function (a) { a.task = swap(a.task); if (a.owner) a.owner = swap(a.owner); });
    });
    return before !== JSON.stringify(MA.minutes.get().content);
  }
  /** Word-for-word corrections in a line ("Jhon" → "John"); lines whose word count changed give none. */
  function wordPairs(before, after) {
    var a = before.split(/\s+/), b = after.split(/\s+/), out = [];
    if (a.length !== b.length) return out;
    a.forEach(function (w, i) {
      var x = w.replace(/^[^\w]+|[^\w]+$/g, ''), y = b[i].replace(/^[^\w]+|[^\w]+$/g, '');
      if (x && y && x !== y && x.length > 1 && !out.some(function (p) { return p.from === x; })) out.push({ from: x, to: y });
    });
    return out;
  }

  // ---- Step 1: Meeting --------------------------------------------------------------------------
  function meetingStep(s, ctx) {
    var run = s.run, summary = run.minutes.meetingSummary, editing = s.editing === 'meeting';
    var host = el('section', null, 'card wf-card', { 'aria-labelledby': 'wfHeading' });
    host.appendChild(MA.workflow.stepHead(s, ctx.actions, { step: 'meeting', title: 'Meeting details', help: 'Check the title and who took part. Names here label the transcript and the emails.',
      editable: !MA.workflow.approved(run), lockedReason: 'The minutes are reviewed — rename from the dashboard (••• More) if needed.' }));
    var body = el('div', null, 'card-body wf-body');
    if (!editing) {
      draft = null;
      var when = MA.dashboard.timeLine(Object.assign({}, summary, { durationMs: (run.transcript[run.transcript.length - 1] || {}).endMs }));
      body.appendChild(append(el('dl', null, 'kv wf-facts'),
        el('dt', 'Title'), el('dd', summary.title || 'Untitled meeting', null, { id: 'meetingTitleValue' }),
        el('dt', 'Date'), el('dd', [ui.longDate(MA.dashboard.sel.localDay(summary)), when].filter(Boolean).join(' · ') || 'Not known'),
        el('dt', 'Where'), el('dd', summary.platformOrLocation || summary.format || '—'),
        el('dt', 'Status'), append(el('dd'), ui.badge(MA.statusOf(run.status || run.stage))),
        el('dt', 'Participants'), append(el('dd'), summary.attendees.length ? ui.peopleList(summary.attendees.map(function (n) { return MA.people.resolve({ name: n, email: (run.recipients || {})[n] }); })) : el('span', 'None listed', 'muted'))));
    } else {
      if (!draft || draft.runId !== run.runId) draft = { runId: run.runId, title: summary.title || '', people: summary.attendees.map(function (n) { return { from: n, name: n, email: (run.recipients || {})[n] || '' }; }) };
      var title = el('input', null, 'input', { id: 'editTitle', type: 'text', maxlength: '300', value: draft.title });
      title.value = draft.title;
      title.addEventListener('input', function () { draft.title = title.value; });
      var list = el('div', null, 'wf-people', { role: 'group', 'aria-labelledby': 'peopleLabel' });
      draft.people.forEach(function (p, i) {
        var n = el('input', null, 'input', { type: 'text', id: 'personName-' + i, 'aria-label': 'Name of participant ' + (i + 1), maxlength: '200' });
        var e = el('input', null, 'input', { type: 'email', id: 'personEmail-' + i, 'aria-label': 'Email of participant ' + (i + 1) + ' (optional)', placeholder: 'name@example.com', maxlength: '320' });
        n.value = p.name; e.value = p.email;
        n.addEventListener('input', function () { p.name = n.value; });
        e.addEventListener('input', function () { p.email = e.value; });
        list.appendChild(append(el('div', null, 'wf-person'), n, e, ui.button(null, 'ghost', function () { draft.people.splice(i, 1); MA.store.set({}); }, { icon: 'x', size: 'sm', ariaLabel: 'Remove ' + (p.name || 'participant') })));
      });
      append(body, append(el('div', null, 'field'), el('label', 'Title', 'label', { for: 'editTitle' }), title),
        append(el('div', null, 'field'), el('span', 'Participants', 'label', { id: 'peopleLabel' }), el('p', 'Renaming someone also renames them in the transcript and in the minutes.', 'help'), list,
          ui.button('Add participant', 'ghost', function () { draft.people.push({ name: '', email: '' }); MA.store.set({}); setTimeout(function () { var f = document.getElementById('personName-' + (draft.people.length - 1)); if (f) f.focus(); }, 0); }, { icon: 'plus', size: 'sm', id: 'addPerson' })),
        el('p', '', 'help help-error', { role: 'alert', id: 'meetingError' }));
    }
    host.appendChild(body);
    return host;
  }

  function saveMeeting() {
    var s = MA.store.get(), run = s.run, summary = run.minutes.meetingSummary, err = document.getElementById('meetingError');
    var title = draft.title.trim(), people = draft.people.map(function (p) { return { from: p.from, name: p.name.trim(), email: p.email.trim() }; }).filter(function (p) { return p.name; });
    if (!title) { if (err) err.textContent = 'Give the meeting a title.'; return Promise.resolve(); }
    if (!people.length) { if (err) err.textContent = 'Keep at least one participant.'; return Promise.resolve(); }
    var jobs = [];
    if (title !== summary.title) jobs.push(function () { return MA.api.renameMeeting(run.runId, title, reviewer() || undefined); });
    var changed = JSON.stringify(people.map(function (p) { return [p.name, p.email]; })) !== JSON.stringify(summary.attendees.map(function (n) { return [n, (run.recipients || {})[n] || '']; }));
    if (changed) jobs.push(function () { return MA.api.saveParticipants(run.runId, people.map(function (p) { return { from: p.from || undefined, name: p.name, email: p.email || undefined }; }), reviewer() || undefined); });
    var renames = people.filter(function (p) { return p.from && p.from !== p.name; }).map(function (p) { return { from: p.from, to: p.name }; });
    return jobs.reduce(function (chain, job) { return chain.then(job); }, Promise.resolve()).then(function () {
      var minutesChanged = replaceInMinutes(renames);
      return (minutesChanged ? MA.minutes.flush() : Promise.resolve()).then(function () {
        draft = null;
        MA.app.actions.endEdit(jobs.length ? 'Meeting details saved' + (minutesChanged ? ' — names updated in the minutes too' : '') : 'No changes');
      });
    }).catch(function (e) { if (err) err.textContent = e.message; });
  }

  // ---- Step 2: Transcript -----------------------------------------------------------------------
  function transcriptStep(s, ctx) {
    var run = s.run, editing = s.editing === 'transcript';
    var host = el('div', null, 'wf-transcript');
    var head = el('section', null, 'card wf-card');
    head.appendChild(MA.workflow.stepHead(s, ctx.actions, { step: 'transcript', title: 'Transcript', help: 'Read what was said and fix words the transcription got wrong. Corrections also update the minutes.',
      editingHelp: 'Correct any line, then Save changes. A word fixed here (e.g. “Jhon” → “John”) is fixed in the minutes too.', editable: true }));
    host.appendChild(head);
    if (!editing) {
      draft = null;
      // Reading mode keeps "Add to minutes" (select text or a line's time) and speaker renames ("Correct").
      var panel = MA.review.transcript.render(run, {
        editable: MA.minutes.editable(),
        headExtra: MA.review.transcriptExtras ? MA.review.transcriptExtras(run) : null,
        insert: function (sectionId, html, title) { if (MA.review.sections.appendTo(sectionId, html)) ui.toast('Added to “' + (title || 'section') + '”'); },
        insertNew: function (html) { MA.minutes.edit(function (c) { c.sections.push({ id: MA.minutes.newId(), kind: 'notes', title: 'Notes', html: html }); }); ui.toast('Added to a new “Notes” section'); },
      });
      host.appendChild(panel);
      return host;
    }
    if (!draft || draft.runId !== run.runId || !draft.lines) draft = { runId: run.runId, lines: run.transcript.map(function (seg) { return seg.text; }) };
    var list = el('ol', null, 'card wf-lines', { 'aria-label': 'Transcript lines' });
    run.transcript.forEach(function (seg, i) {
      var t = el('textarea', null, 'textarea', { rows: '2', id: 'line-' + i, 'aria-label': 'Line ' + (i + 1) + ', ' + seg.speakerLabel + ' at ' + ui.clock(seg.startMs) });
      t.value = draft.lines[i];
      t.addEventListener('input', function () { draft.lines[i] = t.value; });
      list.appendChild(append(el('li', null, 'wf-line'), el('span', ui.clock(seg.startMs) + ' · ' + seg.speakerLabel, 'help'), t));
    });
    host.appendChild(list);
    host.appendChild(el('p', '', 'help help-error', { role: 'alert', id: 'transcriptError' }));
    return host;
  }

  function saveTranscript() {
    var run = MA.store.get().run, err = document.getElementById('transcriptError');
    var changes = [], pairs = [];
    run.transcript.forEach(function (seg, i) {
      var text = (draft.lines[i] || '').replace(/\s+/g, ' ').trim();
      if (text !== seg.text) { changes.push({ index: i, text: text }); wordPairs(seg.text, text).forEach(function (p) { if (!pairs.some(function (x) { return x.from === p.from; })) pairs.push(p); }); }
    });
    if (!changes.length) { draft = null; return MA.app.actions.endEdit('No changes'); }
    return MA.api.minutes.correctTranscript(run.runId, { lines: changes, editedBy: reviewer() || undefined }).then(function () {
      var minutesChanged = replaceInMinutes(pairs);
      return (minutesChanged ? MA.minutes.flush() : Promise.resolve()).then(function () {
        draft = null;
        return MA.app.actions.endEdit('Transcript saved' + (minutesChanged ? ' — the same correction was made in the minutes' : '') + '. The original is kept in version history.');
      });
    }).catch(function (e) { if (err) err.textContent = e.message; });
  }

  // ---- Step 5: Approval -------------------------------------------------------------------------
  function approvalStep(s, ctx) {
    var run = s.run, a = ctx.actions, card = el('section', null, 'card wf-card', { 'aria-labelledby': 'wfHeading' });
    var content = MA.minutes.get().content;
    card.appendChild(MA.workflow.stepHead(s, a, { step: 'approval', title: 'Review', help: MA.workflow.approved(run) ? 'These minutes were reviewed by a person.' : 'Nothing is reviewed until you choose “Approve minutes”. AI-drafted content is never reviewed automatically.' }));
    var body = el('div', null, 'card-body wf-body');
    if (MA.workflow.approved(run)) {
      var fa = run.finalApproval;
      body.appendChild(ui.callout('success', 'circle-check', 'Minutes reviewed.', fa ? 'Reviewed by ' + fa.approvedBy + ' on ' + new Date(fa.approvedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) + '.' : 'Continue to the email preview.'));
      card.appendChild(body);
      return card;
    }
    if (run.changeRequest) body.appendChild(ui.callout('warning', 'triangle-alert', 'Changes requested' + (run.changeRequest.by ? ' by ' + run.changeRequest.by : '') + ':', run.changeRequest.note));
    var checks = el('ul', null, 'wf-checklist', { 'aria-label': 'What you are approving' });
    [['Transcript', run.transcript.length + ' lines'], ['Summary', content.sections.filter(function (x) { return x.kind !== 'decisions'; }).length + ' sections']].forEach(function (c, i) {
      var step = ['transcript', 'summary'][i];
      var link = el('button', 'Review', 'link-button', { type: 'button', 'aria-label': 'Review ' + c[0].toLowerCase() });
      link.addEventListener('click', function () { a.goStep(step); });
      checks.appendChild(append(el('li'), MA.icon('check'), el('strong', c[0]), el('span', c[1], 'muted'), link));
    });
    var name = el('input', null, 'input', { id: 'approverName', type: 'text', autocomplete: 'name', placeholder: 'Your name', maxlength: '200' });
    name.value = s.form.reviewer;
    name.addEventListener('input', function () { MA.store.setForm({ reviewer: name.value }); a.refreshShell(); });
    var approveBtn = ui.button('Approve minutes', 'primary', function () {
      if (!reviewer()) { document.getElementById('approverError').textContent = 'Type your name — it’s recorded on the approval.'; name.focus(); return; }
      a.approveMinutes();
    }, { icon: 'check', id: 'approveMinutes', disabled: s.busy });
    append(body, checks,
      append(el('div', null, 'field wf-approver'), el('label', 'Reviewed by', 'label', { for: 'approverName' }), name, el('p', '', 'help help-error', { id: 'approverError', role: 'alert' })),
      append(el('div', null, 'wf-approve-actions'),
        ui.button('Request changes', 'secondary', function () { a.requestChanges(); }, { icon: 'messages-square', id: 'requestChanges' }),
        el('span', null, 'wf-spacer'),
        run.emailMode === 'draft-only' ? ui.draftOnlyBadge() : null,
        approveBtn),
      el('p', 'Approving drafts the email for your preview. Nothing is sent until you approve it on the next step.', 'help'));
    card.appendChild(body);
    return card;
  }

  MA.review = MA.review || {};
  MA.review.steps = {
    meeting: meetingStep, transcript: transcriptStep, approval: approvalStep,
    save: function (step) { return step === 'meeting' ? saveMeeting() : saveTranscript(); },
    reset: function () { draft = null; },
    wordPairs: wordPairs, replaceInMinutes: replaceInMinutes, lockedReason: lockedReason,
  };
})();
