// Screen — People: everyone from meetings and calendars, with editable names and photos.
(function () {
  var ui = MA.ui, el = ui.el, append = ui.append;
  var SOURCE = {
    edited: 'Name edited by you', calendar: 'Name from synced calendar', entered: 'Name from a meeting invite', derived: 'Name made from the email',
  };
  var filter = '';

  function row(p, ctx) {
    var id = 'person-' + p.id.replace(/[^a-z0-9]/gi, '-');
    var name = el('input', null, 'input', { id: id + '-name', type: 'text', maxlength: '200', autocomplete: 'off', 'aria-describedby': id + '-src' });
    name.value = p.nameSource === 'edited' ? p.name : '';
    name.placeholder = p.name;
    var photo = el('input', null, 'input', { id: id + '-photo', type: 'url', maxlength: '2048', autocomplete: 'off', placeholder: 'https://… (optional)' });
    photo.value = p.photoSource === 'edited' ? p.avatarUrl : '';
    var error = el('p', '', 'help help-error', { 'aria-live': 'polite' });
    var save = ui.button('Save', 'secondary', null, { size: 'sm', disabled: true });
    function dirty() { save.disabled = name.value.trim() === (p.nameSource === 'edited' ? p.name : '') && photo.value.trim() === (p.photoSource === 'edited' ? p.avatarUrl : ''); }
    name.addEventListener('input', dirty);
    photo.addEventListener('input', dirty);
    save.addEventListener('click', function () {
      if (photo.value.trim() && !/^https:\/\/\S+$/.test(photo.value.trim())) { error.textContent = 'Photo links must start with https://'; photo.setAttribute('aria-invalid', 'true'); photo.focus(); return; }
      photo.removeAttribute('aria-invalid');
      error.textContent = '';
      save.disabled = true;
      ctx.actions.savePerson(p.id, { name: name.value.trim() || null, avatarUrl: photo.value.trim() || null }).catch(function (err) { error.textContent = err.message; save.disabled = false; });
    });
    var person = MA.people.resolve({ email: p.email });
    return append(el('li', null, 'person-row'),
      append(el('div', null, 'person-row-who'), ui.avatar(person, { size: 'lg' }),
        append(el('div', null, 'person-row-text'), el('strong', person.name), el('span', p.email, 'person-email'), el('span', SOURCE[p.nameSource] || '', 'help', { id: id + '-src' }))),
      append(el('div', null, 'person-row-edit'),
        append(el('div', null, 'field'), el('label', 'Display name', 'label', { for: id + '-name' }), name),
        append(el('div', null, 'field'), el('label', 'Photo link', 'label', { for: id + '-photo' }), photo),
        append(el('div', null, 'person-row-actions'), save), error));
  }

  MA.screens.people = {
    title: 'People',
    render: function (root, ctx) {
      var s = ctx.state;
      root.appendChild(ui.pageHeader('People', { meta: el('p', 'Everyone from your meetings and synced calendars. Names and photos you set here are used everywhere.', 'meta') }));
      var card = el('section', null, 'card', { 'aria-labelledby': 'peopleHeading' });
      if (!s.people) {
        root.appendChild(append(card, append(el('div', null, 'card-pad'), el('span', null, 'skeleton skeleton-line', { style: 'width:50%' }), el('span', null, 'skeleton skeleton-line', { style: 'width:70%' }))));
        return;
      }
      var search = el('input', null, 'input', { type: 'search', id: 'peopleFilter', placeholder: 'Filter by name or email', autocomplete: 'off' });
      search.value = filter;
      var head = append(el('div', null, 'card-head'), append(el('h2', null, 'section-title', { id: 'peopleHeading' }), 'People', el('span', String(s.people.length), 'count')),
        append(el('div', null, 'people-filter'), el('label', 'Filter people', 'sr-only', { for: 'peopleFilter' }), search));
      card.appendChild(head);
      if (!s.people.length) {
        card.appendChild(ui.emptyState('users', 'No people yet', 'People appear here once they’re added to a meeting or a scheduled meeting, or when you sync a calendar.'));
        root.appendChild(card);
        return;
      }
      var ul = el('ul', null, 'person-rows');
      var count = el('p', '', 'sr-only', { role: 'status' });
      function draw() {
        var q = filter.trim().toLowerCase();
        var shown = s.people.filter(function (p) { return !q || p.name.toLowerCase().indexOf(q) !== -1 || p.email.toLowerCase().indexOf(q) !== -1; });
        ul.replaceChildren();
        shown.forEach(function (p) { ul.appendChild(row(p, ctx)); });
        if (!shown.length) ul.appendChild(el('li', 'Nobody matches “' + filter + '”.', 'empty-inline person-none'));
        count.textContent = shown.length + ' of ' + s.people.length + ' people shown';
      }
      search.addEventListener('input', function () { filter = search.value; draw(); });
      draw();
      append(card, ul, count);
      root.appendChild(card);
    },
  };
})();
