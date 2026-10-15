// Screen — the Email step (approval #2): recipients, the full email (To / Subject / body), Edit email,
// then "Approve & send". In draft-only mode it never says "sent": it says "Draft created — sending is
// disabled." The approved draft stays visible after approval and refresh.
(function () {
  var ui = MA.ui, el = ui.el, append = ui.append;
  var draft = null; // the email being edited: { runId, name, subject, body }

  var EMAIL_RE = /^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$/;

  /** "Add email" for a participant without one (name fixed). */
  function addressDialog(run, name) {
    var emailInput = el('input', null, 'input', { id: 'recipientEmail', type: 'email', maxlength: '320', placeholder: 'name@example.com', autocomplete: 'off' });
    var error = el('p', '', 'help help-error', { role: 'alert', id: 'recipientError' });
    var save = ui.button('Save email', 'primary', function () {
      var email = emailInput.value.trim();
      if (!EMAIL_RE.test(email)) { error.textContent = 'Type a valid email address, like name@example.com.'; emailInput.focus(); return; }
      save.disabled = true;
      MA.api.addRecipient(run.runId, name, email, (MA.store.get().form.reviewer || '').trim() || undefined).then(function (fresh) {
        MA.cal.dialog.close();
        var i = fresh.emails.emails.findIndex(function (e) { return e.participantName === name; });
        MA.store.set({ run: fresh, selectedRecipient: Math.max(0, i) });
        ui.toast('Email address saved for ' + name);
      }).catch(function (err) { save.disabled = false; error.textContent = err.message; });
    }, { id: 'recipientAdd', icon: 'check' });
    MA.cal.dialog.open({ title: 'Add an email address for ' + name, variant: 'dialog', initialFocus: '#recipientEmail',
      body: append(el('div', null, 'recipient-form'), el('p', 'The minutes can be sent to ' + name + ' once they have an address.', 'help'),
        append(el('div', null, 'field'), el('label', 'Email', 'label', { for: 'recipientEmail' }), emailInput), error),
      actions: [ui.button('Cancel', 'secondary', function () { MA.cal.dialog.close(); }), save] });
  }

  /** Every address in pasted text: "a@x.com, b@y.com", one per line, or "Name <a@x.com>". */
  function emailsIn(text) { return (String(text).match(/[^\s<>,;"']+@[^\s<>,;"']+\.[^\s<>,;"']+/g) || []).map(function (e) { return e.replace(/[.)]+$/, ''); }); }

  /**
   * "Add recipients": email addresses only — one per row, "Add another email", one button for all.
   * Pasting several addresses fills one row each. The greeting name comes from the address.
   */
  function recipientsDialog(run) {
    var rows = el('div', null, 'recipient-rows', { role: 'group', 'aria-label': 'Email addresses to add' });
    var error = el('p', '', 'help help-error', { role: 'alert', id: 'recipientError' });
    var add = ui.button('', 'primary', function () { submit(); }, { id: 'recipientAdd', icon: 'plus' });
    var n = 0;
    function filled() {
      return Array.prototype.map.call(rows.querySelectorAll('.recipient-email'), function (input) {
        var typed = input.value.trim(), known = personNamed(typed); // "Sara" → Sara's address from People
        return { input: input, email: known ? known.email : typed, name: input.dataset.name || (known ? known.name : undefined) };
      }).filter(function (p) { return p.email; });
    }
    function label() {
      var count = filled().length;
      add.replaceChildren(MA.icon('plus'), document.createTextNode(count > 1 ? 'Add ' + count + ' recipients' : 'Add recipient'));
    }
    function addRow(focus, value) {
      var i = n++;
      var email = el('input', null, 'input recipient-email', { id: 'recipientEmail-' + i, type: 'text', maxlength: '320', placeholder: 'Name or email, e.g. Sara or name@example.com', autocomplete: 'off', 'aria-label': 'Name or email address ' + (i + 1) });
      if (value) email.value = value;
      var suggestBox = peopleSuggest(email, run, function () { label(); });
      var row = append(el('div', null, 'recipient-row'), append(el('div', null, 'chip-field recipient-field'), email, suggestBox),
        ui.button(null, 'ghost', function () { if (rows.children.length > 1) { row.remove(); label(); } }, { icon: 'x', size: 'sm', ariaLabel: 'Remove email address ' + (i + 1) }));
      email.addEventListener('input', label);
      email.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
      email.addEventListener('paste', function (e) {
        var found = emailsIn((e.clipboardData || window.clipboardData).getData('text'));
        if (found.length < 2) return; // one address pastes normally
        e.preventDefault();
        email.value = found[0];
        found.slice(1).forEach(function (f) { addRow(false, f); });
        label();
      });
      rows.appendChild(row);
      if (focus) email.focus();
      return row;
    }
    function submit() {
      var list = filled();
      error.textContent = '';
      if (!list.length) { error.textContent = 'Type at least one email address.'; return; }
      var bad = list.filter(function (p) { return !EMAIL_RE.test(p.email); });
      if (bad.length) { error.textContent = bad.length === 1 ? '“' + bad[0].email + '” isn’t a valid email address or a person in People.' : bad.length + ' entries aren’t valid email addresses or people in People.'; bad[0].input.focus(); return; }
      var seen = {}, dup = list.filter(function (p) { var k = p.email.toLowerCase(); if (seen[k]) return true; seen[k] = true; return false; })[0];
      if (dup) { error.textContent = dup.email + ' is listed twice.'; dup.input.focus(); return; }
      add.disabled = true;
      MA.api.addRecipients(run.runId, list.map(function (p) { return p.name ? { name: p.name, email: p.email } : { email: p.email }; }), (MA.store.get().form.reviewer || '').trim() || undefined).then(function (fresh) {
        MA.cal.dialog.close();
        var last = list[list.length - 1].email.toLowerCase(), to = fresh.recipients || {};
        var i = fresh.emails.emails.findIndex(function (e) { return (to[e.participantName] || '').toLowerCase() === last; });
        MA.store.set({ run: fresh, selectedRecipient: Math.max(0, i) });
        ui.toast(list.length === 1 ? (list[0].name || list[0].email) + ' will receive the minutes' : list.length + ' people will receive the minutes');
      }).catch(function (err) { add.disabled = false; error.textContent = err.message; });
    }
    addRow(false);
    MA.api.people.list().then(function (p) { MA.people.setAll(p); }).catch(function () { /* suggestions use the list already loaded */ });
    var more = ui.button('Add another email', 'ghost', function () { addRow(true); label(); }, { icon: 'plus', size: 'sm', id: 'recipientMore' });
    MA.cal.dialog.open({ title: 'Add recipients', variant: 'dialog', initialFocus: '#recipientEmail-0',
      body: append(el('div', null, 'recipient-form'),
        el('p', 'Type a name from People (e.g. Sara) and pick them, or type an email address. Each person gets their own email with the reviewed minutes. Tip: paste several addresses at once.', 'help'),
        append(el('label', 'Names or email addresses', 'label', { for: 'recipientEmail-0' })),
        rows, more, error),
      actions: [ui.button('Cancel', 'secondary', function () { MA.cal.dialog.close(); }), add] });
    label();
  }

  /**
   * People suggestions for an email box: typing a name or part of an address lists matching people from
   * People (name + email); picking one fills the address and remembers the name for the greeting.
   * Arrow keys move, Enter picks, Esc closes. People already receiving this email aren't suggested.
   */
  function peopleSuggest(input, run, onPick) {
    var listId = input.id + '-suggest', box = el('ul', null, 'suggest-list', { id: listId, role: 'listbox', 'aria-label': 'People', hidden: '' });
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-controls', listId); input.setAttribute('aria-expanded', 'false');
    var options = [], active = 0;
    function close() { box.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); }
    function pick(p) { input.value = p.email; input.dataset.name = p.name; close(); onPick(p); }
    function draw() {
      var taken = Object.keys(run.recipients || {}).map(function (n) { return run.recipients[n]; });
      options = EMAIL_RE.test(input.value.trim()) ? [] : MA.people.suggest(input.value, taken);
      box.replaceChildren();
      if (!options.length) { close(); return; }
      active = Math.min(active, options.length - 1);
      options.forEach(function (p, i) {
        var r = MA.people.resolve({ name: p.name, email: p.email });
        var li = append(el('li', null, 'suggest-item', { role: 'option', id: listId + '-' + i, 'aria-selected': String(i === active) }), ui.avatar(r, { decorative: true, size: 'md' }),
          append(el('span', null, 'people-list-text'), el('span', p.name, 'person-name'), el('span', p.email + (p.role ? ' · ' + p.role : ''), 'person-email')));
        li.addEventListener('mousedown', function (e) { e.preventDefault(); pick(p); });
        box.appendChild(li);
      });
      box.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      input.setAttribute('aria-activedescendant', listId + '-' + active);
    }
    input.addEventListener('input', function () { delete input.dataset.name; active = 0; draw(); });
    input.addEventListener('blur', function () { setTimeout(close, 100); });
    input.addEventListener('keydown', function (e) {
      if (box.hidden) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); active = (active + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length; draw(); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); if (options[active]) pick(options[active]); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    });
    return box;
  }
  /** A typed name that exactly matches one person in People → that person (else undefined). */
  function personNamed(text) {
    var q = text.trim().toLowerCase();
    if (!q || EMAIL_RE.test(q)) return undefined;
    var hits = MA.people.suggest(q).filter(function (p) { return p.name.toLowerCase() === q; });
    return hits.length === 1 ? hits[0] : undefined;
  }

  function recipientStatus(run, name) {
    if ((run.sentTo || []).some(function (x) { return x.participantName === name; })) return { label: 'Sent', kind: 'success' };
    if (run.emailMode === 'draft-only') return { label: run.finalApproval ? 'Reviewed · not sent' : 'Draft', kind: run.finalApproval ? 'success' : 'neutral' };
    return { label: 'Not sent', kind: 'neutral' };
  }

  function preview(s, run, email, ctx, canAdd) {
    var address = (run.recipients || {})[email.participantName];
    var editing = s.editing === 'email' && draft && draft.runId === run.runId && draft.name === email.participantName;
    var card = el('article', null, 'card email-preview', { 'aria-label': 'Email to ' + email.participantName, id: 'emailPreview' });
    var headers = el('dl', null, 'email-headers');
    var subject;
    if (editing) {
      subject = el('input', null, 'input', { id: 'emailSubject', type: 'text', maxlength: '300', 'aria-label': 'Subject' });
      subject.value = draft.subject;
      subject.addEventListener('input', function () { draft.subject = subject.value; });
    }
    append(headers, el('dt', 'To'), append(el('dd', null, 'email-to'), ui.personChip({ name: email.participantName, email: address }), address ? el('span', ' <' + address + '>', 'muted') : null),
      el('dt', 'Subject'), editing ? append(el('dd'), subject) : el('dd', email.subject, 'email-subject'));
    if (!address) append(headers, el('dt', ''), append(el('dd', null, 'email-missing'), ui.badge({ label: 'No email address given', kind: 'warning' }),
      canAdd ? ui.button('Add email', 'secondary', function () { addressDialog(run, email.participantName); }, { size: 'sm', icon: 'plus', id: 'addEmailFor' }) : null));
    var tools = el('div', null, 'wf-tools');
    if (editing) {
      append(tools, ui.button('Cancel', 'secondary', function () { draft = null; MA.store.set({ editing: null }); }, { id: 'emailCancel', size: 'sm' }),
        ui.button('Save changes', 'primary', function () { ctx.actions.saveEmail(); }, { icon: 'check', id: 'emailSave', size: 'sm' }));
    } // not editing: no status badge here — each person's Sent / Not sent shows once, in the recipient list
    var body;
    if (editing) {
      body = el('textarea', null, 'textarea email-edit', { id: 'emailBody', rows: '16', 'aria-label': 'Email body' });
      body.value = draft.body;
      body.addEventListener('input', function () { draft.body = body.value; });
    } else body = ui.emailBody(email.body);
    return append(card, append(el('div', null, 'card-head'), append(el('span', null, 'section-title'), MA.icon('mail'), editing ? 'Edit email' : 'Email preview'), tools), headers, body,
      editing ? el('p', '', 'help help-error', { role: 'alert', id: 'emailError' }) : null);
  }

  /**
   * Already emailed: send the same reviewed minutes to people who haven't received it yet — someone
   * who was missed, someone whose address was added later, or a newly added recipient.
   */
  function sendMoreBar(s, run, ctx) {
    var sent = (run.sentTo || []).map(function (x) { return x.participantName; });
    var waiting = run.emails.emails.filter(function (e) { return sent.indexOf(e.participantName) === -1; });
    var ready = waiting.filter(function (e) { return (run.recipients || {})[e.participantName]; });
    var hint = !waiting.length ? 'Everyone on the list has the email. Use “Add” above to include someone who was missed.'
      : !ready.length ? 'Not sent yet: ' + waiting.map(function (e) { return e.participantName; }).join(', ') + '. Add an email address for them first.'
        : 'Not sent yet: ' + waiting.map(function (e) { return e.participantName; }).join(', ') + '.';
    return append(el('div', null, 'wf-approve-actions email-actions send-more'),
      append(el('div', null, 'send-more-text'), el('strong', 'Missed someone?'), el('span', hint, 'help', { id: 'sendMoreHint' })),
      el('span', null, 'wf-spacer'),
      ui.button(ready.length ? 'Send to ' + ready.length + ' more' : 'Send to more people', 'primary', function () { return ctx.actions.approveEmails(); },
        { icon: 'send', id: 'sendMore', disabled: s.busy || !ready.length, ariaLabel: 'Send the reviewed minutes to people who haven’t received them' }));
  }

  /** Back to review · Edit email · Approve & send (or, in draft-only mode, Approve draft). */
  function decision(s, run, email, ctx, sendLater) {
    var draftOnly = run.emailMode === 'draft-only';
    return append(el('div', null, 'wf-approve-actions email-actions'),
      ui.button('Back to review', 'secondary', function () { ctx.actions.goStep('approval'); }, { icon: 'arrow-left', id: 'backToReview' }),
      // The email of an already-approved meeting is exactly what was approved: it can be sent, not edited.
      sendLater ? null : ui.button('Edit email', 'secondary', function () {
        draft = { runId: run.runId, name: email.participantName, subject: email.subject, body: email.body };
        MA.store.set({ editing: 'email' });
        var f = document.getElementById('emailSubject');
        if (f) f.focus();
      }, { icon: 'pencil', id: 'editEmail', disabled: s.editing === 'email' }),
      el('span', null, 'wf-spacer'),
      draftOnly ? ui.draftOnlyBadge() : null,
      ui.button(draftOnly ? 'Approve draft' : 'Approve & send', 'primary', function () { ctx.actions.approveEmails(); }, { icon: draftOnly ? 'check' : 'send', id: 'primaryAction', disabled: s.busy || !run.emails || s.editing === 'email' }));
  }

  MA.screens.send = {
    title: 'Review and send',
    render: function (root, ctx) {
      var s = ctx.state, run = s.run, draftOnly = run.emailMode === 'draft-only';
      var approved = !!run.finalApproval && (run.stage === 'approved_not_sent' || run.stage === 'sent');
      // Approved while sending was off, and sending is on now: the drafted email can still be sent.
      var sendLater = approved && run.stage === 'approved_not_sent' && run.emailMode === 'send';
      MA.workflow.markReviewed(run);
      var title = run.minutes.meetingSummary.title || 'Untitled meeting';
      root.appendChild(ui.pageHeader(title, {
        back: { label: 'Meetings', onClick: function () { ctx.actions.go('meetings'); } },
        meta: append(el('div', null, 'meta'), ui.badge(MA.statusOf(run.status || run.stage)),
          el('span', run.stage === 'sent' ? 'Minutes reviewed and emailed' : sendLater ? 'Reviewed — the email hasn’t been sent yet' : approved ? 'Minutes and email reviewed — sending is disabled' : 'Check exactly what each participant will receive, then approve.')),
        actions: [ctx.actions.meetingMenu(run.runId, title, { id: 'reviewMore', className: 'btn-icon-touch' })],
      }));
      root.appendChild(MA.workflow.stepper(s, ctx.actions));
      root.appendChild(append(el('div', null, 'wf-intro'), el('h2', 'Email', 'section-title', { id: 'wfHeading' }),
        el('p', approved ? 'What was reviewed.' : 'Approval 2 of 2 — nothing is sent until you approve this email.', 'help')));

      if (approved) {
        var a = run.finalApproval;
        var facts = append(el('dl', null, 'facts'), el('dt', 'Reviewed by'), el('dd', a.approvedBy), el('dt', 'Reviewed at'), el('dd', new Date(a.approvedAt).toLocaleString()),
          el('dt', 'Email'), el('dd', run.stage === 'sent' ? 'Sent to ' + (run.sentTo || []).length + ' of ' + run.emails.emails.length + ' participants' : sendLater ? 'Not sent yet' : 'Not sent — sending is disabled'));
        root.appendChild(append(el('div', null, 'final-approval', { style: 'margin-bottom:16px' }),
          run.stage === 'sent' ? ui.callout('success', 'circle-check', 'Sent.', facts)
            : sendLater ? ui.callout('warning', 'mail', 'Reviewed while sending was off — this email hasn’t been sent yet.', append(el('div'), el('p', 'Sending is on now. Choose Approve & send to pick the participants and send it.', 'help'), facts))
              : ui.callout('info', 'shield-check', 'Draft created — sending is disabled.', facts)));
      } else if (draftOnly) {
        root.appendChild(append(el('div', null, null, { style: 'margin-bottom:16px' }), ui.callout('info', 'shield-check', 'Sending is disabled (draft-only mode).', 'Approving records your sign-off and keeps this draft. Nothing is emailed.')));
      }
      if (!run.emails) {
        root.appendChild(ui.callout('warning', 'triangle-alert', 'No email draft to show.', 'This meeting was reviewed before drafts were saved, so its email can’t be displayed.'));
        return;
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
      // Until the email is sent people can be added — and after, for anyone who was missed.
      var sentAlready = approved && run.stage === 'sent' && run.emailMode === 'send';
      var canAdd = !approved || sendLater || sentAlready;
      var recipients = append(el('section', null, 'card', { 'aria-labelledby': 'recipientsHeading' }),
        append(el('div', null, 'card-head'), append(el('h2', null, 'section-title', { id: 'recipientsHeading' }), 'Recipients', el('span', String(emails.length), 'count')),
          canAdd ? ui.button('Add', 'ghost', function () { recipientsDialog(run); }, { size: 'sm', icon: 'plus', id: 'addRecipient', ariaLabel: 'Add recipients' }) : null), list);
      var shown = preview(s, run, emails[selected], ctx, canAdd);
      root.appendChild(append(el('div', null, 'send-grid'), recipients, shown));
      if (!approved || sendLater) root.appendChild(decision(s, run, emails[selected], ctx, sendLater));
      else if (sentAlready) root.appendChild(sendMoreBar(s, run, ctx));
      root.appendChild(MA.workflow.footer(s, ctx.actions));
      // Underline possible mistakes in the subject and body (read-only: the text itself is unchanged).
      if (shown.querySelector('.email-subject')) MA.spell.decorate(shown.querySelector('.email-subject'));
      if (shown.querySelector('.email-body')) MA.spell.decorate(shown.querySelector('.email-body'));
    },
    /** The email being edited (for Save changes). */
    draft: function () { return draft; },
    clearDraft: function () { draft = null; },
  };
})();
