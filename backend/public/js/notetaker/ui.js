// Notetaker — display pieces: platform logos, the bot status badge, and the "Send notetaker" switch.
(function () {
  var ui = MA.ui, el = ui.el, append = ui.append;
  var SVG_NS = 'http://www.w3.org/2000/svg';

  var PLATFORM_NAME = { zoom: 'Zoom', teams: 'Microsoft Teams', meet: 'Google Meet' };

  /** Simplified platform marks (drawn here, not the vendors' artwork), each with a text name for screen readers. */
  var MARKS = {
    zoom: { bg: '#0B5CFF', shapes: [['rect', { x: 5, y: 8, width: 9.5, height: 8, rx: 1.6, fill: '#fff' }], ['path', { d: 'M15.5 11 19 8.8v6.4L15.5 13z', fill: '#fff' }]] },
    teams: { bg: '#5B5FC7', shapes: [['path', { d: 'M6.5 7.5h9v2.2h-3.4V17H9.9V9.7H6.5z', fill: '#fff' }], ['circle', { cx: 18, cy: 8.5, r: 1.8, fill: '#fff' }]] },
    meet: { bg: '#188038', shapes: [['rect', { x: 5, y: 8, width: 9.5, height: 8, rx: 1.4, fill: '#fff' }], ['path', { d: 'M15.5 11 19 8.5v7L15.5 13z', fill: '#FBBC04' }]] },
  };

  function platformLogo(platform, opts) {
    var mark = MARKS[platform];
    if (!mark) return null;
    var wrap = el('span', null, 'platform-logo platform-' + platform, { title: PLATFORM_NAME[platform] });
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var bg = document.createElementNS(SVG_NS, 'rect');
    [['width', 24], ['height', 24], ['rx', 6], ['fill', mark.bg]].forEach(function (a) { bg.setAttribute(a[0], String(a[1])); });
    svg.appendChild(bg);
    mark.shapes.forEach(function (s) {
      var n = document.createElementNS(SVG_NS, s[0]);
      Object.keys(s[1]).forEach(function (k) { n.setAttribute(k, String(s[1][k])); });
      svg.appendChild(n);
    });
    wrap.appendChild(svg);
    if (!(opts && opts.decorative)) wrap.appendChild(el('span', PLATFORM_NAME[platform], 'sr-only'));
    return wrap;
  }

  // Each bot status has an icon and words — never colour alone.
  var STATUS = {
    scheduled: { label: 'Notetaker scheduled', kind: 'accent', icon: 'calendar-clock' },
    joining: { label: 'Joining', kind: 'neutral', icon: 'refresh-cw' },
    waiting_room: { label: 'Waiting to be admitted', kind: 'warning', icon: 'clock' },
    awaiting_permission: { label: 'Waiting for permission to record', kind: 'warning', icon: 'clock' },
    recording: { label: 'Recording', kind: 'danger', icon: 'mic' },
    processing: { label: 'Processing', kind: 'neutral', icon: 'refresh-cw' },
    ready: { label: 'Ready for review', kind: 'success', icon: 'circle-check' },
    failed: { label: 'Notetaker failed', kind: 'danger', icon: 'circle-alert' },
    cancelled: { label: 'Notetaker stopped', kind: 'neutral', icon: 'ban' },
  };
  var FINAL = ['ready', 'failed', 'cancelled'];
  function statusOf(s) { return STATUS[s.status] || STATUS.joining; }
  function isActive(s) { return !!s && FINAL.indexOf(s.status) === -1; }

  function statusBadge(s, opts) {
    var b = ui.badge(statusOf(s));
    b.classList.add('bot-badge', 'bot-' + s.status);
    if (opts && opts.compact) b.classList.add('bot-badge-compact');
    return b;
  }

  /** Can the notetaker be sent to this calendar meeting right now? */
  function eligible(m, now) {
    return !!m && MA.cal.platformOf(m.link) !== 'none' && m.display === 'upcoming' && !m.runId && !!m.end && Date.parse(m.end) > (now || Date.now());
  }

  /**
   * The switch and live status for one meeting. opts: { session, configured, onToggle(on), onRetry, onOpen, compact }
   */
  function control(m, opts) {
    var s = opts.session, on = isActive(s), can = eligible(m);
    if (!can && !s) return null;
    var box = el('div', null, 'notetaker' + (opts.compact ? ' notetaker-compact' : ''), { 'data-meeting': m.id });
    if (can || on) {
      var id = 'notetaker-' + m.id;
      var sw = el('button', null, 'switch' + (on ? ' is-on' : ''), { type: 'button', role: 'switch', 'aria-checked': on ? 'true' : 'false', id: id, 'aria-describedby': id + '-hint' });
      sw.appendChild(el('span', null, 'switch-thumb', { 'aria-hidden': 'true' }));
      sw.disabled = !opts.configured || (s && s.status === 'processing');
      sw.addEventListener('click', function () { opts.onToggle(!on, sw); });
      box.appendChild(append(el('div', null, 'notetaker-row'), sw, append(el('label', null, 'notetaker-label', { for: id }), platformLogo(MA.cal.platformOf(m.link), { decorative: true }), 'Send notetaker')));
      box.appendChild(el('p', !opts.configured ? 'The notetaker isn’t set up on this server (RECALL_API_KEY).'
        : on ? (s.status === 'recording' ? 'Turn off to stop recording. What was recorded becomes minutes for review.' : 'Joins as “Meeting Assistant Notetaker” and tells everyone in the chat that it’s recording.')
          : 'Joins as “Meeting Assistant Notetaker” and tells everyone in the chat that it’s recording.', 'help notetaker-hint', { id: id + '-hint' }));
    }
    if (s) {
      var line = append(el('div', null, 'notetaker-status'), statusBadge(s), s.joinAt && s.status === 'scheduled' ? el('span', 'joins at ' + MA.cal.model.fmtTime(new Date(s.joinAt)), 'muted') : null);
      if (s.status === 'ready' && s.runId && opts.onOpen) line.appendChild(ui.button('Open review', 'secondary', function () { opts.onOpen(s); }, { size: 'sm', iconAfter: 'arrow-right' }));
      if (s.canRetry && opts.onRetry) line.appendChild(ui.button('Retry processing', 'secondary', function () { opts.onRetry(s); }, { size: 'sm', icon: 'rotate-ccw' }));
      box.appendChild(line);
      if (s.status === 'failed' && s.error) box.appendChild(el('p', s.error.message, 'notetaker-error', { role: 'alert' }));
    }
    return box;
  }

  MA.notetaker = MA.notetaker || {};
  Object.assign(MA.notetaker, { platformLogo: platformLogo, statusOf: statusOf, statusBadge: statusBadge, control: control, eligible: eligible, isActive: isActive, PLATFORM_NAME: PLATFORM_NAME });
})();
