// Meeting Assistant — thin wrappers over the server endpoints. No business logic here.
(function () {
  /** Error carrying what the server said: a readable message, the failed stage, and any listed problems. */
  function apiError(body, status) {
    var message = body.problems
      ? (body.error === 'ProviderNotConfiguredError' ? 'Setup needed: ' : '') + body.problems.join(' ')
      : body.message || (status === 0 ? 'Could not reach the Meeting Assistant server. Check that it is running, then try again.' : 'Something went wrong (' + status + '). Try again.');
    var error = new Error(message);
    error.stage = body.stage;
    error.status = status;
    error.errorClass = body.error;
    error.body = body; // details such as who saved a newer version (conflicts)
    return error;
  }

  async function call(url, options) {
    var res;
    try { res = await fetch(url, options); } catch (e) { throw apiError({}, 0); }
    var body = res.status === 204 ? {} : await res.json().catch(function () { return {}; });
    if (!res.ok) throw apiError(body, res.status);
    return body;
  }
  function post(url, data) {
    return call(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  }
  var meeting = function (id) { return '/api/meetings/' + encodeURIComponent(id); };

  /** Upload with real byte progress (XMLHttpRequest reports upload progress; fetch does not). */
  function draft(form, uploadId, onProgress) {
    return new Promise(function (resolve, reject) {
      var data = new FormData();
      data.append('audio', form.file);
      data.append('title', form.title);
      data.append('attendees', form.attendees);
      data.append('uploadId', uploadId);
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/meetings/draft');
      xhr.upload.onprogress = function (e) { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      xhr.onload = function () {
        var body = {};
        try { body = JSON.parse(xhr.responseText || '{}'); } catch (e) { body = {}; }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body); else reject(apiError(body, xhr.status));
      };
      xhr.onerror = function () { reject(apiError({}, 0)); };
      xhr.send(data);
    });
  }

  MA.api = {
    status: function () { return call('/api/meetings/status'); },
    meetings: function () { return call('/api/meetings').then(function (b) { return b.meetings; }); },
    actionItems: function () { return call('/api/meetings/action-items/all').then(function (b) { return b.actionItems; }); },
    getRun: function (id) { return call(meeting(id)); },
    progress: function (uploadId) { return call('/api/meetings/progress/' + encodeURIComponent(uploadId)); },
    draft: draft,
    saveMinutes: function (id, edits) { return post(meeting(id) + '/minutes', edits); },
    approveMinutes: function (id, by) { return post(meeting(id) + '/approve-minutes', { approvedBy: by }); },
    approveEmails: function (id, by) { return post(meeting(id) + '/approve-emails', { approvedBy: by }); },
    /** Search across meetings, transcripts, and action items (typo-tolerant). */
    search: function (q, opts) {
      opts = opts || {};
      var qs = '?q=' + encodeURIComponent(q) + '&limit=' + (opts.limit || 3) + (opts.group ? '&group=' + opts.group : '') + (opts.exact ? '&exact=1' : '');
      return call('/api/search' + qs);
    },
    /** Editable minutes: sections + action items, versions, edits after approval. */
    minutes: {
      get: function (runId) { return call('/api/minutes/' + encodeURIComponent(runId)); },
      save: function (runId, body) { return call('/api/minutes/' + encodeURIComponent(runId), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); },
      versions: function (runId) { return call('/api/minutes/' + encodeURIComponent(runId) + '/versions').then(function (b) { return b.versions; }); },
      version: function (runId, n) { return call('/api/minutes/' + encodeURIComponent(runId) + '/versions/' + n); },
      restore: function (runId, n, body) { return post('/api/minutes/' + encodeURIComponent(runId) + '/versions/' + n + '/restore', body); },
      amend: function (runId, body) { return post('/api/minutes/' + encodeURIComponent(runId) + '/amendments', body); },
      finishAmend: function (runId) { return post('/api/minutes/' + encodeURIComponent(runId) + '/amendments/finish', {}); },
      assist: function (runId, body) { return post('/api/minutes/' + encodeURIComponent(runId) + '/assist', body); },
      correctTranscript: function (runId, body) { return call('/api/minutes/' + encodeURIComponent(runId) + '/transcript', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); },
      presence: function (runId, body) { return post('/api/minutes/' + encodeURIComponent(runId) + '/presence', body); },
      sendUpdate: function (runId, by) { return post('/api/minutes/' + encodeURIComponent(runId) + '/updates/send', { sentBy: by }); },
    },
    /** Calendar sync (Google / Outlook). Connecting is a browser navigation to /api/calendar/oauth/<provider>/start. */
    calendar: {
      status: function () { return call('/api/calendar/connections'); },
      sync: function (provider) { return post('/api/calendar/sync', provider ? { provider: provider } : {}); },
      update: function (provider, patch) { return call('/api/calendar/connections/' + provider, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }); },
      disconnect: function (provider) { return call('/api/calendar/connections/' + provider, { method: 'DELETE' }); },
    },
    /** Live recordings (chunks are sent by MA.chunks, which needs raw PUTs). */
    recordings: {
      create: function (body) { return post('/api/recordings', body); },
      get: function (id) { return call('/api/recordings/' + encodeURIComponent(id)); },
      finish: function (id, body) { return post('/api/recordings/' + encodeURIComponent(id) + '/finish', body); },
      discard: function (id) { return call('/api/recordings/' + encodeURIComponent(id), { method: 'DELETE' }); },
      forRun: function (runId) { return call('/api/recordings/by-run/' + encodeURIComponent(runId)); },
      retention: function () { return call('/api/recordings/settings/retention'); },
      setRetention: function (value) { return call('/api/recordings/settings/retention', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rawAudioRetention: value }) }); },
    },
    /** Spell check (reports only — the page changes text only when a suggestion is accepted). */
    spelling: {
      check: function (texts) { return post('/api/spellcheck', { texts: texts }).then(function (b) { return b.results; }); },
      addWord: function (word, by) { return post('/api/spellcheck/dictionary', { word: word, addedBy: by || undefined }); },
    },
    /** People directory: names, photos, avatar colours. */
    people: {
      list: function () { return call('/api/people').then(function (b) { return b.people; }); },
      update: function (id, edit) { return call('/api/people/' + encodeURIComponent(id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(edit) }); },
    },
    /** Calendar (scheduled meetings). */
    schedule: {
      week: function (from, to) { return call('/api/schedule?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to)); },
      get: function (id) { return call('/api/schedule/' + encodeURIComponent(id)); },
      create: function (body) { return post('/api/schedule', body); },
      update: function (id, body) { return call('/api/schedule/' + encodeURIComponent(id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); },
      postpone: function (id, body) { return post('/api/schedule/' + encodeURIComponent(id) + '/postpone', body); },
      cancel: function (id, body) { return post('/api/schedule/' + encodeURIComponent(id) + '/cancel', body); },
      restore: function (id, body) { return post('/api/schedule/' + encodeURIComponent(id) + '/restore', body); },
      undo: function (id, version, by) { return post('/api/schedule/' + encodeURIComponent(id) + '/undo', { version: version, by: by }); },
      remove: function (id) { return call('/api/schedule/' + encodeURIComponent(id), { method: 'DELETE' }); },
      notices: function (id, kind, tz) { return call('/api/schedule/' + encodeURIComponent(id) + '/notices?kind=' + kind + '&tz=' + encodeURIComponent(tz)); },
      notify: function (id, kind, tz, by) { return post('/api/schedule/' + encodeURIComponent(id) + '/notify', { kind: kind, tz: tz, by: by }); },
    },
  };
})();
