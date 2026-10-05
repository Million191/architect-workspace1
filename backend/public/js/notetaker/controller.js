// Notetaker — controller: consent, send/stop, live status (polled; faster while a bot is active),
// announcements, the top-bar "Notetaker recording" pill, and the hooks into the calendar.
(function () {
  var ui = MA.ui, el = ui.el, append = ui.append;
  var POLL_ACTIVE_MS = 4000, POLL_IDLE_MS = 30000;

  function announce(text) {
    var n = document.getElementById('botAnnounce');
    if (n) { n.textContent = ''; setTimeout(function () { n.textContent = text; }, 30); }
  }

  /** "Everyone in this meeting knows it is being recorded." Resolves true only once it's checked and confirmed. */
  function askConsent(title, intro, confirmLabel) {
    return new Promise(function (resolve) {
      var done = false;
      function finish(v) { if (done) return; done = true; MA.cal.dialog.close(); resolve(v); }
      var box = el('input', null, 'checkbox', { type: 'checkbox', id: 'botConsent' });
      var send = ui.button(confirmLabel, 'primary', function () { if (box.checked) finish(true); }, { id: 'botConsentSend', disabled: true, icon: 'mic' });
      box.addEventListener('change', function () { send.disabled = !box.checked; });
      var body = append(el('div', null, 'bot-consent'), el('p', intro),
        append(el('label', null, 'rec-consent', { for: 'botConsent' }), box, el('span', 'Everyone in this meeting knows it is being recorded.')));
      MA.cal.dialog.open({ title: title, body: body, variant: 'dialog', initialFocus: '#botConsent', onClose: function () { if (!done) { done = true; resolve(false); } },
        actions: [ui.button('Cancel', 'secondary', function () { finish(false); }), send] });
    });
  }

  MA.notetaker.attach = function (actions, store, api, hooks) {
    store.quiet({ notetaker: { configured: false, loaded: false, autoSend: false, byMeeting: {} } });
    function nt() { return store.get().notetaker; }
    function setNt(patch) { store.quiet({ notetaker: Object.assign({}, nt(), patch) }); }
    function reviewer() { return (store.get().form.reviewer || '').trim() || undefined; }
    function redraw() {
      var page = store.get().page;
      if ((page === 'meetings' || page === 'settings') && !MA.cal.dialog.isOpen()) store.set({});
      renderPill();
    }

    /** Top-bar pill while any notetaker is recording — always visible, on every page. */
    function renderPill() {
      var pill = document.getElementById('botPill');
      if (!pill) return;
      var recording = Object.keys(nt().byMeeting).map(function (k) { return nt().byMeeting[k]; }).filter(function (s) { return s.status === 'recording'; });
      pill.hidden = !recording.length;
      if (recording.length) pill.querySelector('.bot-pill-text').textContent = recording.length === 1 ? 'Notetaker recording · ' + recording[0].title : recording.length + ' notetakers recording';
    }

    function onChange(s, old) {
      var label = MA.notetaker.statusOf(s).label;
      announce(s.title + ': ' + label + (s.status === 'failed' && s.error ? '. ' + s.error.message : '.'));
      if (s.status === 'ready' && old && old.status !== 'ready') {
        ui.toast('Notetaker minutes for ' + s.title + ' are ready for review', null, { label: 'Open', run: function () { actions.openMeeting(s.runId, 'review'); } });
        if (hooks && hooks.loadLists) hooks.loadLists();
        if (actions.calRefreshNow) actions.calRefreshNow(); // the meeting now has minutes: drop it from "Happening now"
      }
      if (s.status === 'failed' && old && old.status !== 'failed') ui.toast(s.title + ': ' + (s.error ? s.error.message : 'the notetaker failed.'), 'error');
    }

    var timer = null;
    function schedule() {
      clearTimeout(timer);
      var any = Object.keys(nt().byMeeting).some(function (k) { return MA.notetaker.isActive(nt().byMeeting[k]); });
      timer = setTimeout(refresh, any ? POLL_ACTIVE_MS : POLL_IDLE_MS);
    }
    function refresh() {
      return api.notetaker.sessions().then(function (res) {
        var before = nt().byMeeting, next = {}, changed = Object.keys(before).length !== res.sessions.length;
        res.sessions.forEach(function (s) {
          next[s.scheduledMeetingId] = s;
          var old = before[s.scheduledMeetingId];
          if (!old || old.status !== s.status || old.id !== s.id) { changed = true; if (old) onChange(s, old); }
        });
        setNt({ byMeeting: next });
        if (changed) redraw();
      }).catch(function () { /* status is a convenience; the next poll tries again */ }).then(schedule);
    }
    actions.notetakerRefresh = refresh;

    function loadStatus() {
      return api.notetaker.status().then(function (st) { setNt({ configured: st.configured, provider: st.provider, autoSend: st.settings.autoSendToSynced, loaded: true }); redraw(); })
        .catch(function () { setNt({ configured: false, loaded: true, unavailable: true }); });
    }

    function remember(s) { var by = Object.assign({}, nt().byMeeting); by[s.scheduledMeetingId] = s; setNt({ byMeeting: by }); }

    actions.notetakerSend = function (m) {
      if (store.get().busy) return Promise.resolve();
      return askConsent('Send the notetaker?', 'Meeting Assistant Notetaker joins “' + m.title + '”, records it, and posts a message in the meeting chat saying it is recording. The minutes are drafted for your review — nothing is shared without approval.', 'Send notetaker').then(function (ok) {
        if (!ok) return;
        return api.notetaker.send(m.id, reviewer()).then(function (s) {
          remember(s);
          announce(m.title + ': ' + MA.notetaker.statusOf(s).label + '.');
          ui.toast(s.status === 'scheduled' ? 'Notetaker scheduled — it joins at ' + MA.cal.model.fmtTime(new Date(s.joinAt)) : 'Notetaker is joining ' + m.title);
          redraw();
          schedule();
        }).catch(function (err) { ui.toast(err.message, 'error'); refresh(); });
      });
    };

    actions.notetakerStop = function (s) {
      function stop() {
        return api.notetaker.stop(s.id).then(function (next) {
          remember(next);
          announce(next.title + ': ' + MA.notetaker.statusOf(next).label + '.');
          ui.toast(next.status === 'processing' ? 'Notetaker left — processing the recording' : 'Notetaker stopped');
          redraw();
          schedule();
        }).catch(function (err) { ui.toast(err.message, 'error'); refresh(); });
      }
      if (s.status !== 'recording') return stop();
      return new Promise(function (resolve) {
        MA.cal.dialog.open({ title: 'Stop recording?', variant: 'dialog', initialFocus: '#botStopConfirm',
          body: el('p', 'The notetaker leaves the meeting. What was recorded so far becomes draft minutes for your review.'),
          actions: [ui.button('Keep recording', 'secondary', function () { MA.cal.dialog.close(); resolve(); }),
            ui.button('Stop recording', 'danger', function () { MA.cal.dialog.close(); stop().then(resolve); }, { id: 'botStopConfirm', icon: 'square' })] });
      });
    };

    actions.notetakerRetry = function (s) {
      ui.toast('Processing the recording again…');
      return api.notetaker.retry(s.id).then(function (next) { remember(next); redraw(); schedule(); onChange(next, s); })
        .catch(function (err) { ui.toast(err.message, 'error'); refresh(); });
    };

    actions.notetakerSetAuto = function (on) {
      var go = on ? askConsent('Send the notetaker automatically?', 'For meetings synced from your calendar that have a Zoom, Teams or Google Meet link, the notetaker joins at the start time and announces itself in the chat. You can turn it off for any meeting.', 'Turn on') : Promise.resolve(true);
      return go.then(function (ok) {
        if (!ok) { redraw(); return; }
        return api.notetaker.setSettings({ autoSendToSynced: on, consent: on || undefined, confirmedBy: reviewer() }).then(function (res) {
          setNt({ autoSend: res.autoSendToSynced });
          ui.toast(res.autoSendToSynced ? 'The notetaker will join synced meetings automatically' : 'Automatic notetaker turned off');
          redraw();
        }).catch(function (err) { ui.toast(err.message, 'error'); redraw(); });
      });
    };

    /** The switch + status for a calendar meeting (details popover, "Happening now" banner). */
    actions.notetakerControl = function (m, opts) {
      if (!nt().loaded || nt().unavailable) return null;
      var s = nt().byMeeting[m.id];
      return MA.notetaker.control(m, {
        session: s, configured: nt().configured, compact: opts && opts.compact,
        onToggle: function (on) { MA.cal.dialog.close(); if (on) actions.notetakerSend(m); else if (s) actions.notetakerStop(s); },
        onRetry: function (x) { MA.cal.dialog.close(); actions.notetakerRetry(x); },
        onOpen: function (x) { MA.cal.dialog.close(); actions.openMeeting(x.runId, 'review'); },
      });
    };

    // Calendar hooks: platform logo + bot status on blocks and list rows; the control in the details popover.
    var prevExtras = actions.calBlockExtras;
    actions.calBlockExtras = function (m) {
      var s = nt().byMeeting[m.id], logo = MA.notetaker.platformLogo(m.platform || MA.cal.platformOf(m.link));
      var prev = prevExtras ? prevExtras(m) : null;
      if (!logo && !s && !prev) return null;
      return append(el('span', null, 'cal-block-extras'), logo, s && (MA.notetaker.isActive(s) || s.status === 'failed') ? MA.notetaker.statusBadge(s, { compact: true }) : null, prev);
    };
    // Blocks tall enough for a third line show logo + status bottom-left; short blocks show only the logo.
    var prevDecorate = actions.calDecorateBlock;
    actions.calDecorateBlock = function (block, m, hours, hourPx) {
      if (prevDecorate) prevDecorate(block, m, hours, hourPx);
      if (parseFloat(block.style.height) >= 48) block.classList.add('is-roomy');
      if (block.querySelector('.cal-block-extras .platform-logo')) block.classList.add('has-logo');
    };
    var prevExtra = actions.calDetailExtra;
    actions.calDetailExtra = function (m) {
      var mine = actions.notetakerControl(m), prev = prevExtra ? prevExtra(m) : null;
      return mine || prev ? append(el('div'), mine, prev) : null;
    };

    var pill = document.getElementById('botPill');
    if (pill) pill.addEventListener('click', function () { actions.go('meetings'); if (actions.calOpen) actions.calOpen(); });
    loadStatus();
    refresh();
  };
})();
