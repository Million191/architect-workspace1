// Dashboard — "Recent activity": approvals, emails, edits and failures, newest first, from /api/activity.
// Each item opens its meeting. Hidden entirely when there is nothing to show.
(function () {
  var ui = MA.ui, el = ui.el, append = ui.append;
  var PAGE = 5, MAX = 50;
  var ICON = {
    draft_ready: 'file-text', minutes_approved: 'check', final_approved: 'shield-check', emails_sent: 'send',
    minutes_edited: 'pencil', minutes_restored: 'history', approved_minutes_edited: 'pencil', transcript_corrected: 'pencil', recording_failed: 'circle-alert',
  };

  function ago(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return '';
    var s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    if (s < 7 * 86400) { var d = Math.floor(s / 86400); return d === 1 ? 'yesterday' : d + ' days ago'; }
    return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  MA.dashboard = MA.dashboard || {};
  MA.dashboard.attachActivity = function (actions, store, api) {
    actions.dashLoadActivity = function () {
      return api.activity(MAX).then(function (res) {
        store.quiet({ activity: { items: res.items, total: res.total, shown: (store.get().activity || {}).shown || PAGE } });
        if (store.get().page === 'meetings') store.set({});
      }).catch(function () { store.quiet({ activity: { items: [], total: 0, shown: PAGE, error: true } }); });
    };
    actions.dashMoreActivity = function () {
      var act = store.get().activity;
      store.set({ activity: Object.assign({}, act, { shown: act.shown + PAGE }) });
      // Focus the first newly shown item (or keep it on "Show more" if that one isn't clickable).
      var li = document.querySelectorAll('.activity-item')[act.shown], next = li && li.querySelector('button');
      if (next) next.focus(); else if (document.getElementById('activityMore')) document.getElementById('activityMore').focus();
    };
  };

  MA.dashboard.renderActivity = function (root, ctx) {
    var act = ctx.state.activity, a = ctx.actions;
    if (!act || !act.items.length) return; // no data yet, or none at all: no empty box
    var list = el('ul', null, 'activity-list');
    act.items.slice(0, act.shown).forEach(function (item) {
      var when = el('time', ago(item.at), 'activity-time', { datetime: item.at, title: new Date(item.at).toLocaleString() });
      var body = append(el('span', null, 'activity-text'), el('span', item.text), item.by ? el('span', ' · ' + item.by, 'muted') : null);
      var row;
      if (item.runId) {
        row = append(el('button', null, 'activity-row', { type: 'button' }), MA.icon(ICON[item.kind] || 'clock', 'activity-icon'), body, when);
        row.addEventListener('click', function () { a.openMeeting(item.runId); });
      } else {
        row = append(el('div', null, 'activity-row'), MA.icon(ICON[item.kind] || 'clock', 'activity-icon'), body, when);
      }
      list.appendChild(append(el('li', null, 'activity-item activity-' + item.kind), row));
    });
    var section = append(el('section', null, 'card activity', { 'aria-labelledby': 'activityHeading' }),
      append(el('div', null, 'card-head'), el('h2', 'Recent activity', 'section-title', { id: 'activityHeading' })), list);
    if (act.items.length > act.shown) section.appendChild(append(el('div', null, 'activity-foot'), ui.button('Show more', 'ghost', function () { a.dashMoreActivity(); }, { size: 'sm', id: 'activityMore' })));
    root.appendChild(section);
  };
  MA.dashboard.ago = ago;
})();
