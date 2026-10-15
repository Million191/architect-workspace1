// Review — "Send minutes for <title>?": the last check before real emails go out. Lists every
// participant (name + address) with a checkbox (ticked by default; people without an address are
// flagged and can't be ticked), then "Yes, send to N". While sending: spinner, no double clicks.
// On success the meeting is Sent and a toast confirms it; on error the dialog stays open with the reason.
(function () {
  var ui = MA.ui, el = ui.el, append = ui.append;

  /**
   * opts: { run, send(recipients) → Promise<run>, onSent(run) }. Uses the app's one modal (MA.cal.dialog).
   */
  function open(opts) {
    var run = opts.run, title = run.minutes.meetingSummary.title || 'this meeting';
    // Already emailed (sending to more people): those who have it are shown, but can't be ticked again.
    var sentNames = (run.sentTo || []).map(function (x) { return x.participantName; });
    var people = run.emails.emails.map(function (e, i) {
      var address = (run.recipients || {})[e.participantName];
      return { name: e.participantName, address: address, id: 'sendTo-' + i, sent: sentNames.indexOf(e.participantName) !== -1 };
    });
    var more = sentNames.length > 0;
    var sending = false;
    // The approval records who approved it: ask here when no name is set (instead of blocking the button).
    var needName = !(MA.store.get().form.reviewer || '').trim();
    var nameInput = needName ? el('input', null, 'input', { id: 'sendApprover', type: 'text', maxlength: '200', autocomplete: 'name', placeholder: 'Your name' }) : null;
    if (nameInput) nameInput.addEventListener('input', function () { refresh(); });
    var list = el('ul', null, 'send-confirm-list', { 'aria-label': 'Participants' });
    var error = el('div', null, 'send-confirm-error', { role: 'alert' });
    var cancel = ui.button('Cancel', 'secondary', function () { if (!sending) MA.cal.dialog.close(); }, { id: 'sendCancel' });
    var confirm = ui.button('', 'primary', function () { go(); }, { id: 'sendConfirm' });

    function chosen() {
      return people.filter(function (p) { var box = document.getElementById(p.id); return box && box.checked && !box.disabled; }).map(function (p) { return p.name; });
    }
    function refresh() {
      var n = chosen().length;
      confirm.replaceChildren(MA.icon('send'), document.createTextNode(n ? 'Yes, send to ' + n : 'Choose who to send to'));
      confirm.disabled = sending || n === 0 || (needName && !nameInput.value.trim());
    }

    people.forEach(function (p) {
      var box = el('input', null, 'checkbox', { type: 'checkbox', id: p.id, 'data-name': p.name });
      box.checked = !!p.address && !p.sent;
      box.disabled = !p.address || p.sent;
      box.addEventListener('change', refresh);
      list.appendChild(append(el('li', null, 'send-confirm-row' + (p.address ? '' : ' is-missing')),
        append(el('label', null, 'send-confirm-person', { for: p.id }), box,
          ui.avatar(MA.people.resolve({ name: p.name, email: p.address }), { decorative: true }),
          append(el('span', null, 'send-confirm-meta'), el('span', p.name, 'send-confirm-name'),
            p.sent ? el('span', (p.address ? p.address + ' · ' : '') + 'Already sent', 'muted') : p.address ? el('span', p.address, 'muted') : el('span', 'No email address — can’t be sent', 'send-confirm-missing')))));
    });

    function go() {
      var names = chosen();
      if (sending || !names.length) return; // double clicks and an empty selection do nothing
      if (needName) {
        if (!nameInput.value.trim()) { nameInput.focus(); return; }
        MA.store.setForm({ reviewer: nameInput.value.trim() }); // remembered, like the name in Settings
        if (MA.app && MA.app.actions.refreshShell) MA.app.actions.refreshShell();
      }
      sending = true;
      error.replaceChildren();
      confirm.disabled = true;
      cancel.disabled = true;
      list.querySelectorAll('input').forEach(function (b) { b.dataset.wasDisabled = b.disabled ? '1' : ''; b.disabled = true; });
      confirm.replaceChildren(el('span', null, 'spinner', { 'aria-hidden': 'true' }), document.createTextNode('Sending…'));
      confirm.setAttribute('aria-busy', 'true');
      opts.send(names).then(function (sent) {
        sending = false;
        MA.cal.dialog.close();
        opts.onSent(sent, names);
      }).catch(function (err) {
        sending = false;
        cancel.disabled = false;
        confirm.removeAttribute('aria-busy');
        list.querySelectorAll('input').forEach(function (b) { b.disabled = b.dataset.wasDisabled === '1'; });
        error.replaceChildren(ui.callout('danger', 'circle-alert', 'Not sent.', err.message));
        refresh();
      });
    }

    var missing = people.filter(function (p) { return !p.address && !p.sent; }).length;
    var body = append(el('div', null, 'send-confirm'),
      el('p', more ? 'The same reviewed minutes go to the people you tick. People who already have the email aren’t sent it again.' : 'Each person below gets their own email with the reviewed minutes. Untick anyone who shouldn’t receive it.', 'help'),
      missing ? ui.callout('warning', 'triangle-alert', missing + (missing === 1 ? ' participant has' : ' participants have') + ' no email address.', 'Close this, then use “Add email” on their email to include them.') : null,
      list,
      needName ? append(el('div', null, 'field send-confirm-approver'), el('label', 'Your name (recorded on the approval)', 'label', { for: 'sendApprover' }), nameInput) : null,
      error);
    MA.cal.dialog.open({ title: (more ? 'Send minutes to more people for ' : 'Send minutes for ') + title + '?', body: body, variant: 'dialog', initialFocus: people.some(function (p) { return p.address && !p.sent; }) ? '#sendConfirm' : '#sendCancel', actions: [cancel, confirm] });
    refresh();
  }

  MA.review = MA.review || {};
  MA.review.sendDialog = { open: open };
})();
