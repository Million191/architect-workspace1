// Screen — Send confirmation (approval #2): recipient list + email preview, then "Approve and send".
// In draft-only mode it never says "sent". The approved draft stays visible after approval and refresh.
(function () {
  var ui = MA.ui, el = ui.el, append = ui.append;

  function recipientStatus(run, name) {
    if ((run.sentTo || []).some(function (x) { return x.participantName === name; })) return { label: 'Sent', kind: 'success' };
    if (run.emailMode === 'draft-only') return { label: run.finalApproval ? 'Approved · not sent' : 'Draft', kind: run.finalApproval ? 'success' : 'neutral' };
    return { label: 'Not sent', kind: 'neutral' };
  }

  function preview(run, email) {
    var address = (run.recipients || {})[email.participantName];
    var card = el('article', null, 'card email-preview', { 'aria-label': 'Email to ' + email.participantName, id: 'emailPreview' });
    var headers = el('dl', null, 'email-headers');
    append(headers, el('dt', 'To'), append(el('dd', null, 'email-to'), ui.personChip({ name: email.participantName, email: address }), address ? el('span', ' <' + address + '>', 'muted') : null), el('dt', 'Subject'), el('dd', email.subject, 'email-subject'));
    if (!address) append(headers, el('dt', ''), append(el('dd'), ui.badge({ label: 'No email address given', kind: 'warning' })));
    return append(card, append(el('div', null, 'card-head'), append(el('span', null, 'section-title'), MA.icon('mail'), 'Email preview'), ui.badge(recipientStatus(run, email.participantName))), headers, ui.emailBody(email.body));
  }

  MA.screens.send = {
    title: 'Review and send',
    render: function (root, ctx) {
      var s = ctx.state, run = s.run, draftOnly = run.emailMode === 'draft-only';
      var approved = !!run.finalApproval && (run.stage === 'approved_not_sent' || run.stage === 'sent');
      var title = approved ? (run.minutes.meetingSummary.title || 'Untitled meeting') : 'Review and send';
      var primary = approved
        ? ui.button('Back to meetings', 'primary', function () { ctx.actions.go('meetings'); }, { id: 'primaryAction' })
        : ui.button(draftOnly ? 'Approve (draft only)' : 'Approve and send', 'primary', function () { ctx.actions.approveEmails(); }, { icon: draftOnly ? 'check' : 'send', id: 'primaryAction', disabled: s.busy || !run.emails });
      root.appendChild(ui.pageHeader(title, {
        back: { label: 'Back to review', onClick: function () { ctx.actions.go('review'); } },
        meta: append(el('div', null, 'meta'), ui.badge(MA.statusOf(run.stage)),
          el('span', approved ? 'Approved minutes and email' : draftOnly ? 'Email delivery is off — approving records your sign-off; nothing is sent.' : 'Check exactly what each participant will receive.')),
        actions: [approved ? null : el('span', 'Approval 2 of 2', 'gate-label'), primary].filter(Boolean),
      }));

      if (approved) {
        var a = run.finalApproval, tracked = (run.trackedActionItems || []).length;
        var facts = append(el('dl', null, 'facts'), el('dt', 'Approved by'), el('dd', a.approvedBy), el('dt', 'Approved at'), el('dd', new Date(a.approvedAt).toLocaleString()),
          el('dt', 'Email'), el('dd', draftOnly ? 'Not sent — draft-only mode' : 'Sent to ' + (run.sentTo || []).length + ' of ' + run.emails.emails.length + ' participants'),
          el('dt', 'Action items'), el('dd', tracked + ' recorded'));
        root.appendChild(append(el('div', null, 'final-approval', { style: 'margin-bottom:16px' }), ui.callout('success', 'circle-check', 'Meeting review complete.', facts)));
      }
      if (!run.emails) {
        root.appendChild(ui.callout('warning', 'triangle-alert', 'No email draft to show.', 'This meeting was approved before drafts were saved, so its email can’t be displayed.'));
        return;
      }
      if (run.emails.flaggedForReview) {
        root.appendChild(append(el('div', null, null, { style: 'margin-bottom:16px' }), ui.callout('warning', 'triangle-alert', 'Some action items aren’t in any email.',
          'Their owner isn’t a participant: ' + run.emails.unmatchedActionItems.map(function (u) { return u.actionItem.task; }).join('; ') + '. Add that person as a participant to include them.')));
      }

      var emails = run.emails.emails, selected = Math.min(s.selectedRecipient, emails.length - 1);
      var list = el('ul', null, 'recipient-list', { role: 'listbox', 'aria-label': 'Recipients' });
      emails.forEach(function (e, i) {
        var address = (run.recipients || {})[e.participantName];
        var opt = append(el('button', null, 'recipient', { type: 'button', role: 'option', 'aria-selected': String(i === selected), id: 'recipient-' + i }),
          ui.avatar(MA.people.resolve({ name: e.participantName, email: address }), { decorative: true, size: 'md' }),
          append(el('span', null, 'recipient-meta'), el('span', e.participantName), el('span', address || 'No email address', 'recipient-email')),
          ui.badge(recipientStatus(run, e.participantName)));
        opt.addEventListener('click', function () { ctx.actions.selectRecipient(i); });
        opt.addEventListener('keydown', function (ev) {
          var next = ev.key === 'ArrowDown' ? i + 1 : ev.key === 'ArrowUp' ? i - 1 : -1;
          if (next >= 0 && next < emails.length) { ev.preventDefault(); ctx.actions.selectRecipient(next, true); }
        });
        list.appendChild(append(el('li'), opt));
      });
      var recipients = append(el('section', null, 'card', { 'aria-labelledby': 'recipientsHeading' }),
        append(el('div', null, 'card-head'), append(el('h2', null, 'section-title', { id: 'recipientsHeading' }), 'Recipients', el('span', String(emails.length), 'count'))), list);
      var shown = preview(run, emails[selected]);
      root.appendChild(append(el('div', null, 'send-grid'), recipients, shown));
      // Underline possible mistakes in the subject and body (read-only: the text itself is unchanged).
      MA.spell.decorate(shown.querySelector('.email-subject'));
      MA.spell.decorate(shown.querySelector('.email-body'));
    },
  };
})();
