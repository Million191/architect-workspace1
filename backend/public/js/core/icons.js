// Outline icons from Lucide (https://lucide.dev, ISC licence), inlined as SVG data — no dependency.
window.MA = window.MA || { screens: {} };
(function () {
  var c = function (cx, cy, r) { return ['circle', { cx: cx, cy: cy, r: r }]; };
  var p = function (d) { return ['path', { d: d }]; };
  var l = function (x1, y1, x2, y2) { return ['line', { x1: x1, y1: y1, x2: x2, y2: y2 }]; };
  var r = function (x, y, w, h, rx) { return ['rect', { x: x, y: y, width: w, height: h, rx: rx }]; };
  var pl = function (pts) { return ['polyline', { points: pts }]; };

  var ICONS = {
    'messages-square': [p('M14 9a2 2 0 0 1-2 2H6l-4 4V4c0-1.1.9-2 2-2h8a2 2 0 0 1 2 2z'), p('M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1')],
    'list-checks': [p('m3 17 2 2 4-4'), p('m3 7 2 2 4-4'), p('M13 6h8'), p('M13 12h8'), p('M13 18h8')],
    'settings-2': [p('M20 7h-9'), p('M14 17H5'), c(17, 17, 3), c(7, 7, 3)],
    search: [c(11, 11, 8), p('m21 21-4.3-4.3')],
    upload: [p('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'), pl('17 8 12 3 7 8'), l(12, 3, 12, 15)],
    mic: [p('M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z'), p('M19 10v2a7 7 0 0 1-14 0v-2'), l(12, 19, 12, 22)],
    square: [r(3, 3, 18, 18, 2)],
    pause: [r(14, 4, 4, 16, 1), r(6, 4, 4, 16, 1)],
    play: [p('M6 3l14 9-14 9V3z')],
    'audio-lines': [p('M2 10v3'), p('M6 6v11'), p('M10 3v18'), p('M14 8v7'), p('M18 5v13'), p('M22 10v3')],
    'file-text': [p('M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z'), p('M14 2v4a2 2 0 0 0 2 2h4'), p('M10 9H8'), p('M16 13H8'), p('M16 17H8')],
    x: [p('M18 6 6 18'), p('m6 6 12 12')],
    check: [p('M20 6 9 17l-5-5')],
    'circle-check': [c(12, 12, 10), p('m9 12 2 2 4-4')],
    'circle-alert': [c(12, 12, 10), l(12, 8, 12, 12), l(12, 16, 12.01, 16)],
    'triangle-alert': [p('m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3'), p('M12 9v4'), p('M12 17h.01')],
    inbox: [pl('22 12 16 12 14 15 10 15 8 12 2 12'), p('M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z')],
    mail: [r(2, 4, 20, 16, 2), p('m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7')],
    send: [p('m22 2-7 20-4-9-9-4Z'), p('M22 2 11 13')],
    'arrow-left': [p('m12 19-7-7 7-7'), p('M19 12H5')],
    'arrow-up': [p('m5 12 7-7 7 7'), p('M12 19V5')],
    'arrow-down': [p('M12 5v14'), p('m19 12-7 7-7-7')],
    history: [p('M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8'), p('M3 3v5h5'), p('M12 7v5l4 2')],
    sparkles: [p('M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z')],
    lock: [r(3, 11, 18, 11, 2), p('M7 11V7a5 5 0 0 1 10 0v4')],
    pencil: [p('M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z')],
    'arrow-right': [p('M5 12h14'), p('m12 5 7 7-7 7')],
    'chevron-right': [p('m9 18 6-6-6-6')],
    'chevron-down': [p('m6 9 6 6 6-6')],
    'more-horizontal': [c(12, 12, 1), c(19, 12, 1), c(5, 12, 1)],
    trash: [p('M3 6h18'), p('M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6'), p('M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2')],
    'rotate-ccw': [p('M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8'), p('M3 3v5h5')],
    'calendar-clock': [p('M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5'), p('M16 2v4'), p('M8 2v4'), p('M3 10h5'), p('M17.5 17.5 16 16.3V14'), c(16, 16, 6)],
    ban: [c(12, 12, 10), p('m4.9 4.9 14.2 14.2')],
    clock: [c(12, 12, 10), pl('12 6 12 12 16 14')],
    calendar: [r(3, 4, 18, 18, 2), p('M16 2v4'), p('M8 2v4'), p('M3 10h18')],
    users: [p('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'), c(9, 7, 4), p('M22 21v-2a4 4 0 0 0-3-3.87'), p('M16 3.13a4 4 0 0 1 0 7.75')],
    'refresh-cw': [p('M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8'), p('M21 3v5h-5'), p('M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16'), p('M8 16H3v5')],
    sun: [c(12, 12, 4), p('M12 2v2'), p('M12 20v2'), p('m4.93 4.93 1.41 1.41'), p('m17.66 17.66 1.41 1.41'), p('M2 12h2'), p('M20 12h2'), p('m6.34 17.66-1.41 1.41'), p('m19.07 4.93-1.41 1.41')],
    moon: [p('M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z')],
    monitor: [r(2, 3, 20, 14, 2), l(8, 21, 16, 21), l(12, 17, 12, 21)],
    'shield-check': [p('M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z'), p('m9 12 2 2 4-4')],
    plus: [p('M5 12h14'), p('M12 5v14')],
    'corner-down-left': [pl('9 10 4 15 9 20'), p('M20 4v7a4 4 0 0 1-4 4H4')],
    'circle-help': [c(12, 12, 10), p('M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3'), l(12, 17, 12.01, 17)],
    user: [p('M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2'), c(12, 7, 4)],
    keyboard: [r(2, 4, 20, 16, 2), p('M6 8h.01'), p('M10 8h.01'), p('M14 8h.01'), p('M18 8h.01'), p('M8 12h.01'), p('M12 12h.01'), p('M16 12h.01'), p('M7 16h10')],
  };

  var SVG_NS = 'http://www.w3.org/2000/svg';
  MA.icon = function (name, cls) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'icon' + (cls ? ' ' + cls : ''));
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    (ICONS[name] || []).forEach(function (shape) {
      var node = document.createElementNS(SVG_NS, shape[0]);
      Object.keys(shape[1]).forEach(function (k) { node.setAttribute(k, String(shape[1][k])); });
      svg.appendChild(node);
    });
    return svg;
  };
})();
