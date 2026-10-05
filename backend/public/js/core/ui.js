// Meeting Assistant — small DOM helpers and shared pieces. Text from the server is only ever set with
// textContent, never parsed as HTML.
(function () {
  function el(tag, text, cls, attrs) {
    var node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = String(text);
    if (cls) node.className = cls;
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    return node;
  }
  function append(parent) {
    for (var i = 1; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined || child === false) continue;
      parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return parent;
  }
  function button(label, variant, onClick, opts) {
    opts = opts || {};
    var b = el('button', null, 'btn btn-' + (variant || 'secondary') + (opts.size ? ' btn-' + opts.size : ''));
    b.type = 'button';
    if (opts.icon) b.appendChild(MA.icon(opts.icon));
    if (label) b.appendChild(document.createTextNode(label));
    if (opts.iconAfter) b.appendChild(MA.icon(opts.iconAfter));
    if (opts.id) b.id = opts.id;
    if (opts.ariaLabel) b.setAttribute('aria-label', opts.ariaLabel);
    if (opts.disabled) b.disabled = true;
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }
  /** Status badge: icon + text (the icon is decorative; the text is what's read). */
  function badge(status) {
    if (!status.icon) return el('span', status.label, 'badge badge-' + status.kind);
    return append(el('span', null, 'badge badge-icon badge-' + status.kind), MA.icon(status.icon), el('span', status.label));
  }
  /** Shown beside approve buttons while email delivery is off: approving never sends anything. */
  function draftOnlyBadge() {
    var b = badge({ label: 'Draft-only', kind: 'neutral', icon: 'shield-check' });
    b.classList.add('draft-only-badge');
    b.id = 'draftOnlyBadge';
    b.title = 'Draft-only mode: emails are drafted for review and never sent. Change this in Settings.';
    return b;
  }
  function callout(kind, iconName, title, body) {
    var box = el('div', null, 'callout callout-' + kind, { role: kind === 'danger' ? 'alert' : 'status' });
    var text = el('div');
    if (title) text.appendChild(el('strong', title));
    if (title && body) text.appendChild(document.createTextNode(' '));
    if (body) append(text, body);
    return append(box, MA.icon(iconName), text);
  }
  function pageHeader(title, opts) {
    opts = opts || {};
    var head = el('div', null, 'page-header');
    var left = el('div');
    if (opts.back) left.appendChild(append(el('button', null, 'back-link', { type: 'button' }), MA.icon('arrow-left'), opts.back.label)).addEventListener('click', opts.back.onClick);
    var h = el('h1', title, 'page-title');
    h.tabIndex = -1;
    append(left, h, opts.meta || null);
    append(head, left, opts.actions ? append.apply(null, [el('div', null, 'page-actions')].concat(opts.actions)) : null);
    return head;
  }
  function clock(ms) {
    if (typeof ms !== 'number') return '';
    var s = Math.floor(ms / 1000);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function bytes(n) {
    if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }
  function longDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return '';
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function emptyState(iconName, title, text, action) {
    var box = el('div', null, 'empty');
    return append(box, append(el('div', null, 'empty-icon'), MA.icon(iconName, 'icon-lg')), el('h2', title), el('p', text), action || null);
  }
  /** action: { label, run } adds a button (e.g. Undo); such toasts stay longer so there's time to use it. */
  function toast(message, kind, action) {
    var region = document.getElementById('toasts');
    var t = append(el('div', null, 'toast' + (kind === 'error' ? ' toast-error' : '')), MA.icon(kind === 'error' ? 'circle-alert' : 'circle-check'), el('span', message));
    if (action) {
      var b = el('button', action.label, 'toast-action', { type: 'button' });
      b.addEventListener('click', function () { t.remove(); action.run(); });
      t.appendChild(b);
    }
    region.appendChild(t);
    setTimeout(function () { t.remove(); }, action ? 10000 : 5000);
  }
  /** Initials for the avatar, e.g. "Million Abate" → "MA". */
  function initials(name) {
    var parts = (name || '').trim().split(/\s+/).filter(Boolean);
    return parts.length ? (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() : '?';
  }
  /** Email body: textContent equals the generated body exactly; short section headings ("Decisions:") in bold. */
  function emailBody(text) {
    var body = el('div', null, 'email-body');
    text.split('\n').forEach(function (line, i, all) {
      var heading = i > 0 && /^[A-Za-z][A-Za-z ]{1,40}:$/.test(line);
      body.appendChild(heading ? el('strong', line) : document.createTextNode(line));
      if (i < all.length - 1) body.appendChild(document.createTextNode('\n'));
    });
    return body;
  }

  MA.ui = { el: el, append: append, button: button, badge: badge, draftOnlyBadge: draftOnlyBadge, callout: callout, pageHeader: pageHeader, clock: clock, bytes: bytes,
    longDate: longDate, emptyState: emptyState, toast: toast, initials: initials, emailBody: emailBody };
})();
