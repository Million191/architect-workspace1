// Meeting Assistant — live recording actions: setup → recording → stop → upload remaining parts →
// process (Uploading → Transcribing → Drafting minutes) → review. Also recovery of recordings left
// unfinished by a crash or a closed tab, and discarding them.
(function () {
  MA.recordActions = { attach: attach };

  function uid() { return window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12); }
  function announce(text) { var n = document.getElementById('recAnnounce'); if (n) { n.textContent = ''; setTimeout(function () { n.textContent = text; }, 30); } }

  function attach(actions, store, api, helpers) {
    var ui = MA.ui, timer = null, pollTimer = null, baseTitle = null;
    function rec() { return store.get().rec; }
    function setRec(patch, quiet) { var next = Object.assign({}, rec(), patch); if (quiet) store.quiet({ rec: next }); else store.set({ rec: next }); }

    function elapsed() {
      var r = rec();
      if (!r || !r.startedAt) return 0;
      var pausedNow = r.paused && r.pausedAt ? Date.now() - r.pausedAt : 0;
      return Math.max(0, Date.now() - r.startedAt - r.pausedTotal - pausedNow);
    }
    actions.recElapsed = elapsed;

    function onBeforeUnload(e) { e.preventDefault(); e.returnValue = 'A recording is in progress. If you leave, recording stops (what was captured so far is kept on this device).'; return e.returnValue; }
    function tick() {
      var t = document.getElementById('recTimer'), clock = ui.clock(elapsed());
      if (t) t.textContent = clock;
      var pill = document.getElementById('recPillTime');
      if (pill) pill.textContent = clock;
      var r = rec();
      document.title = (r && r.paused ? '❚❚ Paused – ' : '● Recording – ') + clock;
    }

    /** "Record meeting" → setup screen. opts.scheduled: a calendar meeting {id, title, participants}. */
    actions.recordMeeting = function (mode, opts) {
      if (MA.recorder.isActive()) { actions.go('record'); return; }
      var scheduled = opts && opts.scheduled;
      store.set({ page: 'record', notice: null, rec: {
        mode: mode === 'browser_capture' ? 'browser_capture' : 'in_person', phase: 'setup', consent: false, error: null, starting: false,
        title: scheduled ? scheduled.title : '', scheduled: scheduled || null,
        attendees: scheduled ? scheduled.participants.map(function (p) { return p.name ? p.name + ' <' + p.email + '>' : p.email; }).join(', ') : '',
        devices: [], deviceId: '', markers: [], paused: false, pausedTotal: 0, upload: null,
      } });
    };
    actions.recSet = function (patch) { setRec(patch, true); };
    actions.recCancel = function () { MA.recorder.stopPreview(); store.set({ rec: null }); actions.go('meetings'); };

    actions.recCheckMic = function () {
      var help = document.getElementById('recMicHelp');
      if (help) help.textContent = 'Asking for microphone permission…';
      return MA.recorder.startPreview(rec().deviceId, function (v) { MA.screens.record.setLevel('recPreviewLevel', v); }).then(function (devices) {
        setRec({ devices: devices, error: null });
      }).catch(function (err) { setRec({ error: err.message }); });
    };

    actions.recStart = function () {
      var r = rec();
      if (!r || r.starting || r.phase !== 'setup') return;
      if (!r.consent) { setRec({ error: 'Confirm that everyone in this meeting knows it is being recorded.' }); return; }
      setRec({ starting: true, error: null });
      var id = uid(), localRec = null, pending = [], uploader = null;
      function handOver(blob, index) {
        if (!uploader) { pending.push([index, blob]); return; }
        uploader.add(index, blob);
        localRec.chunkCount = Math.max(localRec.chunkCount, index + 1);
        localRec.durationMs = elapsed();
        MA.chunks.local.putRecording(localRec);
      }
      MA.recorder.start({
        mode: r.mode, deviceId: r.deviceId,
        onChunk: handOver,
        onLevel: function (v) { MA.screens.record.setLevel('recLevel', v); },
        onMeetingAudio: function (ok) { setRec({ meetingAudio: ok }); announce(ok ? 'Meeting audio detected.' : 'No sound from the meeting tab yet.'); },
        onEnded: function (reason) {
          announce(reason === 'sharing_stopped' ? 'Screen sharing stopped. Recording stopped.' : 'The microphone was disconnected. Recording stopped.');
          ui.toast(reason === 'sharing_stopped' ? 'You stopped sharing the meeting tab, so the recording was stopped and is being processed.' : 'The microphone was disconnected, so the recording was stopped and is being processed.', 'error');
          actions.recStop();
        },
      }).then(function (started) {
        var cur = rec();
        localRec = {
          id: id, mode: cur.mode, startedAt: new Date().toISOString(), chunkCount: 0, durationMs: 0, markers: [], finished: false,
          title: cur.title.trim(), serverBody: { id: id, mode: cur.mode, title: cur.title.trim() || undefined, attendees: cur.attendees, scheduledMeetingId: cur.scheduled ? cur.scheduled.id : undefined, mimeType: started.mimeType, consent: true, confirmedBy: (store.get().form.reviewer || '').trim() || undefined },
        };
        return MA.chunks.local.putRecording(localRec).then(function () {
          uploader = MA.chunks.uploader(localRec, function (status) {
            var now = rec();
            if (now && now.id === id) { setRec({ upload: status }, true); MA.screens.record.setUpload(status); }
          });
          uploader.kick(); // creates the recording on the server right away
          pending.splice(0).forEach(function (p) { handOver(p[1], p[0]); });
          baseTitle = document.title;
          window.addEventListener('beforeunload', onBeforeUnload);
          timer = setInterval(tick, 500);
          setRec({ id: id, phase: 'live', starting: false, startedAt: Date.now(), pausedTotal: 0, paused: false, local: localRec });
          announce('Recording started.');
        });
      }).catch(function (err) {
        setRec({ starting: false, error: err.message });
        announce('Recording did not start. ' + err.message);
      });
    };

    function refocus(id) { var b = document.getElementById(id); if (b) b.focus(); }
    actions.recPause = function () { MA.recorder.pause(); setRec({ paused: true, pausedAt: Date.now() }); tick(); refocus('recPause'); announce('Recording paused.'); };
    actions.recResume = function () { var r = rec(); MA.recorder.resume(); setRec({ paused: false, pausedTotal: r.pausedTotal + (Date.now() - r.pausedAt), pausedAt: null }); tick(); refocus('recPause'); announce('Recording resumed.'); };
    actions.recOpenMarker = function () {
      setRec({ markerOpen: true, markerAt: elapsed() });
      var n = document.getElementById('recMarkerNote');
      if (n) n.focus();
    };
    actions.recCloseMarker = function () { setRec({ markerOpen: false }); var b = document.getElementById('recMarker'); if (b) b.focus(); };
    actions.recAddMarker = function (note) {
      var r = rec(), text = (note || '').trim();
      if (!text) { actions.recCloseMarker(); return; }
      var markers = r.markers.concat([{ atMs: r.markerAt, note: text.slice(0, 500) }]);
      r.local.markers = markers;
      MA.chunks.local.putRecording(r.local);
      setRec({ markers: markers, markerOpen: false });
      announce('Marker added at ' + ui.clock(r.markerAt) + '.');
      var b = document.getElementById('recMarker');
      if (b) b.focus();
    };

    function cleanupLive() {
      clearInterval(timer);
      timer = null;
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (baseTitle) document.title = baseTitle;
    }

    actions.recStop = function () {
      var r = rec();
      if (!r || r.phase !== 'live') return Promise.resolve();
      var durationMs = elapsed();
      setRec({ phase: 'stopping' });
      return MA.recorder.stop().then(function () {
        cleanupLive();
        r.local.durationMs = durationMs;
        r.local.stoppedAt = new Date().toISOString();
        return MA.chunks.local.putRecording(r.local);
      }).then(function () {
        announce('Recording stopped. Uploading and processing.');
        return actions.finishRecording(r.local.id);
      });
    };

    function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

    /**
     * Uploads whatever is still on the device, then processes the recording. Used after Stop, for
     * "Upload and process" on a recovered recording, and for "Try again".
     */
    actions.finishRecording = function (id) {
      return MA.chunks.local.getRecording(id).then(function (local) {
        if (!local) { ui.toast('That recording is no longer on this device.', 'error'); return null; }
        if (!local.chunkCount) {
          ui.toast('Nothing was recorded, so there’s nothing to process.', 'error');
          return actions.discardRecording(id, true);
        }
        store.set({ busy: true, page: 'processing', rec: null, upload: { id: id, recordingId: id, title: local.title || 'Recorded meeting', sentFraction: 0, stage: null, error: null, failedStage: null, startedAt: Date.now() } });
        var u = MA.chunks.uploader(local, function (status) {
          var cur = store.get();
          if (cur.upload.recordingId !== id || cur.upload.error) return;
          var fraction = local.chunkCount ? Math.min(1, (local.chunkCount - status.pending) / local.chunkCount) : 1;
          store.set({ upload: Object.assign({}, cur.upload, { sentFraction: fraction, offline: status.state === 'offline' }) });
        });
        return u.drained().then(function () {
          stopPolling();
          pollTimer = setInterval(function () {
            api.progress(id).then(function (p) {
              var cur = store.get();
              if (cur.upload.recordingId === id && !cur.upload.error) store.set({ upload: Object.assign({}, cur.upload, { sentFraction: 1, stage: p.stage || cur.upload.stage }) });
            }).catch(function () { /* progress is informational */ });
          }, 1000);
          return api.recordings.finish(id, { chunkCount: local.chunkCount, durationMs: local.durationMs || undefined, markers: local.markers && local.markers.length ? local.markers : undefined });
        }).then(function (res) {
          stopPolling();
          u.stop();
          local.finished = true;
          return MA.chunks.local.deleteRecording(id).then(function () {
            store.set({ busy: false, run: res.run, page: 'review', recovered: (store.get().recovered || []).filter(function (x) { return x.id !== id; }),
              upload: { id: null, sentFraction: 0, stage: null, error: null, failedStage: null, startedAt: null }, save: { state: 'idle' }, selectedRecipient: 0 });
            ui.toast('Draft minutes are ready for your review');
            helpers.loadLists();
          });
        });
      }).catch(function (err) {
        stopPolling();
        var cur = store.get();
        store.set({ busy: false, upload: Object.assign({}, cur.upload, { error: err.message, failedStage: err.stage || cur.upload.stage }) });
      });
    };

    actions.discardRecording = function (id, silent) {
      return MA.chunks.local.deleteRecording(id).then(function () {
        return api.recordings.discard(id).catch(function (err) { if (err.status !== 404) throw err; });
      }).then(function () {
        store.set({ recovered: (store.get().recovered || []).filter(function (x) { return x.id !== id; }) });
        if (!silent) ui.toast('Recording discarded');
      }).catch(function (err) { ui.toast(err.message, 'error'); });
    };

    /** On start-up: recordings left on this device by a crash, a closed tab, or a lost connection. */
    actions.recFindUnfinished = function () {
      return MA.chunks.local.allRecordings().then(function (all) {
        var left = (all || []).filter(function (r) { return !r.finished && r.chunkCount > 0; });
        store.quiet({ recovered: left });
        if (left.length && store.get().page === 'meetings') store.set({});
      }).catch(function () { /* nothing to recover */ });
    };
  }
})();
