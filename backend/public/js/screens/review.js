// Screen — Review: transcript and editable minutes (sections + action items), autosave with a
// visible status, approval lock and "Edit approved minutes", conflict and recovery notices.
// On phones the transcript and minutes are tabs.
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
    if (v.state === 'locked') box.appendChild(ui.callout('info', 'lock', 'Minutes approved.', 'Review and approve the email next. After it’s approved, you can still edit the minutes with a reason.'));
    if (v.state === 'approved' && v.approval) box.appendChild(ui.callout('success', 'lock', 'Approved by ' + v.approval.by + ' on ' + new Date(v.approval.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) + '.', 'These minutes are read-only.'));
    if (v.state === 'amending') {
      box.appendChild(ui.callout('warning', 'pencil', 'Editing approved minutes.', append(el('span'), 'Reason: ' + v.amending.reason + '. ',
        ui.button('Done editing', 'secondary', function () { ctx.actions.finishAmendment(); }, { size: 'sm', id: 'finishAmendment' }))));
    }
    if (v.pendingUpdateEmail && v.state !== 'amending') {
      box.appendChild(ui.callout('info', 'mail', 'The approved minutes changed.', append(el('span'), 'Send participants the updated minutes? ',
        ui.button('Send updated minutes', 'primary', function () { ctx.actions.sendUpdatedMinutes(); }, { size: 'sm', id: 'sendUpdate' }))));
    }
    if (v.outOfDateTranslations && v.outOfDateTranslations.length) box.appendChild(ui.callout('warning', 'triangle-alert', 'Translations are out of date.', v.outOfDateTranslations.join(', ').toUpperCase() + ' — update them after editing.'));
    if (v.state === 'draft' && !st.dirty && st.status === 'idle') box.appendChild(ui.callout('info', 'triangle-alert', 'AI-drafted.', 'Check everything against the transcript and edit anything that’s wrong. Changes save automatically. Nothing is shared until you approve.'));
    if (box.childNodes.length) root.appendChild(box);
  }

  function primaryAction(s, v, ctx) {
    if (v.state === 'draft') return [el('span', 'Approval 1 of 2', 'gate-label'), ui.button('Approve minutes', 'primary', function () { ctx.actions.approveMinutes(); }, { icon: 'check', id: 'primaryAction', disabled: s.busy })];
    if (v.state === 'locked') return [ui.button('Review email', 'primary', function () { ctx.actions.go('send'); }, { iconAfter: 'arrow-right', id: 'primaryAction' })];
    if (v.state === 'approved') return [ui.button('Edit approved minutes', 'secondary', function () { ctx.actions.startAmendment(); }, { icon: 'pencil', id: 'editApproved' }), ui.button('View email', 'primary', function () { ctx.actions.go('send'); }, { iconAfter: 'arrow-right', id: 'primaryAction' })];
    return [ui.button('Done editing', 'primary', function () { ctx.actions.finishAmendment(); }, { icon: 'check', id: 'primaryAction' })];
  }

  function minutesArea(root, s, ctx) {
    var st = MA.minutes.get(), v = st.view, editable = MA.minutes.editable(), run = s.run;
    var attendees = run.minutes.meetingSummary.attendees.map(function (n) { return { name: n, email: (run.recipients || {})[n] }; });
    var jump = function (ms) { ctx.actions.reviewTab('transcript'); MA.review.transcript.highlight(root, ms); };
    var panel = el('div', null, 'minutes-panel', { id: 'minutesPanel' });
    var sectionsHost = el('div'), itemsHost = el('div');
    function redraw(focusId, message) {
      sectionsHost.replaceChildren();
      MA.review.sections.render(sectionsHost, { editable: editable, jump: jump, redraw: redraw, extraHead: MA.review.sectionExtras });
      if (message) announce(message);
      var f = focusId && document.getElementById(focusId);
      if (f) f.focus();
    }
    redraw();
    MA.review.actionItems.render(itemsHost, { editable: editable, attendees: attendees, jump: jump, announce: announce });
    append(panel, sectionsHost, itemsHost);
    return { panel: panel, insert: function (sectionId, html, title) {
      if (!MA.review.sections.appendTo(sectionId, html)) return;
      ui.toast('Added to “' + (title || 'section') + '”');
      window.getSelection && window.getSelection().removeAllRanges();
    }, insertNew: function (html) {
      var id = MA.minutes.newId();
      MA.minutes.edit(function (c) { c.sections.push({ id: id, kind: 'notes', title: 'Notes', html: html }); });
      redraw('mdTitle-' + id, 'Notes section added');
      ui.toast('Added to a new “Notes” section');
    } };
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
      var v = st.view, status = statusNode();
      if (unsubscribe) unsubscribe();
      var lastStatus = st.status;
      unsubscribe = MA.minutes.subscribe(function (next) {
        status.draw(next);
        // Conflicts and failures change the banners; plain typing doesn't redraw anything.
        if ((next.status === 'conflict' || lastStatus === 'conflict' || next.status === 'error' || lastStatus === 'error') && next.status !== lastStatus) { lastStatus = next.status; ctx.actions.redrawReview(); }
        lastStatus = next.status;
      });
      root.appendChild(ui.pageHeader(summary.title || 'Untitled meeting', {
        back: { label: 'Meetings', onClick: function () { ctx.actions.go('meetings'); } },
        meta: append(el('div', null, 'meta'), ui.badge(MA.statusOf(run.stage)), el('span', [ui.longDate(summary.date), summary.attendees.length + ' participant' + (summary.attendees.length === 1 ? '' : 's')].filter(Boolean).join(' · ')),
          ui.avatarStack(summary.attendees.map(function (n) { return { name: n, email: (run.recipients || {})[n] }; })), el('span', null, 'presence', { id: 'presence' }), status.node),
        actions: [ui.button('Version history', 'ghost', function () { ctx.actions.openVersions(); }, { icon: 'history', id: 'versionHistory' })].concat(primaryAction(s, v, ctx)),
      }));
      root.appendChild(el('p', '', 'sr-only', { id: 'reviewAnnounce', role: 'status', 'aria-live': 'polite' }));
      if (s.notice) root.appendChild(append(el('div', null, null, { style: 'margin-bottom:16px' }), ui.callout(s.notice.kind, s.notice.kind === 'danger' ? 'circle-alert' : 'circle-check', null, s.notice.text)));
      banners(root, st, ctx);

      // Phones: Transcript | Minutes tabs (CSS shows both side by side on wider screens).
      var tab = s.reviewTab || 'minutes';
      var tabs = el('div', null, 'review-tabs', { role: 'tablist', 'aria-label': 'Review' });
      [['transcript', 'Transcript'], ['minutes', 'Minutes']].forEach(function (t) {
        var b = el('button', t[1], 'review-tab', { type: 'button', role: 'tab', id: 'tab-' + t[0], 'aria-selected': String(tab === t[0]), 'aria-controls': t[0] === 'transcript' ? 'transcriptPanel' : 'minutesPanel', tabindex: tab === t[0] ? '0' : '-1' });
        b.addEventListener('click', function () { ctx.actions.reviewTab(t[0]); });
        b.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); ctx.actions.reviewTab(t[0] === 'minutes' ? 'transcript' : 'minutes'); var other = document.getElementById('tab-' + (t[0] === 'minutes' ? 'transcript' : 'minutes')); if (other) other.focus(); } });
        tabs.appendChild(b);
      });
      root.appendChild(tabs);
      var minutes = minutesArea(root, s, ctx);
      var transcript = MA.review.transcript.render(run, { editable: MA.minutes.editable(), insert: minutes.insert, insertNew: minutes.insertNew, headExtra: MA.review.transcriptExtras ? MA.review.transcriptExtras(run) : null });
      transcript.setAttribute('role', 'tabpanel');
      minutes.panel.setAttribute('role', 'tabpanel');
      var grid = append(el('div', null, 'review-grid review-tab-' + tab), transcript, minutes.panel);
      root.appendChild(grid);
      if (typeof s.focusMs === 'number') {
        var focusMs = s.focusMs;
        MA.store.quiet({ focusMs: null, reviewTab: 'transcript' });
        grid.className = 'review-grid review-tab-transcript';
        var line = MA.review.transcript.highlight(root, focusMs);
        if (line) line.setAttribute('tabindex', '-1');
      }
      if (ctx.actions.reviewMounted) ctx.actions.reviewMounted(root);
    },
    announce: announce,
  };
})();
