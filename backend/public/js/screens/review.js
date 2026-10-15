// Screen — Review, as guided steps (see review/workflow.js): Meeting → Transcript → Summary →
// Decisions & action items → Approval (the Email step is screens/send.js). Autosave with a visible
// status, Edit / Cancel / Save changes per step, approval lock and "Edit approved minutes",
// conflict and recovery notices.
(function () {
  var ui = MA.ui, el = ui.el, append = ui.append;
  var STATUS = { idle: '', dirty: 'Unsaved changes', saving: 'Saving…', saved: 'Saved', error: 'Couldn’t save', conflict: 'Not saved — newer version' };
  var unsubscribe = null, loadedRun = null;

  function announce(text) { var n = document.getElementById('reviewAnnounce'); if (n) { n.textContent = ''; setTimeout(function () { n.textContent = text; }, 20); } }

  /** Save status in the header: updated in place on every change (no re-render while typing). */
  function statusNode() {
    var wrap = el('span', null, 'save-state', { id: 'saveState' });
    function draw(st) {
      if (!st) return;
      wrap.replaceChildren(el('span', STATUS[st.status] || '', null, { role: st.status === 'error' || st.status === 'conflict' ? 'alert' : 'status' }));
      wrap.className = 'save-state' + (st.status === 'error' || st.status === 'conflict' ? ' is-error' : '');
      if (st.status === 'error') wrap.appendChild(ui.button('Retry', 'ghost', function () { MA.minutes.retry().catch(function () { /* status explains */ }); }, { size: 'sm', id: 'saveRetry' }));
    }
    draw(MA.minutes.get());
    return { node: wrap, draw: draw };
  }

  function banners(root, st, ctx) {
    var v = st.view, box = el('div', null, 'review-banners');
    if (st.status === 'conflict') {
      box.appendChild(ui.callout('danger', 'circle-alert', st.conflict.updatedBy + ' updated this draft.', append(el('span'), 'Your latest change wasn’t saved, so nothing of theirs was overwritten. ',
        ui.button('Reload', 'secondary', function () { ctx.actions.reloadMinutes(); }, { size: 'sm', id: 'conflictReload' }))));
    }
    if (st.error && st.status === 'error') box.appendChild(ui.callout('warning', 'triangle-alert', 'Couldn’t save.', /kept in this browser/.test(st.error) ? st.error : st.error + ' Your text is kept in this browser until it saves.'));
    if (st.recovered) box.appendChild(ui.callout('info', 'rotate-ccw', 'Recovered your unsaved changes.', 'They were kept in this browser and are being saved now.'));
    if (st.staleBackup) {
      box.appendChild(ui.callout('warning', 'triangle-alert', 'You have unsaved changes from earlier.', append(el('span'), 'Someone saved a newer version since. ',
        ui.button('Use my changes', 'secondary', function () { MA.minutes.keepMine(); ctx.actions.redrawReview(); }, { size: 'sm' }), ' ',
        ui.button('Discard them', 'ghost', function () { MA.minutes.discardBackup(); ctx.actions.redrawReview(); }, { size: 'sm' }))));
    }
    var reopening = MA.minutes.isReopening && MA.minutes.isReopening();
    if (reopening) box.appendChild(ui.callout('warning', 'triangle-alert', 'Editing reviewed minutes will require approval again.', 'When you save, the status changes to Needs review and no email can be sent until the minutes are reviewed again. Cancel keeps the current approval.'));
    else if (v.state === 'locked') box.appendChild(ui.callout('info', 'lock', 'Minutes reviewed.', 'Review and approve the email next. To correct the minutes, choose Edit Summary on the Review step — they’ll need approval again.'));
    else if (v.state === 'approved' && v.approval) box.appendChild(ui.callout('success', 'lock', 'Reviewed by ' + v.approval.by + ' on ' + new Date(v.approval.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) + '.', 'To correct the minutes, choose Edit Summary on the Review step — they’ll need approval again.'));
    if (v.state === 'amending') {
      box.appendChild(ui.callout('warning', 'pencil', 'Editing reviewed minutes.', append(el('span'), 'Reason: ' + v.amending.reason + '. ',
        ui.button('Done editing', 'secondary', function () { ctx.actions.finishAmendment(); }, { size: 'sm', id: 'finishAmendment' }))));
    }
    if (v.pendingUpdateEmail && v.state !== 'amending') {
      box.appendChild(ui.callout('info', 'mail', 'The reviewed minutes changed.', append(el('span'), 'Send participants the updated minutes? ',
        ui.button('Send updated minutes', 'primary', function () { ctx.actions.sendUpdatedMinutes(); }, { size: 'sm', id: 'sendUpdate' }))));
    }
    if (v.outOfDateTranslations && v.outOfDateTranslations.length) box.appendChild(ui.callout('warning', 'triangle-alert', 'Translations are out of date.', v.outOfDateTranslations.join(', ').toUpperCase() + ' — update them after editing.'));
    // Until a person approves them, the minutes are labelled as a draft — edited or not.
    if (v.state === 'draft' && (['summary', 'approval', 'decisions'].indexOf(MA.store.get().reviewStep) !== -1)) {
      var label = ui.callout('info', 'sparkles', 'AI-generated draft — review and edit before approval.', 'Nothing is reviewed or shared until you approve it. Your edits are never overwritten by the AI.');
      label.id = 'draftLabel';
      box.appendChild(label);
    }
    if (box.childNodes.length) root.appendChild(box);
  }

  /**
   * Summary (every section except decisions) or Decisions & action items. Editors are read-only until
   * Edit is chosen; approved minutes are changed through "Edit approved minutes" (with a reason).
   */
  /**
   * opts.readOnly (the Summary step): the summary is shown with no Edit buttons — editing happens on the
   * Review step, which calls this with the same step id ('summary') so Edit / Cancel / Save work unchanged.
   */
  function minutesStep(root, s, ctx, step, opts) {
    opts = opts || {};
    var st = MA.minutes.get(), v = st.view, run = s.run;
    var a = ctx.actions, approvedMinutes = v.state === 'locked' || v.state === 'approved';
    var stepEditing = !opts.readOnly && s.editing === step && !s.editingSection;
    var editable = !opts.readOnly && (v.state === 'amending' || (stepEditing && MA.minutes.editable()));
    /** A section is editable while the whole step is in Edit mode, or while its own ✏ Edit is open. */
    var editableFor = function (sec) { return !opts.readOnly && (v.state === 'amending' || (MA.minutes.editable() && (stepEditing || (s.editing === step && s.editingSection === sec.id)))); };
    /** ✏ Edit on each section, or Cancel / Save changes while that section is being edited. */
    var sectionTools = function (sec) {
      if (opts.readOnly) return null;
      var label = sec.title || 'section';
      if (s.editing === step && s.editingSection === sec.id) {
        return append(el('span', null, 'md-section-tools'),
          ui.button('Cancel', 'secondary', function () { a.cancelEdit(); }, { size: 'sm', id: 'sectionCancel-' + sec.id }),
          ui.button('Save changes', 'primary', function () { a.saveEdit(); }, { size: 'sm', icon: 'check', id: 'sectionSave-' + sec.id }));
      }
      if (s.editing || v.state === 'amending' || !(approvedMinutes || MA.minutes.editable())) return null;
      return ui.button('Edit', 'ghost', function () { a.startEdit(step, { sectionId: sec.id }); }, { icon: 'pencil', size: 'sm', id: 'editSection-' + sec.id, ariaLabel: 'Edit ' + label });
    };
    var attendees = run.minutes.meetingSummary.attendees.map(function (n) { return { name: n, email: (run.recipients || {})[n] }; });
    var jump = function (ms) { MA.store.quiet({ focusMs: ms }); ctx.actions.goStep('transcript'); };
    var isDecisions = step === 'decisions';
    var headOpts = isDecisions
      ? { step: step, title: 'Action items', editLabel: 'Edit action items', help: 'Check who owns each action item and when it’s due.', editingHelp: 'Edit action items (task, owner, due date), then Save changes.' }
      : { step: step, title: 'Meeting Summary', editLabel: 'Edit Summary', help: 'What was discussed, section by section. Choose Edit Summary to correct anything.',
        editingHelp: 'Fix spelling, wording, names, dates or facts; add or remove sentences. Save changes keeps your version — it’s the one used in the reviewed minutes and the email.' };
    headOpts.editingHere = stepEditing;
    if (opts.inReview) headOpts.headingId = 'summaryHeading'; // the Review step has its own wfHeading below
    if (opts.readOnly) {
      headOpts.editable = false;
      headOpts.hideEdit = true;
      headOpts.help = 'What was discussed, with the recording and the transcript below. To correct anything, go to Review.';
    }
    if (opts.readOnly) { /* no editing on the Summary step */ }
    else if (v.state === 'draft') headOpts.editable = MA.minutes.editable() && !s.editing;
    else if (approvedMinutes) {
      // Approved minutes can still be corrected — after a warning, and they then need approval again.
      headOpts.editable = !s.editing;
      headOpts.help = (isDecisions ? 'Reviewed action items.' : 'The reviewed summary.') + ' Editing it will require approval again.';
    }
    var card = el('div', null, 'wf-minutes' + (s.editing === step ? ' is-editing' : ''));
    var head = MA.workflow.stepHead(s, ctx.actions, headOpts);
    card.appendChild(append(el('section', null, 'card wf-card'), head));
    var panel = el('div', null, 'minutes-panel wf-body', { id: 'minutesPanel' });
    var sectionsHost = el('div'), itemsHost = el('div');
    function redraw(focusId, message) {
      sectionsHost.replaceChildren();
      MA.review.sections.render(sectionsHost, { editable: editable, editableFor: editableFor, sectionTools: sectionTools, jump: jump, redraw: redraw, extraHead: MA.review.sectionExtras, noAdd: isDecisions,
        filter: function (sec) { return isDecisions ? sec.kind === 'decisions' : sec.kind !== 'decisions'; } });
      if (message) announce(message);
      var f = focusId && document.getElementById(focusId);
      if (f) f.focus();
    }
    // The action-items step shows only action items; decisions aren't shown in the review (user request 2026-10-09).
    if (!isDecisions) { redraw(); append(panel, sectionsHost); }
    if (isDecisions) {
      MA.review.actionItems.render(itemsHost, { editable: editable, attendees: attendees, jump: jump, announce: announce });
      panel.appendChild(itemsHost);
    }
    card.appendChild(panel);
    if (opts.readOnly) root.appendChild(audioCard(run));
    root.appendChild(card);
    if (opts.readOnly) {
      root.appendChild(MA.review.transcript.render(run, { editable: false }));
      root.appendChild(editLog(s, ctx));
    }
  }

  /** The meeting's recording (an in-app recording, or the uploaded file). Says so plainly when none is kept. */
  function audioCard(run) {
    var body = el('div', null, 'card-body audio-body');
    var player = el('audio', null, 'meeting-audio', { controls: '', preload: 'metadata', src: '/api/meetings/' + encodeURIComponent(run.runId) + '/audio', 'aria-label': 'Meeting recording', id: 'meetingAudio' });
    player.addEventListener('error', function () {
      body.replaceChildren(el('p', 'No audio is kept for this meeting — it may have been deleted by the “Keep raw meeting audio” setting, or uploaded before audio was saved.', 'help', { id: 'noAudio' }));
    });
    body.appendChild(player);
    return append(el('section', null, 'card audio-card', { 'aria-labelledby': 'audioHeading' }),
      append(el('div', null, 'card-head'), append(el('h2', null, 'section-title', { id: 'audioHeading' }), MA.icon('audio-lines'), 'Recording')), body);
  }

  /**
   * Edit log (Summary step): the original AI draft and every saved version, newest first — who, when, and why.
   * The original is kept from the start and each Edit session saves a new version, so nothing is ever overwritten.
   */
  var LOG_KIND = { ai_draft: 'Original (AI draft)', edit: 'Edited', restore: 'Restored an earlier version', amendment: 'Edited after approval', transcript_correction: 'Transcript corrected' };
  function editLog(s, ctx) {
    var list = el('ol', null, 'edit-log-list', { 'aria-label': 'Edit log' });
    list.appendChild(el('li', 'Loading…', 'muted'));
    var head = append(el('div', null, 'card-head'), append(el('h2', null, 'section-title', { id: 'editLogHeading' }), MA.icon('history'), 'Edit log'),
      ui.button('Compare with original', 'ghost', function () { ctx.actions.openVersions(); }, { size: 'sm', id: 'editLogCompare' }));
    var card = append(el('section', null, 'card edit-log', { 'aria-labelledby': 'editLogHeading' }), head,
      el('p', 'The original summary is saved before anything is edited. Every saved change is kept here.', 'help edit-log-note'), list);
    MA.api.minutes.versions(s.run.runId).then(function (versions) {
      list.replaceChildren();
      versions.forEach(function (v) {
        var when = new Date(v.updatedAt || v.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
        var who = v.kind === 'ai_draft' ? '' : ' by ' + (v.author || 'someone');
        list.appendChild(append(el('li', null, 'edit-log-item' + (v.kind === 'ai_draft' ? ' is-original' : '')),
          el('strong', (LOG_KIND[v.kind] || 'Saved') + who), el('span', ' · ' + when + ' · version ' + v.number, 'muted'), v.reason ? el('span', ' — ' + v.reason, 'muted') : null));
      });
    }).catch(function () { list.replaceChildren(el('li', 'Couldn’t load the edit log. Try again later.', 'muted')); });
    return card;
  }

  MA.screens.review = {
    title: 'Review minutes',
    render: function (root, ctx) {
      var s = ctx.state, run = s.run, summary = run.minutes.meetingSummary;
      var st = MA.minutes.get();
      if (!st || st.runId !== run.runId) {
        root.appendChild(ui.pageHeader(summary.title || 'Untitled meeting', { back: { label: 'Meetings', onClick: function () { ctx.actions.go('meetings'); } } }));
        root.appendChild(append(el('div', null, 'card card-pad', { role: 'status', 'aria-label': 'Loading the minutes' }), el('span', null, 'skeleton skeleton-line', { style: 'width:50%' }), el('span', null, 'skeleton skeleton-line', { style: 'width:80%' })));
        if (loadedRun !== run.runId) {
          loadedRun = run.runId;
          MA.minutes.load(run.runId).then(function () { if (MA.store.get().page === 'review') MA.store.set({}); })
            .catch(function (err) { loadedRun = null; ui.toast('Couldn’t open the minutes: ' + err.message, 'error'); });
        }
        return;
      }
      var v = st.view, status = statusNode(), step = MA.workflow.current(s);
      MA.workflow.markReviewed(run);
      MA.workflow.reach(run.runId, step);
      if (unsubscribe) unsubscribe();
      var lastStatus = st.status;
      unsubscribe = MA.minutes.subscribe(function (next) {
        status.draw(next);
        // Conflicts and failures change the banners; plain typing doesn't redraw anything.
        if ((next.status === 'conflict' || lastStatus === 'conflict' || next.status === 'error' || lastStatus === 'error') && next.status !== lastStatus) { lastStatus = next.status; ctx.actions.redrawReview(); }
        lastStatus = next.status;
      });
      var title = summary.title || 'Untitled meeting';
      root.appendChild(ui.pageHeader(title, {
        back: { label: 'Meetings', onClick: function () { ctx.actions.go('meetings'); } },
        meta: append(el('div', null, 'meta'), ui.badge(MA.statusOf(run.status || run.stage)), el('span', [ui.longDate(MA.dashboard.sel.localDay(summary)), summary.attendees.length + ' participant' + (summary.attendees.length === 1 ? '' : 's')].filter(Boolean).join(' · ')),
          ui.avatarStack(summary.attendees.map(function (n) { return { name: n, email: (run.recipients || {})[n] }; })), el('span', null, 'presence', { id: 'presence' }), status.node),
        actions: [ui.button('Version history', 'ghost', function () { ctx.actions.openVersions(); }, { icon: 'history', id: 'versionHistory' }), ctx.actions.meetingMenu(run.runId, title, { id: 'reviewMore', className: 'btn-icon-touch' })],
      }));
      root.appendChild(MA.workflow.stepper(s, ctx.actions));
      root.appendChild(el('p', '', 'sr-only', { id: 'reviewAnnounce', role: 'status', 'aria-live': 'polite' }));
      if (s.notice) root.appendChild(append(el('div', null, null, { style: 'margin-bottom:16px' }), ui.callout(s.notice.kind, s.notice.kind === 'danger' ? 'circle-alert' : 'circle-check', null, s.notice.text)));
      banners(root, st, ctx);

      if (step === 'meeting') root.appendChild(MA.review.steps.meeting(s, ctx));
      else if (step === 'transcript') {
        root.appendChild(MA.review.steps.transcript(s, ctx));
        // The moment opened from a timestamp or a search result stays highlighted (even across a background
        // redraw) until the reviewer leaves this step.
        if (typeof s.focusMs === 'number') MA.store.quiet({ highlightMs: s.focusMs, focusMs: null });
        if (typeof MA.store.get().highlightMs === 'number') {
          var line = MA.review.transcript.highlight(root, MA.store.get().highlightMs);
          if (line) line.setAttribute('tabindex', '-1');
        }
      } else if (step === 'summary') minutesStep(root, s, ctx, 'summary', { readOnly: true });
      else if (step === 'decisions') minutesStep(root, s, ctx, step);
      else {
        // Review: approve the minutes, with the summary right below to correct it first (Edit Summary).
        root.appendChild(MA.review.steps.approval(s, ctx));
        minutesStep(root, s, ctx, 'summary', { inReview: true });
      }
      root.appendChild(MA.workflow.footer(s, ctx.actions));
      if (ctx.actions.reviewMounted) ctx.actions.reviewMounted(root);
    },
    announce: announce,
  };
})();
