// Screen — Processing: real progress only (bytes uploaded, then the stage the server reports),
// with skeletons of the review layout instead of a blank spinner.
(function () {
  var ui = MA.ui, el = ui.el, append = ui.append;
  var STEPS = [
    { title: 'Uploading', done: 'Uploaded', detail: 'Sending the recording to the server.' },
    { title: 'Transcribing', done: 'Transcribed', detail: 'Turning speech into text with timestamps. Long recordings take a few minutes.' },
    { title: 'Drafting minutes', done: 'Minutes drafted', detail: 'Writing the summary and pulling out decisions and action items from the transcript.' },
  ];
  var DRAFTING = ['speaker identification', 'meeting summary', 'unclear-audio marking', 'discussion summary', 'decision extraction', 'action item extraction', 'minutes review gate'];

  /** Which step is happening now, from the real upload state. */
  function currentStep(up) {
    var stage = up.error ? up.failedStage || up.stage : up.stage;
    if (stage === 'transcription') return 1;
    if (DRAFTING.indexOf(stage) !== -1) return 2;
    if (stage === 'audio ingestion') return up.error ? 0 : 1;
    return 0;
  }

  function skeletonCard(lines) {
    var card = el('div', null, 'card card-pad', { 'aria-hidden': 'true' });
    lines.forEach(function (w) { card.appendChild(el('span', null, 'skeleton skeleton-line', { style: 'width:' + w + '%' })); });
    return card;
  }

  MA.screens.processing = {
    title: 'Processing meeting',
    render: function (root, ctx) {
      var s = ctx.state, up = s.upload, failed = !!up.error;
      var actions = failed
        ? [up.recordingId ? null : ui.button('Edit details', 'secondary', function () { ctx.actions.go('upload'); }), ui.button('Try again', 'primary', function () { ctx.actions.retryProcessing(); }, { icon: 'refresh-cw', id: 'primaryAction', disabled: s.busy })].filter(Boolean)
        : [];
      root.appendChild(ui.pageHeader((up.recordingId ? up.title : s.form.title) || 'Processing meeting', {
        meta: append(el('p', null, 'meta'), failed ? ui.badge({ label: 'Needs attention', kind: 'danger' }) : ui.badge({ label: 'Processing', kind: 'neutral' }),
          el('span', up.recordingId ? 'Live recording' : s.form.file ? s.form.file.name : '')),
        actions: actions,
      }));
      if (failed) {
        root.appendChild(append(el('div', null, null, { style: 'margin-bottom:16px' }),
          ui.callout('danger', 'circle-alert', STEPS[currentStep(up)].title + ' didn’t finish.', up.error + ' Your recording and details are still here — try again, or edit the details first.')));
      }

      var at = currentStep(up);
      var list = el('ol', null, 'process-steps', { 'aria-label': 'Progress' });
      STEPS.forEach(function (step, i) {
        var state = i < at ? 'is-done' : i === at ? (failed ? 'is-failed' : 'is-active') : 'is-pending';
        var mark = el('span', null, 'step-mark', { 'aria-hidden': 'true' });
        if (state === 'is-done') mark.appendChild(MA.icon('check'));
        if (state === 'is-failed') mark.appendChild(MA.icon('x'));
        var body = append(el('div'), el('div', state === 'is-done' ? step.done : step.title, 'step-title'));
        if (state === 'is-active' || state === 'is-failed') body.appendChild(el('div', step.detail, 'step-detail'));
        if (i === 0 && state === 'is-active') {
          var pct = Math.round(up.sentFraction * 100);
          var bar = el('div', null, 'progress', { role: 'progressbar', 'aria-label': 'Upload progress', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) });
          bar.appendChild(el('div', null, 'progress-bar', { style: 'width:' + pct + '%' }));
          body.appendChild(bar);
        }
        var li = append(el('li', null, 'process-step ' + state), mark, body);
        if (state === 'is-active') li.setAttribute('aria-current', 'step');
        list.appendChild(li);
      });
      var progressCard = append(el('section', null, 'card card-pad', { 'aria-live': 'polite' }), list);
      if (!failed && up.offline) progressCard.appendChild(ui.callout('warning', 'triangle-alert', 'You’re offline.', 'The rest of the recording is saved on this device and will upload as soon as the connection is back.'));
      if (!failed && up.startedAt) progressCard.appendChild(el('p', ui.clock(Date.now() - up.startedAt) + ' elapsed · keep this tab open', 'help', { style: 'margin-top:16px' }));
      root.appendChild(progressCard);
      if (!failed) root.appendChild(append(el('div', null, 'skeleton-grid'), skeletonCard([30, 90, 80, 85, 60, 90, 70]), skeletonCard([40, 95, 85, 50, 90, 75])));
    },
  };
})();
