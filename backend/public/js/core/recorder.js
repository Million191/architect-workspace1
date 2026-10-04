// Meeting Assistant — live capture: microphone (in-person) or meeting tab/window audio mixed with the
// microphone (online meeting on this computer). MediaRecorder hands over a chunk every 5 seconds;
// the caller stores and uploads it. Also: live level meter, pause/resume, and keeping the screen awake.
(function () {
  var CHUNK_MS = 5000;
  var TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4'];

  function support() {
    var md = navigator.mediaDevices;
    return {
      mic: !!(md && md.getUserMedia && window.MediaRecorder),
      display: !!(md && md.getDisplayMedia && window.MediaRecorder),
      wakeLock: !!(navigator.wakeLock && navigator.wakeLock.request),
    };
  }
  function pickType() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
    for (var i = 0; i < TYPES.length; i++) if (MediaRecorder.isTypeSupported(TYPES[i])) return TYPES[i];
    return '';
  }

  /** A readable reason for a getUserMedia/getDisplayMedia failure, saying how to fix it. */
  function explain(err, what) {
    var name = err && err.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') return what === 'display'
      ? 'Sharing was cancelled or blocked. Choose the meeting tab and turn on “Share tab audio”, then try again.'
      : 'Microphone access is blocked. Allow it from the icon in your browser’s address bar, then try again.';
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone was found. Connect one or choose another in the list.';
    if (name === 'NotReadableError') return 'The microphone is being used by another app. Close it and try again.';
    return (what === 'display' ? 'Couldn’t capture the meeting audio: ' : 'Couldn’t start the microphone: ') + ((err && err.message) || 'unknown error') + '.';
  }

  /** Microphones, with labels once permission has been granted. */
  function microphones() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return Promise.resolve([]);
    return navigator.mediaDevices.enumerateDevices().then(function (all) {
      return all.filter(function (d) { return d.kind === 'audioinput'; }).map(function (d, i) { return { id: d.deviceId, label: d.label || 'Microphone ' + (i + 1) }; });
    }).catch(function () { return []; });
  }

  function micStream(deviceId) {
    return navigator.mediaDevices.getUserMedia({ audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .catch(function (err) { throw new Error(explain(err, 'mic')); });
  }

  /** Level meter: RMS of the latest samples, 0..1, delivered ~10 times a second. */
  function meter(ctx, node, onLevel) {
    var analyser = ctx.createAnalyser(), data = new Uint8Array(1024), timer;
    analyser.fftSize = 1024;
    node.connect(analyser);
    timer = setInterval(function () {
      analyser.getByteTimeDomainData(data);
      var sum = 0;
      for (var i = 0; i < data.length; i++) { var v = (data[i] - 128) / 128; sum += v * v; }
      onLevel(Math.min(1, Math.sqrt(sum / data.length) * 3));
    }, 100);
    return { analyser: analyser, stop: function () { clearInterval(timer); } };
  }

  var preview = null;
  /** Mic test before recording (setup screen). Returns stop(). */
  function startPreview(deviceId, onLevel) {
    stopPreview();
    return micStream(deviceId).then(function (stream) {
      var Ctx = window.AudioContext || window.webkitAudioContext, ctx = new Ctx(), m = meter(ctx, ctx.createMediaStreamSource(stream), onLevel);
      preview = { stop: function () { m.stop(); stream.getTracks().forEach(function (t) { t.stop(); }); ctx.close(); } };
      return microphones();
    });
  }
  function stopPreview() { if (preview) { preview.stop(); preview = null; } }

  var session = null;
  /** Latest input levels (0..1), for diagnostics and the UI. */
  var levels = { mic: 0, meeting: null };

  /**
   * opts: { mode: 'in_person' | 'browser_capture', deviceId, onChunk(blob, index), onLevel(0..1),
   *         onMeetingAudio(bool) (browser_capture: whether the shared tab is producing sound),
   *         onEnded(reason) (the user stopped sharing, the mic was unplugged) }
   * Resolves with { mimeType } once recording has started.
   */
  function start(opts) {
    stopPreview();
    var sup = support();
    if (!sup.mic) return Promise.reject(new Error('Recording isn’t supported in this browser. Use a current version of Chrome, Edge, Firefox, or Safari — or upload a recording instead.'));
    if (opts.mode === 'browser_capture' && !sup.display) return Promise.reject(new Error('This browser can’t capture another tab’s audio. Use Chrome or Edge on a computer, or record the meeting in person / upload its recording.'));
    var Ctx = window.AudioContext || window.webkitAudioContext;
    var ctx = new Ctx(), streams = [], cleanups = [];
    var displayPromise = opts.mode === 'browser_capture'
      ? navigator.mediaDevices.getDisplayMedia({ video: true, audio: { echoCancellation: false, noiseSuppression: false }, systemAudio: 'include', preferCurrentTab: false })
        .catch(function (err) { throw new Error(explain(err, 'display')); })
      : Promise.resolve(null);
    return displayPromise.then(function (display) {
      if (display) {
        streams.push(display);
        if (!display.getAudioTracks().length) {
          display.getTracks().forEach(function (t) { t.stop(); });
          throw new Error('No meeting audio was shared. Start again, pick the browser tab with your meeting, and turn on “Share tab audio”. (Sharing a whole window on a Mac can’t include sound.)');
        }
        display.getVideoTracks().forEach(function (t) { t.stop(); }); // only the sound is kept
        display.getAudioTracks()[0].addEventListener('ended', function () { if (opts.onEnded) opts.onEnded('sharing_stopped'); });
      }
      return micStream(opts.deviceId).then(function (mic) { streams.push(mic); return { display: display, mic: mic }; });
    }).then(function (s) {
      var dest = ctx.createMediaStreamDestination();
      var micNode = ctx.createMediaStreamSource(s.mic);
      micNode.connect(dest);
      var level = meter(ctx, micNode, function (v) { levels.mic = v; if (opts.onLevel) opts.onLevel(v); });
      cleanups.push(level.stop);
      if (s.display) {
        var meetingNode = ctx.createMediaStreamSource(new MediaStream(s.display.getAudioTracks()));
        meetingNode.connect(dest);
        // Warn when the shared tab stays silent: the user probably forgot "Share tab audio" or picked the wrong tab.
        // Warn once after 20 s of silence; clear the warning as soon as the tab makes a sound.
        var quietSince = Date.now(), warned = false, heard = false;
        var meetingMeter = meter(ctx, meetingNode, function (v) {
          levels.meeting = v;
          if (v > 0.02) {
            quietSince = Date.now();
            if ((!heard || warned) && opts.onMeetingAudio) opts.onMeetingAudio(true);
            heard = true; warned = false;
          } else if (!warned && Date.now() - quietSince >= 20000) {
            warned = true;
            if (opts.onMeetingAudio) opts.onMeetingAudio(false);
          }
        });
        cleanups.push(meetingMeter.stop);
      }
      s.mic.getAudioTracks()[0].addEventListener('ended', function () { if (opts.onEnded) opts.onEnded('microphone_lost'); });
      var mimeType = pickType();
      var rec = new MediaRecorder(dest.stream, mimeType ? { mimeType: mimeType, audioBitsPerSecond: 48000 } : undefined);
      var index = 0;
      rec.ondataavailable = function (e) { if (e.data && e.data.size) opts.onChunk(e.data, index++); };
      session = { rec: rec, ctx: ctx, streams: streams, cleanups: cleanups, wake: null };
      keepAwake(true);
      rec.start(CHUNK_MS);
      return { mimeType: rec.mimeType || mimeType || 'audio/webm' };
    }).catch(function (err) {
      streams.forEach(function (st) { st.getTracks().forEach(function (t) { t.stop(); }); });
      cleanups.forEach(function (fn) { fn(); });
      ctx.close();
      throw err;
    });
  }

  /** Screen Wake Lock where supported (phones lock their screen mid-meeting otherwise); re-taken when the tab returns. */
  function keepAwake(on) {
    if (!session) return;
    if (!on) { if (session.wake) session.wake.release().catch(function () {}); session.wake = null; return; }
    if (!support().wakeLock) return;
    navigator.wakeLock.request('screen').then(function (w) { if (session) session.wake = w; }).catch(function () { /* low battery or not allowed: recording still works */ });
  }
  document.addEventListener('visibilitychange', function () { if (session && document.visibilityState === 'visible' && !session.wake) keepAwake(true); });

  function pause() { if (session && session.rec.state === 'recording') session.rec.pause(); }
  function resume() { if (session && session.rec.state === 'paused') session.rec.resume(); }
  /** Stops capture; resolves after the last chunk has been handed over. */
  function stop() {
    if (!session) return Promise.resolve();
    var s = session;
    session = null;
    return new Promise(function (resolve) {
      s.rec.onstop = function () {
        s.streams.forEach(function (st) { st.getTracks().forEach(function (t) { t.stop(); }); });
        s.cleanups.forEach(function (fn) { fn(); });
        if (s.wake) s.wake.release().catch(function () {});
        s.ctx.close();
        resolve();
      };
      if (s.rec.state !== 'inactive') s.rec.stop(); else s.rec.onstop();
    });
  }

  MA.recorder = { support: support, microphones: microphones, startPreview: startPreview, stopPreview: stopPreview, start: start, pause: pause, resume: resume, stop: stop, isActive: function () { return !!session; }, levels: levels };
})();
