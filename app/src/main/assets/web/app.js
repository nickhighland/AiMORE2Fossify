(() => {
  "use strict";

  const state = {
    date: new Date(),
    view: "month",
    defaultViewApplied: false,
    events: [],
    calendars: [],
    weather: null,
    settings: {
      displayMode: "auto",
      adaptiveBrightness: true,
      orientation: "landscape",
      weekStart: "today",
      showLocalCalendar: true,
      defaultView: "month"
    }
  };
  const $ = (id) => document.getElementById(id);
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const monthFormatter = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
  const dayFormatter = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

  function dateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }
  function startOfDay(date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
  function toSeconds(date) { return Math.floor(date.getTime() / 1000); }
  function fromSeconds(value) { return new Date(Number(value) * 1000); }
  function localDateTime(date, time) {
    const [hours, minutes] = time.split(":").map(Number);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes, 0, 0);
  }
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  }
  function color(value) {
    if (typeof value === "number") return `#${(value & 0xffffff).toString(16).padStart(6, "0")}`;
    return value || "#75a4ff";
  }
  const COLOR_PALETTE = [
    "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16", "#22c55e", "#10b981", "#14b8a6",
    "#06b6d4", "#0ea5e9", "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#d946ef", "#ec4899",
    "#f43f5e", "#be123c", "#b45309", "#78716c", "#64748b", "#334155", "#0f766e", "#7c3aed"
  ];
  function paletteMarkup(selected, attribute, valueAttribute = "data-color-value") {
    const selectedColor = color(selected).toLowerCase();
    return COLOR_PALETTE.map((hex) => `<button type="button" class="palette-swatch ${hex === selectedColor ? "selected" : ""}" style="--swatch-color:${hex}" ${attribute}="${hex}" ${valueAttribute}="${hex}" title="${hex}" aria-label="${hex}"></button>`).join("");
  }
  function isWallView(value) { return ["month", "monthday", "week", "agenda"].includes(value); }
  function setStatus(text, error = false) { $("status").textContent = text; $("status").classList.toggle("error", error); }

  async function api(path, options = {}) {
    const isFormData = options.body instanceof FormData;
    const headers = isFormData ? {} : { "Content-Type": "application/json" };
    const response = await fetch(path, { ...options, headers: { ...headers, ...(options.headers || {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
    return body;
  }

  function effectiveTheme(settings = state.settings) {
    if (settings.displayMode === "day" || settings.displayMode === "night") return settings.displayMode;
    const hour = new Date().getHours();
    return hour >= 7 && hour < 19 ? "day" : "night";
  }

  function applyWallSettings(settings) {
    state.settings = { ...state.settings, ...(settings || {}) };
    document.body.dataset.theme = effectiveTheme(state.settings);
    if ($("displayMode")) {
      $("displayMode").value = state.settings.displayMode || "auto";
      $("wallOrientation").value = state.settings.orientation || "landscape";
      $("adaptiveBrightness").checked = state.settings.adaptiveBrightness !== false;
      $("weekStart").value = state.settings.weekStart || "today";
      $("startWallMode").checked = state.settings.startWallMode !== false;
      $("showLocalCalendar").checked = state.settings.showLocalCalendar !== false;
      $("defaultView").value = isWallView(state.settings.defaultView) ? state.settings.defaultView : "month";
    }
    if ($("calendarGrid")) render();
  }
  window.applyWallSettings = applyWallSettings;

  function rangeForView() {
    if (state.view === "week") {
      const start = startOfDay(state.date);
      if (state.settings.weekStart !== "today") start.setDate(start.getDate() - start.getDay());
      const end = new Date(start); end.setDate(end.getDate() + 7);
      return { start, end };
    }
    const first = new Date(state.date.getFullYear(), state.date.getMonth(), 1);
    const start = new Date(first); start.setDate(start.getDate() - start.getDay());
    const end = new Date(start); end.setDate(end.getDate() + 42);
    return { start, end };
  }

  async function load() {
    try {
      const range = rangeForView();
      const [calendars, events, status, settings, weather] = await Promise.all([
        api("/api/calendars"),
        api(`/api/events?start=${toSeconds(range.start)}&end=${toSeconds(range.end)}`),
        api("/api/status"),
        api("/api/settings"),
        api("/api/weather")
      ]);
      state.calendars = calendars.calendars || [];
      state.events = events.events || [];
      state.weather = weather || null;
      state.settings = { ...state.settings, ...(settings || {}) };
      if (!state.defaultViewApplied) {
        state.view = isWallView(state.settings.defaultView) ? state.settings.defaultView : "month";
        state.defaultViewApplied = true;
      }
      applyWallSettings(state.settings);
      render(status);
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  function render(status) {
    const range = rangeForView();
    $("monthTitle").textContent = state.view === "week"
      ? `Week of ${dayFormatter.format(range.start)}`
      : state.view === "agenda" ? "Agenda" : monthFormatter.format(state.date);
    $("clock").textContent = new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "short" }).format(new Date());
    if (status) {
      $("status").textContent = status.addresses?.length ? `Local web interface · ${status.addresses.map((ip) => `http://${ip}:${status.port}`).join(" · ")}` : "Local web interface · Wi-Fi address unavailable";
      $("status").classList.remove("error");
    }
    document.body.dataset.theme = effectiveTheme(state.settings);
    document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === state.view));
    $("calendarGrid").classList.toggle("hidden", state.view !== "month");
    $("monthDayView").classList.toggle("hidden", state.view !== "monthday");
    $("weekView").classList.toggle("hidden", state.view !== "week");
    $("agendaView").classList.toggle("hidden", state.view !== "agenda");
    renderCalendars();
    $("newEvent").classList.toggle("hidden", !state.calendars.some((calendar) => calendar.visible && !calendar.synced && !calendar.readOnly));
    renderWeather();
    if (state.view === "month") renderMonth();
    if (state.view === "monthday") renderMonthDay();
    if (state.view === "week") renderWeek();
    if (state.view === "agenda") renderAgenda();
  }

  function eventsForDay(date) {
    const key = dateKey(date);
    return state.events.filter((event) => dateKey(fromSeconds(event.start)) === key || (event.start < toSeconds(startOfDay(date)) && event.end > toSeconds(startOfDay(date))));
  }
  function eventColor(event) {
    const calendar = state.calendars.find((item) => Number(item.id) === Number(event.calendarId));
    return color(calendar?.color ?? event.color);
  }
  function eventChip(event) {
    const date = fromSeconds(event.start);
    const time = event.allDay ? "All day" : timeFormatter.format(date);
    return `<button class="event-chip" style="--event-color:${eventColor(event)}" data-event-id="${event.id}" data-occurrence="${event.start}"><span class="event-title">${escapeHtml(event.title)}</span><span class="event-time">${escapeHtml(time)}</span></button>`;
  }
  function attachEventClicks(root) {
    root.querySelectorAll("[data-event-id]").forEach((button) => button.addEventListener("click", (event) => {
      event.stopPropagation();
      const found = state.events.find((item) => String(item.id) === button.dataset.eventId && String(item.start) === button.dataset.occurrence) || state.events.find((item) => String(item.id) === button.dataset.eventId);
      if (found) openEvent(found);
    }));
  }

  function renderMonth() {
    const range = rangeForView();
    let html = dayNames.map((name) => `<div class="day-heading">${name}</div>`).join("");
    for (let index = 0; index < 42; index += 1) {
      const day = new Date(range.start); day.setDate(day.getDate() + index);
      const events = eventsForDay(day);
      const isToday = dateKey(day) === dateKey(new Date());
      html += `<div class="day-cell ${day.getMonth() !== state.date.getMonth() ? "other-month" : ""} ${isToday ? "today" : ""}" data-date="${dateKey(day)}"><div class="day-number">${day.getDate()}</div><div class="day-events">${events.slice(0, 6).map(eventChip).join("")}${events.length > 6 ? `<span class="more">+${events.length - 6} more</span>` : ""}</div></div>`;
    }
    $("calendarGrid").innerHTML = html;
    $("calendarGrid").querySelectorAll(".day-cell").forEach((cell) => cell.addEventListener("dblclick", () => openNewEvent(new Date(`${cell.dataset.date}T00:00:00`))));
    attachEventClicks($("calendarGrid"));
  }

  function renderMonthDay() {
    const range = rangeForView();
    let monthHtml = dayNames.map((name) => `<div class="day-heading">${name}</div>`).join("");
    for (let index = 0; index < 42; index += 1) {
      const day = new Date(range.start); day.setDate(day.getDate() + index);
      const events = eventsForDay(day);
      const isToday = dateKey(day) === dateKey(new Date());
      const isSelected = dateKey(day) === dateKey(state.date);
      monthHtml += `<button type="button" class="month-day-cell ${day.getMonth() !== state.date.getMonth() ? "other-month" : ""} ${isToday ? "today" : ""} ${isSelected ? "selected" : ""}" data-monthday-date="${dateKey(day)}"><span class="day-number">${day.getDate()}</span><span class="month-day-dots">${events.slice(0, 4).map((event) => `<i style="--event-color:${eventColor(event)}"></i>`).join("")}</span></button>`;
    }
    $("monthDayMonth").innerHTML = `<div class="month-day-grid">${monthHtml}</div>`;
    const selectedDate = startOfDay(state.date);
    const selectedEvents = eventsForDay(selectedDate);
    $("monthDayAgenda").innerHTML = `<div class="month-day-heading"><div class="eyebrow">DAY</div><h2>${escapeHtml(dayFormatter.format(selectedDate))}</h2><button type="button" class="primary month-day-add" id="monthDayAdd">＋ Add event</button></div><div class="month-day-events">${selectedEvents.map(eventChip).join("") || "<p class=\"local-note\">No events for this day.</p>"}</div>`;
    $("monthDayMonth").querySelectorAll("[data-monthday-date]").forEach((cell) => cell.addEventListener("click", () => {
      state.date = new Date(`${cell.dataset.monthdayDate}T00:00:00`);
      load();
    }));
    $("monthDayMonth").querySelectorAll("[data-monthday-date]").forEach((cell) => cell.addEventListener("dblclick", () => openNewEvent(new Date(`${cell.dataset.monthdayDate}T00:00:00`))));
    $("monthDayAdd").addEventListener("click", () => openNewEvent(selectedDate));
    attachEventClicks($("monthDayAgenda"));
  }

  function renderWeek() {
    const range = rangeForView();
    let html = "";
    for (let index = 0; index < 7; index += 1) {
      const day = new Date(range.start); day.setDate(day.getDate() + index);
      const events = eventsForDay(day);
      html += `<div class="week-column"><div class="week-column-header">${dayNames[day.getDay()]}<strong>${day.getDate()}</strong></div><div class="week-events">${events.map(eventChip).join("") || "<span class=\"muted\">No events</span>"}</div></div>`;
    }
    $("weekView").innerHTML = html;
    attachEventClicks($("weekView"));
  }

  function renderAgenda() {
    const days = {};
    state.events.slice().sort((a, b) => a.start - b.start).forEach((event) => {
      const key = dateKey(fromSeconds(event.start));
      (days[key] ||= []).push(event);
    });
    const html = Object.entries(days).map(([key, events]) => {
      const date = new Date(`${key}T00:00:00`);
      return `<div class="agenda-day"><h3>${escapeHtml(dayFormatter.format(date))}</h3>${events.map((event) => `<button class="agenda-event" style="--event-color:${eventColor(event)}" data-event-id="${event.id}" data-occurrence="${event.start}"><span class="agenda-event-time">${event.allDay ? "All day" : escapeHtml(timeFormatter.format(fromSeconds(event.start)))}</span><span><span class="agenda-event-title">${escapeHtml(event.title)}</span>${event.location ? `<span class="agenda-event-meta">${escapeHtml(event.location)}</span>` : ""}</span></button>`).join("")}</div>`;
    }).join("");
    $("agendaView").innerHTML = html || `<p class="local-note">No events in this range.</p>`;
    attachEventClicks($("agendaView"));
  }

  function calendarBadge(calendar) {
    if (calendar.syncMode === "ics_url") return `<span class="calendar-badge">${calendar.readOnly ? "One-way" : "ICS"}</span>`;
    if (calendar.syncMode === "ics_file") return `<span class="calendar-badge">${calendar.readOnly ? "Read-only" : "Imported"}</span>`;
    if (calendar.readOnly) return `<span class="calendar-badge">Read-only</span>`;
    return "";
  }

  function renderCalendars() {
    const sidebarCalendars = state.settings.showLocalCalendar === false
      ? state.calendars.filter((calendar) => Number(calendar.id) !== 1)
      : state.calendars;
    $("calendarList").innerHTML = sidebarCalendars.map((calendar) => {
      const syncButton = calendar.syncMode === "ics_url"
        ? `<button class="calendar-sync" data-sync-calendar-id="${calendar.id}" title="Sync now">↻</button>` : "";
      const deleteButton = Number(calendar.id) !== 1 && !calendar.synced
        ? `<button class="calendar-delete" data-delete-calendar-id="${calendar.id}" title="Delete calendar">×</button>` : "";
      const labelTitle = calendar.lastSyncError || calendar.title;
      return `<div class="calendar-row"><input type="checkbox" data-calendar-id="${calendar.id}" ${calendar.visible ? "checked" : ""} ${calendar.synced ? "disabled" : ""}><div class="calendar-color-picker"><button type="button" class="calendar-color-button" data-color-toggle="${calendar.id}" style="--calendar-color:${color(calendar.color)}" title="Choose ${escapeHtml(calendar.title)} color" aria-label="Choose ${escapeHtml(calendar.title)} color"></button><div class="color-palette" data-calendar-palette="${calendar.id}">${paletteMarkup(calendar.color, `data-calendar-palette-color-id="${calendar.id}"`)}<input type="color" class="color-palette-custom" data-calendar-custom-color-id="${calendar.id}" value="${color(calendar.color)}" title="Custom color"></div></div><label title="${escapeHtml(labelTitle)}">${escapeHtml(calendar.title)} ${calendarBadge(calendar)}</label>${syncButton}${deleteButton}</div>`;
    }).join("") || `<span class="local-note">No calendars yet.</span>`;
    $("eventCalendar").innerHTML = state.calendars.filter((calendar) => !calendar.synced && !calendar.readOnly).map((calendar) => `<option value="${calendar.id}">${escapeHtml(calendar.title)}</option>`).join("");
    $("calendarList").querySelectorAll("input[data-calendar-id]").forEach((checkbox) => checkbox.addEventListener("change", async () => {
      try { await api(`/api/calendars/${checkbox.dataset.calendarId}`, { method: "PUT", body: JSON.stringify({ visible: checkbox.checked }) }); await load(); }
      catch (error) { setStatus(error.message, true); }
    }));
    $("calendarList").querySelectorAll("[data-color-toggle]").forEach((button) => button.addEventListener("click", (event) => {
      event.stopPropagation();
      const palette = $("calendarList").querySelector(`[data-calendar-palette="${button.dataset.colorToggle}"]`);
      document.querySelectorAll(".color-palette.open").forEach((item) => item.classList.remove("open"));
      palette?.classList.toggle("open");
    }));
    const updateCalendarColor = async (control, value) => {
      try { await api(`/api/calendars/${control.dataset.calendarPaletteColorId || control.dataset.calendarCustomColorId}`, { method: "PUT", body: JSON.stringify({ color: value }) }); await load(); }
      catch (error) { setStatus(error.message, true); }
    };
    $("calendarList").querySelectorAll("[data-calendar-palette-color-id]").forEach((swatch) => swatch.addEventListener("click", async (event) => {
      event.stopPropagation();
      await updateCalendarColor(swatch, swatch.dataset.colorValue);
    }));
    $("calendarList").querySelectorAll("[data-calendar-custom-color-id]").forEach((picker) => picker.addEventListener("change", async (event) => {
      event.stopPropagation();
      await updateCalendarColor(picker, picker.value);
    }));
    $("calendarList").querySelectorAll("[data-sync-calendar-id]").forEach((button) => button.addEventListener("click", async () => {
      button.disabled = true;
      try { setStatus("Syncing ICS calendar…"); await api(`/api/calendars/${button.dataset.syncCalendarId}/sync`, { method: "POST" }); await load(); }
      catch (error) { setStatus(error.message, true); button.disabled = false; }
    }));
    $("calendarList").querySelectorAll("[data-delete-calendar-id]").forEach((button) => button.addEventListener("click", async () => {
      const calendar = state.calendars.find((item) => String(item.id) === button.dataset.deleteCalendarId);
      if (!calendar || !confirm(`Delete “${calendar.title}” and all of its events? This cannot be undone.`)) return;
      button.disabled = true;
      try {
        await api(`/api/calendars/${button.dataset.deleteCalendarId}`, { method: "DELETE" });
        setStatus(`${calendar.title} deleted.`);
        await load();
      } catch (error) { setStatus(error.message, true); button.disabled = false; }
    }));
  }

  function weatherGlyph(code) {
    const value = Number(code);
    if (value === 0) return "☀";
    if (value === 1 || value === 2 || value === 3) return "⛅";
    if (value === 45 || value === 48) return "≋";
    if (value >= 71 && value <= 77 || value >= 85 && value <= 86) return "❄";
    if (value >= 95) return "⚡";
    if (value >= 51 && value <= 67 || value >= 80 && value <= 82) return "☂";
    return "☁";
  }

  function weatherNumber(value, suffix = "°") {
    const number = Number(value);
    return Number.isFinite(number) ? `${Math.round(number)}${suffix}` : "—";
  }

  function renderWeather() {
    const widget = $("weatherWidget");
    const weather = state.weather;
    widget.classList.remove("hidden");
    if (!weather || weather.configured === false) {
      widget.innerHTML = `<div class="weather-unconfigured"><strong>Weather</strong>Set a ZIP code and label in Settings to add local weather.</div>`;
      return;
    }
    if (weather.error) {
      widget.innerHTML = `<div class="weather-error"><strong>${escapeHtml(weather.label || "Weather")}</strong>${escapeHtml(weather.error)}<div class="weather-footer"><a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Weather by Open-Meteo</a> · CAMS ENSEMBLE air quality</div></div>`;
      return;
    }
    const current = weather.current || {};
    const today = weather.today || {};
    const air = weather.airQuality || {};
    const aqiValue = air.aqi === null || air.aqi === undefined ? "—" : `${Math.round(Number(air.aqi))} · ${escapeHtml(air.label || "")}`;
    const aqiClass = String(air.label || "").toLowerCase() === "good" ? " good" : "";
    const forecast = Array.isArray(weather.forecast) ? weather.forecast : [];
    widget.innerHTML = `
      <div class="weather-current">
        <div class="weather-place"><span class="weather-pin">⌖</span><span class="weather-location">${escapeHtml(weather.label || weather.locationName || weather.zip)}</span></div>
        <div class="weather-main"><div class="weather-icon" aria-hidden="true">${weatherGlyph(current.weatherCode)}</div><div class="weather-temperature">${weatherNumber(current.temperature, "°F")}</div></div>
        <div class="weather-condition">${escapeHtml(current.condition || "Weather")}</div>
      </div>
      <div class="weather-rows">
        <div class="weather-row"><span class="weather-row-icon">♨</span><span class="weather-row-label">High / Low</span><span class="weather-row-value">${weatherNumber(today.high)} / ${weatherNumber(today.low)}</span></div>
        <div class="weather-row"><span class="weather-row-icon">💧</span><span class="weather-row-label">Precipitation</span><span class="weather-row-value">${weatherNumber(current.precipitation, "%")}</span></div>
        <div class="weather-row"><span class="weather-row-icon">◌</span><span class="weather-row-label">Humidity</span><span class="weather-row-value">${weatherNumber(current.humidity, "%")}</span></div>
        <div class="weather-row"><span class="weather-row-icon">◉</span><span class="weather-row-label">Air quality</span><span class="weather-row-value${aqiClass}">${aqiValue}</span></div>
        <div class="weather-row"><span class="weather-row-icon">☀</span><span class="weather-row-label">Sunrise / Sunset</span><span class="weather-row-value">${escapeHtml(today.sunrise || "—")} / ${escapeHtml(today.sunset || "—")}</span></div>
        <div class="weather-row"><span class="weather-row-icon">≋</span><span class="weather-row-label">Wind</span><span class="weather-row-value">${escapeHtml(current.windDirection || "—")} ${weatherNumber(current.windSpeed, " mph")}</span></div>
      </div>
      <div class="weather-forecast">${forecast.map((day) => `<div class="weather-day"><div class="weather-day-name">${escapeHtml(day.date || "—")}</div><div class="weather-day-icon" aria-hidden="true">${weatherGlyph(day.weatherCode)}</div><div class="weather-day-high">${weatherNumber(day.high)}</div><div class="weather-day-low">${weatherNumber(day.low)}</div><div class="weather-day-rain">💧 ${weatherNumber(day.precipitation, "%")}</div></div>`).join("")}</div>
      <div class="weather-footer"><a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Weather by Open-Meteo</a> · CAMS ENSEMBLE air quality</div>`;
  }

  function openNewEvent(date = state.date) {
    const editable = state.calendars.filter((item) => item.visible && !item.synced && !item.readOnly);
    if (!editable.length) {
      setStatus("Add or enable an editable calendar before creating events.", true);
      return;
    }
    $("eventId").value = "";
    $("dialogTitle").textContent = "New event";
    $("eventTitle").value = "";
    $("eventDate").value = dateKey(date);
    $("eventStart").value = "09:00";
    $("eventEnd").value = "10:00";
    $("eventAllDay").checked = false;
    document.querySelectorAll(".timed-fields").forEach((row) => row.classList.remove("hidden"));
    $("eventLocation").value = "";
    $("eventDescription").value = "";
    $("deleteEvent").classList.add("hidden");
    $("formError").textContent = "";
    $("eventCalendar").disabled = false;
    $("eventCalendar").value = editable[0].id;
    $("eventDialog").showModal();
  }

  function openEvent(event) {
    const calendar = state.calendars.find((item) => Number(item.id) === Number(event.calendarId));
    if (calendar?.readOnly || calendar?.synced) {
      setStatus(`${calendar.title} is read-only; incoming calendar changes cannot be edited here.`, true);
      return;
    }
    $("eventId").value = event.id;
    $("dialogTitle").textContent = event.repeatInterval ? "Edit repeating series" : "Edit event";
    const date = fromSeconds(event.start);
    $("eventTitle").value = event.title || "";
    $("eventDate").value = dateKey(date);
    $("eventStart").value = event.allDay ? "09:00" : `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
    const end = fromSeconds(event.end);
    $("eventEnd").value = event.allDay ? "10:00" : `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`;
    $("eventAllDay").checked = Boolean(event.allDay);
    document.querySelectorAll(".timed-fields").forEach((row) => row.classList.toggle("hidden", Boolean(event.allDay)));
    $("eventLocation").value = event.location || "";
    $("eventDescription").value = event.description || "";
    $("eventCalendar").value = event.calendarId;
    $("eventCalendar").disabled = false;
    $("deleteEvent").classList.remove("hidden");
    $("formError").textContent = event.repeatInterval ? "Saving edits updates the repeating series." : "";
    $("eventDialog").showModal();
  }

  function formPayload() {
    const date = new Date(`${$("eventDate").value}T00:00:00`);
    const allDay = $("eventAllDay").checked;
    const start = allDay ? startOfDay(date) : localDateTime(date, $("eventStart").value);
    let end = allDay ? new Date(start) : localDateTime(date, $("eventEnd").value);
    if (allDay) end.setDate(end.getDate() + 1);
    if (!allDay && end <= start) end.setDate(end.getDate() + 1);
    return { title: $("eventTitle").value, calendarId: Number($("eventCalendar").value), start: toSeconds(start), end: toSeconds(end), allDay, location: $("eventLocation").value, description: $("eventDescription").value };
  }

  async function saveEvent(event) {
    const id = $("eventId").value;
    await api(id ? `/api/events/${id}` : "/api/events", { method: id ? "PUT" : "POST", body: JSON.stringify(event) });
    $("eventDialog").close();
    await load();
  }

  function openSettings() {
    $("displayMode").value = state.settings.displayMode || "auto";
    $("wallOrientation").value = state.settings.orientation || "landscape";
    $("adaptiveBrightness").checked = state.settings.adaptiveBrightness !== false;
    $("weekStart").value = state.settings.weekStart || "today";
    $("startWallMode").checked = state.settings.startWallMode !== false;
    $("showLocalCalendar").checked = state.settings.showLocalCalendar !== false;
    $("defaultView").value = isWallView(state.settings.defaultView) ? state.settings.defaultView : "month";
    $("weatherZip").value = state.settings.weatherZip || "";
    $("weatherLabel").value = state.settings.weatherLabel || "";
    $("settingsError").textContent = "";
    $("settingsDialog").showModal();
  }

  function openCalendarDialog(focusFile = false) {
    $("sourceTitle").value = "";
    $("sourceColor").value = COLOR_PALETTE[state.calendars.length % COLOR_PALETTE.length] || "#4f7cff";
    $("sourceColorCustom").value = $("sourceColor").value;
    renderSourceColorPalette();
    $("sourceFile").value = "";
    $("sourceUrl").value = "";
    $("sourceMode").value = focusFile ? "readonly" : "editable";
    $("calendarError").textContent = "";
    $("calendarDialog").showModal();
    if (focusFile) setTimeout(() => $("sourceFile").focus(), 0);
  }

  function renderSourceColorPalette() {
    const selected = $("sourceColor").value;
    $("sourceColorPreview").style.setProperty("--selected-color", selected);
    $("sourceColorValue").textContent = selected.toUpperCase();
    $("sourceColorPalette").innerHTML = paletteMarkup(selected, "data-source-color");
    $("sourceColorPalette").querySelectorAll("[data-source-color]").forEach((swatch) => swatch.addEventListener("click", () => {
      $("sourceColor").value = swatch.dataset.colorValue;
      $("sourceColorCustom").value = swatch.dataset.colorValue;
      renderSourceColorPalette();
    }));
  }

  async function saveSettings() {
    try {
      const settings = await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          displayMode: $("displayMode").value,
          orientation: $("wallOrientation").value,
          adaptiveBrightness: $("adaptiveBrightness").checked,
          weekStart: $("weekStart").value,
          startWallMode: $("startWallMode").checked,
          showLocalCalendar: $("showLocalCalendar").checked,
          defaultView: $("defaultView").value,
          weatherZip: $("weatherZip").value.trim(),
          weatherLabel: $("weatherLabel").value.trim()
        })
      });
      state.settings = { ...state.settings, ...settings };
      applyWallSettings(state.settings);
      $("settingsDialog").close();
      await load();
    } catch (error) { $("settingsError").textContent = error.message; }
  }

  async function importCalendar() {
    const file = $("sourceFile").files[0];
    const url = $("sourceUrl").value.trim();
    const title = $("sourceTitle").value.trim() || "New calendar";
    if (!file && !url) {
      if ($("sourceMode").value !== "editable") {
        $("calendarError").textContent = "Choose an .ics file or enter an ICS feed URL, or select Editable local copy.";
        return;
      }
      try {
        $("calendarError").textContent = "Creating calendar…";
        await api("/api/calendars", { method: "POST", body: JSON.stringify({ title, color: $("sourceColor").value }) });
        $("calendarDialog").close();
        await load();
      } catch (error) { $("calendarError").textContent = error.message; }
      return;
    }
    const form = new FormData();
    form.append("title", title === "New calendar" ? (file ? file.name.replace(/\\.ics$/i, "") : "Imported calendar") : title);
    form.append("color", $("sourceColor").value);
    form.append("mode", $("sourceMode").value);
    if (url) form.append("url", url);
    if (file) form.append("file", file);
    try {
      $("calendarError").textContent = "Importing calendar…";
      await api("/api/calendars/import", { method: "POST", body: form });
      $("calendarDialog").close();
      await load();
    } catch (error) { $("calendarError").textContent = error.message; }
  }

  $("prev").addEventListener("click", () => { if (state.view === "week") state.date.setDate(state.date.getDate() - 7); else state.date.setMonth(state.date.getMonth() - 1); load(); });
  $("next").addEventListener("click", () => { if (state.view === "week") state.date.setDate(state.date.getDate() + 7); else state.date.setMonth(state.date.getMonth() + 1); load(); });
  $("today").addEventListener("click", () => { state.date = new Date(); load(); });
  $("newEvent").addEventListener("click", () => openNewEvent());
  $("closeDialog").addEventListener("click", () => $("eventDialog").close());
  $("cancelEvent").addEventListener("click", () => $("eventDialog").close());
  $("eventAllDay").addEventListener("change", () => document.querySelectorAll(".timed-fields").forEach((row) => row.classList.toggle("hidden", $("eventAllDay").checked)));
  $("eventForm").addEventListener("submit", async (event) => { event.preventDefault(); try { await saveEvent(formPayload()); } catch (error) { $("formError").textContent = error.message; } });
  $("deleteEvent").addEventListener("click", async () => { if (!confirm("Delete this event?")) return; try { await api(`/api/events/${$("eventId").value}`, { method: "DELETE" }); $("eventDialog").close(); await load(); } catch (error) { $("formError").textContent = error.message; } });
  $("addCalendar").addEventListener("click", () => openCalendarDialog());
  $("settingsButton").addEventListener("click", openSettings);
  $("importCalendar").addEventListener("click", () => openCalendarDialog(true));
  $("closeSettings").addEventListener("click", () => $("settingsDialog").close());
  $("cancelSettings").addEventListener("click", () => $("settingsDialog").close());
  $("saveSettings").addEventListener("click", saveSettings);
  $("closeCalendar").addEventListener("click", () => $("calendarDialog").close());
  $("cancelCalendar").addEventListener("click", () => $("calendarDialog").close());
  $("doImport").addEventListener("click", importCalendar);
  $("sourceColorCustom").addEventListener("input", () => {
    $("sourceColor").value = $("sourceColorCustom").value;
    renderSourceColorPalette();
  });
  $("exitWallMode").addEventListener("click", async () => {
    $("settingsDialog").close();
    setStatus("Opening the native calendar…");
    try { await api("/api/exit-wall-mode", { method: "POST" }); }
    catch (error) { setStatus(error.message, true); }
  });
  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => { state.view = button.dataset.view; load(); }));
  setInterval(() => { $("clock").textContent = new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "short" }).format(new Date()); }, 1000);
  setInterval(load, 15000);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  load();
})();
