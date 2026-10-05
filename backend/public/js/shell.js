// Meeting Assistant — app shell: sidebar navigation, top-bar search (⌘K), help and account menus, theme.
(function () {
  var ui = MA.ui, el = ui.el, append = ui.append, store = MA.store;
  var NAV = [
    { page: 'meetings', label: 'Meetings', icon: 'messages-square', match: ['meetings', 'upload', 'processing', 'review', 'send', 'record'] },
    { page: 'action-items', label: 'Action items', icon: 'list-checks', match: ['action-items'] },
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
        var pending = s.meetings.filter(function (m) { return m.status === 'needs_review'; }).length;
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
      var pill = append(el('div', null, 'mode-pill', { title: draftOnly ? 'Email delivery is off for this demo. Drafts are created for human review.' : 'Approved minutes are emailed to participants.' }),
        MA.icon(draftOnly ? 'shield-check' : 'send'),
        append(el('div'), el('strong', draftOnly ? 'Draft-only mode' : 'Email delivery on'), draftOnly ? 'Emails are drafted, never sent.' : 'Sent after final approval.',
          append(el('a', null, 'mode-link', { href: '?page=settings', id: 'modeSettingsLink' }), 'Change in Settings')));
      pill.querySelector('.mode-link').addEventListener('click', function (e) { e.preventDefault(); go('settings'); });
      foot.appendChild(pill);
    }
  }

  /**
   * Phone navigation (below 640px): Meetings, Action items, Record, Settings. "Record" opens the same
   * recording menu as the header. People is reached from Settings and the search box.
   */
  var BOTTOM = [
    { page: 'meetings', label: 'Meetings', icon: 'messages-square', match: ['meetings', 'upload', 'processing', 'review', 'send'] },
    { page: 'action-items', label: 'Action items', icon: 'list-checks', match: ['action-items'] },
    { record: true, label: 'Record', icon: 'mic' },
    { page: 'settings', label: 'Settings', icon: 'settings-2', match: ['settings', 'people'] },
  ];
  function renderBottomNav(s, actions) {
    var bar = document.getElementById('bottomNav');
    bar.replaceChildren();
    BOTTOM.forEach(function (item) {
      var node;
      if (item.record) {
        node = MA.menu.button(null, 'ghost', [
          { label: 'In-person meeting', hint: 'Use this device’s microphone', icon: 'users', run: function () { actions.recordMeeting('in_person'); } },
          { label: 'Online meeting on this computer', hint: 'Zoom, Teams, or Meet in a browser tab', icon: 'monitor', run: function () { actions.recordMeeting('browser_capture'); } },
        ], { icon: item.icon, id: 'bottomRecord', ariaLabel: 'Record meeting', className: 'bottom-link bottom-record' });
        node.appendChild(el('span', item.label, 'bottom-label'));
        node.removeAttribute('aria-label');
      } else {
        node = append(el('a', null, 'bottom-link', { href: '?page=' + item.page }), MA.icon(item.icon, 'icon-lg'), el('span', item.label, 'bottom-label'));
        if (item.match.indexOf(s.page) !== -1) node.setAttribute('aria-current', 'page');
        if (item.page === 'meetings' && s.meetings) {
          var pending = s.meetings.filter(function (m) { return m.status === 'needs_review'; }).length;
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
    var input = el('input', null, 'input search-overlay-input', { type: 'search', id: 'searchMobile', placeholder: 'Search meetings, transcripts, or action items', autocomplete: 'off', 'aria-label': 'Search meetings, transcripts, or action items' });
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
    avatar.textContent = ui.initials(s.form.reviewer);
    avatar.setAttribute('aria-label', 'Account menu' + (s.form.reviewer ? ' — ' + s.form.reviewer : ' — name not set'));
    avatar.title = s.form.reviewer || 'Set your name in Settings';
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
        infoDialog('Keyboard shortcuts', [[mod + 'K', 'Search meetings, transcripts, action items, and commands'], ['Enter', 'Open the selected meeting row'], ['← →', 'Move between the meeting tabs'], ['Esc', 'Close a menu, dialog, or the calendar']]);
      } },
      { label: 'How it works', icon: 'circle-help', id: 'helpHowItWorks', run: function () {
        infoDialog('How it works', [['1. Add a meeting', 'Upload a recording or record one here.'], ['2. Review the draft', 'AI drafts the minutes and action items; you edit and approve them.'], ['3. Approve the email', 'Check the email to participants and approve it.'], ['4. Delivery', store.get().status && store.get().status.emailMode === 'draft-only' ? 'Draft-only mode is on, so emails are drafted but never sent.' : 'Approved emails are sent to every participant.']]);
      } },
    ];
  }
  function accountItems(actions) {
    var name = (store.get().form.reviewer || '').trim();
    return [
      { label: name || 'Set your name', hint: name ? 'Your name on approvals — change it in Settings' : 'Recorded on every approval', icon: 'user', id: 'accountProfile', run: function () {
        actions.go('settings');
        setTimeout(function () { var f = document.getElementById('settingsName'); if (f) f.focus(); }, 0);
      } },
      { label: 'Settings', icon: 'settings-2', id: 'accountSettings', run: function () { actions.go('settings'); } },
    ];
  }

  /** Commands offered in the top-bar search results (Ctrl K focuses the search box). */
  function commands(actions) {
    var s = store.get();
    var list = [
      { group: 'Actions', label: 'Upload meeting', icon: 'upload', run: function () { actions.go('upload'); } },
      { group: 'Navigate', label: 'Go to meetings', icon: 'messages-square', run: function () { actions.go('meetings'); } },
      { group: 'Navigate', label: 'Go to action items', icon: 'list-checks', run: function () { actions.go('action-items'); } },
      { group: 'Navigate', label: 'Go to people', icon: 'users', run: function () { actions.go('people'); } },
      { group: 'Navigate', label: 'Go to settings', icon: 'settings-2', run: function () { actions.go('settings'); } },
      { group: 'Actions', label: 'Switch to light theme', icon: 'sun', run: function () { actions.setTheme('light'); } },
      { group: 'Actions', label: 'Switch to dark theme', icon: 'moon', run: function () { actions.setTheme('dark'); } },
    ];
    (s.meetings || []).forEach(function (m) {
      list.push({ group: 'Meetings', label: m.title || 'Untitled meeting', hint: ui.longDate(m.date), icon: 'file-text', run: function () { actions.openMeeting(m.runId); } });
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
