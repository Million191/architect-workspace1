// Calendar — the meeting form (add and edit): popover next to the slot, bottom sheet on narrow screens.
// Inline validation: title required, end after start, valid emails. Overlaps warn but never block.
(function () {
  var ui = MA.ui, el = ui.el, append = ui.append, M = MA.cal.model;
  var EMAIL = /^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$/;

  function pad(n) { return String(n).padStart(2, '0'); }
  function dateValue(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function timeValue(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function toDate(dateStr, timeStr) {
    var dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || ''), tm = /^(\d{2}):(\d{2})$/.exec(timeStr || '');
    return dm && tm ? new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2])) : null;
  }

  /** "Priya <priya@x.com>" or "priya@x.com" → { name?, email } (or null when it isn't an email). */
  function parseChip(text) {
    var t = text.trim();
    var m = /^(.*?)\s*<([^<>]+)>$/.exec(t);
    var name = m ? m[1].trim().replace(/^"|"$/g, '') : '', email = (m ? m[2] : t).trim();
    return EMAIL.test(email) ? (name ? { name: name, email: email } : { email: email }) : null;
  }

  function field(id, label, control, help) {
    var f = el('div', null, 'field');
    var errorId = id + '-error';
    control.id = id;
    control.setAttribute('aria-describedby', errorId + (help ? ' ' + id + '-help' : ''));
    return append(f, el('label', label, 'label', { for: id }), control, help ? el('p', help, 'help', { id: id + '-help' }) : null, el('p', '', 'help help-error', { id: errorId, 'aria-live': 'polite' }));
  }
  function showError(root, id, message) {
    var input = root.querySelector('#' + id), out = root.querySelector('#' + id + '-error');
    if (out) out.textContent = message || '';
    if (input) { if (message) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); }
  }

  /**
   * Participant chips: Enter or comma adds; Backspace on empty removes the last chip. As you type, known
   * people are suggested by name or email (avatar + name + email); new addresses can still be typed in.
   */
  function chipInput(initial) {
    var chips = (initial || []).slice(), wrap = el('div', null, 'chip-input'), list = el('ul', null, 'chip-list', { 'aria-label': 'Participants' });
    var input = el('input', null, 'chip-text', { type: 'text', placeholder: 'Name or email', autocomplete: 'off', role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': 'calSuggest' });
    var invalid = el('p', '', 'help help-error', { 'aria-live': 'polite' });
    var suggestBox = el('ul', null, 'suggest-list', { id: 'calSuggest', role: 'listbox', 'aria-label': 'Suggested people', hidden: '' });
    var suggestions = [], active = -1;
    function draw() {
      list.replaceChildren();
      chips.forEach(function (c, i) {
        var person = MA.people.resolve(c), label = c.email ? person.name + ' <' + c.email + '>' : person.name;
        list.appendChild(append(el('li', null, 'chip', { title: label }), ui.avatar(person, { decorative: true }), el('span', person.name),
          ui.button(null, 'ghost', function () { chips.splice(i, 1); draw(); input.focus(); }, { icon: 'x', size: 'sm', ariaLabel: 'Remove ' + label })));
      });
    }
    function closeSuggest() { suggestBox.hidden = true; suggestions = []; active = -1; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); }
    function drawSuggest() {
      var q = input.value.split(/[,;]/).pop().trim();
      suggestions = MA.people.suggest(q, chips.map(function (c) { return c.email; }));
      suggestBox.replaceChildren();
      if (!suggestions.length) { closeSuggest(); return; }
      active = Math.min(Math.max(active, 0), suggestions.length - 1);
      suggestions.forEach(function (p, i) {
        var r = MA.people.resolve({ email: p.email });
        var opt = append(el('li', null, 'suggest-item', { role: 'option', id: 'calSuggest-' + i, 'aria-selected': String(i === active) }),
          ui.avatar(r, { decorative: true, size: 'md' }), append(el('span', null, 'people-list-text'), el('span', r.name, 'person-name'), el('span', r.email, 'person-email')));
        opt.addEventListener('mousedown', function (e) { e.preventDefault(); pick(i); }); // mousedown: before the input's blur commits the text
        suggestBox.appendChild(opt);
      });
      suggestBox.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      input.setAttribute('aria-activedescendant', 'calSuggest-' + active);
    }
    function pick(i) {
      var p = suggestions[i];
      if (!p) return;
      var parts = input.value.split(/[,;]/);
      parts.pop();
      input.value = parts.join(',');
      if (!chips.some(function (x) { return x.email.toLowerCase() === p.email.toLowerCase(); })) chips.push({ name: p.name, email: p.email });
      commit();
      draw();
      closeSuggest();
      input.focus();
    }
    function commit() {
      var parts = input.value.split(/[,;\n]/).map(function (p) { return p.trim(); }).filter(Boolean);
      if (!parts.length) return true;
      var bad = [];
      parts.forEach(function (p) {
        var c = parseChip(p);
        if (!c) bad.push(p);
        else if (!chips.some(function (x) { return x.email.toLowerCase() === c.email.toLowerCase(); })) chips.push(c);
      });
      input.value = bad.join(', ');
      invalid.textContent = bad.length ? '“' + bad.join('”, “') + '” isn’t a valid email address.' : '';
      if (bad.length) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
      draw();
      return !bad.length;
    }
    input.addEventListener('keydown', function (e) {
      var open = !suggestBox.hidden && suggestions.length;
      if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); active = (active + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length; drawSuggest(); }
      else if (open && e.key === 'Enter') { e.preventDefault(); pick(active); }
      else if (open && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSuggest(); } // closes the list, not the form
      else if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); closeSuggest(); }
      else if (e.key === 'Backspace' && !input.value && chips.length) { chips.pop(); draw(); }
    });
    input.addEventListener('input', function () { active = 0; drawSuggest(); });
    input.addEventListener('blur', function () { commit(); closeSuggest(); });
    draw();
    append(wrap, list, input);
    return { node: append(el('div', null, 'chip-field'), wrap, suggestBox, invalid), input: input, commit: commit, value: function () { return chips.slice(); } };
  }

  /**
   * opts: { mode: 'add'|'edit', start: Date, end: Date, meeting?, anchor?, others (meetings for overlap check),
   *         onSave(body) → Promise (rejects with Error to show) }
   */
  function open(opts) {
    var m = opts.meeting || {};
    var body = el('form', null, 'cal-form', { novalidate: 'true' });
    var title = el('input', null, 'input', { type: 'text', placeholder: 'Weekly team sync', autocomplete: 'off', maxlength: '200' });
    title.value = m.title || '';
    var date = el('input', null, 'input', { type: 'date' }), start = el('input', null, 'input', { type: 'time', step: '900' }), end = el('input', null, 'input', { type: 'time', step: '900' });
    date.value = dateValue(opts.start); start.value = timeValue(opts.start); end.value = timeValue(opts.end);
    var chips = chipInput(m.participants);
    var link = el('input', null, 'input', { type: 'url', placeholder: 'https://meet.example.com/…', autocomplete: 'off' });
    link.value = m.link || '';
    var agenda = el('textarea', null, 'textarea', { rows: '3', placeholder: 'What will you cover?' });
    agenda.value = m.agenda || '';
    var overlap = el('p', '', 'help help-warning', { id: 'calOverlap', role: 'status' });
    var formError = el('div', null, null, { 'aria-live': 'assertive' });

    var times = append(el('div', null, 'cal-form-times'), field('calDate', 'Date', date), field('calStart', 'Start', start), field('calEnd', 'End', end));
    var participantsField = append(el('div', null, 'field'), el('label', 'Participants', 'label', { for: 'calParticipants' }), chips.node,
      el('p', 'Press Enter or comma to add. They’ll get the approved minutes later.', 'help'));
    chips.input.id = 'calParticipants';
    append(body, field('calTitle', 'Title', title), times, overlap, participantsField, field('calLink', 'Meeting link (optional)', link), field('calAgenda', 'Agenda or notes (optional)', agenda), formError);

    function range() { var s = toDate(date.value, start.value), e = toDate(date.value, end.value); return { s: s, e: e }; }
    function checkOverlap() {
      var r = range();
      if (!r.s || !r.e || r.e <= r.s) { overlap.textContent = ''; return; }
      var hits = (opts.others || []).filter(function (o) { return o.id !== m.id && o.start && o.end && o.display !== 'cancelled' && Date.parse(o.start) < r.e && Date.parse(o.end) > r.s; });
      overlap.textContent = hits.length ? 'Overlaps with ' + hits.map(function (o) { return o.title; }).join(', ') + ' — you can still save.' : '';
    }
    [date, start, end].forEach(function (i) { i.addEventListener('change', checkOverlap); i.addEventListener('input', checkOverlap); });
    checkOverlap();

    var saving = false;
    var save = ui.button(opts.mode === 'edit' ? 'Save changes' : 'Save meeting', 'primary', null, { id: 'calSave' });
    save.type = 'submit';
    save.setAttribute('form', 'calForm');
    body.id = 'calForm';
    var cancel = ui.button('Cancel', 'secondary', function () { MA.cal.dialog.close(); });

    body.addEventListener('submit', function (e) {
      e.preventDefault();
      if (saving) return; // one save at a time
      var r = range(), ok = true;
      showError(body, 'calTitle', title.value.trim() ? '' : 'Add a title.');
      if (!title.value.trim()) ok = false;
      if (!r.s || !r.e) { showError(body, 'calEnd', 'Pick a date, start, and end time.'); ok = false; }
      else if (r.e <= r.s) { showError(body, 'calEnd', 'The end time must be after the start time.'); ok = false; }
      else showError(body, 'calEnd', '');
      if (!chips.commit()) ok = false;
      if (link.value.trim() && !/^https?:\/\/\S+$/.test(link.value.trim())) { showError(body, 'calLink', 'Links must start with http:// or https://'); ok = false; } else showError(body, 'calLink', '');
      if (!ok) { var firstBad = body.querySelector('[aria-invalid="true"]'); if (firstBad) firstBad.focus(); return; }
      saving = true;
      save.disabled = true;
      formError.replaceChildren();
      opts.onSave({ title: title.value.trim(), start: r.s.toISOString(), end: r.e.toISOString(), participants: chips.value(), link: link.value.trim() || undefined, agenda: agenda.value.trim() || undefined })
        .then(function () { MA.cal.dialog.close(); })
        .catch(function (err) {
          saving = false;
          save.disabled = false;
          formError.appendChild(ui.callout('danger', 'circle-alert', 'Couldn’t save.', err.message));
        });
    });

    var dialog = MA.cal.dialog.open({ title: opts.mode === 'edit' ? 'Edit meeting' : 'New meeting', body: body, actions: [cancel, save], anchor: opts.anchor, variant: 'popover', initialFocus: '#calTitle' });
    MA.spell.attach(title);
    MA.spell.attach(agenda);
    return dialog;
  }

  MA.cal.form = { open: open, parseChip: parseChip, toDate: toDate };
})();
