// Review — the guided workflow: Meeting → Transcript → Summary → Decisions & action items → Approval →
// Email. The step bar, Back / Next, which steps can be opened (no skipping review or approval), the
// per-step Edit / Cancel / Save changes mode, "Request changes", and deleting a meeting.
// Everything edited is saved on the server (minutes autosave, transcript and participant APIs), so
// moving between steps or refreshing never loses work.
(function () {
  var ui = MA.ui, el = ui.el, append = ui.append;
  var STEPS = [
    { id: 'meeting', label: 'Meeting' },
    { id: 'transcript', label: 'Transcript' },
    { id: 'summary', label: 'Summary' },
    { id: 'approval', label: 'Review' },
    { id: 'email', label: 'Email' },
  ];
  var ids = STEPS.map(function (s) { return s.id; });
  var snapshot = null; // minutes content when Edit was chosen, for Cancel

  function idx(id) { return ids.indexOf(id); }
  function approved(run) { return !!run && run.stage !== 'minutes_pending_approval'; }
  function key(runId) { return 'ma.wf.' + runId; }
  /** Steps opened in this browser (navigation memory only; the meeting itself is saved on the server). */
  function visited(runId) {
    try { var v = JSON.parse(window.localStorage.getItem(key(runId)) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function reach(runId, id) {
    var v = visited(runId);
    if (v.indexOf(id) !== -1) return;
    try { window.localStorage.setItem(key(runId), JSON.stringify(v.concat(id))); } catch (e) { /* convenience only */ }
  }
  /** The review steps that must each be opened before Approval. */
  var REVIEW = ['transcript', 'summary']; // the action-items step was removed from the review (user request 2026-10-09)
  function reviewed(runId) { var v = visited(runId); return REVIEW.every(function (id) { return v.indexOf(id) !== -1; }); }
  function furthest(runId) { var v = visited(runId); return v.reduce(function (m, id) { return Math.max(m, idx(id)); }, 0); }

  /** The step shown now. */
  function current(s) {
    if (s.page === 'send') return 'email';
    return ids.indexOf(s.reviewStep) !== -1 && s.reviewStep !== 'email' ? s.reviewStep : 'meeting';
  }
  /** Where opening a meeting lands: unapproved → where the reviewer left off; approved → the email. */
  function landing(run) {
    if (approved(run)) return 'email';
    var f = STEPS[furthest(run.runId)].id;
    return f === 'email' || (f === 'approval' && !reviewed(run.runId)) ? 'meeting' : f;
  }
  /**
   * Steps you may open: the reading steps (Meeting → Decisions) freely; Approval only after Transcript,
   * Summary and Decisions have each been opened; the Email only once the minutes are approved.
   */
  function canOpen(run, id) {
    if (id === 'email') return approved(run);
    if (id === 'approval') return approved(run) || reviewed(run.runId);
    return true;
  }

  /** The step bar at the top: done ✓ / current (aria-current="step") / not yet reachable. */
  function stepper(s, actions) {
    var run = s.run, here = current(s);
    var nav = el('nav', null, 'wf-steps', { 'aria-label': 'Review steps' });
    var ol = el('ol');
    STEPS.forEach(function (step, i) {
      var emailDone = run.stage === 'sent' || (run.stage === 'approved_not_sent' && run.emailMode !== 'send');
      var done = approved(run) ? i < idx('email') || (emailDone && i === idx('email')) : visited(run.runId).indexOf(step.id) !== -1 && i < idx('approval');
      var on = step.id === here, open = canOpen(run, step.id);
      var b = el('button', null, 'wf-step' + (on ? ' is-current' : '') + (done && !on ? ' is-done' : ''), { type: 'button', id: 'wfStep-' + step.id, 'aria-label': (step.full || step.label) + (on ? ', current step' : '') });
      if (on) b.setAttribute('aria-current', 'step');
      b.disabled = !open && !on;
      if (b.disabled) b.title = step.id === 'email' ? 'Approve the minutes first' : 'Review the transcript and summary first';
      append(b, el('span', done && !on ? '' : String(i + 1), 'wf-num', { 'aria-hidden': 'true' }), done && !on ? MA.icon('check', 'wf-check') : null,
        el('span', step.label, 'wf-label'), el('span', step.short || step.label, 'wf-short', { 'aria-hidden': 'true' }),
        done && !on ? el('span', ' (done)', 'sr-only') : null);
      if (done && !on) b.querySelector('.wf-num').hidden = true;
      b.addEventListener('click', function () { if (!on) actions.goStep(step.id); });
      ol.appendChild(append(el('li'), b));
    });
    return append(nav, ol);
  }

  /** ← Back / Next → at the bottom. Next on Approval waits for the explicit approval. */
  function footer(s, actions) {
    var run = s.run, here = current(s), i = idx(here);
    var back = i > 0 ? ui.button('Back', 'secondary', function () { actions.goStep(ids[i - 1]); }, { icon: 'arrow-left', id: 'wfBack' }) : ui.button('Meetings', 'secondary', function () { actions.go('meetings'); }, { icon: 'arrow-left', id: 'wfBack' });
    var next;
    if (here === 'approval' && !approved(run)) {
      next = append(el('span', null, 'wf-next-wrap'), el('span', 'Approve the minutes to continue', 'help', { id: 'wfNextHint' }),
        ui.button('Next', 'secondary', null, { iconAfter: 'arrow-right', id: 'wfNext', disabled: true }));
      next.querySelector('#wfNext').setAttribute('aria-describedby', 'wfNextHint');
    } else if (here === 'email') {
      var waiting = run.stage === 'emails_pending_approval' || (run.stage === 'approved_not_sent' && run.emailMode === 'send'); // an email still to send
      next = ui.button('Back to meetings', waiting ? 'secondary' : 'primary', function () { actions.go('meetings'); }, { id: 'wfDone' });
    } else {
      next = ui.button('Next: ' + STEPS[i + 1].label, 'primary', function () { actions.goStep(ids[i + 1]); }, { iconAfter: 'arrow-right', id: 'wfNext' });
    }
    return append(el('div', null, 'wf-footer'), back, next);
  }

  /** The bar above a step's content: its title and what to do, then Edit, or Cancel / Save changes. */
  function stepHead(s, actions, opts) {
    var editing = opts.editingHere !== undefined ? opts.editingHere : s.editing === opts.step;
    var tools = el('div', null, 'wf-tools');
    if (opts.editable !== undefined && !opts.hideEdit) {
      if (editing) {
        append(tools, ui.button('Cancel', 'secondary', function () { actions.cancelEdit(); }, { id: 'editCancel' }),
          ui.button('Save changes', 'primary', function () { actions.saveEdit(); }, { icon: 'check', id: 'editSave' }));
      } else {
        var edit = ui.button(opts.editLabel || 'Edit', 'secondary', function () { actions.startEdit(opts.step); }, { icon: 'pencil', id: 'editStep', disabled: !opts.editable });
        if (!opts.editable && opts.lockedReason) edit.title = opts.lockedReason;
        tools.appendChild(edit);
      }
    }
    return append(el('div', null, 'wf-head' + (editing ? ' is-editing' : '')), append(el('div'), el('h2', opts.title, 'section-title', { id: opts.headingId || 'wfHeading' }), el('p', editing ? opts.editingHelp || 'Make your changes, then Save changes.' : opts.help, 'help')), tools);
  }

  /** A meeting that has been approved was reviewed already: its review steps count as done (e.g. after reopening it). */
  function markReviewed(run) { if (approved(run)) REVIEW.forEach(function (id) { reach(run.runId, id); }); }

  MA.workflow = { markReviewed: markReviewed, STEPS: STEPS, current: current, landing: landing, canOpen: canOpen, stepper: stepper, footer: footer, stepHead: stepHead, approved: approved, reach: reach };

  MA.workflow.attach = function (actions, store, api, hooks) {
    function reviewer() { return (store.get().form.reviewer || '').trim(); }
    function flush() { var st = MA.minutes && MA.minutes.get(); return st && st.dirty ? MA.minutes.flush() : Promise.resolve(); }

    /** Moves to a step: saves first (so Back/Next never lose work), leaves Edit mode, remembers progress. */
    actions.goStep = function (id, opts) {
      var s = store.get();
      if (!s.run || ids.indexOf(id) === -1) return Promise.resolve();
      if (!canOpen(s.run, id) && !(opts && opts.force)) { ui.toast(id === 'email' ? 'Approve the minutes first.' : 'Review the transcript and summary first.', 'error'); return Promise.resolve(); }
      return flush().then(function () {
        reach(s.run.runId, id);
        snapshot = null;
        var edit = opts && opts.edit ? id : null;
        if (edit && MA.minutes.get()) snapshot = JSON.parse(JSON.stringify(MA.minutes.get().content));
        store.set(id === 'email' ? { page: 'send', editing: null, editingSection: null, highlightMs: null } : { page: 'review', reviewStep: id, editing: edit, editingSection: null, highlightMs: id === 'transcript' ? store.get().highlightMs : null });
        var h = document.getElementById('wfHeading') || document.querySelector('.page-title');
        if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
        if (window.scrollTo) window.scrollTo(0, 0);
      }).catch(function (err) { ui.toast('Couldn’t save your changes, so you stayed on this step. ' + err.message, 'error'); });
    };

    /**
     * Edit (a whole step, or one section with opts.sectionId). On approved minutes it warns first:
     * the edits stay in this browser until Save changes, which withdraws the approval.
     */
    actions.startEdit = function (step, opts) {
      var st = MA.minutes.get(), sectionId = opts && opts.sectionId ? opts.sectionId : null;
      var approvedMinutes = st && (st.view.state === 'locked' || st.view.state === 'approved') && (step === 'summary' || step === 'decisions');
      function go() {
        if (approvedMinutes) MA.minutes.beginReopen();
        if (MA.minutes.get()) { snapshot = JSON.parse(JSON.stringify(MA.minutes.get().content)); MA.minutes.startSession(); }
        store.set({ editing: step, editingSection: sectionId });
        var scope = sectionId ? document.querySelector('.md-section[data-id="' + sectionId + '"]') : document;
        var first = scope && scope.querySelector('.ql-editor[contenteditable="true"], .wf-body input:not([readonly]), .wf-body textarea');
        if (first) first.focus();
      }
      if (!approvedMinutes) { go(); return; }
      MA.cal.dialog.open({ title: 'Edit reviewed minutes?', variant: 'dialog', initialFocus: '#reopenCancel',
        body: append(el('div'), el('p', 'Editing reviewed minutes will require approval again.', null, { id: 'reopenWarning' }),
          el('p', 'When you save, the status changes to Needs review, and no email can be sent until the minutes are reviewed again. If you cancel, the current approval stays.', 'help')),
        actions: [ui.button('Cancel', 'secondary', function () { MA.cal.dialog.close(); }, { id: 'reopenCancel' }),
          ui.button('Edit anyway', 'primary', function () { MA.cal.dialog.close(); go(); }, { icon: 'pencil', id: 'reopenContinue' })] });
    };
    /** Cancel: puts the minutes back exactly as they were when Edit was chosen (and saves that). */
    actions.cancelEdit = function () {
      var step = store.get().editing;
      if (snapshot && (step === 'summary' || step === 'decisions') && MA.minutes.editable() && !(MA.minutes.isReopening && MA.minutes.isReopening())) {
        var snap = snapshot;
        if (JSON.stringify(snap) !== JSON.stringify(MA.minutes.get().content)) MA.minutes.edit(function (c) { c.sections = snap.sections; c.actionItems = snap.actionItems; });
      }
      snapshot = null;
      if (MA.review.steps) MA.review.steps.reset(); // typed-but-unsaved meeting/transcript edits are dropped
      if (MA.minutes.isReopening && MA.minutes.isReopening()) { MA.minutes.cancelReopen(); store.set({ editing: null, editingSection: null }); return Promise.resolve(); }
      store.set({ editing: null, editingSection: null });
      return flush().catch(function () { /* the save status explains */ });
    };
    /** Save changes: for the minutes steps, everything is written to the server before leaving Edit mode. */
    actions.saveEdit = function () {
      var step = store.get().editing;
      if (step === 'meeting' || step === 'transcript') return MA.review.steps.save(step);
      var reopening = MA.minutes.isReopening && MA.minutes.isReopening();
      // Approved minutes: Save changes withdraws the approval first, then saves (Needs review again).
      var saved = reopening ? MA.minutes.commitReopen(reviewer()) : flush();
      return saved.then(function () {
        snapshot = null;
        return refreshRun();
      }).then(function () {
        store.set({ editing: null, editingSection: null });
        ui.toast(reopening ? 'Saved — the minutes need approval again (Needs review)' : 'Changes saved');
        if (reopening && hooks && hooks.loadLists) hooks.loadLists();
      }).catch(function (err) { ui.toast('Couldn’t save: ' + err.message, 'error'); });
    };
    function refreshRun() {
      var s = store.get();
      if (!s.run) return Promise.resolve();
      return api.getRun(s.run.runId).then(function (run) { if (store.get().run && store.get().run.runId === run.runId) store.set({ run: run }); });
    }
    actions.refreshRun = refreshRun;
    /** Leaves Edit mode once the saved meeting is back from the server, so the page never flashes the old text. */
    actions.endEdit = function (message) {
      snapshot = null;
      var s = store.get();
      if (!s.run) { store.set({ editing: null }); return Promise.resolve(); }
      return api.getRun(s.run.runId).then(function (run) { store.set({ run: run, editing: null }); }, function () { store.set({ editing: null }); })
        .then(function () { if (message) ui.toast(message); });
    };

    /** "Request changes": recorded on the draft; nothing is approved; the meeting shows In progress. */
    actions.requestChanges = function () {
      var s = store.get();
      var box = el('textarea', null, 'textarea', { id: 'changesNote', rows: '4', maxlength: '2000', 'aria-describedby': 'changesHelp' });
      var error = el('p', '', 'help help-error', { role: 'alert' });
      var send = ui.button('Request changes', 'primary', function () {
        if (!box.value.trim()) { error.textContent = 'Say what needs to change.'; box.focus(); return; }
        send.disabled = true;
        api.requestChanges(s.run.runId, box.value.trim(), reviewer() || undefined).then(function (run) {
          MA.cal.dialog.close();
          store.set({ run: run });
          ui.toast('Change request recorded — the minutes stay unreviewed');
          if (hooks && hooks.loadLists) hooks.loadLists();
        }).catch(function (err) { send.disabled = false; error.textContent = err.message; });
      }, { id: 'changesSend' });
      MA.cal.dialog.open({ title: 'Request changes', variant: 'dialog', initialFocus: '#changesNote',
        body: append(el('div', null, 'field'), el('label', 'What needs to change?', 'label', { for: 'changesNote' }), box,
          el('p', 'It’s recorded with the draft and shown on the Approval step until the minutes are edited.', 'help', { id: 'changesHelp' }), error),
        actions: [ui.button('Cancel', 'secondary', function () { MA.cal.dialog.close(); }), send] });
    };

    /** "Delete meeting" (from ••• More), only after confirmation. */
    actions.deleteMeeting = function (runId, title) {
      var confirmBtn = ui.button('Delete meeting', 'danger', function () {
        confirmBtn.disabled = true;
        api.deleteMeeting(runId).then(function () {
          MA.cal.dialog.close();
          try { window.localStorage.removeItem(key(runId)); window.localStorage.removeItem('ma.minutes.' + runId); } catch (e) { /* convenience only */ }
          var s = store.get();
          var patch = { meetings: (s.meetings || []).filter(function (m) { return m.runId !== runId; }) };
          if (s.run && s.run.runId === runId) Object.assign(patch, { run: null, page: 'meetings', editing: null });
          store.set(patch);
          ui.toast('Deleted “' + (title || 'Untitled meeting') + '”');
          if (hooks && hooks.loadLists) hooks.loadLists();
          var h = document.querySelector('.page-title');
          if (h) h.focus();
        }).catch(function (err) { confirmBtn.disabled = false; ui.toast('Couldn’t delete: ' + err.message, 'error'); });
      }, { id: 'confirmDelete', icon: 'trash' });
      MA.cal.dialog.open({ title: 'Delete this meeting?', variant: 'dialog', initialFocus: '#cancelDelete',
        body: el('p', 'This meeting, its transcript, and its minutes will be removed. This action cannot be undone.'),
        actions: [ui.button('Cancel', 'secondary', function () { MA.cal.dialog.close(); }, { id: 'cancelDelete' }), confirmBtn] });
    };

    /** ••• More for a meeting: Edit meeting / Delete meeting (kept away from the primary actions). */
    actions.meetingMenu = function (runId, title, opts) {
      return MA.menu.button(opts && opts.label ? opts.label : null, 'ghost', [
        { label: 'Edit meeting', icon: 'pencil', run: function () { actions.openMeeting(runId, 'review', { step: 'meeting', edit: true }); } },
        { label: 'Delete meeting', icon: 'trash', danger: true, run: function () { actions.deleteMeeting(runId, title); } },
      ], { icon: 'more-horizontal', id: opts && opts.id, ariaLabel: 'More actions for ' + (title || 'this meeting'), className: (opts && opts.className) || '' });
    };
  };
})();
