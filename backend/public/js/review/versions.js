// Review — version history: the AI draft plus every saved version (who, when, why), preview any of
// them, restore one (as a new version — nothing is deleted), and compare the current minutes with
// the AI draft (added text green, removed text red).
(function () {
  var ui = MA.ui, el = ui.el, append = ui.append;
  var KIND = { ai_draft: 'AI draft', edit: 'Edited', restore: 'Restored', amendment: 'Edited after approval', transcript_correction: 'Transcript corrected' };

  function words(text) { return (text || '').split(/(\s+)/).filter(function (w) { return w.length; }); }

  /** Word diff (longest common subsequence). Returns [{ type: 'same'|'add'|'del', text }]. */
  function diff(before, after) {
    var a = words(before), b = words(after), n = a.length, m = b.length;
    if (n * m > 400000) return [{ type: 'del', text: before }, { type: 'add', text: after }]; // very long: show as replaced
    var dp = [];
    for (var i = 0; i <= n; i++) { dp.push(new Uint16Array(m + 1)); }
    for (i = n - 1; i >= 0; i--) for (var j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    var out = [], x = 0, y = 0;
    function push(type, text) { var last = out[out.length - 1]; if (last && last.type === type) last.text += text; else out.push({ type: type, text: text }); }
    while (x < n && y < m) {
      if (a[x] === b[y]) { push('same', a[x]); x++; y++; }
      else if (dp[x + 1][y] >= dp[x][y + 1]) { push('del', a[x]); x++; }
      else { push('add', b[y]); y++; }
    }
    while (x < n) push('del', a[x++]);
    while (y < m) push('add', b[y++]);
    return out;
  }

  function diffNode(before, after) {
    var p = el('p', null, 'diff');
    diff(before, after).forEach(function (part) {
      if (part.type === 'same') p.appendChild(document.createTextNode(part.text));
      else p.appendChild(el(part.type === 'add' ? 'ins' : 'del', part.text, part.type === 'add' ? 'diff-add' : 'diff-del', { title: part.type === 'add' ? 'Added' : 'Removed' }));
    });
    return p;
  }

  function itemLine(a) { return a.task + (a.owner ? ' — ' + a.owner : '') + (a.dueDate ? ' (due ' + a.dueDate + ')' : '') + (a.priority ? ' [' + a.priority + ']' : '') + (a.dismissed ? ' (not an action item)' : ''); }

  /** Current minutes vs the AI draft, section by section, then action items. */
  function compare(ai, current) {
    var box = el('div', null, 'compare'), text = MA.minutes.textOf;
    box.appendChild(append(el('p', null, 'help compare-legend'), el('ins', 'Added', 'diff-add'), ' ', el('del', 'Removed', 'diff-del'), ' — compared with the AI draft.'));
    var aiSections = {};
    ai.sections.forEach(function (s) { aiSections[s.id] = s; });
    current.sections.forEach(function (s) {
      var was = aiSections[s.id];
      delete aiSections[s.id];
      var head = el('h3', null, 'compare-title');
      if (!was) head.appendChild(el('ins', s.title || 'Untitled section', 'diff-add'));
      else if (was.title !== s.title) append(head, el('del', was.title, 'diff-del'), ' ', el('ins', s.title, 'diff-add'));
      else head.textContent = s.title;
      box.appendChild(append(el('section', null, 'compare-section'), head, diffNode(was ? text(was.html) : '', text(s.html))));
    });
    Object.keys(aiSections).forEach(function (id) {
      var s = aiSections[id];
      box.appendChild(append(el('section', null, 'compare-section'), append(el('h3', null, 'compare-title'), el('del', s.title + ' (section deleted)', 'diff-del')), diffNode(text(s.html), '')));
    });
    box.appendChild(append(el('section', null, 'compare-section'), el('h3', 'Action items', 'compare-title'),
      diffNode(ai.actionItems.map(itemLine).join('\n'), current.actionItems.map(itemLine).join('\n'))));
    return box;
  }

  function preview(v) {
    var box = el('div', null, 'version-preview');
    v.content.sections.forEach(function (s) {
      box.appendChild(append(el('section', null, 'compare-section'), el('h3', s.title || 'Untitled section', 'compare-title'), el('p', MA.minutes.textOf(s.html) || '(empty)', 'version-text')));
    });
    var items = v.content.actionItems.filter(function (a) { return !a.dismissed; });
    box.appendChild(append(el('section', null, 'compare-section'), el('h3', 'Action items (' + items.length + ')', 'compare-title'), append.apply(null, [el('ul', null, 'version-items')].concat(items.map(function (a) { return el('li', itemLine(a)); })))));
    return box;
  }

  function when(iso) { return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }

  /** Opens the panel. actions.restoreVersion(n) restores; canRestore says whether restoring is allowed now. */
  function open(runId, opts) {
    var list = el('ol', null, 'version-list', { 'aria-label': 'Versions' });
    var detail = el('div', null, 'version-detail', { 'aria-live': 'polite' });
    var body = append(el('div', null, 'versions'), append(el('div', null, 'version-side'), ui.button('Compare with AI draft', 'secondary', function () { showCompare(); }, { icon: 'file-text', size: 'sm', id: 'compareAi' }), list), detail);
    MA.cal.dialog.open({ title: 'Version history', body: body, variant: 'dialog', initialFocus: '#compareAi' });
    document.querySelector('.cal-dialog').classList.add('cal-dialog-wide');
    detail.appendChild(el('p', 'Loading…', 'help'));
    var versions = [];
    function select(v, btn) {
      list.querySelectorAll('[aria-current]').forEach(function (n) { n.removeAttribute('aria-current'); });
      if (btn) btn.setAttribute('aria-current', 'true');
      detail.replaceChildren(el('p', 'Loading…', 'help'));
      MA.api.minutes.version(runId, v.number).then(function (full) {
        var head = append(el('div', null, 'version-head'), append(el('div'), el('strong', 'Version ' + v.number + ' · ' + KIND[v.kind]), el('div', v.author + ' · ' + when(v.updatedAt) + (v.reason ? ' · Reason: ' + v.reason : ''), 'help')),
          opts.canRestore() && v.number !== versions[0].number ? ui.button('Restore this version', 'primary', function () { opts.restore(v.number); }, { size: 'sm', icon: 'rotate-ccw', id: 'restoreVersion' }) : null);
        detail.replaceChildren(head, preview(full));
      }).catch(function (err) { detail.replaceChildren(ui.callout('danger', 'circle-alert', 'Couldn’t load that version.', err.message)); });
    }
    function showCompare() {
      list.querySelectorAll('[aria-current]').forEach(function (n) { n.removeAttribute('aria-current'); });
      var ai = versions.find(function (v) { return v.kind === 'ai_draft'; });
      if (!ai) { detail.replaceChildren(el('p', 'There is no AI draft for this meeting.', 'help')); return; }
      MA.api.minutes.version(runId, ai.number).then(function (full) { detail.replaceChildren(el('strong', 'Your changes compared with the AI draft'), compare(full.content, MA.minutes.get().content)); })
        .catch(function (err) { detail.replaceChildren(ui.callout('danger', 'circle-alert', 'Couldn’t compare.', err.message)); });
    }
    MA.api.minutes.versions(runId).then(function (vs) {
      versions = vs;
      vs.forEach(function (v, i) {
        var b = append(el('button', null, 'version-item', { type: 'button' }), el('strong', i === 0 ? 'Current version' : 'Version ' + v.number), el('span', KIND[v.kind] + ' · ' + v.author, 'help'), el('span', when(v.updatedAt), 'help'));
        b.addEventListener('click', function () { select(v, b); });
        list.appendChild(append(el('li'), b));
      });
      showCompare();
    }).catch(function (err) { detail.replaceChildren(ui.callout('danger', 'circle-alert', 'Couldn’t load the history.', err.message)); });
  }

  MA.review = MA.review || {};
  MA.review.versions = { open: open, diff: diff, compare: compare };
})();
