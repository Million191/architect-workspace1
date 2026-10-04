// Meeting Assistant — keeps every recorded chunk on this device (IndexedDB) until the server has it,
// uploads in order with retries, and survives dropped connections, closed tabs, and crashes.
(function () {
  var DB_NAME = 'ma-recordings', DB_VERSION = 1;
  var memory = { recordings: {}, chunks: {} }; // used when IndexedDB isn't available (private windows)
  var dbPromise = null, persistent = true;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve) {
      if (!window.indexedDB) { persistent = false; resolve(null); return; }
      var req;
      try { req = window.indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { persistent = false; resolve(null); return; }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('recordings')) db.createObjectStore('recordings', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks', { keyPath: ['recId', 'index'] });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { persistent = false; resolve(null); };
    });
    return dbPromise;
  }
  function tx(store, mode, fn) {
    return openDb().then(function (db) {
      if (!db) return fn(null);
      return new Promise(function (resolve, reject) {
        var t = db.transaction(store, mode), s = t.objectStore(store), out;
        var r = fn(s);
        if (r && 'onsuccess' in r) r.onsuccess = function () { out = r.result; };
        t.oncomplete = function () { resolve(out); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error || new Error('Saving on this device failed.')); };
      });
    });
  }
  function memKey(recId, index) { return recId + ':' + index; }

  var local = {
    putRecording: function (rec) { return tx('recordings', 'readwrite', function (s) { if (!s) { memory.recordings[rec.id] = rec; return null; } return s.put(rec); }); },
    getRecording: function (id) { return tx('recordings', 'readonly', function (s) { return s ? s.get(id) : null; }).then(function (r) { return r || memory.recordings[id]; }); },
    allRecordings: function () { return tx('recordings', 'readonly', function (s) { return s ? s.getAll() : null; }).then(function (r) { return r || Object.keys(memory.recordings).map(function (k) { return memory.recordings[k]; }); }); },
    deleteRecording: function (id) {
      return tx('recordings', 'readwrite', function (s) { if (!s) { delete memory.recordings[id]; return null; } return s.delete(id); })
        .then(function () { return local.pending(id); })
        .then(function (chunks) { return Promise.all(chunks.map(function (c) { return local.deleteChunk(id, c.index); })); });
    },
    putChunk: function (recId, index, blob) { return tx('chunks', 'readwrite', function (s) { if (!s) { memory.chunks[memKey(recId, index)] = { recId: recId, index: index, blob: blob }; return null; } return s.put({ recId: recId, index: index, blob: blob }); }); },
    deleteChunk: function (recId, index) { return tx('chunks', 'readwrite', function (s) { if (!s) { delete memory.chunks[memKey(recId, index)]; return null; } return s.delete([recId, index]); }); },
    /** This recording's chunks still waiting for the server, oldest first. */
    pending: function (recId) {
      return tx('chunks', 'readonly', function (s) { return s ? s.getAll(window.IDBKeyRange.bound([recId, 0], [recId, Infinity])) : null; })
        .then(function (r) {
          var list = r || Object.keys(memory.chunks).map(function (k) { return memory.chunks[k]; }).filter(function (c) { return c.recId === recId; });
          return list.sort(function (a, b) { return a.index - b.index; });
        });
    },
  };

  // ---- Uploader ---------------------------------------------------------------------------------
  var uploaders = {};

  /** fetch with a hard timeout, so a stalled connection becomes a retry instead of a hang. */
  function timedFetch(url, options, ms) {
    var ctrl = window.AbortController ? new AbortController() : null, timer = null;
    if (ctrl) { options.signal = ctrl.signal; timer = setTimeout(function () { ctrl.abort(); }, ms); }
    return fetch(url, options).finally(function () { clearTimeout(timer); });
  }

  /**
   * One uploader per recording. Sends pending chunks in order; on failure waits 1s, 2s, 4s … (max 30s)
   * and tries again, immediately when the browser comes back online. Never gives up on its own —
   * the chunks stay on the device until the server confirms them.
   */
  function uploader(rec, onStatus) {
    if (uploaders[rec.id]) { if (onStatus) uploaders[rec.id].onStatus = onStatus; return uploaders[rec.id]; }
    var u = { onStatus: onStatus, running: false, failures: 0, created: false, uploaded: 0, waiters: [], stopped: false };
    function report(state, extra) {
      local.pending(rec.id).then(function (list) {
        var status = Object.assign({ state: state, pending: list.length, uploaded: u.uploaded, persistent: persistent }, extra || {});
        u.last = status;
        if (u.onStatus) u.onStatus(status);
        if (!list.length && state === 'ok') { var w = u.waiters.splice(0); w.forEach(function (fn) { fn(); }); }
      });
    }
    function ensureCreated() {
      if (u.created) return Promise.resolve();
      return MA.api.recordings.create(rec.serverBody).then(function () { u.created = true; });
    }
    function backoff() { return Math.min(30000, 1000 * Math.pow(2, Math.min(u.failures, 5))); }
    function pump() {
      if (u.running || u.stopped) return;
      u.running = true;
      ensureCreated().then(function () { return local.pending(rec.id); }).then(function step(list) {
        if (!list.length) return null;
        var c = list[0];
        return timedFetch('/api/recordings/' + encodeURIComponent(rec.id) + '/chunks/' + c.index, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: c.blob }, 30000)
          .then(function (res) {
            if (!res.ok) { var err = new Error('Upload failed (' + res.status + ')'); err.status = res.status; throw err; }
            u.failures = 0;
            u.uploaded++;
            return local.deleteChunk(rec.id, c.index);
          })
          .then(function () { report('ok'); return local.pending(rec.id); })
          .then(step);
      }).then(function () {
        u.running = false;
        report('ok');
      }).catch(function (err) {
        u.running = false;
        u.failures++;
        var offline = navigator.onLine === false;
        report(offline ? 'offline' : 'retrying', { error: err.message, retryInMs: backoff() });
        clearTimeout(u.timer);
        u.timer = setTimeout(pump, backoff());
      });
    }
    u.kick = pump;
    u.add = function (index, blob) { return local.putChunk(rec.id, index, blob).then(function () { pump(); }); };
    /** Resolves once every chunk on this device has reached the server. */
    u.drained = function () {
      return local.pending(rec.id).then(function (list) {
        if (!list.length && u.created) return null;
        return new Promise(function (resolve) { u.waiters.push(resolve); pump(); });
      });
    };
    u.stop = function () { u.stopped = true; clearTimeout(u.timer); delete uploaders[rec.id]; };
    window.addEventListener('online', function () { if (!u.stopped) { u.failures = 0; clearTimeout(u.timer); pump(); } });
    uploaders[rec.id] = u;
    return u;
  }

  MA.chunks = { local: local, uploader: uploader, isPersistent: function () { return openDb().then(function () { return persistent; }); } };
})();
