// Meeting Assistant — accessible dropdown menu (header "Record meeting", mobile "More", row "⋯" menus).
// Arrow keys move, Enter/Space choose, Esc or an outside click closes and returns focus to the button.
(function () {
  var ui = MA.ui, el = ui.el, append = ui.append;
  var current = null;

  function close(restoreFocus) {
    if (!current) return;
    var c = current;
    current = null;
    c.list.remove();
    if (c.trigger.hasAttribute('aria-haspopup')) c.trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', c.onOutside, true);
    window.removeEventListener('resize', c.onResize);
    if (restoreFocus !== false && c.trigger.isConnected) c.trigger.focus();
  }

  /** Places the menu under the trigger, right-aligned, flipped above when there is no room below. */
  function position(list, trigger) {
    var r = trigger.getBoundingClientRect(), w = list.offsetWidth || 240, h = list.offsetHeight || 0;
    // Right edge lines up with the trigger; if that runs off the left edge, the left edges line up instead.
    var left = r.right - w >= 8 ? Math.min(r.right - w, window.innerWidth - w - 8) : Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    var top = r.bottom + 6 + h > window.innerHeight && r.top - 6 - h > 0 ? r.top - 6 - h : r.bottom + 6;
    list.style.left = left + 'px';
    list.style.top = top + 'px';
  }

  /**
   * items: [{ label, icon?, hint?, run, id? }]. Returns the list element while open.
   * The trigger gets aria-haspopup/aria-expanded so screen readers announce it as a menu button.
   * opts.focus === false leaves focus where it is (e.g. a text field the user is typing in).
   */
  function open(trigger, items, opts) {
    if (current && current.trigger === trigger) { close(); return null; }
    close(false);
    var list = el('div', null, 'menu', { role: 'menu', 'aria-label': trigger.getAttribute('aria-label') || trigger.textContent.trim() });
    var buttons = items.map(function (item) {
      var b = append(el('button', null, 'menu-item', { type: 'button', role: 'menuitem', tabindex: '-1' }),
        item.icon ? MA.icon(item.icon) : null,
        append(el('span', null, 'menu-text'), el('span', item.label, 'menu-label'), item.hint ? el('span', item.hint, 'menu-hint') : null));
      if (item.id) b.id = item.id;
      b.addEventListener('click', function () { close(); item.run(); });
      list.appendChild(b);
      return b;
    });
    list.addEventListener('keydown', function (e) {
      var i = buttons.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); buttons[(i + 1) % buttons.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length].focus(); }
      else if (e.key === 'Home') { e.preventDefault(); buttons[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); buttons[buttons.length - 1].focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'Tab') { close(false); }
    });
    document.body.appendChild(list);
    position(list, trigger);
    if (trigger.hasAttribute('aria-haspopup')) trigger.setAttribute('aria-expanded', 'true');
    var onOutside = function (e) { if (!list.contains(e.target) && !trigger.contains(e.target)) close(false); };
    var onResize = function () { close(false); };
    document.addEventListener('mousedown', onOutside, true);
    window.addEventListener('resize', onResize);
    current = { list: list, trigger: trigger, onOutside: onOutside, onResize: onResize };
    if (buttons[0] && !(opts && opts.focus === false)) buttons[0].focus();
    return list;
  }

  /** A button that opens a menu. `items` may be a function so labels can reflect the latest state. */
  function menuButton(label, variant, items, opts) {
    opts = opts || {};
    var b = ui.button(label, variant, null, { icon: opts.icon, iconAfter: label ? 'chevron-down' : null, id: opts.id, ariaLabel: opts.ariaLabel, size: opts.size });
    b.setAttribute('aria-haspopup', 'menu');
    b.setAttribute('aria-expanded', 'false');
    if (opts.className) b.className += ' ' + opts.className;
    b.addEventListener('click', function () { open(b, typeof items === 'function' ? items() : items); });
    b.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!current || current.trigger !== b) open(b, typeof items === 'function' ? items() : items); }
    });
    return b;
  }

  MA.menu = { open: open, close: close, button: menuButton, isOpen: function () { return !!current; }, list: function () { return current ? current.list : null; } };
})();
