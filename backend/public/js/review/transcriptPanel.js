// Review — transcript panel: lines with speaker + time, live-recording markers, jump-to-moment,
// and "Add to minutes" (select text, or use a line's time button) as a quote or a note.
(function () {
  var ui = MA.ui, el = ui.el, append = ui.append;

  function highlight(root, ms) {
    var lines = Array.prototype.slice.call(root.querySelectorAll('.transcript-line'));
    var line = root.querySelector('.transcript-line[data-start="' + ms + '"]') || lines.filter(function (l) { return Number(l.getAttribute('data-start')) <= ms; }).pop() || lines[0];
    root.querySelectorAll('.transcript-line.is-highlighted').forEach(function (n) { n.classList.remove('is-highlighted'); });
    if (!line) return null;
    line.classList.add('is-highlighted');
    if (line.scrollIntoView) line.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return line;
  }

  function addMarkers(list, runId) {
    MA.api.recordings.forRun(runId).then(function (recording) {
      if (!recording.markers || !recording.markers.length) return;
      recording.markers.forEach(function (m) {
        var lines = Array.prototype.slice.call(list.querySelectorAll('.transcript-line'));
        var before = lines.find(function (li) { return Number(li.getAttribute('data-start')) >= m.atMs; });
        list.insertBefore(append(el('li', null, 'transcript-marker', { 'aria-label': 'Marker at ' + ui.clock(m.atMs) + ': ' + m.note }), el('span', ui.clock(m.atMs), 'transcript-time'), append(el('span', null, 'transcript-marker-note'), MA.icon('plus'), m.note)), before || null);
      });
    }).catch(function () { /* not a live recording */ });
  }

  function escape(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  /** Choose the section and the form (quote / note), then append it as an edit. */
  function insertMenu(anchor, text, seg, ctx) {
    var sections = MA.minutes.get().content.sections;
    var stamp = (seg.speakerLabel ? seg.speakerLabel + ', ' : '') + ui.clock(seg.startMs);
    var items = [];
    sections.forEach(function (s) {
      items.push({ label: 'Quote in “' + (s.title || 'Untitled') + '”', icon: 'messages-square', run: function () { ctx.insert(s.id, '<blockquote>“' + escape(text) + '” — ' + escape(stamp) + '</blockquote>', s.title); } });
      items.push({ label: 'Note in “' + (s.title || 'Untitled') + '”', icon: 'file-text', run: function () { ctx.insert(s.id, '<p><em>Note (' + escape(stamp) + '):</em> ' + escape(text) + '</p>', s.title); } });
    });
    items.push({ label: 'Quote in a new “Notes” section', icon: 'plus', run: function () { ctx.insertNew('<blockquote>“' + escape(text) + '” — ' + escape(stamp) + '</blockquote>'); } });
    MA.menu.open(anchor, items);
  }

  /** run: the pipeline run; ctx: { editable, insert(sectionId, html, title), insertNew(html) } */
  function render(run, ctx) {
    var panel = el('section', null, 'card transcript-panel', { 'aria-labelledby': 'transcriptHeading', id: 'transcriptPanel' });
    panel.appendChild(append(el('div', null, 'card-head'), append(el('h2', null, 'section-title', { id: 'transcriptHeading' }), 'Transcript', el('span', run.transcript.length + ' lines', 'count')),
      ctx.editable ? el('span', 'Select text to add it to the minutes', 'help transcript-hint') : null, ctx.headExtra || null));
    var list = el('ol', null, 'transcript-list');
    run.transcript.forEach(function (seg, i) {
      var time = el('button', ui.clock(seg.startMs), 'transcript-time transcript-time-btn', { type: 'button', 'aria-label': ctx.editable ? 'Line at ' + ui.clock(seg.startMs) + ' — add to minutes' : 'Line at ' + ui.clock(seg.startMs), 'aria-haspopup': ctx.editable ? 'menu' : null });
      if (!ctx.editable) time.removeAttribute('aria-haspopup');
      if (ctx.editable) time.addEventListener('click', function () { insertMenu(time, seg.text, seg, ctx); });
      list.appendChild(append(el('li', null, 'transcript-line', { 'data-start': String(seg.startMs), 'data-index': String(i) }), time,
        append(el('div'), append(el('div', null, 'transcript-speaker'), ui.avatar(MA.people.resolve({ name: seg.speakerLabel, email: (run.recipients || {})[seg.speakerLabel] }), { decorative: true }), el('span', seg.speakerLabel, 'speaker-name')), el('div', seg.text || '[inaudible]', 'transcript-text'))));
    });
    panel.appendChild(list);
    addMarkers(list, run.runId);

    if (ctx.editable) {
      // Selecting text shows a floating "Add to minutes" button next to the selection.
      var floating = ui.button('Add to minutes', 'primary', null, { icon: 'plus', size: 'sm', id: 'addFromTranscript' });
      floating.classList.add('transcript-add');
      floating.hidden = true;
      panel.appendChild(floating);
      var pending = null;
      floating.addEventListener('mousedown', function (e) { e.preventDefault(); });
      floating.addEventListener('click', function () { if (pending) insertMenu(floating, pending.text, pending.seg, ctx); });
      list.addEventListener('mouseup', function () { setTimeout(check, 0); });
      list.addEventListener('keyup', function (e) { if (e.shiftKey) check(); });
      function check() {
        var sel = window.getSelection && window.getSelection();
        var text = sel ? String(sel).replace(/\s+/g, ' ').trim() : '';
        var node = sel && sel.anchorNode, line = node && (node.nodeType === 1 ? node : node.parentElement).closest('.transcript-line');
        if (!text || !line || !list.contains(line)) { floating.hidden = true; pending = null; return; }
        pending = { text: text.slice(0, 1000), seg: run.transcript[Number(line.getAttribute('data-index'))] };
        var r = sel.getRangeAt(0).getBoundingClientRect(), p = panel.getBoundingClientRect();
        floating.style.top = Math.max(48, r.bottom - p.top + 6) + 'px';
        floating.style.left = Math.max(8, Math.min(r.left - p.left, p.width - 160)) + 'px';
        floating.hidden = false;
      }
    }
    return panel;
  }

  MA.review = MA.review || {};
  MA.review.transcript = { render: render, highlight: highlight };
})();
