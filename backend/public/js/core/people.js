// Meeting Assistant — people: names, avatars, and avatar stacks everywhere a participant appears.
// The identity helpers mirror src/services/people/identity.ts exactly (identity.test.ts checks this).
(function () {
  var ui = MA.ui, el = ui.el, append = ui.append;
  var PALETTE = ['#4f46e5', '#0e7490', '#047857', '#b45309', '#be123c', '#7c3aed', '#1d4ed8', '#a21caf', '#4d7c0f', '#c2410c'];
  var EMAIL = /^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$/;

  function fnv1a(text) {
    var hash = 0x811c9dc5;
    for (var i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; }
    return hash >>> 0;
  }
  function avatarColor(key) { return PALETTE[fnv1a(String(key || '').trim().toLowerCase()) % PALETTE.length]; }
  function readableNameFromEmail(email) {
    var local = String(email).trim().split('@')[0].split('+')[0];
    var words = local.split(/[._-]+/).map(function (w) { return w.replace(/\d+$/g, ''); }).filter(function (w) { return w.length > 0; });
    if (!words.length) return local || String(email).trim();
    return words.map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(); }).join(' ');
  }
  function isEmail(v) { return EMAIL.test(String(v || '').trim()); }

  // ---- Directory (loaded from /api/people) ------------------------------------------------------
  var byEmail = {}, byName = {}, list = [];
  function setAll(people) {
    list = people || [];
    byEmail = {}; byName = {};
    list.forEach(function (p) { byEmail[p.id] = p; var n = p.name.toLowerCase(); if (!byName[n]) byName[n] = p; });
  }

  /** "Priya <priya@x.com>" | "priya@x.com" | "Priya" | { name?, email? } → { name?, email? } */
  function parse(input) {
    if (input && typeof input === 'object') return { name: input.name || undefined, email: input.email || undefined };
    var t = String(input || '').trim(), m = /^(.*?)\s*<([^<>]+)>$/.exec(t);
    if (m) return { name: m[1].trim().replace(/^"|"$/g, '') || undefined, email: m[2].trim() };
    return isEmail(t) ? { email: t } : { name: t || undefined };
  }

  /**
   * What to show for one participant. Name: People list (edited/calendar) → the name given with the
   * address → readable email. Photo: People list/calendar, else coloured initials.
   */
  function resolve(input) {
    var p = parse(input), email = p.email ? p.email.trim() : undefined;
    // A "name" that is really an address ("li.wu@acme.com" typed without a name) is treated as the address.
    if (p.name && isEmail(p.name)) { email = email || p.name.trim(); p.name = undefined; }
    var known = email ? byEmail[email.toLowerCase()] : p.name ? byName[p.name.toLowerCase()] : undefined;
    if (known && !email) email = known.email;
    var name = known && known.nameSource !== 'derived' ? known.name : p.name || (email ? readableNameFromEmail(email) : 'Unknown');
    return { key: (email || name).toLowerCase(), name: name, email: email, avatarUrl: known ? known.avatarUrl : undefined, color: avatarColor(email || name), initials: ui.initials(name) };
  }

  /** People whose name or email contains `q`, best matches (name starts with q) first. */
  function suggest(q, excludeEmails) {
    var query = String(q || '').trim().toLowerCase(), skip = (excludeEmails || []).map(function (e) { return e.toLowerCase(); });
    if (!query) return [];
    return list.filter(function (p) { return skip.indexOf(p.id) === -1 && (p.name.toLowerCase().indexOf(query) !== -1 || p.email.toLowerCase().indexOf(query) !== -1); })
      .sort(function (a, b) { return (b.name.toLowerCase().indexOf(query) === 0) - (a.name.toLowerCase().indexOf(query) === 0) || a.name.localeCompare(b.name); })
      .slice(0, 6);
  }

  // ---- UI pieces -------------------------------------------------------------------------------
  /**
   * One round avatar. opts.decorative: the name is already visible beside it, so the avatar is hidden
   * from screen readers instead of announcing the name twice. opts.size: 'sm' | 'md' | 'lg'.
   */
  function avatar(person, opts) {
    opts = opts || {};
    var cls = 'person-avatar person-avatar-' + (opts.size || 'sm');
    function initialsNode() {
      // Initials come from CSS (data-initials), so they never leak into the surrounding text content.
      var n = el('span', null, cls, opts.decorative ? { 'aria-hidden': 'true', 'data-initials': person.initials } : { role: 'img', 'aria-label': person.name, 'data-initials': person.initials });
      n.style.backgroundColor = person.color;
      return n;
    }
    if (!person.avatarUrl) return initialsNode();
    var img = el('img', null, cls, { src: person.avatarUrl, alt: opts.decorative ? '' : person.name, loading: 'lazy', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', function () { if (img.parentNode) img.parentNode.replaceChild(initialsNode(), img); });
    return img;
  }

  /** Avatar + name; the email shows on hover (title) and is kept for screen readers. */
  function personChip(input, opts) {
    var p = resolve(input);
    var chip = append(el('span', null, 'person-chip', { title: p.email ? p.name + ' <' + p.email + '>' : p.name }), avatar(p, { decorative: true, size: opts && opts.size }), el('span', p.name, 'person-name'));
    if (p.email && opts && opts.showEmail) chip.appendChild(el('span', p.email, 'person-email'));
    return chip;
  }

  /** "Sara Lee", "Sara Lee and Tom Ward", "Sara Lee, Tom Ward, and Ann Bo", "Sara Lee, Tom Ward, and 4 others". */
  function stackLabel(names) {
    if (!names.length) return 'No participants';
    if (names.length === 1) return names[0];
    if (names.length === 2) return names[0] + ' and ' + names[1];
    if (names.length === 3) return names[0] + ', ' + names[1] + ', and ' + names[2];
    var rest = names.length - 2;
    return names[0] + ', ' + names[1] + ', and ' + rest + ' others';
  }

  function peopleList(people) {
    var ul = el('ul', null, 'people-list');
    people.forEach(function (p) {
      ul.appendChild(append(el('li', null, 'people-list-item'), avatar(p, { decorative: true, size: 'md' }),
        append(el('span', null, 'people-list-text'), el('span', p.name, 'person-name'), el('span', p.email || 'No email address', 'person-email'))));
    });
    return ul;
  }

  /**
   * Up to `max` avatars plus "+N". Interactive (default): a button that opens the full list with names
   * and emails; hover shows the same list as a tooltip. Non-interactive: for use inside another button.
   */
  function avatarStack(inputs, opts) {
    opts = opts || {};
    var max = opts.max || 3, people = (inputs || []).map(resolve);
    var label = stackLabel(people.map(function (p) { return p.name; }));
    var interactive = opts.interactive !== false && people.length > 0;
    var stack = interactive
      ? el('button', null, 'avatar-stack', { type: 'button', 'aria-label': label + '. Show participants', 'aria-haspopup': 'dialog' })
      : el('span', null, 'avatar-stack', { role: 'img', 'aria-label': label });
    stack.title = people.map(function (p) { return p.email ? p.name + ' <' + p.email + '>' : p.name; }).join('\n');
    var visible = people.slice(0, max);
    visible.forEach(function (p) { stack.appendChild(avatar(p, { decorative: true })); });
    if (people.length > visible.length) stack.appendChild(el('span', null, 'person-avatar person-avatar-sm avatar-more', { 'aria-hidden': 'true', 'data-initials': '+' + (people.length - visible.length) }));
    if (!people.length) stack.appendChild(el('span', '—', 'muted'));
    if (interactive) {
      stack.addEventListener('click', function (e) {
        e.stopPropagation(); // stacks sit inside clickable rows
        MA.cal.dialog.open({ title: 'Participants (' + people.length + ')', body: peopleList(people), anchor: stack, variant: 'popover' });
      });
    }
    return stack;
  }

  MA.people = {
    setAll: setAll, all: function () { return list; }, resolve: resolve, parse: parse, suggest: suggest,
    avatarColor: avatarColor, readableNameFromEmail: readableNameFromEmail, fnv1a: fnv1a, palette: PALETTE, stackLabel: stackLabel,
  };
  MA.ui.avatar = avatar;
  MA.ui.personChip = personChip;
  MA.ui.avatarStack = avatarStack;
  MA.ui.peopleList = peopleList;
})();
