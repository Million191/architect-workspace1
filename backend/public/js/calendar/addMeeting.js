// Calendar — adding meetings: "+ New meeting" (keyboard path), click an empty slot, or drag across slots.
(function () {
  var M = MA.cal.model;
  var SLOT = 30; // minutes

  MA.cal.attachAdd = function (actions, store, api) {
    var ui = MA.ui;
    function cal() { return store.get().calendar; }
    function weekMeetings() { return (cal().data && cal().data.meetings) || []; }
    function by() { return (store.get().form.reviewer || '').trim() || undefined; }

    function openForm(start, end, anchor) {
      MA.cal.form.open({
        mode: 'add', start: start, end: end, anchor: anchor, others: weekMeetings(),
        onSave: function (body) {
          body.by = by();
          return api.schedule.create(body).then(function (res) {
            ui.toast(res.warnings && res.warnings.length ? 'Meeting added — ' + res.warnings[0].toLowerCase() : 'Meeting added');
            // Show the week the meeting is in, then refresh it and the dashboard count.
            var week = M.startOfWeek(new Date(body.start)).toISOString();
            store.quiet({ calendar: Object.assign({}, cal(), { weekStart: week }) });
            actions.calReload();
            actions.calLoadSummary();
          });
        },
      });
    }

    /** "+ New meeting": the next free half-hour today. */
    actions.calNewMeeting = function () {
      var slot = M.nextFreeSlot(weekMeetings(), new Date());
      openForm(slot.start, slot.end, document.getElementById('calNew'));
    };

    /** Empty-slot affordances + click and drag-to-create on each day column (mouse/touch; the button covers keyboard). */
    actions.calRenderSlots = function (col, day, hours, hourPx) {
      for (var mins = hours.from * 60; mins < hours.to * 60; mins += SLOT) {
        var slot = document.createElement('div');
        slot.className = 'cal-slot';
        slot.setAttribute('aria-hidden', 'true');
        slot.style.top = ((mins - hours.from * 60) / 60) * hourPx + 'px';
        col.appendChild(slot);
      }
      var drag = null;
      function slotAt(clientY) {
        var rect = col.getBoundingClientRect();
        var mins = hours.from * 60 + Math.floor(((clientY - rect.top) / hourPx) * 60 / SLOT) * SLOT;
        return Math.max(hours.from * 60, Math.min(hours.to * 60 - SLOT, mins));
      }
      function at(mins) { return new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(mins / 60), mins % 60); }
      function paint() {
        var lo = Math.min(drag.from, drag.to), hi = Math.max(drag.from, drag.to) + SLOT;
        drag.preview.style.top = ((lo - hours.from * 60) / 60) * hourPx + 'px';
        drag.preview.style.height = ((hi - lo) / 60) * hourPx + 'px';
        drag.preview.textContent = M.fmtTime(at(lo)) + ' – ' + M.fmtTime(at(hi));
      }
      col.addEventListener('pointerdown', function (e) {
        if (e.button > 0 || e.target.closest('.cal-block, .cal-chip')) return;
        e.preventDefault();
        var mins = slotAt(e.clientY);
        drag = { from: mins, to: mins, preview: document.createElement('div') };
        drag.preview.className = 'cal-drag-preview';
        col.appendChild(drag.preview);
        paint();
        if (col.setPointerCapture && e.pointerId !== undefined) { try { col.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ } }
      });
      col.addEventListener('pointermove', function (e) { if (!drag) return; drag.to = slotAt(e.clientY); paint(); });
      col.addEventListener('pointerup', function () {
        if (!drag) return;
        var lo = Math.min(drag.from, drag.to), hi = Math.max(drag.from, drag.to) + SLOT, preview = drag.preview;
        drag = null;
        openForm(at(lo), at(hi), preview);
        setTimeout(function () { preview.remove(); }, 0);
      });
      col.addEventListener('pointercancel', function () { if (drag) { drag.preview.remove(); drag = null; } });
    };
  };
})();
