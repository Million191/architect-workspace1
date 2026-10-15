// Screen — People: a table of everyone from your meetings (and people you add) — Name, Role, Email —
// with an Edit button per person, and each person's meetings under their name.
// Nobody appears here unless a meeting, a calendar entry, or you put them here.
(function () {
  var ui = MA.ui, el = ui.el, append = ui.append;
  var EMAIL_RE = /^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$/;
  var filter = '';
  /** The person whose row is open for editing (survives redraws while the list refreshes). */
  var editingId = null;

  /** The meetings this person is in, and the action items assigned to them (by email, or by name). */
  function historyOf(p, s) {
    var email = p.email.toLowerCase(), name = p.name.toLowerCase();
    var meetings = (s.meetings || []).filter(function (m) {
      return (m.people || []).some(function (x) { return (x.email || '').toLowerCase() === email; });
    });
    var names = meetings.reduce(function (acc, m) { (m.people || []).forEach(function (x) { if ((x.email || '').toLowerCase() === email) acc[x.name.toLowerCase()] = true; }); return acc; }, {});
    names[name] = true;
    var items = (s.actionItems || []).filter(function (a) { return a.owner && names[a.owner.trim().toLowerCase()]; });
    return { meetings: meetings, items: items };
  }

  function history(p, ctx) {
    var h = historyOf(p, ctx.state);
    if (!h.meetings.length) return el('p', p.origins.indexOf('manual') !== -1 ? 'Added by you — not in any meeting yet.' : 'Not in any meeting yet.', 'help person-history-empty');
    var box = append(el('details', null, 'person-history'), el('summary', h.meetings.length + ' meeting' + (h.meetings.length === 1 ? '' : 's'), 'help'));
    if (h.meetings.length) {
      var ul = el('ul', null, 'person-history-list', { 'aria-label': 'Meetings with ' + p.name });
      h.meetings.forEach(function (m) {
        var b = el('button', null, 'link-button', { type: 'button' });
        append(b, m.title || 'Untitled meeting');
        b.addEventListener('click', function () { ctx.actions.openMeeting(m.runId); });
        ul.appendChild(append(el('li'), b, el('span', ' · ' + ui.longDate(MA.dashboard.sel.localDay(m)), 'muted'), ' ', ui.badge(MA.statusOf(m.status || m.stage))));
      });
      box.appendChild(ul);
    }
    return box;
  }

  function rowId(p) { return 'person-' + p.id.replace(/[^a-z0-9]/gi, '-'); }

  /** Read-only row: Name (with photo and history), Role, Email, Edit. */
  function displayRow(p, ctx, redraw) {
    var id = rowId(p), person = MA.people.resolve({ email: p.email });
    var edit = ui.button('Edit', 'ghost', function () { editingId = p.id; redraw(); var f = document.getElementById(id + '-name'); if (f) f.focus(); },
      { size: 'sm', icon: 'pencil', id: id + '-edit', ariaLabel: 'Edit ' + person.name });
    return append(el('tr', null, 'person-row', { 'data-email': p.email }),
      append(el('td', null, 'col-name', { 'data-label': 'Name' }),
        append(el('div', null, 'person-row-who'), ui.avatar(person, { size: 'md' }),
          append(el('div', null, 'person-row-text'), el('strong', person.name, 'person-name'), history(p, ctx)))),
      append(el('td', null, 'col-role', { 'data-label': 'Role' }), p.role ? el('span', p.role) : el('span', '—', 'muted', { 'aria-label': 'No role' })),
      append(el('td', null, 'col-email', { 'data-label': 'Email' }), el('a', p.email, 'person-email-link', { href: 'mailto:' + p.email })),
      append(el('td', null, 'col-actions'), edit));
  }

  /** The same row, open for editing: Name, Role, Email (and an optional photo link). */
  function editRow(p, ctx, redraw) {
    var id = rowId(p);
    function field(key, label, type, value, attrs) {
      var input = el('input', null, 'input', Object.assign({ id: id + '-' + key, type: type, autocomplete: 'off' }, attrs || {}));
      input.value = value || '';
      return { input: input, node: append(el('div', null, 'field'), el('label', label, 'label', { for: id + '-' + key }), input) };
    }
    var currentPhoto = p.photoSource === 'edited' ? p.avatarUrl : '';
    var name = field('name', 'Name', 'text', p.name, { maxlength: '200' });
    var role = field('role', 'Role', 'text', p.role, { maxlength: '100', placeholder: 'e.g. Product Manager' });
    var email = field('email', 'Email', 'email', p.email, { maxlength: '320' });
    var photo = field('photo', 'Photo link (optional)', 'url', currentPhoto, { maxlength: '2048', placeholder: 'https://…' });
    var error = el('p', '', 'help help-error', { 'aria-live': 'polite' });
    var save = ui.button('Save', 'primary', null, { size: 'sm', disabled: true, id: id + '-save' });
    var cancel = ui.button('Cancel', 'secondary', function () { editingId = null; redraw(); }, { size: 'sm', id: id + '-cancel' });

    function changes() {
      var edit = {};
      if (name.input.value.trim() !== p.name) edit.name = name.input.value.trim() || null; // empty → back to the name from the meeting/calendar
      if (role.input.value.trim() !== (p.role || '')) edit.role = role.input.value.trim() || null;
      if (email.input.value.trim() !== p.email) edit.email = email.input.value.trim();
      if (photo.input.value.trim() !== (currentPhoto || '')) edit.avatarUrl = photo.input.value.trim() || null;
      return edit;
    }
    [name, role, email, photo].forEach(function (f) { f.input.addEventListener('input', function () { save.disabled = !Object.keys(changes()).length; }); });
    save.addEventListener('click', function () {
      var bad = !EMAIL_RE.test(email.input.value.trim()) ? [email, 'Type a valid email address, like name@example.com.']
        : photo.input.value.trim() && !/^https:\/\/\S+$/.test(photo.input.value.trim()) ? [photo, 'Photo links must start with https://'] : null;
      [email, photo].forEach(function (f) { f.input.removeAttribute('aria-invalid'); });
      if (bad) { error.textContent = bad[1]; bad[0].input.setAttribute('aria-invalid', 'true'); bad[0].input.focus(); return; }
      error.textContent = '';
      var edit = changes();
      if (!Object.keys(edit).length) { editingId = null; redraw(); return; }
      save.disabled = true;
      editingId = null; // the refreshed list draws this person closed
      return ctx.actions.savePerson(p.id, edit).catch(function (err) { editingId = p.id; error.textContent = err.message; save.disabled = false; });
    });
    var form = append(el('div', null, 'person-edit'), name.node, role.node, email.node, photo.node,
      append(el('div', null, 'person-row-actions'), cancel, save), error);
    form.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { editingId = null; redraw(); }
      if (e.key === 'Enter' && e.target.tagName === 'INPUT' && !save.disabled) { e.preventDefault(); save.click(); }
    });
    return append(el('tr', null, 'person-row is-editing', { 'data-email': p.email }),
      append(el('td', null, 'col-edit', { colspan: '4' }),
        append(el('div', null, 'person-row-who'), ui.avatar(MA.people.resolve({ email: p.email }), { size: 'md' }), el('strong', 'Edit ' + p.name, 'person-name')),
        form));
  }

  /** "+ Add person": name, role (optional), email. */
  function addDialog(ctx) {
    function field(id, label, type, placeholder) {
      var input = el('input', null, 'input', { id: id, type: type, autocomplete: 'off', placeholder: placeholder || '' });
      return { input: input, node: append(el('div', null, 'field'), el('label', label, 'label', { for: id }), input) };
    }
    var n = field('newPersonName', 'Name', 'text', 'Sara Lee'), r = field('newPersonRole', 'Role (optional)', 'text', 'e.g. Product Manager'), e = field('newPersonEmail', 'Email', 'email', 'name@example.com');
    var error = el('p', '', 'help help-error', { role: 'alert', id: 'newPersonError' });
    var add = ui.button('Add person', 'primary', function () {
      var name = n.input.value.trim(), email = e.input.value.trim(), role = r.input.value.trim();
      if (!name) { error.textContent = 'Type the person’s name.'; n.input.focus(); return; }
      if (!EMAIL_RE.test(email)) { error.textContent = 'Type a valid email address, like name@example.com.'; e.input.focus(); return; }
      return ctx.actions.addPerson({ name: name, email: email, role: role || undefined }).then(function () { MA.cal.dialog.close(); })
        .catch(function (err) { error.textContent = err.message; });
    }, { icon: 'plus', id: 'newPersonAdd' });
    MA.cal.dialog.open({ title: 'Add person', variant: 'dialog', initialFocus: '#newPersonName',
      body: append(el('div', null, 'recipient-form'), n.node, r.node, e.node, error),
      actions: [ui.button('Cancel', 'secondary', function () { MA.cal.dialog.close(); }), add] });
  }

  MA.screens.people = {
    title: 'People',
    render: function (root, ctx) {
      var s = ctx.state;
      root.appendChild(ui.pageHeader('People', {
        meta: el('p', 'Everyone from your meetings.', 'meta'),
        actions: [ui.button('Add person', 'primary', function () { addDialog(ctx); }, { icon: 'plus', id: 'addPerson' })],
      }));
      var card = el('section', null, 'card', { 'aria-labelledby': 'peopleHeading' });
      if (!s.people) {
        root.appendChild(append(card, append(el('div', null, 'card-pad'), el('span', null, 'skeleton skeleton-line', { style: 'width:50%' }), el('span', null, 'skeleton skeleton-line', { style: 'width:70%' }))));
        return;
      }
      if (!s.people.length) {
        card.appendChild(ui.emptyState('users', 'No participants yet', 'Participants from your meetings will appear here automatically. You can also add someone manually.',
          ui.button('Add person', 'secondary', function () { addDialog(ctx); }, { icon: 'plus', id: 'addPersonEmpty' })));
        card.querySelector('h2').id = 'peopleHeading';
        root.appendChild(card);
        return;
      }
      var search = el('input', null, 'input', { type: 'search', id: 'peopleFilter', placeholder: 'Filter by name, role, or email', autocomplete: 'off' });
      search.value = filter;
      card.appendChild(append(el('div', null, 'card-head'), append(el('h2', null, 'section-title', { id: 'peopleHeading' }), 'People', el('span', String(s.people.length), 'count')),
        append(el('div', null, 'people-filter'), el('label', 'Filter people', 'sr-only', { for: 'peopleFilter' }), search)));
      var body = el('tbody', null, 'person-rows');
      var table = append(el('table', null, 'table people-table', { 'aria-labelledby': 'peopleHeading' }),
        append(el('thead'), append(el('tr'), el('th', 'Name', 'col-name', { scope: 'col' }), el('th', 'Role', 'col-role', { scope: 'col' }), el('th', 'Email', 'col-email', { scope: 'col' }),
          append(el('th', null, 'col-actions', { scope: 'col' }), el('span', 'Actions', 'sr-only')))),
        body);
      var count = el('p', '', 'sr-only', { role: 'status' });
      function draw() {
        var q = filter.trim().toLowerCase();
        var shown = s.people.filter(function (p) { return !q || p.name.toLowerCase().indexOf(q) !== -1 || p.email.toLowerCase().indexOf(q) !== -1 || (p.role || '').toLowerCase().indexOf(q) !== -1; });
        body.replaceChildren();
        shown.forEach(function (p) { body.appendChild(editingId === p.id ? editRow(p, ctx, draw) : displayRow(p, ctx, draw)); });
        if (!shown.length) body.appendChild(append(el('tr', null, 'person-none'), el('td', 'Nobody matches “' + filter + '”.', 'empty-inline', { colspan: '4' })));
        count.textContent = shown.length + ' of ' + s.people.length + ' people shown';
      }
      search.addEventListener('input', function () { filter = search.value; draw(); });
      draw();
      append(card, append(el('div', null, 'table-wrap'), table), count);
      root.appendChild(card);
    },
  };
})();
