// Meeting Assistant — in-browser recording to WAV. Browsers record WebM/Ogg by default, which the server
// does not accept, so raw samples are captured and encoded as 16 kHz mono 16-bit WAV here (no library).
(function () {
  var TARGET_RATE = 16000;

  /** Averages samples down to the target rate (simple, adequate for speech). */
  function downsample(samples, fromRate, toRate) {
    if (toRate >= fromRate) return samples;
    var ratio = fromRate / toRate, out = new Float32Array(Math.floor(samples.length / ratio));
    for (var i = 0; i < out.length; i++) {
      var start = Math.floor(i * ratio), end = Math.min(samples.length, Math.floor((i + 1) * ratio)), sum = 0;
      for (var j = start; j < end; j++) sum += samples[j];
      out[i] = end > start ? sum / (end - start) : 0;
    }
    return out;
  }

  /** Float32 mono samples → WAV bytes (RIFF/PCM, 16-bit). Pure; unit-tested. */
  function encodeWav(samples, sampleRate) {
    var pcm = downsample(samples, sampleRate, TARGET_RATE);
    var rate = Math.min(sampleRate, TARGET_RATE);
    var buffer = new ArrayBuffer(44 + pcm.length * 2), view = new DataView(buffer);
    function text(offset, s) { for (var i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i)); }
    text(0, 'RIFF'); view.setUint32(4, 36 + pcm.length * 2, true); text(8, 'WAVE');
    text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    text(36, 'data'); view.setUint32(40, pcm.length * 2, true);
    for (var i = 0; i < pcm.length; i++) {
      var s = Math.max(-1, Math.min(1, pcm[i]));
      view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Uint8Array(buffer);
  }

  var session = null;

  /** Starts recording from the microphone. Rejects with a message that says how to fix the problem. */
  async function start() {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !Ctx) {
      throw new Error('Recording isn’t supported in this browser. Upload a recording instead.');
    }
    var stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      throw new Error(e && e.name === 'NotAllowedError'
        ? 'Microphone access is blocked. Allow it from the icon in your browser’s address bar, then try again.'
        : 'No microphone was found. Connect one, or upload a recording instead.');
    }
    var ctx = new Ctx(), source = ctx.createMediaStreamSource(stream), node = ctx.createScriptProcessor(4096, 1, 1), chunks = [];
    node.onaudioprocess = function (e) { chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
    source.connect(node);
    node.connect(ctx.destination);
    session = { ctx: ctx, stream: stream, node: node, source: source, chunks: chunks };
  }

  /** Stops recording and returns the recording as a WAV File. */
  function stop() {
    if (!session) return null;
    var s = session;
    session = null;
    s.node.disconnect(); s.source.disconnect();
    s.stream.getTracks().forEach(function (t) { t.stop(); });
    var length = s.chunks.reduce(function (n, c) { return n + c.length; }, 0), all = new Float32Array(length), offset = 0;
    s.chunks.forEach(function (c) { all.set(c, offset); offset += c.length; });
    var rate = s.ctx.sampleRate;
    s.ctx.close();
    var stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    return new File([encodeWav(all, rate)], 'recording-' + stamp + '.wav', { type: 'audio/wav' });
  }

  MA.audio = { start: start, stop: stop, encodeWav: encodeWav, isRecording: function () { return !!session; } };
})();
