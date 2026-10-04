// Meeting Assistant — spell check while writing. Red wavy underlines drawn by a mirror layer behind
// the text; click or right-click a flagged word for suggestions, Ignore, or Add to dictionary.
// Words are only ever changed when the user picks a suggestion. Transcripts are never checked.
(function () {
  var ui = MA.ui, el = ui.el;
  var IGNORE_KEY = 'ma.spellIgnore';
  var attached = [], queue = [], flushTimer = null;
  var COPY = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'textTransform', 'textIndent', 'textAlign', 'wordSpacing',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'boxSizing'];

  // ---- "Ignore" lasts for this browser session --------------------------------------------------
  function ignored() { try { return JSON.parse(window.sessionStorage.getItem(IGNORE_KEY) || '[]'); } catch (e) { return []; } }
  function ignore(word) {
    var list = ignored();
    if (list.indexOf(word.toLowerCase()) === -1) list.push(word.toLowerCase());
    try { window.sessionStorage.setItem(IGNORE_KEY, JSON.stringify(list)); } catch (e) { /* convenience only */ }
  }
  function visible(issues) { var skip = ignored(); return (issues || []).filter(function (i) { return skip.indexOf(i.word.toLowerCase()) === -1; }); }

  // ---- Batched checking: every field that changed in the same moment goes in one request ----------
  function check(texts) { return MA.api.spelling.check(texts).then(function (results) { return results.map(visible); }); }
  function schedule(field) {
    if (queue.indexOf(field) === -1) queue.push(field);
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 60);
  }
  function flush() {
    var batch = queue.splice(0).filter(function (f) { return f.isConnected; });
    if (!batch.length) return;
    var texts = batch.map(function (f) { return f.value; });
    check(texts).then(function (results) {
      batch.forEach(function (f, i) { if (f.value === texts[i]) { f._spellIssues = results[i]; draw(f); } });
    }).catch(function () { /* checking is a helper: if the server can't check, the field simply shows no underlines */ });
  }

  // ---- Drawing --------------------------------------------------------------------------------
  function draw(field) {
    var mirror = field._spellMirror, issues = field._spellIssues || [], text = field.value;
    if (!mirror) return;
    var cs = window.getComputedStyle(field);
    COPY.forEach(function (p) { mirror.style[p] = cs[p]; });
    // Sit exactly over the field's box (inline fields have negative margins).
    mirror.style.left = field.offsetLeft + 'px';
    mirror.style.top = field.offsetTop + 'px';
    mirror.style.width = field.offsetWidth + 'px';
    mirror.style.height = field.offsetHeight + 'px';
    // A single-line input centres its text vertically; one line box the height of the content area does the same.
    if (field.tagName === 'INPUT') mirror.style.lineHeight = Math.max(0, field.clientHeight - parseFloat(cs.paddingTop || 0) - parseFloat(cs.paddingBottom || 0)) + 'px';
    mirror.replaceChildren();
    var at = 0;
    issues.forEach(function (i) {
      if (i.offset < at || text.substr(i.offset, i.length) !== i.word) return; // stale
      mirror.appendChild(document.createTextNode(text.slice(at, i.offset)));
      mirror.appendChild(el('span', i.word, 'spell-err'));
      at = i.offset + i.length;
    });
    mirror.appendChild(document.createTextNode(text.slice(at) + '​'));
    mirror.scrollTop = field.scrollTop;
    mirror.scrollLeft = field.scrollLeft;
    var note = field._spellNote;
    note.textContent = issues.length ? issues.length + ' possible spelling mistake' + (issues.length === 1 ? '' : 's') + ': ' + issues.map(function (i) { return i.word; }).join(', ') + '. Right-click or press the menu key on a word for suggestions.' : '';
    field.classList.toggle('has-spelling-issues', issues.length > 0);
  }

  function issueAt(field, index) {
    return (field._spellIssues || []).find(function (i) { return index >= i.offset && index <= i.offset + i.length && field.value.substr(i.offset, i.length) === i.word; });
  }

  /** Replace exactly one flagged word with the chosen suggestion, then let the page save as if typed. */
  function apply(field, issue, replacement) {
    var v = field.value;
    field.value = v.slice(0, issue.offset) + replacement + v.slice(issue.offset + issue.length);
    var caret = issue.offset + replacement.length;
    try { field.setSelectionRange(caret, caret); } catch (e) { /* not focusable right now */ }
    field.focus();
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function openMenu(field, issue, keyboard) {
    var items = issue.suggestions.slice(0, 5).map(function (s) { return { label: s, icon: 'check', run: function () { apply(field, issue, s); } }; });
    if (!items.length) items.push({ label: 'No suggestions', hint: 'Edit the word yourself', run: function () { field.focus(); } });
    items.push({ label: 'Ignore', hint: 'For the rest of this session', icon: 'x', run: function () { ignore(issue.word); recheckAll(); field.focus(); } });
    items.push({ label: 'Add to dictionary', hint: 'Known for everyone on your team', icon: 'plus', run: function () {
      MA.api.spelling.addWord(issue.word, (MA.store.get().form.reviewer || '').trim()).then(function () {
        ui.toast('Added “' + issue.word + '” to the team dictionary');
        recheckAll();
      }).catch(function (err) { ui.toast(err.message, 'error'); });
      field.focus();
    } });
    MA.menu.close(false);
    var list = MA.menu.open(field, items, { focus: !!keyboard });
    if (list) { list.classList.add('spell-menu'); list.setAttribute('aria-label', 'Spelling suggestions for ' + issue.word); }
  }

  function recheckAll() { attached = attached.filter(function (f) { return f.isConnected; }); attached.forEach(schedule); }

  /** Adds spell checking to an <input type="text"> or <textarea>. Safe to call once per field render. */
  function attach(field) {
    if (!field || field._spellMirror) return field;
    var wrap = el('span', null, 'spell-wrap' + (field.tagName === 'TEXTAREA' ? ' spell-wrap-area' : ''));
    var mirror = el('span', null, 'spell-mirror', { 'aria-hidden': 'true' });
    var note = el('span', '', 'sr-only', { id: 'spell-' + Math.random().toString(36).slice(2, 10) });
    // Moving a node blurs it: keep focus and caret where the user had them.
    var hadFocus = document.activeElement === field, selStart = field.selectionStart, selEnd = field.selectionEnd;
    field.parentNode.insertBefore(wrap, field);
    wrap.appendChild(mirror);
    wrap.appendChild(field);
    wrap.appendChild(note);
    if (hadFocus) { field.focus(); try { field.setSelectionRange(selStart, selEnd); } catch (e) { /* type without selection */ } }
    field.setAttribute('spellcheck', 'false'); // the browser's own underline would double ours
    field.setAttribute('aria-describedby', ((field.getAttribute('aria-describedby') || '') + ' ' + note.id).trim());
    field._spellMirror = mirror;
    field._spellNote = note;
    var timer = null;
    field.addEventListener('input', function () { field._spellIssues = []; draw(field); clearTimeout(timer); timer = setTimeout(function () { schedule(field); }, 400); });
    field.addEventListener('scroll', function () { mirror.scrollTop = field.scrollTop; mirror.scrollLeft = field.scrollLeft; });
    field.addEventListener('click', function () {
      var issue = issueAt(field, field.selectionStart);
      if (issue) openMenu(field, issue, false); else if (MA.menu.isOpen()) MA.menu.close(false);
    });
    field.addEventListener('contextmenu', function (e) {
      var issue = issueAt(field, field.selectionStart);
      if (!issue) return; // ordinary right-click menu
      e.preventDefault();
      openMenu(field, issue, true);
    });
    attached.push(field);
    if (field.value.trim()) schedule(field);
    return field;
  }

  /**
   * Underlines words in read-only text (the email preview) without changing its text content.
   * Each text node is checked on its own, so words never straddle element boundaries.
   */
  function decorate(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes = [];
    while (walker.nextNode()) if (walker.currentNode.nodeValue.trim()) nodes.push(walker.currentNode);
    if (!nodes.length) return Promise.resolve(0);
    return check(nodes.map(function (n) { return n.nodeValue; })).then(function (results) {
      var total = 0;
      nodes.forEach(function (node, k) {
        var issues = results[k];
        if (!issues.length || !node.parentNode) return;
        var text = node.nodeValue, frag = document.createDocumentFragment(), at = 0;
        issues.forEach(function (i) {
          frag.appendChild(document.createTextNode(text.slice(at, i.offset)));
          frag.appendChild(el('span', i.word, 'spell-err spell-err-static', { title: 'Possible spelling mistake' + (i.suggestions.length ? ' — maybe: ' + i.suggestions.slice(0, 3).join(', ') : '') }));
          at = i.offset + i.length;
          total++;
        });
        frag.appendChild(document.createTextNode(text.slice(at)));
        node.parentNode.replaceChild(frag, node);
      });
      return total;
    }).catch(function () { return 0; });
  }

  // ---- Rich text (minutes editor): CSS Custom Highlights, so the editor's own text is never touched ----
  var richEditors = [];
  var supportsHighlights = !!(window.CSS && CSS.highlights && window.Highlight);
  function paintAll() {
    if (!supportsHighlights) return;
    var ranges = [];
    richEditors = richEditors.filter(function (r) { return r.q.root.isConnected; });
    richEditors.forEach(function (r) { ranges = ranges.concat(r.ranges || []); });
    var h = new Highlight();
    ranges.forEach(function (rg) { h.add(rg); });
    CSS.highlights.set('spelling', h);
  }
  /** DOM range for [index, index+length) of a Quill editor's text. */
  function rangeIn(q, index, length) {
    try {
      var a = q.getLeaf(index + 1), b = q.getLeaf(index + length);
      var startLeaf = a[0], endLeaf = b[0];
      if (!startLeaf || !endLeaf || startLeaf.domNode.nodeType !== 3 || endLeaf.domNode.nodeType !== 3) return null;
      var rg = document.createRange();
      rg.setStart(startLeaf.domNode, a[1] - 1);
      rg.setEnd(endLeaf.domNode, b[1]);
      return rg;
    } catch (e) { return null; }
  }
  /**
   * Spell check for a Quill editor. Underlines via CSS highlights (where supported); click a flagged
   * word for suggestions (focus stays in the text), right-click / menu key for a keyboard menu.
   */
  function attachRich(q, label) {
    var rec = { q: q, issues: [], ranges: [], label: label };
    richEditors.push(rec);
    var timer = null;
    function run() {
      var text = q.getText();
      if (!text.trim()) { rec.issues = []; rec.ranges = []; paintAll(); return; }
      check([text]).then(function (results) {
        if (q.getText() !== text) return; // changed while checking
        rec.issues = results[0];
        rec.ranges = rec.issues.map(function (i) { return rangeIn(q, i.offset, i.length); }).filter(Boolean);
        q.root.setAttribute('data-spelling-issues', String(rec.issues.length));
        paintAll();
      }).catch(function () { /* helper only */ });
    }
    q.on('text-change', function () { rec.ranges = []; paintAll(); clearTimeout(timer); timer = setTimeout(run, 600); });
    rec.recheck = run;
    function at(index) { return rec.issues.find(function (i) { return index >= i.offset && index <= i.offset + i.length && q.getText(i.offset, i.length) === i.word; }); }
    function menu(issue, keyboard) {
      var items = issue.suggestions.slice(0, 5).map(function (s) { return { label: s, icon: 'check', run: function () {
        q.deleteText(issue.offset, issue.length, 'user'); q.insertText(issue.offset, s, 'user'); q.setSelection(issue.offset + s.length, 0, 'user');
      } }; });
      if (!items.length) items.push({ label: 'No suggestions', hint: 'Edit the word yourself', run: function () { q.focus(); } });
      items.push({ label: 'Ignore', hint: 'For the rest of this session', icon: 'x', run: function () { ignore(issue.word); recheckAll(); q.focus(); } });
      items.push({ label: 'Add to dictionary', hint: 'Known for everyone on your team', icon: 'plus', run: function () {
        MA.api.spelling.addWord(issue.word, (MA.store.get().form.reviewer || '').trim()).then(function () { ui.toast('Added “' + issue.word + '” to the team dictionary'); recheckAll(); }).catch(function (err) { ui.toast(err.message, 'error'); });
        q.focus();
      } });
      MA.menu.close(false);
      var list = MA.menu.open(q.root, items, { focus: !!keyboard });
      if (list) { list.classList.add('spell-menu'); list.setAttribute('aria-label', 'Spelling suggestions for ' + issue.word); }
    }
    q.root.addEventListener('click', function () { var r = q.getSelection(); var issue = r && at(r.index); if (issue) menu(issue, false); });
    q.root.addEventListener('contextmenu', function (e) { var r = q.getSelection(); var issue = r && at(r.index); if (!issue) return; e.preventDefault(); menu(issue, true); });
    if (q.getText().trim()) setTimeout(run, 50);
    return rec;
  }
  var baseRecheck = recheckAll;
  recheckAll = function () { baseRecheck(); richEditors.forEach(function (r) { if (r.q.root.isConnected) r.recheck(); }); };

  MA.spell = { attach: attach, attachRich: attachRich, check: check, decorate: decorate, recheckAll: function () { recheckAll(); }, ignored: ignored, highlightsSupported: supportsHighlights };
})();
