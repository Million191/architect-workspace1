(function () {
  "use strict";

  var STORAGE_KEY = "barbershop.appointments";
  var THEME_KEY = "barbershop.theme";

  var CONFIG = {
    openHour: 9, // 9am
    closeHour: 18, // last slot starts at 5pm, shop closes 6pm
    closedDay: 0, // Sunday
    chairs: ["Mike", "Alex", "Sam"],
    services: [
      { id: "haircut", name: "Haircut", price: 25 },
      { id: "beard", name: "Beard Trim", price: 15 },
      { id: "haircut-beard", name: "Haircut + Beard", price: 35 },
      { id: "shave", name: "Hot Towel Shave", price: 20 },
      { id: "kids", name: "Kids Cut (12 & under)", price: 18 }
    ]
  };

  // ---------- storage ----------

  function getAppointments() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveAppointments(list) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }

  // ---------- theme ----------

  function getTheme() {
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  function setTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (e) {}
  }

  function initThemeToggle() {
    var toggle = document.getElementById("theme-toggle");
    if (!toggle) return;
    toggle.setAttribute("aria-checked", getTheme() === "dark" ? "true" : "false");
    toggle.addEventListener("click", function () {
      var next = getTheme() === "dark" ? "light" : "dark";
      setTheme(next);
      toggle.setAttribute("aria-checked", next === "dark" ? "true" : "false");
    });
  }

  // ---------- helpers ----------

  function todayIso() {
    var d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }

  function formatHour(hour) {
    var period = hour >= 12 ? "PM" : "AM";
    var h = hour % 12;
    if (h === 0) h = 12;
    return h + ":00 " + period;
  }

  function allSlots() {
    var slots = [];
    for (var h = CONFIG.openHour; h < CONFIG.closeHour; h++) {
      slots.push(h);
    }
    return slots;
  }

  function isClosedDate(dateStr) {
    if (!dateStr) return false;
    var d = new Date(dateStr + "T00:00:00");
    return d.getDay() === CONFIG.closedDay;
  }

  function serviceName(id) {
    var s = CONFIG.services.filter(function (s) { return s.id === id; })[0];
    return s ? s.name : id;
  }

  // Chairs already booked for a given date + hour
  function bookedChairsFor(dateStr, hour) {
    return getAppointments()
      .filter(function (a) { return a.date === dateStr && a.hour === hour; })
      .map(function (a) { return a.chair; });
  }

  function openChairsFor(dateStr, hour) {
    var booked = bookedChairsFor(dateStr, hour);
    return CONFIG.chairs.filter(function (c) { return booked.indexOf(c) === -1; });
  }

  // ---------- rendering: services ----------

  function renderServices() {
    var grid = document.getElementById("services-grid");
    grid.innerHTML = CONFIG.services.map(function (s) {
      return (
        '<div class="service-card">' +
          "<h3>" + s.name + "</h3>" +
          '<div class="price">$' + s.price + "</div>" +
          "<p>Walk-ins welcome, or reserve a chair below.</p>" +
        "</div>"
      );
    }).join("");
  }

  function populateServiceSelect() {
    var select = document.getElementById("book-service");
    select.innerHTML = CONFIG.services.map(function (s) {
      return '<option value="' + s.id + '">' + s.name + " ($" + s.price + ")</option>";
    }).join("");
  }

  // ---------- rendering: seat availability section ----------

  function renderAvailability(dateStr) {
    var slotGrid = document.getElementById("slot-grid");
    var chairStatus = document.getElementById("chair-status");

    if (!dateStr) {
      slotGrid.innerHTML = "";
      chairStatus.innerHTML = "";
      return;
    }

    if (isClosedDate(dateStr)) {
      slotGrid.innerHTML = '<p class="empty-note">Closed on Sundays.</p>';
      chairStatus.innerHTML = "";
      return;
    }

    slotGrid.innerHTML = allSlots().map(function (hour) {
      var open = openChairsFor(dateStr, hour).length;
      var full = open === 0;
      return (
        '<div class="slot-cell ' + (full ? "full" : "open") + '">' +
          '<div class="slot-time">' + formatHour(hour) + "</div>" +
          '<div class="slot-count">' + (full ? "Fully booked" : open + " of " + CONFIG.chairs.length + " open") + "</div>" +
        "</div>"
      );
    }).join("");

    chairStatus.innerHTML = CONFIG.chairs.map(function (chair) {
      var nextSlot = allSlots().filter(function (hour) {
        return bookedChairsFor(dateStr, hour).indexOf(chair) === -1;
      })[0];
      var label = nextSlot !== undefined ? "next open " + formatHour(nextSlot) : "fully booked today";
      return '<div class="chair-pill"><b>' + chair + "</b>" + label + "</div>";
    }).join("");
  }

  // ---------- booking form ----------

  function populateTimeOptions() {
    var dateInput = document.getElementById("book-date");
    var timeSelect = document.getElementById("book-time");
    var dateStr = dateInput.value;

    if (!dateStr || isClosedDate(dateStr)) {
      timeSelect.innerHTML = '<option value="">No slots available</option>';
      populateChairOptions();
      return;
    }

    var options = allSlots().map(function (hour) {
      var open = openChairsFor(dateStr, hour).length;
      var label = formatHour(hour) + (open === 0 ? " - fully booked" : " (" + open + " open)");
      return '<option value="' + hour + '"' + (open === 0 ? " disabled" : "") + ">" + label + "</option>";
    });
    timeSelect.innerHTML = options.join("");
    populateChairOptions();
  }

  function populateChairOptions() {
    var dateStr = document.getElementById("book-date").value;
    var hourStr = document.getElementById("book-time").value;
    var chairSelect = document.getElementById("book-chair");

    if (!dateStr || hourStr === "") {
      chairSelect.innerHTML = '<option value="">Pick a date and time first</option>';
      return;
    }

    var open = openChairsFor(dateStr, Number(hourStr));
    var options = ['<option value="any">Any available barber</option>'];
    options = options.concat(open.map(function (c) {
      return '<option value="' + c + '">' + c + "</option>";
    }));
    chairSelect.innerHTML = options.join("");
  }

  function handleBookingSubmit(evt) {
    evt.preventDefault();
    var message = document.getElementById("book-message");

    var name = document.getElementById("book-name").value.trim();
    var contact = document.getElementById("book-contact").value.trim();
    var service = document.getElementById("book-service").value;
    var dateStr = document.getElementById("book-date").value;
    var hourStr = document.getElementById("book-time").value;
    var chairChoice = document.getElementById("book-chair").value;

    if (!name || !contact || !dateStr || hourStr === "" || !chairChoice) {
      showMessage(message, "Please fill in every field.", false);
      return;
    }

    if (isClosedDate(dateStr)) {
      showMessage(message, "We're closed on Sundays, pick another date.", false);
      return;
    }

    var hour = Number(hourStr);
    var open = openChairsFor(dateStr, hour);

    if (open.length === 0) {
      showMessage(message, "That time just filled up, pick another slot.", false);
      populateTimeOptions();
      return;
    }

    var chair = chairChoice === "any" ? open[0] : chairChoice;
    if (open.indexOf(chair) === -1) {
      showMessage(message, chair + " is no longer free at that time, pick another.", false);
      populateChairOptions();
      return;
    }

    var appointments = getAppointments();
    appointments.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      name: name,
      contact: contact,
      service: service,
      date: dateStr,
      hour: hour,
      chair: chair
    });
    saveAppointments(appointments);

    showMessage(message, "Booked with " + chair + " on " + dateStr + " at " + formatHour(hour) + ".", true);
    document.getElementById("booking-form").reset();
    document.getElementById("book-date").value = dateStr;
    populateTimeOptions();

    // refresh whatever date the availability viewer is showing
    var availabilityDate = document.getElementById("availability-date").value;
    if (availabilityDate) renderAvailability(availabilityDate);

    renderAppointmentsList();
  }

  function showMessage(el, text, ok) {
    el.textContent = text;
    el.className = "form-message " + (ok ? "success" : "error");
  }

  // ---------- appointments list ----------

  function renderAppointmentsList() {
    var container = document.getElementById("appointments-list");
    var appointments = getAppointments().slice().sort(function (a, b) {
      return a.date === b.date ? a.hour - b.hour : a.date.localeCompare(b.date);
    });

    if (appointments.length === 0) {
      container.innerHTML = '<p class="empty-note">No appointments requested yet.</p>';
      return;
    }

    container.innerHTML = appointments.map(function (a) {
      return (
        '<div class="appointment-item" data-id="' + a.id + '">' +
          '<div class="details">' +
            "<b>" + a.name + " &mdash; " + serviceName(a.service) + "</b>" +
            "<span>" + a.date + " at " + formatHour(a.hour) + " with " + a.chair + "</span>" +
          "</div>" +
          '<button class="btn-cancel" type="button">Cancel</button>' +
        "</div>"
      );
    }).join("");

    container.querySelectorAll(".btn-cancel").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.closest(".appointment-item").getAttribute("data-id");
        cancelAppointment(id);
      });
    });
  }

  function cancelAppointment(id) {
    var appointments = getAppointments().filter(function (a) { return a.id !== id; });
    saveAppointments(appointments);
    renderAppointmentsList();

    var availabilityDate = document.getElementById("availability-date").value;
    if (availabilityDate) renderAvailability(availabilityDate);
    populateTimeOptions();
  }

  // ---------- init ----------

  function init() {
    initThemeToggle();
    renderServices();
    populateServiceSelect();

    var today = todayIso();

    var availabilityDate = document.getElementById("availability-date");
    availabilityDate.min = today;
    availabilityDate.value = today;
    availabilityDate.addEventListener("change", function () {
      renderAvailability(availabilityDate.value);
    });
    renderAvailability(today);

    var bookDate = document.getElementById("book-date");
    bookDate.min = today;
    bookDate.value = today;
    bookDate.addEventListener("change", populateTimeOptions);

    var bookTime = document.getElementById("book-time");
    bookTime.addEventListener("change", populateChairOptions);

    populateTimeOptions();

    document.getElementById("booking-form").addEventListener("submit", handleBookingSubmit);

    renderAppointmentsList();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
