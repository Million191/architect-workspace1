// Meeting Assistant — app shell: sidebar navigation, top-bar search (⌘K), help and account menus, theme.
(function () {
  var ui = MA.ui, el = ui.el, append = ui.append, store = MA.store;
  var NAV = [
    { page: 'meetings', label: 'Meetings', icon: 'messages-square', match: ['meetings', 'upload', 'processing', 'review', 'send', 'record'] },
    { page: 'people', label: 'People', icon: 'users', match: ['people'] },
    { page: 'settings', label: 'Settings', icon: 'settings-2', match: ['settings'] },
  ];

  function applyTheme(theme) {
    var root = document.documentElement;
    if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme); else root.removeAttribute('data-theme');
    try { window.localStorage.setItem('ma.theme', theme); } catch (e) { /* convenience only */ }
  }

  function renderNav(s, go) {
    var nav = document.getElementById('nav');
    nav.replaceChildren();
    NAV.forEach(function (item) {
      var a = el('a', null, 'nav-link', { href: '?page=' + item.page });
      if (item.match.indexOf(s.page) !== -1) a.setAttribute('aria-current', 'page');
      append(a, MA.icon(item.icon, 'icon-lg'), el('span', item.label, 'label-text'));
      if (item.page === 'meetings' && s.meetings) {
        var pending = s.meetings.filter(function (m) { return MA.REVIEW_STATUSES.indexOf(m.status) !== -1; }).length;
        if (pending) append(a, el('span', String(pending), 'nav-count', { 'aria-label': pending + ' need review' }));
      }
      a.title = item.label;
      a.addEventListener('click', function (e) { e.preventDefault(); go(item.page); });
      nav.appendChild(a);
    });
    var foot = document.getElementById('sidebarFoot');
    foot.replaceChildren();
    if (s.status) {
      var draftOnly = s.status.emailMode === 'draft-only';
      var pill = append(el('div', null, 'mode-pill', { title: draftOnly ? 'Email delivery is off. Drafts are created for human review.' : 'Emails go out only after a person approves them.' }),
        MA.icon('shield-check'),
        append(el('div'), el('strong', draftOnly ? 'Draft-only mode' : 'Human approval enabled'), draftOnly ? 'Emails are drafted, never sent.' : 'Nothing is sent without your approval.',
          append(el('a', null, 'mode-link', { href: '?page=settings', id: 'modeSettingsLink' }), 'Change in Settings')));
      pill.querySelector('.mode-link').addEventListener('click', function (e) { e.preventDefault(); go('settings'); });
      foot.appendChild(pill);
    }
  }

  /**
   * Phone navigation (below 640px): Meetings, Record, People, Settings. "Record" opens the same
   * recording menu as the header. People is reached from Settings and the search box.
   */
  var BOTTOM = [
    { page: 'meetings', label: 'Meetings', icon: 'messages-square', match: ['meetings', 'upload', 'processing', 'review', 'send'] },
    { record: true, label: 'Record', icon: 'mic' },
    { page: 'people', label: 'People', icon: 'users', match: ['people'] },
    { page: 'settings', label: 'Settings', icon: 'settings-2', match: ['settings'] },
  ];
  function renderBottomNav(s, actions) {
    var bar = document.getElementById('bottomNav');
    bar.replaceChildren();
    BOTTOM.forEach(function (item) {
      var node;
      if (item.record) {
        node = MA.menu.button(null, 'ghost', [
          { label: 'Record In Person Meeting', hint: 'Use this device’s microphone', icon: 'users', run: function () { actions.recordMeeting('in_person'); } },
          { label: 'Record Online Meeting', hint: 'Zoom, Teams, or Meet in a browser tab', icon: 'monitor', run: function () { actions.recordMeeting('browser_capture'); } },
        ], { icon: item.icon, id: 'bottomRecord', ariaLabel: 'Record meeting', className: 'bottom-link bottom-record' });
        node.appendChild(el('span', item.label, 'bottom-label'));
        node.removeAttribute('aria-label');
      } else {
        node = append(el('a', null, 'bottom-link', { href: '?page=' + item.page }), MA.icon(item.icon, 'icon-lg'), el('span', item.label, 'bottom-label'));
        if (item.match.indexOf(s.page) !== -1) node.setAttribute('aria-current', 'page');
        if (item.page === 'meetings' && s.meetings) {
          var pending = s.meetings.filter(function (m) { return MA.REVIEW_STATUSES.indexOf(m.status) !== -1; }).length;
          if (pending) node.appendChild(el('span', String(pending), 'bottom-count', { 'aria-label': pending + ' need review' }));
        }
        node.addEventListener('click', function (e) { e.preventDefault(); actions.go(item.page); });
      }
      bar.appendChild(node);
    });
  }

  // ---- Full-screen search (phones) ------------------------------------------------------------------
  var overlayReturnFocus = null;
  function openSearchOverlay(actions) {
    var host = document.getElementById('searchOverlay');
    overlayReturnFocus = document.activeElement;
    var input = el('input', null, 'input search-overlay-input', { type: 'search', id: 'searchMobile', placeholder: 'Search meetings and transcripts', autocomplete: 'off', 'aria-label': 'Search meetings and transcripts' });
    var cancel = ui.button('Cancel', 'ghost', function () { closeSearchOverlay(); }, { id: 'searchCancel' });
    var results = el('div', null, 'search-overlay-results', { id: 'searchOverlayResults' });
    host.replaceChildren(append(el('div', null, 'search-overlay-head'), append(el('div', null, 'search-overlay-field'), MA.icon('search'), input), cancel), results);
    host.hidden = false;
    // Dialog semantics only while open, so a hidden host never counts as an open dialog.
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-modal', 'true');
    host.setAttribute('aria-label', 'Search');
    document.body.classList.add('no-scroll');
    host.onkeydown = function (e) {
      if (e.key === 'Escape') { e.preventDefault(); closeSearchOverlay(); return; }
      if (e.key !== 'Tab') return;
      var items = Array.prototype.filter.call(host.querySelectorAll('button, input, [href], [tabindex="0"]'), function (n) { return !n.disabled; });
      var first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    MA.search.mount(results, input, { onClose: closeSearchOverlay }).refresh();
    input.focus();
  }
  function closeSearchOverlay() {
    var host = document.getElementById('searchOverlay');
    if (host.hidden) return;
    host.hidden = true;
    host.replaceChildren();
    ['role', 'aria-modal', 'aria-label'].forEach(function (a) { host.removeAttribute(a); });
    document.body.classList.remove('no-scroll');
    if (overlayReturnFocus && overlayReturnFocus.isConnected) overlayReturnFocus.focus();
  }

  function renderRecPill(s) {
    var pill = document.getElementById('recPill'), live = !!(s.rec && (s.rec.phase === 'live' || s.rec.phase === 'stopping'));
    pill.hidden = !live || s.page === 'record';
    pill.setAttribute('aria-label', live ? (s.rec.paused ? 'Recording paused — return to the recorder' : 'Recording in progress — return to the recorder') : 'Recording');
    pill.classList.toggle('is-paused', !!(s.rec && s.rec.paused));
  }

  function renderTopbar(s) {
    var avatar = document.getElementById('avatar');
    // Initials from the name in Settings; a person icon until a name is set — never "?".
    var letters = (s.form.reviewer || '').trim() ? ui.initials(s.form.reviewer) : '';
    avatar.replaceChildren(letters && letters !== '?' ? document.createTextNode(letters) : MA.icon('user'));
    avatar.setAttribute('aria-label', 'Account menu' + (s.form.reviewer ? ' — ' + s.form.reviewer : ' — name not set'));
    avatar.title = s.form.reviewer || 'Set the reviewer name';
  }

  // ---- Help and account menus (top bar) ----------------------------------------------------------
  function infoDialog(title, rows) {
    var list = el('dl', null, 'help-list');
    rows.forEach(function (r) { append(list, el('dt', r[0]), el('dd', r[1])); });
    MA.cal.dialog.open({ title: title, body: list, variant: 'dialog', actions: [ui.button('Close', 'secondary', function () { MA.cal.dialog.close(); }, { id: 'helpClose' })], initialFocus: '#helpClose' });
  }
  function helpItems() {
    var mod = /Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘' : 'Ctrl ';
    return [
      { label: 'Keyboard shortcuts', icon: 'keyboard', id: 'helpShortcuts', run: function () {
        infoDialog('Keyboard shortcuts', [[mod + 'K', 'Search meetings, transcripts, and commands'], ['Enter', 'Open the selected meeting row'], ['← →', 'Move between the meeting tabs'], ['Esc', 'Close a menu, dialog, or the calendar']]);
      } },
      { label: 'How it works', icon: 'circle-help', id: 'helpHowItWorks', run: function () {
        infoDialog('How it works', [['1. Add a meeting', 'Upload a recording or record one here.'], ['2. Review the draft', 'AI drafts the minutes; you edit and approve them.'], ['3. Approve the email', 'Check the email to participants and approve it.'], ['4. Delivery', store.get().status && store.get().status.emailMode === 'draft-only' ? 'Draft-only mode is on, so emails are drafted but never sent.' : 'Reviewed emails are sent to every participant.']]);
      } },
    ];
  }
  /** "Reviewer name": the name recorded on reviews (the same value as Upload → Reviewer). Saved in this browser. */
  function approverDialog(actions) {
    var input = el('input', null, 'input', { id: 'approverNameInput', type: 'text', maxlength: '200', autocomplete: 'name', placeholder: 'e.g. Million Abate' });
    input.value = store.get().form.reviewer || '';
    var save = ui.button('Save', 'primary', function () {
      store.setForm({ reviewer: input.value.trim() });
      actions.refreshShell();
      MA.cal.dialog.close();
      ui.toast(input.value.trim() ? 'Reviewer name saved' : 'Reviewer name cleared');
    }, { id: 'approverNameSave' });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); save.click(); } });
    MA.cal.dialog.open({ title: 'Reviewer name', variant: 'dialog', initialFocus: '#approverNameInput',
      body: append(el('div', null, 'field'), el('label', 'Name recorded on your reviews', 'label', { for: 'approverNameInput' }), input),
      actions: [ui.button('Cancel', 'secondary', function () { MA.cal.dialog.close(); }), save] });
  }
  // Is the login switched on (and are we signed in)? Change password / Sign out only make sense then.
  var signedIn = false;
  try { fetch('/api/auth/status', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (st) { signedIn = !!(st && st.signedIn); }).catch(function () { signedIn = false; }); } catch (e) { signedIn = false; }

  /** Change password: current one, new one twice. Other browsers are signed out; this one stays signed in. */
  function passwordDialog() {
    function field(id, label, auto) {
      var input = el('input', null, 'input', { id: id, type: 'password', autocomplete: auto, maxlength: '200' });
      return { input: input, node: append(el('div', null, 'field'), el('label', label, 'label', { for: id }), input) };
    }
    var cur = field('pwCurrent', 'Current password', 'current-password'), next = field('pwNew', 'New password (at least 6 characters)', 'new-password'), again = field('pwAgain', 'Repeat new password', 'new-password');
    var error = el('p', '', 'help help-error', { role: 'alert', id: 'pwError' });
    var save = ui.button('Change password', 'primary', function () {
      error.textContent = '';
      if (!cur.input.value || !next.input.value) { error.textContent = 'Type your current password and a new one.'; return; }
      if (next.input.value.length < 6) { error.textContent = 'Use at least 6 characters for the new password.'; next.input.focus(); return; }
      if (next.input.value !== again.input.value) { error.textContent = 'The two new passwords don’t match.'; again.input.focus(); return; }
      return fetch('/api/auth/password', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current: cur.input.value, next: next.input.value }) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { if (!r.ok) throw new Error(b.message || 'Couldn’t change the password. Try again.'); }); })
        .then(function () { MA.cal.dialog.close(); ui.toast('Password changed. Other browsers were signed out.'); })
        .catch(function (err) { error.textContent = err.message; });
    }, { id: 'pwSave' });
    MA.cal.dialog.open({ title: 'Change password', variant: 'dialog', initialFocus: '#pwCurrent',
      body: append(el('div', null, 'recipient-form'), cur.node, next.node, again.node, error),
      actions: [ui.button('Cancel', 'secondary', function () { MA.cal.dialog.close(); }), save] });
  }
  function accountItems(actions) {
    var name = (store.get().form.reviewer || '').trim();
    return [
      { label: name || 'Set reviewer name', hint: name ? 'Your name on reviews — click to change' : 'Recorded on every review', icon: 'user', id: 'accountProfile', run: function () { approverDialog(actions); } },
      { label: 'Settings', icon: 'settings-2', id: 'accountSettings', run: function () { actions.go('settings'); } },
    ].concat(signedIn ? [
      { label: 'Change password', icon: 'lock', id: 'accountPassword', run: function () { passwordDialog(); } },
      { label: 'Sign out', icon: 'log-out', id: 'accountSignOut', run: function () {
        fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(function () { /* signed out locally anyway */ }).then(function () { window.location.assign('/login'); });
      } },
    ] : []);
  }

  /** Commands offered in the top-bar search results (Ctrl K focuses the search box). */
  function commands(actions) {
    var s = store.get();
    var list = [
      { group: 'Actions', label: 'Upload meeting', icon: 'upload', run: function () { actions.go('upload'); } },
      { group: 'Navigate', label: 'Go to meetings', icon: 'messages-square', run: function () { actions.go('meetings'); } },
      { group: 'Navigate', label: 'Go to people', icon: 'users', run: function () { actions.go('people'); } },
      { group: 'Navigate', label: 'Go to settings', icon: 'settings-2', run: function () { actions.go('settings'); } },
      { group: 'Actions', label: 'Switch to light theme', icon: 'sun', run: function () { actions.setTheme('light'); } },
      { group: 'Actions', label: 'Switch to dark theme', icon: 'moon', run: function () { actions.setTheme('dark'); } },
    ];
    (s.meetings || []).forEach(function (m) {
      list.push({ group: 'Meetings', label: m.title || 'Untitled meeting', hint: ui.longDate(MA.dashboard.sel.localDay(m)), icon: 'file-text', run: function () { actions.openMeeting(m.runId); } });
    });
    return list;
  }

  MA.shell = {
    init: function (actions) {
      document.getElementById('brandMark').appendChild(MA.icon('audio-lines'));
      document.querySelector('#topbarBrand .brand-mark').appendChild(MA.icon('audio-lines'));
      document.getElementById('recPill').addEventListener('click', function () { actions.go('record'); });
      var searchOpen = document.getElementById('searchOpen');
      searchOpen.appendChild(MA.icon('search', 'icon-lg'));
      searchOpen.addEventListener('click', function () { openSearchOverlay(actions); });
      document.getElementById('searchIcon').appendChild(MA.icon('search'));
      var isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');
      document.getElementById('searchKbd').textContent = isMac ? '⌘K' : 'Ctrl K';
      applyTheme(store.get().theme);
      var search = document.getElementById('search'), panel = document.getElementById('searchPanel');
      var results = MA.search.mount(panel, search, { onClose: hidePanel, commands: function () { return commands(actions).filter(function (c) { return c.group !== 'Meetings'; }); } });
      function showPanel() { panel.hidden = false; search.setAttribute('aria-expanded', 'true'); }
      function hidePanel() { panel.hidden = true; search.setAttribute('aria-expanded', 'false'); search.removeAttribute('aria-activedescendant'); }
      search.addEventListener('focus', function () { showPanel(); results.refresh(); });
      search.addEventListener('input', showPanel);
      search.addEventListener('blur', function () { setTimeout(function () { if (document.activeElement !== search && !panel.contains(document.activeElement)) hidePanel(); }, 120); });
      search.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { e.preventDefault(); if (!panel.hidden) hidePanel(); else { search.value = ''; search.blur(); } }
      });
      var help = document.getElementById('helpButton'), avatar = document.getElementById('avatar');
      help.appendChild(MA.icon('circle-help', 'icon-lg'));
      help.addEventListener('click', function () { MA.menu.open(help, helpItems()); });
      avatar.addEventListener('click', function () { MA.menu.open(avatar, accountItems(actions)); });
      [help, avatar].forEach(function (b) {
        b.addEventListener('keydown', function (e) { if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !MA.menu.isOpen()) { e.preventDefault(); b.click(); } });
      });
      // Ctrl K / ⌘K: the search box (its hint shows the shortcut); on phones, the full-screen search.
      document.addEventListener('keydown', function (e) {
        if (!((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) return;
        e.preventDefault();
        var phone = window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
        if (phone) openSearchOverlay(actions); else { search.focus(); search.select(); }
      });
    },
    render: function (s, actions) { renderNav(s, actions.go); renderBottomNav(s, actions); renderTopbar(s); renderRecPill(s); },
    openSearchOverlay: openSearchOverlay,
    closeSearchOverlay: closeSearchOverlay,
    applyTheme: applyTheme,
  };
})();
