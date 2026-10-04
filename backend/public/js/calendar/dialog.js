// Calendar — one accessible overlay used for popovers (next to a slot/block), dialogs, and the mobile
// bottom sheet. Traps focus while open, closes with Esc or outside click, returns focus to the opener.
(function () {
  var ui = MA.ui, el = ui.el, append = ui.append;
  var current = null;

  function focusables(root) {
    return Array.prototype.filter.call(root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'), function (n) { return !n.disabled && !n.hidden; });
  }

  /**
   * opts: { title, body (Node), actions (Node[]), anchor (Element, for a popover), variant ('popover'|'dialog'),
   *         danger (bool), onClose (fn), labelledBy?, initialFocus (selector) }
   * Returns { close, root }.
   */
  function open(opts) {
    close();
    var opener = document.activeElement;
    var narrow = window.matchMedia && window.matchMedia('(max-width: 720px)').matches;
    // A popover needs something to sit next to; without an anchor (e.g. opened from search) it is a dialog.
    var variant = opts.variant === 'popover' && !narrow && opts.anchor ? 'popover' : narrow ? 'sheet' : 'dialog';
    var backdrop = el('div', null, 'cal-overlay cal-overlay-' + variant);
    var box = el('div', null, 'cal-dialog cal-dialog-' + variant, { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'calDialogTitle' });
    var head = append(el('div', null, 'cal-dialog-head'), el('h2', opts.title, null, { id: 'calDialogTitle' }),
      ui.button(null, 'ghost', function () { close(); }, { icon: 'x', size: 'sm', ariaLabel: 'Close' }));
    append(box, head, append(el('div', null, 'cal-dialog-body'), opts.body), opts.actions && opts.actions.length ? append.apply(null, [el('div', null, 'cal-dialog-actions')].concat(opts.actions)) : null);
    backdrop.appendChild(box);
    document.body.appendChild(backdrop);

    if (variant === 'popover' && opts.anchor && opts.anchor.getBoundingClientRect) {
      var r = opts.anchor.getBoundingClientRect(), w = 380;
      var left = r.right + 8 + w > window.innerWidth ? Math.max(8, r.left - w - 8) : r.right + 8;
      var top = Math.min(Math.max(8, r.top), Math.max(8, window.innerHeight - (box.offsetHeight || 420) - 8));
      box.style.left = left + 'px';
      box.style.top = top + 'px';
    }

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key !== 'Tab') return;
      var items = focusables(box);
      if (!items.length) return;
      var first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    box.addEventListener('keydown', onKey);
    backdrop.addEventListener('mousedown', function (e) { if (e.target === backdrop) close(); });

    var target = (opts.initialFocus && box.querySelector(opts.initialFocus)) || focusables(box.querySelector('.cal-dialog-body'))[0] || focusables(box)[0];
    if (target) target.focus();

    current = { root: backdrop, opener: opener, onClose: opts.onClose };
    return { root: box, close: close };
  }

  function close() {
    if (!current) return;
    var c = current;
    current = null;
    c.root.remove();
    if (c.onClose) c.onClose();
    if (c.opener && c.opener.isConnected && c.opener.focus) c.opener.focus();
  }

  MA.cal = MA.cal || {};
  MA.cal.dialog = { open: open, close: close, isOpen: function () { return !!current; } };
})();
