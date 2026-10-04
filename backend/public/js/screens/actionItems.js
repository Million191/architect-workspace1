// Screen — Action items across all approved meetings (read-only; recorded at final approval).
(function () {
  var ui = MA.ui, el = ui.el, append = ui.append;
  var STATUS = { 'Not Started': { label: 'Not started', kind: 'neutral' }, Stale: { label: 'Overdue review', kind: 'warning' }, Done: { label: 'Done', kind: 'success' } };

  MA.screens['action-items'] = {
    title: 'Action items',
    render: function (root, ctx) {
      var s = ctx.state;
      root.appendChild(ui.pageHeader('Action items', {
        meta: el('p', 'Everything assigned in approved meetings. Items are recorded when a meeting gets its final approval.', 'meta'),
        actions: [ui.button('Upload meeting', 'primary', function () { ctx.actions.go('upload'); }, { icon: 'upload', id: 'primaryAction' })],
      }));
      var card = el('section', null, 'card');
      if (!s.actionItems) {
        root.appendChild(append(card, append(el('div', null, 'card-pad'), el('span', null, 'skeleton skeleton-line', { style: 'width:60%' }), el('span', null, 'skeleton skeleton-line', { style: 'width:80%' }))));
        return;
      }
      var items = s.actionItems;
      if (!s.actionItems.length) {
        card.appendChild(ui.emptyState('list-checks', 'No action items yet', 'Action items show up here once a meeting’s minutes get final approval.'));
        root.appendChild(card);
        return;
      }
      function meetingLink(a, cls) {
        var link = el('a', a.meetingTitle || 'Untitled meeting', cls || null, { href: '?run=' + encodeURIComponent(a.runId) });
        link.addEventListener('click', function (e) { e.preventDefault(); ctx.actions.openMeeting(a.runId); });
        return link;
      }
      function owner(a) { return a.owner ? ui.personChip(a.owner) : el('span', 'Not specified', 'not-specified'); }
      function due(a) { return a.dueDate ? el('span', ui.longDate(a.dueDate) || a.dueDate) : el('span', 'Not specified', 'not-specified'); }
      function status(a) { return ui.badge(STATUS[a.status] || { label: a.status, kind: 'neutral' }); }

      // Tablet: the Meeting column folds into a line under the task instead of squeezing five columns.
      var table = el('table', null, 'table'), head = el('tr');
      [['Task', ''], ['Owner', ''], ['Due', ''], ['Meeting', 'col-meeting'], ['Status', '']].forEach(function (h) { head.appendChild(el('th', h[0], h[1] || null, { scope: 'col' })); });
      append(table, append(el('thead'), head));
      var body = el('tbody');
      items.forEach(function (a) {
        append(body, append(el('tr'), append(el('td'), el('span', a.task), append(el('span', null, 'cell-sub tablet-only'), meetingLink(a))),
          append(el('td'), owner(a)), append(el('td'), due(a)), append(el('td', null, 'col-meeting'), meetingLink(a)), append(el('td'), status(a))));
      });
      table.appendChild(body);
      card.appendChild(append(el('div', null, 'table-wrap wide-only-block'), table));

      // Phone: one card per item.
      var cards = el('ul', null, 'meeting-cards narrow-only-block', { 'aria-label': 'Action items' });
      items.forEach(function (a) {
        cards.appendChild(append(el('li', null, 'meeting-card'),
          append(el('div', null, 'meeting-card-top'), el('span', a.task, 'meeting-card-title')),
          append(el('div', null, 'meeting-card-meta'), owner(a), status(a)),
          append(el('div', null, 'meeting-card-foot'), append(el('span', null, 'muted'), 'Due ', due(a)), meetingLink(a, 'cell-link'))));
      });
      card.appendChild(cards);
      root.appendChild(card);
    },
  };
})();
