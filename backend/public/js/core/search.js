// Meeting Assistant — search results: grouped (Meetings, Transcripts, Action items), highlighted,
// typo-tolerant, keyboard-operable. Mounted under the top-bar search (desktop) and in the full-screen
// search (phones). Results come from GET /api/search; nothing is parsed as HTML.
(function () {
  var ui = MA.ui, el = ui.el, append = ui.append;
  var RECENT_KEY = 'ma.recentSearches', RECENT_MAX = 5;
  var ICON = { meeting: 'file-text', schedule: 'calendar', transcript: 'messages-square', action: 'list-checks' };

  function recent() { try { return JSON.parse(window.localStorage.getItem(RECENT_KEY) || '[]').filter(function (q) { return typeof q === 'string'; }); } catch (e) { return []; } }
  function remember(q) {
    var list = [q].concat(recent().filter(function (x) { return x.toLowerCase() !== q.toLowerCase(); })).slice(0, RECENT_MAX);
    try { window.localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch (e) { /* convenience only */ }
  }
  function forgetAll() { try { window.localStorage.removeItem(RECENT_KEY); } catch (e) { /* convenience only */ } }

  /** Text with every word that starts with a matched term wrapped in <mark> — built from text nodes only. */
  function highlight(text, terms) {
    var frag = document.createDocumentFragment(), words = (terms || []).filter(Boolean).map(function (t) { return t.toLowerCase(); });
    String(text || '').split(/([\p{L}\p{N}']+)/u).forEach(function (part) {
      if (!part) return;
      var lower = part.toLowerCase();
      var hit = /[\p{L}\p{N}]/u.test(part) && words.some(function (w) { return lower.indexOf(w) === 0 || (w.length >= 3 && lower.indexOf(w) !== -1); });
      frag.appendChild(hit ? el('mark', part, 'search-mark') : document.createTextNode(part));
    });
    return frag;
  }

  function subline(hit) {
    if (hit.type === 'transcript') return (hit.speaker || 'Speaker') + ' · ' + ui.clock(hit.startMs || 0);
    if (hit.type === 'action') return 'From ' + (hit.meetingTitle || 'a meeting');
    var date = hit.date ? (/^\d{4}-\d{2}-\d{2}$/.test(hit.date) ? ui.longDate(hit.date) : new Date(hit.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })) : '';
    return [hit.scheduleId ? 'Scheduled' : 'Meeting', date].filter(Boolean).join(' · ');
  }

  /**
   * container: where results render. input: the text box that drives them.
   * opts: { onClose(): called after a result is opened (phone overlay closes; desktop hides the list),
   *         commands(): optional [{label, icon, run}] matched by label (desktop palette shortcuts) }
   */
  function mount(container, input, opts) {
    opts = opts || {};
    var seq = 0, timer = null, last = null, expanded = null, active = -1, options = [];
    var listId = (input.id || 'search') + 'Results';
    var status = el('p', '', 'sr-only', { role: 'status', 'aria-live': 'polite' });
    var list = el('div', null, 'search-results', { id: listId, role: 'listbox', 'aria-label': 'Search results' });
    container.replaceChildren(list, status);
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', listId);
    input.setAttribute('aria-expanded', 'false');

    function setActive(i) {
      options.forEach(function (o, j) { o.setAttribute('aria-selected', String(j === i)); });
      active = i;
      if (options[i]) { input.setAttribute('aria-activedescendant', options[i].id); if (options[i].scrollIntoView) options[i].scrollIntoView({ block: 'nearest' }); }
      else input.removeAttribute('aria-activedescendant');
    }
    function option(id, node, run) {
      node.id = listId + '-' + id;
      node.setAttribute('role', 'option');
      node.setAttribute('aria-selected', 'false');
      node.addEventListener('mousedown', function (e) { e.preventDefault(); }); // keep focus in the input
      node.addEventListener('click', run);
      node._run = run;
      options.push(node);
      return node;
    }
    function done() { if (input.value.trim()) remember(input.value.trim()); if (opts.onClose) opts.onClose(); }

    function open(hit) {
      var a = MA.app.actions;
      done();
      if (hit.scheduleId) a.openScheduled(hit.scheduleId);
      else if (hit.type === 'transcript') a.openMeeting(hit.runId, 'review', { focusMs: hit.startMs });
      else a.openMeeting(hit.runId);
    }

    function hitNode(hit, i, groupKey) {
      var node = append(el('div', null, 'search-hit'), MA.icon(ICON[hit.scheduleId ? 'schedule' : hit.type]),
        append(el('div', null, 'search-hit-text'), append(el('span', null, 'search-hit-title'), highlight(hit.title, hit.terms)), el('span', subline(hit), 'search-hit-sub'),
          hit.snippet && hit.type !== 'action' ? append(el('span', null, 'search-hit-snippet'), highlight(hit.snippet, hit.terms)) : null));
      return option(groupKey + '-' + i, node, function () { open(hit); });
    }

    function drawRecent() {
      list.replaceChildren();
      options = []; active = -1;
      var items = recent();
      if (!items.length) { list.appendChild(el('p', 'Search titles, people, dates, what was said, and action items.', 'search-hint')); status.textContent = ''; return; }
      var head = append(el('div', null, 'search-group-head'), el('span', 'Recent searches'),
        ui.button('Clear', 'ghost', function () { forgetAll(); drawRecent(); input.focus(); }, { size: 'sm' }));
      list.appendChild(head);
      items.forEach(function (q, i) {
        list.appendChild(option('recent-' + i, append(el('div', null, 'search-hit search-recent'), MA.icon('clock'), el('span', q, 'search-hit-title')), function () { input.value = q; run(q); input.focus(); }));
      });
      status.textContent = items.length + ' recent searches';
    }

    function draw(res) {
      list.replaceChildren();
      options = []; active = -1;
      if (res.correction) {
        var bar = el('p', null, 'search-correction', { role: 'note' });
        if (res.correction.mode === 'showing') {
          append(bar, 'Showing results for ', el('strong', res.correction.text), '. ',
            linkButton('Search instead for ' + res.query, function () { run(res.query, { exact: true }); }));
        } else {
          append(bar, 'Did you mean ', linkButton(res.correction.text, function () { input.value = res.correction.text; run(res.correction.text); }), '?');
        }
        list.appendChild(bar);
      }
      var cmds = opts.commands && !expanded ? opts.commands().filter(function (c) { return c.label.toLowerCase().indexOf(res.query.toLowerCase()) !== -1; }).slice(0, 3) : [];
      res.groups.forEach(function (g) {
        if (!g.items.length) return;
        var section = el('div', null, 'search-group', { role: 'group', 'aria-labelledby': listId + '-g-' + g.key });
        section.appendChild(append(el('div', null, 'search-group-head', { id: listId + '-g-' + g.key }), el('span', g.label), el('span', String(g.total), 'count')));
        g.items.forEach(function (hit, i) { section.appendChild(hitNode(hit, i, g.key)); });
        if (!expanded && g.total > g.items.length) {
          section.appendChild(option('all-' + g.key, append(el('div', null, 'search-hit search-see-all'), el('span', 'See all ' + g.total + ' ' + g.label.toLowerCase()), MA.icon('arrow-right')),
            function () { expanded = g.key; run(res.query, { group: g.key, exact: !!(last && last.exact) }); }));
        }
        list.appendChild(section);
      });
      if (expanded) {
        list.insertBefore(option('back', append(el('div', null, 'search-hit search-see-all'), MA.icon('arrow-left'), el('span', 'All results')), function () { expanded = null; run(res.query); }), list.firstChild);
      }
      if (cmds.length) {
        var cs = append(el('div', null, 'search-group', { role: 'group', 'aria-labelledby': listId + '-g-cmd' }), append(el('div', null, 'search-group-head', { id: listId + '-g-cmd' }), el('span', 'Commands')));
        cmds.forEach(function (c, i) { cs.appendChild(option('cmd-' + i, append(el('div', null, 'search-hit'), MA.icon(c.icon), el('span', c.label, 'search-hit-title')), function () { if (opts.onClose) opts.onClose(); c.run(); })); });
        list.appendChild(cs);
      }
      if (!res.total && !cmds.length) {
        list.appendChild(append(el('div', null, 'search-empty'), el('strong', 'No results for “' + res.query + '”'),
          el('p', 'Try a participant’s name, a word someone said in the meeting, or a date like “Oct 4”.', 'help')));
      }
      status.textContent = res.total ? (res.total + ' result' + (res.total === 1 ? '' : 's') + (res.correction && res.correction.mode === 'showing' ? ' for ' + res.correction.text : '')) : 'No results';
      input.setAttribute('aria-expanded', 'true');
    }
    function linkButton(label, onClick) {
      var b = el('button', label, 'link-button', { type: 'button' });
      b.addEventListener('mousedown', function (e) { e.preventDefault(); });
      b.addEventListener('click', onClick);
      return b;
    }

    function run(q, params) {
      params = params || {};
      var mine = ++seq;
      if (!q.trim()) { expanded = null; last = null; drawRecent(); return Promise.resolve(); }
      if (!params.group) expanded = null;
      return MA.api.search(q, { group: params.group, limit: params.group ? 50 : 3, exact: params.exact }).then(function (res) {
        if (mine !== seq) return; // a newer search started — drop this answer
        last = { query: q, exact: !!params.exact };
        draw(res);
      }).catch(function (err) {
        if (mine !== seq) return;
        list.replaceChildren(ui.callout('danger', 'circle-alert', 'Search isn’t working right now.', err.message));
        status.textContent = 'Search failed';
      });
    }

    input.addEventListener('input', function () {
      clearTimeout(timer);
      var q = input.value;
      timer = setTimeout(function () { run(q); }, q.trim() ? 150 : 0);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (options.length) setActive((active + 1) % options.length); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (options.length) setActive((active - 1 + options.length) % options.length); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        var target = options[active] || options.find(function (o) { return o.classList.contains('search-hit') && !o.classList.contains('search-recent') && !o.classList.contains('search-see-all'); });
        if (target) target._run();
      }
    });

    return {
      refresh: function () { return run(input.value); },
      clear: function () { seq++; list.replaceChildren(); status.textContent = ''; options = []; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); },
    };
  }

  MA.search = { mount: mount, highlight: highlight, recent: recent };
})();
