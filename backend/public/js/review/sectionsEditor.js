// Review — minutes sections: one small rich-text editor (Quill) per section, with a minimal toolbar
// that appears on focus, rename, "Edited" label, move up/down, drag to reorder, delete with Undo.
(function () {
  var ui = MA.ui, el = ui.el, append = ui.append;
  var FORMATS = ['header', 'bold', 'italic', 'list', 'link', 'blockquote'];
  var KIND_TITLES = { summary: 'Summary', next_steps: 'Next steps', notes: 'Notes', decisions: 'Decisions', custom: 'New section' };
  var editors = {}; // section id → Quill

  function quillFor(container, section, editable, label) {
    var q = new window.Quill(container, { formats: FORMATS, readOnly: !editable, placeholder: editable ? 'Click to start typing' : '', modules: { toolbar: false, history: { delay: 800, maxStack: 300, userOnly: true } } });
    q.setContents(q.clipboard.convert({ html: section.html || '' }), 'silent');
    q.history.clear();
    q.root.setAttribute('aria-label', label);
    q.root.setAttribute('aria-multiline', 'true');
    q.root.setAttribute('role', 'textbox');
    if (!editable) q.root.setAttribute('aria-readonly', 'true');
    return q;
  }

  /** The formatting bar: headings, bold, italic, lists, link. Buttons say whether they're on. */
  function toolbar(q, title) {
    var bar = el('div', null, 'rt-toolbar', { role: 'toolbar', 'aria-label': 'Formatting for ' + title });
    var buttons = [
      { label: 'Heading', text: 'H', apply: function (f) { q.format('header', f.header === 2 ? false : 2, 'user'); }, on: function (f) { return f.header === 2; } },
      { label: 'Bold (Ctrl+B)', text: 'B', cls: 'is-bold', apply: function (f) { q.format('bold', !f.bold, 'user'); }, on: function (f) { return !!f.bold; } },
      { label: 'Italic (Ctrl+I)', text: 'I', cls: 'is-italic', apply: function (f) { q.format('italic', !f.italic, 'user'); }, on: function (f) { return !!f.italic; } },
      { label: 'Bulleted list', text: '•', apply: function (f) { q.format('list', f.list === 'bullet' ? false : 'bullet', 'user'); }, on: function (f) { return f.list === 'bullet'; } },
      { label: 'Numbered list', text: '1.', apply: function (f) { q.format('list', f.list === 'ordered' ? false : 'ordered', 'user'); }, on: function (f) { return f.list === 'ordered'; } },
      { label: 'Link', text: '🔗', apply: function (f) { linkDialog(q, f.link); }, on: function (f) { return !!f.link; } },
    ];
    var nodes = buttons.map(function (b) {
      var n = el('button', b.text, 'rt-btn' + (b.cls ? ' ' + b.cls : ''), { type: 'button', 'aria-label': b.label, title: b.label, 'aria-pressed': 'false' });
      n.addEventListener('mousedown', function (e) { e.preventDefault(); }); // keep the text selection
      n.addEventListener('click', function () { var range = q.getSelection(true); b.apply(range ? q.getFormat(range) : {}); refresh(); });
      bar.appendChild(n);
      return n;
    });
    function refresh() {
      var range = q.getSelection();
      var f = range ? q.getFormat(range) : {};
      nodes.forEach(function (n, i) { n.setAttribute('aria-pressed', String(buttons[i].on(f))); });
    }
    q.on('selection-change', refresh);
    q.on('text-change', refresh);
    // Arrow keys move between toolbar buttons (one tab stop for the whole bar).
    bar.addEventListener('keydown', function (e) {
      var i = nodes.indexOf(document.activeElement);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); nodes[(i + (e.key === 'ArrowRight' ? 1 : -1) + nodes.length) % nodes.length].focus(); }
    });
    nodes.forEach(function (n, i) { n.tabIndex = i === 0 ? 0 : -1; });
    return bar;
  }

  function linkDialog(q, current) {
    var range = q.getSelection(true) || { index: q.getLength() - 1, length: 0 };
    var input = el('input', null, 'input', { type: 'url', id: 'rtLink', placeholder: 'https://…', autocomplete: 'off' });
    input.value = current || '';
    var error = el('p', '', 'help help-error', { role: 'alert' });
    var save = ui.button(current ? 'Update link' : 'Add link', 'primary', function () {
      var href = input.value.trim();
      if (href && !/^(https?:\/\/|mailto:)/i.test(href)) { error.textContent = 'Links must start with https://, http://, or mailto:'; input.focus(); return; }
      MA.cal.dialog.close();
      q.focus();
      if (range.length) q.formatText(range.index, range.length, 'link', href || false, 'user');
      else if (href) { q.insertText(range.index, href, 'link', href, 'user'); q.setSelection(range.index + href.length, 0); }
    });
    var remove = current ? ui.button('Remove link', 'secondary', function () { MA.cal.dialog.close(); q.focus(); q.format('link', false, 'user'); }) : null;
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); save.click(); } });
    MA.cal.dialog.open({ title: current ? 'Edit link' : 'Add link', body: append(el('div', null, 'field'), el('label', 'Link address', 'label', { for: 'rtLink' }), input, error), actions: [remove, save].filter(Boolean), variant: 'dialog', initialFocus: '#rtLink' });
  }

  function move(list, from, to) { var item = list.splice(from, 1)[0]; list.splice(to, 0, item); }

  /**
   * Renders the sections into `host`. ctx: { view, editable, redraw(), jump(ms), extraHead(section) }.
   * Typing never re-renders; structural changes (add/move/delete) call ctx.redraw().
   */
  function render(host, ctx) {
    var st = MA.minutes.get(), content = st.content, editable = ctx.editable;
    Object.keys(editors).forEach(function (k) { delete editors[k]; });
    var list = el('div', null, 'md-sections', { role: 'list', 'aria-label': 'Minutes sections' });
    content.sections.forEach(function (s, i) {
      var edited = MA.review.sections.isEdited(s);
      var card = el('section', null, 'card md-section', { role: 'listitem', 'data-id': s.id, 'aria-labelledby': 'mdTitle-' + s.id });
      var title = el('input', null, 'input inline md-title', { id: 'mdTitle-' + s.id, type: 'text', maxlength: '200', 'aria-label': 'Section title', placeholder: 'Section title' });
      title.value = s.title;
      title.readOnly = !editable;
      title.addEventListener('input', function () { MA.minutes.edit(function (c) { c.sections[i].title = title.value; }); markEdited(card); });
      var head = append(el('div', null, 'md-section-head'),
        editable ? el('button', '⠿', 'md-handle', { type: 'button', 'aria-label': 'Reorder ' + (s.title || 'section') + ' (use Move up / Move down)', title: 'Drag to reorder', draggable: 'true' }) : null,
        title,
        edited ? el('span', 'Edited', 'badge badge-accent md-edited') : null,
        typeof s.startMs === 'number' ? (function () { var b = el('button', ui.clock(s.startMs), 'time-link', { type: 'button', 'aria-label': 'Show transcript at ' + ui.clock(s.startMs) }); b.addEventListener('click', function () { ctx.jump(s.startMs); }); return b; })() : null,
        ctx.extraHead ? ctx.extraHead(s, i) : null,
        editable ? append(el('div', null, 'md-section-actions'),
          ui.button(null, 'ghost', function () { if (i > 0) { MA.minutes.edit(function (c) { move(c.sections, i, i - 1); }); ctx.redraw('mdTitle-' + s.id, (s.title || 'Section') + ' moved up'); } }, { icon: 'arrow-up', size: 'sm', ariaLabel: 'Move ' + (s.title || 'section') + ' up', disabled: i === 0 }),
          ui.button(null, 'ghost', function () { if (i < content.sections.length - 1) { MA.minutes.edit(function (c) { move(c.sections, i, i + 1); }); ctx.redraw('mdTitle-' + s.id, (s.title || 'Section') + ' moved down'); } }, { icon: 'arrow-down', size: 'sm', ariaLabel: 'Move ' + (s.title || 'section') + ' down', disabled: i === content.sections.length - 1 }),
          ui.button(null, 'ghost', function () { removeSection(s, i, ctx); }, { icon: 'trash', size: 'sm', ariaLabel: 'Delete ' + (s.title || 'section') })) : null);
      var box = el('div', null, 'md-editor');
      card.appendChild(head);
      var editorHost = el('div', null, 'md-quill');
      box.appendChild(editorHost);
      card.appendChild(box);
      list.appendChild(card);
      var q = quillFor(editorHost, s, editable, (s.title || 'Section') + ' — minutes text');
      editors[s.id] = q;
      if (editable) {
        box.insertBefore(toolbar(q, s.title || 'section'), editorHost);
        q.on('text-change', function (_d, _o, source) {
          if (source === 'silent') return;
          var html = q.root.innerHTML === '<p><br></p>' ? '' : q.root.innerHTML;
          MA.minutes.edit(function (c) { var sec = c.sections.find(function (x) { return x.id === s.id; }); if (sec) sec.html = html; });
          markEdited(card);
        });
        MA.spell.attachRich(q, s.title || 'section');
        dragAndDrop(card, s, i, ctx);
      }
    });
    host.appendChild(list);
    if (editable) host.appendChild(addSectionButton(ctx));
  }

  function markEdited(card) {
    if (card.querySelector('.md-edited')) return;
    var head = card.querySelector('.md-section-head'), title = head.querySelector('.md-title');
    title.insertAdjacentElement('afterend', el('span', 'Edited', 'badge badge-accent md-edited'));
  }

  function removeSection(s, i, ctx) {
    var removed = JSON.parse(JSON.stringify(MA.minutes.get().content.sections[i]));
    MA.minutes.edit(function (c) { c.sections.splice(i, 1); });
    ctx.redraw(null, (s.title || 'Section') + ' deleted');
    ui.toast('Deleted “' + (s.title || 'section') + '”', null, { label: 'Undo', run: function () { MA.minutes.edit(function (c) { c.sections.splice(Math.min(i, c.sections.length), 0, removed); }); ctx.redraw('mdTitle-' + removed.id, (removed.title || 'Section') + ' restored'); } });
  }

  function dragAndDrop(card, s, i, ctx) {
    var handle = card.querySelector('.md-handle');
    handle.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move'; card.classList.add('is-dragging'); });
    handle.addEventListener('dragend', function () { card.classList.remove('is-dragging'); });
    card.addEventListener('dragover', function (e) { e.preventDefault(); card.classList.add('is-drop-target'); });
    card.addEventListener('dragleave', function () { card.classList.remove('is-drop-target'); });
    card.addEventListener('drop', function (e) {
      e.preventDefault();
      card.classList.remove('is-drop-target');
      var from = Number(e.dataTransfer.getData('text/plain'));
      if (Number.isInteger(from) && from !== i) { MA.minutes.edit(function (c) { move(c.sections, from, i); }); ctx.redraw(null, 'Section moved'); }
    });
  }

  function addSectionButton(ctx) {
    var items = ['summary', 'next_steps', 'notes', 'decisions', 'custom'].map(function (kind) {
      return { label: KIND_TITLES[kind], icon: 'plus', run: function () {
        var id = MA.minutes.newId();
        MA.minutes.edit(function (c) { c.sections.push({ id: id, kind: kind, title: KIND_TITLES[kind], html: '' }); });
        ctx.redraw('mdTitle-' + id, KIND_TITLES[kind] + ' section added');
        var q = editors[id];
        if (q) q.focus();
      } };
    });
    return append(el('div', null, 'md-add'), MA.menu.button('Add section', 'secondary', items, { icon: 'plus', id: 'addSection' }));
  }

  /** Appends a quote or note (from the transcript) to a section, as an edit. */
  function appendTo(sectionId, html) {
    var q = editors[sectionId];
    if (!q) return false;
    var Delta = window.Quill.import('delta'), at = q.getLength(), empty = !q.getText().trim();
    var delta = q.clipboard.convert({ html: html });
    // Start a new line first, so the quote never merges into the last paragraph.
    q.updateContents(empty ? new Delta().concat(delta) : new Delta().retain(at - 1).insert('\n').concat(delta), 'user');
    q.setSelection(q.getLength(), 0, 'silent');
    return true;
  }

  MA.review = MA.review || {};
  // Phones: keep the formatting bar just above the on-screen keyboard.
  if (window.visualViewport) {
    var placeToolbar = function () {
      var vv = window.visualViewport, offset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty('--kb-offset', offset + 'px');
    };
    window.visualViewport.addEventListener('resize', placeToolbar);
    window.visualViewport.addEventListener('scroll', placeToolbar);
  }

  /** Changed from what the AI drafted (or added by a person). Mirrors sectionEdited() on the server. */
  function isEdited(s) { return s.aiHtml === undefined || s.aiTitle !== s.title || MA.minutes.textOf(s.aiHtml) !== MA.minutes.textOf(s.html); }

  MA.review.sections = { render: render, editors: editors, appendTo: appendTo, kindTitles: KIND_TITLES, isEdited: isEdited };
})();
