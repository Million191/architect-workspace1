// Meeting Assistant — the editable minutes on the page: one working copy, autosaved ~2 s after the
// last change, backed up in this browser until the server confirms it, retried when the connection
// returns, and never silently overwriting someone else's newer save.
(function () {
  var SAVE_DELAY_MS = 2000;
  var state = null, timer = null, inFlight = null, listeners = [];

  function key(runId) { return 'ma.minutes.' + runId; }
  function backup() {
    try { window.localStorage.setItem(key(state.runId), JSON.stringify({ content: state.content, baseRevision: state.view.revision, at: Date.now() })); } catch (e) { /* storage full or blocked: the page still saves */ }
  }
  function clearBackup(runId) { try { window.localStorage.removeItem(key(runId)); } catch (e) { /* ignore */ } }
  function readBackup(runId) { try { return JSON.parse(window.localStorage.getItem(key(runId)) || 'null'); } catch (e) { return null; } }
  function emit() { listeners.forEach(function (fn) { fn(state); }); }
  function copy(v) { return JSON.parse(JSON.stringify(v)); }
  function plain(content) { return { sections: content.sections.map(strip), actionItems: content.actionItems.map(strip) }; }
  function strip(x) { var o = Object.assign({}, x); delete o.edited; return o; }

  function onBeforeUnload(e) {
    if (!state || (!state.dirty && !inFlight)) return undefined;
    e.preventDefault();
    e.returnValue = 'Your latest changes to the minutes haven’t saved yet.';
    return e.returnValue;
  }
  window.addEventListener('beforeunload', onBeforeUnload);
  window.addEventListener('online', function () { if (state && state.dirty && state.status === 'error') save(); });

  /** status: 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict' */
  function setStatus(status, extra) { Object.assign(state, { status: status }, extra || {}); emit(); }

  function save() {
    if (!state || !state.dirty) return inFlight || Promise.resolve();
    if (state.reopening) return Promise.reject(new Error('Choose Save changes (the minutes will need approval again) or Cancel first.'));
    if (inFlight) return inFlight.then(save);
    clearTimeout(timer);
    var runId = state.runId, sent = copy(state.content), sentAt = state.changeCount;
    setStatus('saving');
    var fresh = !!state.newVersionNext;
    inFlight = MA.api.minutes.save(runId, Object.assign({ content: plain(sent), baseRevision: state.view.revision, editedBy: (MA.store.get().form.reviewer || '').trim() }, fresh ? { newVersion: true } : {}))
      .then(function (view) {
        inFlight = null;
        if (fresh && state && state.runId === runId) state.newVersionNext = false; // later saves in this session fold into it
        if (!state || state.runId !== runId) return;
        state.view = view;
        if (state.changeCount === sentAt) { state.dirty = false; state.content = copy(view.content); clearBackup(runId); setStatus('saved', { error: null }); }
        else { backup(); setStatus('dirty'); schedule(); } // more typing happened while saving
      })
      .catch(function (err) {
        inFlight = null;
        if (!state || state.runId !== runId) return;
        if (err.errorClass === 'MinutesConflict') setStatus('conflict', { conflict: { updatedBy: (err.body && err.body.updatedBy) || 'Someone', revision: err.body && err.body.revision } });
        else setStatus('error', { error: err.status === 0 ? 'You’re offline. Your changes are kept in this browser and will save when you’re back online.' : err.message });
        throw err;
      });
    return inFlight;
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(function () { save().catch(function () { /* status shows the problem */ }); }, SAVE_DELAY_MS); }

  MA.minutes = {
    /** Edit was chosen: the next save starts a new version, so the text from before this edit stays in the history. */
    startSession: function () { if (state) state.newVersionNext = true; },
    /** Loads the document; restores unsaved changes kept in this browser when they still apply. */
    load: function (runId) {
      return MA.api.minutes.get(runId).then(function (view) {
        state = { runId: runId, view: view, content: copy(view.content), dirty: false, status: 'idle', changeCount: 0, error: null, conflict: null, recovered: false };
        var b = readBackup(runId);
        if (b && b.content && view.state !== 'approved' && view.state !== 'locked') {
          if (b.baseRevision === view.revision && JSON.stringify(plain(b.content)) !== JSON.stringify(plain(view.content))) {
            state.content = b.content; state.dirty = true; state.recovered = true; state.changeCount = 1;
            schedule();
          } else if (b.baseRevision !== view.revision) {
            state.staleBackup = b; // someone saved since: offer the choice instead of guessing
          }
        }
        emit();
        return state;
      });
    },
    get: function () { return state; },
    /** Applies a change to the working copy. `mutate(content)` edits in place. */
    edit: function (mutate) {
      if (!state || !MA.minutes.editable()) return;
      mutate(state.content);
      state.dirty = true;
      state.changeCount++;
      backup();
      // Editing approved minutes: nothing reaches the server until Save changes (which reopens them first).
      if (state.status !== 'conflict') { setStatus('dirty'); if (!state.reopening) schedule(); }
    },
    editable: function () { return !!state && (state.view.state === 'draft' || state.view.state === 'amending' || !!state.reopening) && state.status !== 'conflict'; },
    /** Approved minutes: edit locally after the "approval again" warning; nothing is saved yet. */
    beginReopen: function () { if (state) { state.reopening = { content: copy(state.content) }; emit(); } },
    isReopening: function () { return !!(state && state.reopening); },
    /** Save changes on approved minutes: withdraw the approval on the server, then save the edits. */
    commitReopen: function (by) {
      var runId = state.runId;
      return MA.api.minutes.reopen(runId, by).then(function (view) {
        if (!state || state.runId !== runId) return;
        state.view = view;
        state.reopening = null;
        return save();
      });
    },
    /** Cancel on approved minutes: back exactly as approved; the approval stands. */
    cancelReopen: function () {
      if (!state || !state.reopening) return;
      clearTimeout(timer);
      state.content = state.reopening.content; state.reopening = null; state.dirty = false;
      clearBackup(state.runId);
      setStatus('idle');
    },
    /** Save now (before approving, leaving, or on "Retry"). Resolves when everything is on the server. */
    flush: function () { return save(); },
    retry: function () { return save(); },
    /** Replace the working copy with a server view (after restore, reload, amendment start). */
    replace: function (view) {
      clearTimeout(timer);
      state.view = view; state.content = copy(view.content); state.dirty = false; state.conflict = null; state.staleBackup = null;
      clearBackup(state.runId);
      setStatus('saved');
    },
    /** "Use my unsaved changes" after someone else saved: keep my content on top of their revision. */
    keepMine: function () {
      var b = state.staleBackup;
      state.staleBackup = null;
      if (!b) return;
      state.content = b.content; state.dirty = true; state.changeCount++;
      backup(); setStatus('dirty'); schedule();
    },
    discardBackup: function () { state.staleBackup = null; clearBackup(state.runId); emit(); },
    subscribe: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; },
    /** Plain text of minutes HTML. DOMParser never runs scripts or loads images, unlike innerHTML on a live element. */
    textOf: function (html) { return new DOMParser().parseFromString('<body>' + (html || '').replace(/<\/(p|h2|h3|li|blockquote)>/gi, '</$1> ') + '</body>', 'text/html').body.textContent.replace(/\s+/g, ' ').trim(); },
    newId: function () { return window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); },
    /** Plain text of everything the reviewer wrote (for the spelling check before approval). */
    texts: function () {
      if (!state) return [];
      return state.content.sections.map(function (s) { return { where: s.title || 'Untitled section', text: (s.title ? s.title + '. ' : '') + MA.minutes.textOf(s.html) }; });
    },
  };
})();
