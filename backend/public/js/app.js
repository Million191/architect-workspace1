// Meeting Assistant — controller: routing, data loading, and every action that talks to the server.
(function () {
  var store = MA.store, ui = MA.ui, api = MA.api;
  var PAGES = ['meetings', 'upload', 'processing', 'review', 'send', 'action-items', 'people', 'settings', 'record'];
  /**
   * Screens redrawn when the People list arrives. Review and send are left alone: redrawing an open
   * meeting would wipe edits in progress (they pick up names on their next render).
   */
  var PEOPLE_PAGES = ['meetings', 'action-items', 'people'];
  var lastPage = null, pollTimer = null, recTimer = null;

  function reviewer() { return (store.get().form.reviewer || '').trim(); }
  function uid() { return window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12); }

  /** Address bar mirrors where you are, so refresh and bookmarks return to the same place. */
  function syncUrl(s) {
    try {
      var url = new URL(window.location.href);
      ['page', 'run', 'view'].forEach(function (k) { url.searchParams.delete(k); });
      if ((s.page === 'review' || s.page === 'send') && s.run) { url.searchParams.set('run', s.run.runId); url.searchParams.set('view', s.page); }
      else if (s.page !== 'meetings' && s.page !== 'processing') url.searchParams.set('page', s.page);
      window.history.replaceState(null, '', url.toString());
    } catch (e) { /* convenience only */ }
  }

  function render() {
    var s = store.get(), content = document.getElementById('content');
    MA.shell.render(s, actions);
    content.replaceChildren();
    MA.screens[s.page].render(content, { state: s, actions: actions });
    syncUrl(s);
    if (lastPage !== s.page) {
      lastPage = s.page;
      content.classList.remove('view-enter');
      void content.offsetWidth;
      content.classList.add('view-enter');
      document.title = MA.screens[s.page].title + ' · Meeting Assistant';
      var h = content.querySelector('.page-title');
      if (h && document.getElementById('searchOverlay').hidden) h.focus({ preventScroll: true }); // never steal focus from the phone search
      if (window.scrollTo) window.scrollTo(0, 0);
    }
  }

  /**
   * Background data (lists, status) only redraws screens that show it. Everything else just refreshes
   * the shell — redrawing an open meeting would wipe edits the reviewer is in the middle of.
   */
  function setBackground(patch, pagesThatShowIt) {
    store.quiet(patch);
    if (pagesThatShowIt.indexOf(store.get().page) !== -1) store.set({}); else MA.shell.render(store.get(), actions);
  }
  function loadLists() {
    var lists = ['meetings', 'action-items'];
    api.meetings().then(function (m) { setBackground({ meetings: m }, lists); }).catch(function () { setBackground({ meetings: [] }, lists); });
    api.actionItems().then(function (a) { setBackground({ actionItems: a }, lists); }).catch(function () { setBackground({ actionItems: [] }, lists); });
    if (actions.calLoadSummary) actions.calLoadSummary();
    loadPeople();
  }
  function loadPeople() {
    return api.people.list().then(function (p) { MA.people.setAll(p); setBackground({ people: p }, PEOPLE_PAGES); })
      .catch(function () { MA.people.setAll([]); setBackground({ people: [] }, PEOPLE_PAGES); });
  }

  function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

  // ---- Saving the minutes before leaving / approving ---------------------------------------------
  /** Everything typed in the minutes editor is on the server (rejects if it can't be saved). */
  function flushSave() {
    var st = MA.minutes && MA.minutes.get();
    return st && st.dirty ? MA.minutes.flush() : Promise.resolve();
  }

  var actions = {
    go: function (page) {
      var s = store.get();
      if (PAGES.indexOf(page) === -1 || ((page === 'review' || page === 'send') && !s.run)) page = 'meetings';
      if (page === 'processing' && !s.upload.id) page = 'upload';
      flushSave().catch(function () { /* the error toast already explains */ });
      if (s.page === 'record' && page !== 'record' && s.rec && s.rec.phase === 'setup') { MA.recorder.stopPreview(); store.quiet({ rec: null }); }
      if (page === 'record' && !s.rec) page = 'meetings';
      store.set({ page: page, notice: null });
      if (page === 'meetings' || page === 'action-items') loadLists();
      if (page === 'people') loadPeople();
    },
    /** opts.focusMs: open the review at that moment of the transcript (from a transcript search result). */
    openMeeting: function (runId, view, opts) {
      return api.getRun(runId).then(function (run) {
        var page = view === 'review' || view === 'send' ? view : run.stage === 'minutes_pending_approval' ? 'review' : 'send';
        store.set({ run: run, page: page, selectedRecipient: 0, save: { state: 'idle' }, notice: null, focusMs: opts && typeof opts.focusMs === 'number' ? opts.focusMs : null });
      }).catch(function (err) {
        store.set({ page: 'meetings' });
        ui.toast(err.status === 404 ? 'That meeting isn’t available anymore. Meetings that weren’t approved are cleared when the server restarts.' : err.message, 'error');
      });
    },
    search: function (q, opts) {
      var s = store.get();
      // The top bar searches meetings, so results always show on the meetings list.
      if (s.page !== 'meetings') { flushSave().catch(function () { /* toast explains */ }); loadLists(); }
      store.set({ query: q, page: 'meetings' });
      if (!(opts && opts.keepFocus)) document.getElementById('search').focus();
    },
    /** A scheduled (not yet recorded) meeting from search: its details over the meetings page. */
    openScheduled: function (id) {
      return api.schedule.get(id).then(function (m) {
        if (store.get().page !== 'meetings') actions.go('meetings');
        actions.calOpenMeeting(m, null);
      }).catch(function (err) { ui.toast(err.status === 404 ? 'That meeting no longer exists.' : err.message, 'error'); });
    },
    setTheme: function (theme) { MA.shell.applyTheme(theme); store.set({ theme: theme }); },
    refreshShell: function () { MA.shell.render(store.get(), actions); },
    selectRecipient: function (i, focus) {
      store.set({ selectedRecipient: i });
      if (focus) { var b = document.getElementById('recipient-' + i); if (b) b.focus(); }
    },

    chooseFile: function (file) { store.setForm({ file: file || null }); store.set({ recording: { active: false, startedAt: null, error: null } }); },
    startRecording: async function () {
      try {
        await MA.audio.start();
        store.set({ recording: { active: true, startedAt: Date.now(), error: null } });
        recTimer = setInterval(function () { var t = document.getElementById('recTimer'); if (t) t.textContent = ui.clock(Date.now() - store.get().recording.startedAt); }, 500);
      } catch (err) {
        store.set({ recording: { active: false, startedAt: null, error: err.message } });
      }
    },
    stopRecording: function () {
      clearInterval(recTimer);
      actions.chooseFile(MA.audio.stop());
    },

    startUpload: async function () {
      var s = store.get();
      if (s.busy || !s.form.file || MA.screens.upload.fileProblem(s.form.file)) return; // one upload at a time
      var id = uid();
      store.set({ busy: true, page: 'processing', upload: { id: id, sentFraction: 0, stage: null, error: null, failedStage: null, startedAt: Date.now() } });
      stopPolling();
      pollTimer = setInterval(function () {
        api.progress(id).then(function (p) {
          var cur = store.get();
          if (cur.upload.id === id && !cur.upload.error) store.set({ upload: Object.assign({}, cur.upload, { stage: p.stage || cur.upload.stage }) });
        }).catch(function () { if (store.get().page === 'processing') store.set({}); });
      }, 1000);
      try {
        var run = await api.draft(s.form, id, function (fraction) {
          var cur = store.get();
          if (cur.upload.id === id && Math.round(fraction * 100) !== Math.round(cur.upload.sentFraction * 100)) store.set({ upload: Object.assign({}, cur.upload, { sentFraction: fraction }) });
        });
        stopPolling();
        store.set({ busy: false, run: run, upload: { id: null, sentFraction: 0, stage: null, error: null, failedStage: null, startedAt: null },
          page: run.stage === 'minutes_pending_approval' ? 'review' : 'send', save: { state: 'idle' }, selectedRecipient: 0 });
        ui.toast(run.stage === 'minutes_pending_approval' ? 'Draft minutes are ready for your review' : 'This recording was already processed — opened its meeting');
        loadLists();
      } catch (err) {
        stopPolling();
        var cur = store.get();
        store.set({ busy: false, upload: Object.assign({}, cur.upload, { error: err.message, failedStage: err.stage || cur.upload.stage }) });
      }
    },

    /** Version history panel; restoring saves first, then makes the chosen version current (as a new version). */
    openVersions: function () {
      var runId = store.get().run.runId;
      flushSave().catch(function () { /* the status shows it; history still opens */ }).then(function () {
        MA.review.versions.open(runId, {
          canRestore: function () { return MA.minutes.editable(); },
          restore: function (n) {
            if (!reviewer()) { ui.toast('Add your name in Settings first — it’s recorded on the change.', 'error'); return; }
            api.minutes.restore(runId, n, { baseRevision: MA.minutes.get().view.revision, editedBy: reviewer() }).then(function (view) {
              MA.cal.dialog.close();
              MA.minutes.replace(view);
              ui.toast('Restored version ' + n + ' — saved as a new version');
              actions.redrawReview();
            }).catch(function (err) { ui.toast(err.message, 'error'); });
          },
        });
      });
    },
    /** After the review screen draws: start telling the server this tab has the draft open. */
    reviewMounted: function () { var run = store.get().run; if (run) MA.review.watchPresence(run.runId); },
    /** Review screen helpers. */
    reviewTab: function (tab) { store.set({ reviewTab: tab === 'transcript' ? 'transcript' : 'minutes' }); },
    redrawReview: function () { if (store.get().page === 'review') store.set({}); },
    reloadMinutes: function () {
      var run = store.get().run;
      return MA.minutes.load(run.runId).then(function () { ui.toast('Loaded the latest version'); actions.redrawReview(); });
    },
    /** "Edit approved minutes": a short reason, then the minutes open for editing as a new version. */
    startAmendment: function () {
      var input = ui.el('textarea', null, 'textarea', { id: 'amendReason', rows: '3', maxlength: '500', placeholder: 'e.g. Corrected the launch date' });
      var error = ui.el('p', '', 'help help-error', { role: 'alert' });
      var go = ui.button('Start editing', 'primary', function () {
        var reason = input.value.trim();
        if (reason.length < 3) { error.textContent = 'Say briefly why the approved minutes are being changed.'; input.focus(); return; }
        if (!reviewer()) { error.textContent = 'Add your name in Settings first — it’s recorded on the change.'; return; }
        go.disabled = true;
        api.minutes.amend(store.get().run.runId, { reason: reason, editedBy: reviewer() }).then(function (view) {
          MA.cal.dialog.close();
          MA.minutes.replace(view);
          ui.toast('Editing approved minutes — changes are saved as a new version');
          actions.redrawReview();
        }).catch(function (err) { go.disabled = false; error.textContent = err.message; });
      }, { id: 'amendStart' });
      MA.cal.dialog.open({ title: 'Edit approved minutes', variant: 'dialog', initialFocus: '#amendReason',
        body: ui.append(ui.el('div', null, 'field'), ui.el('label', 'Why are you changing them?', 'label', { for: 'amendReason' }), input, ui.el('p', 'Shown in the version history and in the updated email to participants.', 'help'), error),
        actions: [ui.button('Cancel', 'secondary', function () { MA.cal.dialog.close(); }), go] });
    },
    finishAmendment: function () {
      return flushSave().then(function () { return api.minutes.finishAmend(store.get().run.runId); }).then(function (view) {
        MA.minutes.replace(view);
        return api.getRun(view.runId);
      }).then(function (run) { store.set({ run: run }); }).catch(function (err) { ui.toast(err.message, 'error'); });
    },
    sendUpdatedMinutes: function () {
      if (!window.confirm('Email the updated minutes to every participant?')) return Promise.resolve();
      return api.minutes.sendUpdate(store.get().run.runId, reviewer()).then(function (res) {
        ui.toast(res.emailMode === 'draft-only' ? 'Updated minutes drafted — not sent (draft-only mode)' : 'Updated minutes sent to ' + res.sentTo.length + ' participant' + (res.sentTo.length === 1 ? '' : 's'));
        return MA.minutes.load(store.get().run.runId);
      }).then(function () { actions.redrawReview(); }).catch(function (err) { ui.toast(err.message, 'error'); });
    },

    /** People list edit: saves, refreshes everyone's names/avatars, confirms with a toast. */
    savePerson: function (id, edit) {
      return api.people.update(id, edit).then(function (res) {
        ui.toast('Saved ' + res.person.name);
        return loadPeople();
      });
    },

    /** "Try again" on the processing screen: a live recording finishes again; an upload re-uploads. */
    retryProcessing: function () {
      var up = store.get().upload;
      if (up.recordingId) return actions.finishRecording(up.recordingId);
      return actions.startUpload();
    },

    approveMinutes: function () { return approve('minutes'); },
    approveEmails: function () { return approve('emails'); },
  };

  /** The words checked before each approval: the minutes the reviewer wrote, or the emails about to go out. */
  function textsToCheck(which, run) {
    if (which === 'emails') return (run.emails ? run.emails.emails : []).reduce(function (all, e) {
      return all.concat([{ where: 'Email to ' + e.participantName + ' (subject)', text: e.subject }, { where: 'Email to ' + e.participantName, text: e.body }]);
    }, []);
    if (MA.minutes.get() && MA.minutes.get().runId === run.runId) return MA.minutes.texts();
    var m = run.minutes, out = [];
    m.discussionTopics.forEach(function (t) { out.push({ where: 'Summary: ' + t.topic, text: t.topic + '. ' + t.summary }); });
    m.decisions.forEach(function (d, i) { out.push({ where: 'Decision ' + (i + 1), text: d.decision + '. ' + (d.rationale || '') }); });
    m.actionItems.forEach(function (a, i) { out.push({ where: 'Action item ' + (i + 1), text: a.task }); });
    return out;
  }

  /**
   * Before an approval: "3 possible spelling mistakes — Review / Approve anyway". Nothing is ever
   * corrected automatically. If the checker is unavailable the approval goes ahead (it is a helper,
   * not a gate) and the reviewer is told.
   */
  function spellingGate(which, run) {
    var items = textsToCheck(which, run).filter(function (x) { return x.text && x.text.trim(); });
    if (!items.length) return Promise.resolve(true);
    return MA.spell.check(items.map(function (x) { return x.text; })).then(function (results) {
      var found = [];
      results.forEach(function (issues, k) { issues.forEach(function (i) { found.push({ where: items[k].where, issue: i }); }); });
      if (!found.length) return true;
      return new Promise(function (resolve) {
        var settled = false;
        function finish(v) { if (settled) return; settled = true; MA.cal.dialog.close(); resolve(v); }
        var list = ui.el('ul', null, 'spell-review-list');
        found.slice(0, 8).forEach(function (f) {
          list.appendChild(ui.append(ui.el('li'), ui.el('strong', f.issue.word), f.issue.suggestions.length ? ' → ' + f.issue.suggestions[0] : '', ui.el('span', ' · ' + f.where, 'muted')));
        });
        if (found.length > 8) list.appendChild(ui.el('li', 'and ' + (found.length - 8) + ' more', 'muted'));
        var body = ui.append(ui.el('div'), ui.el('p', which === 'emails' ? 'Check the email before it goes out. Nothing has been changed.' : 'Check the minutes before approving. Nothing has been changed.', 'help'), list);
        var review = ui.button('Review', 'secondary', function () {
          finish(false);
          var target = which === 'emails' ? document.getElementById('emailPreview') : document.querySelector('.ql-editor[data-spelling-issues]:not([data-spelling-issues="0"]), .has-spelling-issues');
          if (target) { if (target.scrollIntoView) target.scrollIntoView({ block: 'center' }); if (target.focus) target.focus(); }
        }, { id: 'spellReview' });
        var anyway = ui.button(which === 'emails' ? (run.emailMode === 'draft-only' ? 'Approve anyway' : 'Send anyway') : 'Approve anyway', 'primary', function () { finish(true); }, { id: 'spellAnyway' });
        MA.cal.dialog.open({ title: found.length + ' possible spelling mistake' + (found.length === 1 ? '' : 's'), body: body, actions: [review, anyway], variant: 'dialog', initialFocus: '#spellReview', onClose: function () { finish(false); } });
      });
    }).catch(function () {
      ui.toast('Couldn’t check spelling right now — continuing without it.', 'error');
      return true;
    });
  }

  var approving = false;
  async function approve(which) {
    var s = store.get();
    if (approving || s.busy || !s.run) return; // blocks double clicks
    if (!reviewer()) {
      ui.toast('Add your name in Settings before approving — it’s recorded on the approval.', 'error');
      return;
    }
    approving = true;
    try {
      // Save the reviewer's last edit before anything redraws the screen.
      if (which === 'minutes') await flushSave();
    } catch (err) {
      approving = false;
      ui.toast('The minutes couldn’t be saved, so nothing was approved. ' + err.message, 'error');
      return;
    }
    if (which === 'minutes' && MA.minutes.get() && MA.minutes.get().status === 'conflict') { approving = false; ui.toast('Someone else changed these minutes. Reload before approving.', 'error'); return; }
    s = store.get();
    var proceed = await spellingGate(which, s.run);
    if (!proceed) { approving = false; return; }
    store.set({ busy: true, notice: null });
    try {
      var run = which === 'minutes' ? await api.approveMinutes(s.run.runId, reviewer()) : await api.approveEmails(s.run.runId, reviewer());
      if (MA.minutes.get() && MA.minutes.get().runId === run.runId) await MA.minutes.load(run.runId); // now read-only
      store.set({ busy: false, run: run, page: 'send' });
      if (which === 'minutes') ui.toast('Minutes approved — review the email next');
      else ui.toast(run.emailMode === 'draft-only' ? 'Minutes approved — email not sent (draft-only mode)' : 'Minutes sent to ' + (run.sentTo || []).length + ' participant' + ((run.sentTo || []).length === 1 ? '' : 's'));
      loadLists();
    } catch (err) {
      var fresh = null;
      try { fresh = await api.getRun(s.run.runId); } catch (e) { /* keep the original error */ }
      store.set({ busy: false, run: fresh || s.run });
      ui.toast(err.message, 'error');
    } finally {
      approving = false;
    }
  }

  // ---- Start-up ---------------------------------------------------------------------------------
  MA.recordActions.attach(actions, store, api, { loadLists: loadLists });
  MA.cal.attach(actions, store, api);
  MA.cal.attachAdd(actions, store, api);
  MA.cal.attachRecording(actions, store, api);
  MA.cal.attachSync(actions, store, api);
  MA.shell.init(actions);
  store.subscribe(render);
  var params = new URL(window.location.href).searchParams;
  var page = params.get('page');
  store.quiet({ page: PAGES.indexOf(page) !== -1 && page !== 'processing' && page !== 'review' && page !== 'send' ? page : 'meetings' });
  render();
  api.status().then(function (st) { setBackground({ status: st }, ['upload', 'settings', 'send']); }).catch(function () { ui.toast('Could not reach the Meeting Assistant server. Check that it is running.', 'error'); });
  loadLists();
  actions.recFindUnfinished();
  if (params.get('run')) {
    var view = params.get('view');
    actions.openMeeting(params.get('run'), view === 'email' || view === 'complete' ? 'send' : view);
  }
  MA.app = { actions: actions };
})();
