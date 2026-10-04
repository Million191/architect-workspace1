// Review — action items: inline task, owner (person picker with avatars), due date, priority, done,
// add, delete with Undo, reorder (drag or Move up/down), and "Not an action item" for false ones.
(function () {
  var ui = MA.ui, el = ui.el, append = ui.append;
  var PRIORITY = [['', 'No priority'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']];

  function move(list, from, to) { var item = list.splice(from, 1)[0]; list.splice(to, 0, item); }
  function idx(id) { return MA.minutes.get().content.actionItems.findIndex(function (a) { return a.id === id; }); }
  function update(id, patch) { MA.minutes.edit(function (c) { var a = c.actionItems.find(function (x) { return x.id === id; }); if (a) Object.assign(a, patch); }); }

  /** Attendees of this meeting first, then everyone in People; typed names are allowed too. */
  function candidates(ctx, q) {
    var query = (q || '').trim().toLowerCase(), seen = {}, out = [];
    (ctx.attendees || []).concat(MA.people.all().map(function (p) { return { name: p.name, email: p.email }; })).forEach(function (p) {
      var k = (p.email || p.name).toLowerCase();
      if (seen[k]) return;
      seen[k] = true;
      if (!query || p.name.toLowerCase().indexOf(query) !== -1 || (p.email || '').toLowerCase().indexOf(query) !== -1) out.push(p);
    });
    return out.slice(0, 6);
  }

  /** Owner field: avatar + name input with suggestions (combobox). */
  function ownerPicker(item, ctx, editable, n) {
    var wrap = el('div', null, 'owner-picker');
    var avatarSlot = el('span', null, 'owner-avatar');
    var input = el('input', null, 'input inline', { type: 'text', 'aria-label': 'Owner of action item ' + n, placeholder: 'Owner', autocomplete: 'off', role: 'combobox', 'aria-expanded': 'false', 'aria-autocomplete': 'list' });
    input.value = item.owner || '';
    input.readOnly = !editable;
    var listId = 'ownerList-' + item.id, list = el('ul', null, 'suggest-list', { id: listId, role: 'listbox', 'aria-label': 'People', hidden: '' });
    input.setAttribute('aria-controls', listId);
    var options = [], active = 0;
    function drawAvatar(name, email) { avatarSlot.replaceChildren(name ? ui.avatar(MA.people.resolve({ name: name, email: email }), { decorative: true }) : el('span', null, 'person-avatar person-avatar-sm avatar-empty', { 'aria-hidden': 'true' })); }
    function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); }
    function pick(p) { input.value = p.name; update(item.id, { owner: p.name, ownerEmail: p.email }); drawAvatar(p.name, p.email); close(); }
    function draw() {
      options = candidates(ctx, input.value);
      list.replaceChildren();
      if (!options.length) { close(); return; }
      active = Math.min(active, options.length - 1);
      options.forEach(function (p, i) {
        var r = MA.people.resolve(p);
        var li = append(el('li', null, 'suggest-item', { role: 'option', id: listId + '-' + i, 'aria-selected': String(i === active) }), ui.avatar(r, { decorative: true, size: 'md' }),
          append(el('span', null, 'people-list-text'), el('span', r.name, 'person-name'), r.email ? el('span', r.email, 'person-email') : null));
        li.addEventListener('mousedown', function (e) { e.preventDefault(); pick(p); });
        list.appendChild(li);
      });
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      input.setAttribute('aria-activedescendant', listId + '-' + active);
    }
    if (editable) {
      input.addEventListener('focus', function () { active = 0; draw(); });
      input.addEventListener('input', function () { active = 0; update(item.id, { owner: input.value, ownerEmail: undefined }); drawAvatar(input.value.trim()); draw(); });
      input.addEventListener('keydown', function (e) {
        if (list.hidden) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); active = (active + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length; draw(); }
        else if (e.key === 'Enter') { e.preventDefault(); if (options[active]) pick(options[active]); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      });
      input.addEventListener('blur', close);
    }
    drawAvatar(item.owner, item.ownerEmail);
    return append(wrap, avatarSlot, append(el('div', null, 'owner-field'), input, list));
  }

  function row(item, n, total, ctx, redraw) {
    var editable = ctx.editable, edited = !item.ai || item.ai.task !== item.task || (item.ai.owner || '') !== (item.owner || '') || (item.ai.dueDate || '') !== (item.dueDate || '') || (item.ai.priority || '') !== (item.priority || '');
    var li = el('li', null, 'ai-row' + (item.status === 'done' ? ' is-done' : ''), { 'data-id': item.id });
    var done = el('input', null, 'checkbox', { type: 'checkbox', 'aria-label': 'Done: action item ' + n });
    done.checked = item.status === 'done';
    done.disabled = !editable;
    done.addEventListener('change', function () { update(item.id, { status: done.checked ? 'done' : 'open' }); li.classList.toggle('is-done', done.checked); });
    var task = el('input', null, 'input inline ai-task', { type: 'text', maxlength: '2000', 'aria-label': 'Action item ' + n, placeholder: 'What needs doing?' });
    task.value = item.task;
    task.readOnly = !editable;
    task.addEventListener('input', function () { update(item.id, { task: task.value }); });
    var due = el('input', null, 'input inline ai-due', { type: 'date', 'aria-label': 'Due date for action item ' + n });
    due.value = item.dueDate || '';
    due.readOnly = !editable;
    due.addEventListener('change', function () { update(item.id, { dueDate: due.value || undefined }); });
    var prio = el('select', null, 'input inline ai-priority', { 'aria-label': 'Priority for action item ' + n });
    PRIORITY.forEach(function (p) { var o = el('option', p[1], null, { value: p[0] }); if ((item.priority || '') === p[0]) o.selected = true; prio.appendChild(o); });
    prio.disabled = !editable;
    prio.addEventListener('change', function () { update(item.id, { priority: prio.value || undefined }); });
    var time = typeof item.sourceTimestampMs === 'number' ? el('button', ui.clock(item.sourceTimestampMs), 'time-link', { type: 'button', 'aria-label': 'Show transcript at ' + ui.clock(item.sourceTimestampMs) }) : null;
    if (time) time.addEventListener('click', function () { ctx.jump(item.sourceTimestampMs); });
    var menu = editable ? MA.menu.button(null, 'ghost', function () {
      var i = idx(item.id);
      return [
        { label: 'Move up', icon: 'arrow-up', run: function () { if (i > 0) { MA.minutes.edit(function (c) { move(c.actionItems, i, i - 1); }); redraw('Action item moved up'); } } },
        { label: 'Move down', icon: 'arrow-down', run: function () { if (i < MA.minutes.get().content.actionItems.length - 1) { MA.minutes.edit(function (c) { move(c.actionItems, i, i + 1); }); redraw('Action item moved down'); } } },
        { label: 'Not an action item', hint: 'Removes it; you can bring it back', icon: 'ban', run: function () { update(item.id, { dismissed: true }); redraw('Marked as not an action item'); } },
        { label: 'Delete', icon: 'trash', run: function () { remove(item, redraw); } },
      ];
    }, { icon: 'more-horizontal', ariaLabel: 'More actions for action item ' + n, size: 'sm', className: 'ai-menu' }) : null;
    var handle = editable ? el('button', '⠿', 'md-handle', { type: 'button', draggable: 'true', 'aria-label': 'Reorder action item ' + n + ' (use the ⋯ menu to move it)', title: 'Drag to reorder' }) : null;
    append(li, handle, done,
      append(el('div', null, 'ai-main'), task, append(el('div', null, 'ai-meta'), time, edited ? el('span', 'Edited', 'badge badge-accent md-edited') : null)),
      ownerPicker(item, ctx, editable, n), due, prio, menu);
    if (editable) MA.spell.attach(task);
    if (handle) {
      handle.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/plain', item.id); li.classList.add('is-dragging'); });
      handle.addEventListener('dragend', function () { li.classList.remove('is-dragging'); });
      li.addEventListener('dragover', function (e) { e.preventDefault(); li.classList.add('is-drop-target'); });
      li.addEventListener('dragleave', function () { li.classList.remove('is-drop-target'); });
      li.addEventListener('drop', function (e) {
        e.preventDefault(); li.classList.remove('is-drop-target');
        var from = idx(e.dataTransfer.getData('text/plain')), to = idx(item.id);
        if (from !== -1 && from !== to) { MA.minutes.edit(function (c) { move(c.actionItems, from, to); }); redraw('Action item moved'); }
      });
    }
    return li;
  }

  function remove(item, redraw) {
    var at = idx(item.id), copy = JSON.parse(JSON.stringify(item));
    MA.minutes.edit(function (c) { c.actionItems.splice(at, 1); });
    redraw('Action item deleted');
    ui.toast('Action item deleted', null, { label: 'Undo', run: function () { MA.minutes.edit(function (c) { c.actionItems.splice(Math.min(at, c.actionItems.length), 0, copy); }); redraw('Action item restored'); } });
  }

  /** ctx: { editable, attendees: [{name, email}], jump(ms), announce(text) } */
  function render(host, ctx) {
    var items = MA.minutes.get().content.actionItems, active = items.filter(function (a) { return !a.dismissed; }), dismissed = items.filter(function (a) { return a.dismissed; });
    var card = el('section', null, 'card', { 'aria-labelledby': 'itemsHeading' });
    card.appendChild(append(el('div', null, 'card-head'), append(el('h2', null, 'section-title', { id: 'itemsHeading' }), 'Action items', el('span', String(active.length), 'count'))));
    var body = el('div', null, 'card-body');
    function redraw(message) {
      var focusId = document.activeElement && document.activeElement.closest && document.activeElement.closest('.ai-row') ? document.activeElement.closest('.ai-row').getAttribute('data-id') : null;
      host.replaceChildren();
      render(host, ctx);
      if (message && ctx.announce) ctx.announce(message);
      var back = focusId && host.querySelector('.ai-row[data-id="' + focusId + '"] .ai-task');
      if (back) back.focus();
    }
    if (!active.length) body.appendChild(append(el('p', null, 'empty-inline'), MA.icon('circle-check'), 'No action items.'));
    else body.appendChild(append(el('div', null, 'ai-row ai-head', { 'aria-hidden': 'true' }), el('span'), el('span', 'Done'), el('span', 'Task'), el('span', 'Owner'), el('span', 'Due'), el('span', 'Priority'), el('span')));
    var ol = el('ol', null, 'ai-list', { 'aria-label': 'Action items' });
    active.forEach(function (a, i) { ol.appendChild(row(a, i + 1, active.length, ctx, redraw)); });
    body.appendChild(ol);
    if (ctx.editable) {
      body.appendChild(ui.button('Add action item', 'secondary', function () {
        var id = MA.minutes.newId();
        MA.minutes.edit(function (c) { c.actionItems.push({ id: id, task: '', status: 'open' }); });
        redraw('Action item added');
        var t = host.querySelector('.ai-row[data-id="' + id + '"] .ai-task');
        if (t) t.focus();
      }, { icon: 'plus', id: 'addActionItem', size: 'sm' }));
    }
    if (dismissed.length) {
      var d = append(el('details', null, 'ai-dismissed'), el('summary', 'Not action items (' + dismissed.length + ')'));
      var ul = el('ul');
      dismissed.forEach(function (a) {
        ul.appendChild(append(el('li'), el('span', a.task, 'muted'), ctx.editable ? ui.button('Restore', 'ghost', function () { update(a.id, { dismissed: false }); redraw('Action item restored'); }, { size: 'sm' }) : null));
      });
      body.appendChild(append(d, ul));
    }
    card.appendChild(body);
    host.appendChild(card);
  }

  MA.review = MA.review || {};
  MA.review.actionItems = { render: render };
})();
