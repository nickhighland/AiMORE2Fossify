(() => {
  "use strict";

  const isNativeWall = new URLSearchParams(window.location.search).get("client") === "app";
  document.body.classList.toggle("native-wall", isNativeWall);

  const THEMES = ["midnight", "frost", "hearth", "botanical", "twilight", "minimal"];
  const SHAPES = ["rounded", "sharp"];
  const EVENT_FONT_SIZES = ["compact", "normal", "large", "xlarge", "huge"];
  const EVENT_ALIGNS = ["top", "center"];
  const EVENT_FONTS = ["plus-jakarta", "outfit", "inter", "lexend", "roboto", "space-grotesk", "system"];
  const EVENT_WEIGHTS = ["normal", "medium", "semibold", "bold"];

  const state = {
    date: new Date(),
    view: "month",
    defaultViewApplied: false,
    events: [],
    calendars: [],
    weather: null,
    followToday: true,
    todayKey: dateKey(new Date()),
    loadId: 0,
    settings: {
      displayMode: "auto",
      theme: "midnight",
      shape: "rounded",
      adaptiveBrightness: true,
      orientation: "landscape",
      weekStart: "today",
      showLocalCalendar: true,
      defaultView: "month",
      weekAgendaLayout: "list",
      timeGridStart: 7,
      timeGridEnd: 22,
      showNewEvent: true,
      eventFontSize: "normal",
      eventAlign: "top",
      eventFontFamily: "plus-jakarta",
      eventFontWeight: "semibold"
    }
  };
  const $ = (id) => document.getElementById(id);
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const monthFormatter = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
  const dayFormatter = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
  const clockTimeFormatter = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
  const clockDateFormatter = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" });
  const hourFormatter = new Intl.DateTimeFormat(undefined, { hour: "numeric" });

  function formatGridHour(hour) {
    const date = new Date(2000, 0, 1, hour === 24 ? 0 : hour, 0, 0, 0);
    const label = hourFormatter.format(date);
    return hour === 24 ? `${label} (next day)` : label;
  }

  function populateTimeGridHours() {
    const start = $("timeGridStart");
    const end = $("timeGridEnd");
    if (!start || !end) return;
    start.innerHTML = Array.from({ length: 24 }, (_, hour) => `<option value="${hour}">${formatGridHour(hour)}</option>`).join("");
    end.innerHTML = Array.from({ length: 24 }, (_, index) => {
      const hour = index + 1;
      return `<option value="${hour}">${formatGridHour(hour)}</option>`;
    }).join("");
  }
  populateTimeGridHours();

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
    return value || "#3b82f6";
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
  function normalizeView(value) {
    const normalized = String(value || "").toLowerCase();
    return normalized === "weekly" ? "week" : normalized;
  }
  function isWallView(value) { return ["month", "monthday", "week", "agenda"].includes(normalizeView(value)); }
  
  function setStatus(text, error = false) {
    const statusEl = $("status");
    if (!statusEl) return;
    const textEl = statusEl.querySelector(".status-text") || statusEl;
    textEl.textContent = text;
    statusEl.classList.toggle("error", error);
  }

  function moveDate(amount) {
    state.followToday = false;
    if (state.view === "week") {
      state.date.setDate(state.date.getDate() + amount * 7);
    } else if (state.view === "monthday" || (state.view === "agenda" && state.settings.weekAgendaLayout === "timegrid")) {
      state.date.setDate(state.date.getDate() + amount);
    } else {
      state.date.setMonth(state.date.getMonth() + amount);
    }
  }

  function updateNavigationLabels() {
    const unit = state.view === "week"
      ? "week"
      : state.view === "monthday" || (state.view === "agenda" && state.settings.weekAgendaLayout === "timegrid")
        ? "day"
        : "month";
    $("prev").setAttribute("aria-label", `Previous ${unit}`);
    $("prev").title = `Previous ${unit}`;
    $("next").setAttribute("aria-label", `Next ${unit}`);
    $("next").title = `Next ${unit}`;
  }

  async function api(path, options = {}) {
    const isFormData = options.body instanceof FormData;
    const headers = isFormData ? {} : { "Content-Type": "application/json" };
    const response = await fetch(path, { ...options, headers: { ...headers, ...(options.headers || {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
    return body;
  }

  function effectiveMode(settings = state.settings) {
    if (settings.displayMode === "day" || settings.displayMode === "night") return settings.displayMode;
    const hour = new Date().getHours();
    return hour >= 7 && hour < 19 ? "day" : "night";
  }

  function effectiveTheme(settings = state.settings) {
    return THEMES.includes(settings.theme) ? settings.theme : "midnight";
  }

  function effectiveShape(settings = state.settings) {
    return SHAPES.includes(settings.shape) ? settings.shape : "rounded";
  }

  function effectiveEventFontSize(settings = state.settings) {
    return EVENT_FONT_SIZES.includes(settings.eventFontSize) ? settings.eventFontSize : "normal";
  }

  function effectiveEventAlign(settings = state.settings) {
    return EVENT_ALIGNS.includes(settings.eventAlign) ? settings.eventAlign : "top";
  }

  function effectiveEventFontFamily(settings = state.settings) {
    return EVENT_FONTS.includes(settings.eventFontFamily) ? settings.eventFontFamily : "plus-jakarta";
  }

  function effectiveEventFontWeight(settings = state.settings) {
    return EVENT_WEIGHTS.includes(settings.eventFontWeight) ? settings.eventFontWeight : "semibold";
  }

  function applyWallSettings(settings) {
    const incomingSettings = settings || {};
    const previousDefaultView = normalizeView(state.settings.defaultView);
    state.settings = { ...state.settings, ...(settings || {}) };
    if (Object.prototype.hasOwnProperty.call(incomingSettings, "defaultView")
        && state.defaultViewApplied
        && isWallView(state.settings.defaultView)
        && previousDefaultView !== normalizeView(state.settings.defaultView)) {
      state.view = normalizeView(state.settings.defaultView);
    }

    const currentTheme = effectiveTheme(state.settings);
    const currentMode = effectiveMode(state.settings);
    const currentShape = effectiveShape(state.settings);
    const currentEventSize = effectiveEventFontSize(state.settings);
    const currentEventAlign = effectiveEventAlign(state.settings);
    const currentEventFont = effectiveEventFontFamily(state.settings);
    const currentEventWeight = effectiveEventFontWeight(state.settings);

    document.body.dataset.theme = currentTheme;
    document.body.dataset.mode = currentMode;
    document.body.dataset.shape = currentShape;
    document.body.dataset.eventSize = currentEventSize;
    document.body.dataset.eventAlign = currentEventAlign;
    document.body.dataset.eventFont = currentEventFont;
    document.body.dataset.eventWeight = currentEventWeight;

    // Sync settings form inputs if open/rendered
    if ($("displayMode")) {
      $("displayMode").value = state.settings.displayMode || "auto";
      $("wallOrientation").value = state.settings.orientation || "landscape";
      $("adaptiveBrightness").checked = state.settings.adaptiveBrightness !== false;
      $("weekStart").value = state.settings.weekStart || "today";
      $("startWallMode").checked = state.settings.startWallMode !== false;
      $("showLocalCalendar").checked = state.settings.showLocalCalendar !== false;
      $("showNewEvent").checked = state.settings.showNewEvent !== false;
      $("defaultView").value = isWallView(state.settings.defaultView) ? normalizeView(state.settings.defaultView) : "month";
      $("weekAgendaLayout").value = state.settings.weekAgendaLayout === "timegrid" ? "timegrid" : "list";
      $("timeGridStart").value = String(Number.isFinite(Number(state.settings.timeGridStart)) ? state.settings.timeGridStart : 7);
      $("timeGridEnd").value = String(Number.isFinite(Number(state.settings.timeGridEnd)) ? state.settings.timeGridEnd : 22);
      if ($("eventFontSize")) $("eventFontSize").value = currentEventSize;
      if ($("eventAlign")) $("eventAlign").value = currentEventAlign;
      if ($("eventFontFamily")) $("eventFontFamily").value = currentEventFont;
      if ($("eventFontWeight")) $("eventFontWeight").value = currentEventWeight;
      
      const themeChoiceInput = $("wallThemeChoice");
      if (themeChoiceInput) themeChoiceInput.value = currentTheme;
      document.querySelectorAll("[data-theme-choice]").forEach((card) => {
        card.classList.toggle("active", card.dataset.themeChoice === currentTheme);
      });

      const shapeChoiceInput = $("wallShapeChoice");
      if (shapeChoiceInput) shapeChoiceInput.value = currentShape;
      document.querySelectorAll("[data-shape-choice]").forEach((card) => {
        card.classList.toggle("active", card.dataset.shapeChoice === currentShape);
      });
    }

    if ($("calendarGrid")) render();
  }
  window.applyWallSettings = applyWallSettings;

  function rangeForView(date = state.date, view = state.view, settings = state.settings) {
    if (view === "week") {
      const start = startOfDay(date);
      if (settings.weekStart !== "today") start.setDate(start.getDate() - start.getDay());
      const end = new Date(start); end.setDate(end.getDate() + 7);
      return { start, end };
    }
    const first = new Date(date.getFullYear(), date.getMonth(), 1);
    const start = new Date(first); start.setDate(start.getDate() - start.getDay());
    const end = new Date(start); end.setDate(end.getDate() + 42);
    return { start, end };
  }

  async function load() {
    const loadId = ++state.loadId;
    try {
      const settings = await api("/api/settings");
      if (loadId !== state.loadId) return;
      state.settings = { ...state.settings, ...(settings || {}) };
      if (!state.defaultViewApplied) {
        state.view = isWallView(state.settings.defaultView) ? normalizeView(state.settings.defaultView) : "month";
        state.defaultViewApplied = true;
      }
      const requestedDate = new Date(state.date);
      const requestedView = state.view;
      const requestedSettings = { ...state.settings };
      const range = rangeForView(requestedDate, requestedView, requestedSettings);
      const [calendars, events, status, weather] = await Promise.all([
        api("/api/calendars"),
        api(`/api/events?start=${toSeconds(range.start)}&end=${toSeconds(range.end)}`),
        api("/api/status"),
        api("/api/weather")
      ]);
      if (loadId !== state.loadId) return;
      state.calendars = calendars.calendars || [];
      state.events = events.events || [];
      state.weather = weather || null;
      applyWallSettings(state.settings);
      render(status);
    } catch (error) {
      if (loadId !== state.loadId) return;
      setStatus(error.message, true);
    }
  }

  function updateClock() {
    const now = new Date();
    const clockTime = $("clockTime");
    const clockDate = $("clockDate");
    if (clockTime) clockTime.textContent = clockTimeFormatter.format(now);
    if (clockDate) clockDate.textContent = clockDateFormatter.format(now);
  }

  function render(status) {
    const range = rangeForView();
    $("monthTitle").textContent = state.view === "week"
      ? `Week of ${dayFormatter.format(range.start)}`
      : state.view === "monthday" && state.settings.weekAgendaLayout === "timegrid"
        ? `Agenda · ${dayFormatter.format(state.date)}`
        : state.view === "agenda" ? "Agenda" : monthFormatter.format(state.date);
    
    updateClock();

    if (status) {
      const version = status.version ? "v" + status.version + " · " : "";
      const text = status.addresses?.length
        ? version + "LAN: " + status.addresses.map((ip) => "http://" + ip + ":" + status.port).join(" · ")
        : version + "Wi-Fi address unavailable";
      setStatus(text, false);
    }

    const currentTheme = effectiveTheme(state.settings);
    const currentMode = effectiveMode(state.settings);
    const currentShape = effectiveShape(state.settings);
    document.body.dataset.theme = currentTheme;
    document.body.dataset.mode = currentMode;
    document.body.dataset.shape = currentShape;

    updateNavigationLabels();
    document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === state.view));
    $("calendarGrid").classList.toggle("hidden", state.view !== "month");
    $("monthDayView").classList.toggle("hidden", state.view !== "monthday");
    $("weekView").classList.toggle("hidden", state.view !== "week");
    $("agendaView").classList.toggle("hidden", state.view !== "agenda");
    
    renderCalendars();
    $("newEvent").classList.toggle("hidden", state.settings.showNewEvent === false || !state.calendars.some((calendar) => calendar.visible && calendar.outgoingEnabled !== false && !calendar.synced && !calendar.readOnly));
    renderWeather();
    
    if (state.view === "month") renderMonth();
    if (state.view === "monthday") renderMonthDay();
    if (state.view === "week") {
      if (state.settings.weekAgendaLayout === "timegrid") renderTimeGrid("week"); else renderWeek();
    }
    if (state.view === "agenda") {
      if (state.settings.weekAgendaLayout === "timegrid") renderTimeGrid("agenda"); else renderAgenda();
    }
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
      html += `<div class="day-cell ${day.getMonth() !== state.date.getMonth() ? "other-month" : ""} ${isToday ? "today" : ""}" data-date="${dateKey(day)}"><div class="day-number">${day.getDate()}</div><div class="day-events">${events.slice(0, 5).map(eventChip).join("")}${events.length > 5 ? `<span class="more">+${events.length - 5} more</span>` : ""}</div></div>`;
    }
    $("calendarGrid").innerHTML = html;
    $("calendarGrid").querySelectorAll(".day-cell").forEach((cell) => cell.addEventListener("dblclick", () => openNewEvent(new Date(`${cell.dataset.date}T00:00:00`))));
    attachEventClicks($("calendarGrid"));
    scrollMonthToToday();
  }

  function scrollMonthToToday() {
    if (!document.body.classList.contains("native-wall")) return;
    const grid = $("calendarGrid");
    const panel = grid?.closest(".calendar-panel");
    if (!grid || !panel) return;
    const todayCell = grid.querySelector(`[data-date="${dateKey(new Date())}"]`);
    requestAnimationFrame(() => {
      if (!todayCell) {
        panel.scrollTop = 0;
        return;
      }
      const cells = Array.from(grid.querySelectorAll(".day-cell"));
      const row = Math.floor(cells.indexOf(todayCell) / 7);
      const maxScroll = Math.max(0, panel.scrollHeight - panel.clientHeight);
      panel.scrollTop = row >= 5 ? maxScroll : Math.min(todayCell.offsetTop, maxScroll);
    });
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
    $("monthDayAgenda").innerHTML = `<div class="month-day-heading"><div class="eyebrow">SELECTED DAY</div><h2>${escapeHtml(dayFormatter.format(selectedDate))}</h2><button type="button" class="primary month-day-add" id="monthDayAdd">＋ Add event</button></div><div class="month-day-events">${selectedEvents.map(eventChip).join("") || "<p class=\"settings-help\">No events scheduled for this day.</p>"}</div>`;
    $("monthDayMonth").querySelectorAll("[data-monthday-date]").forEach((cell) => cell.addEventListener("click", () => {
      state.date = new Date(`${cell.dataset.monthdayDate}T00:00:00`);
      load();
    }));
    $("monthDayMonth").querySelectorAll("[data-monthday-date]").forEach((cell) => cell.addEventListener("dblclick", () => openNewEvent(new Date(`${cell.dataset.monthdayDate}T00:00:00`))));
    $("monthDayAdd").addEventListener("click", () => openNewEvent(selectedDate));
    attachEventClicks($("monthDayAgenda"));
  }

  const TIME_GRID_HOUR_HEIGHT = 76;

  function timeGridSettings() {
    const requestedStart = Number(state.settings.timeGridStart);
    const requestedEnd = Number(state.settings.timeGridEnd);
    const start = Number.isInteger(requestedStart) ? Math.max(0, Math.min(23, requestedStart)) : 7;
    const end = Number.isInteger(requestedEnd) ? Math.max(1, Math.min(24, requestedEnd)) : 22;
    return { start, end: end > start ? end : Math.min(24, start + 1) };
  }

  function timedEventsForDay(day, startHour, endHour) {
    const dayStart = startOfDay(day);
    const visibleStart = toSeconds(new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate(), startHour));
    const visibleEnd = toSeconds(new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate(), endHour));
    return eventsForDay(day)
      .filter((event) => !event.allDay && Number(event.end) > visibleStart && Number(event.start) < visibleEnd)
      .map((event) => ({
        event,
        start: Math.max(Number(event.start), visibleStart),
        end: Math.min(Number(event.end), visibleEnd)
      }))
      .filter((item) => item.end > item.start)
      .sort((first, second) => first.start - second.start || first.end - second.end);
  }

  function timeGridEventMarkup(item, lane, laneCount, visibleStart) {
    const top = ((item.start - visibleStart) / 3600) * TIME_GRID_HOUR_HEIGHT;
    const height = Math.max(24, ((item.end - item.start) / 3600) * TIME_GRID_HOUR_HEIGHT - 3);
    const event = item.event;
    const time = event.allDay ? "All day" : `${timeFormatter.format(fromSeconds(item.start))}–${timeFormatter.format(fromSeconds(item.end))}`;
    return `<button class="time-grid-event" style="--event-color:${eventColor(event)};--event-top:${top}px;--event-height:${height}px;--event-left:${lane * (100 / laneCount)}%;--event-width:calc(${100 / laneCount}% - 3px)" data-event-id="${event.id}" data-occurrence="${event.start}"><span class="time-grid-event-title">${escapeHtml(event.title)}</span><span class="time-grid-event-time">${escapeHtml(time)}</span>${event.location ? `<span class="time-grid-event-location">📍 ${escapeHtml(event.location)}</span>` : ""}</button>`;
  }

  function timeGridAllDayMarkup(event) {
    return `<button class="time-grid-all-day-event" style="--event-color:${eventColor(event)}" data-event-id="${event.id}" data-occurrence="${event.start}">${escapeHtml(event.title)}</button>`;
  }

  function renderTimeGrid(mode) {
    const { start: startHour, end: endHour } = timeGridSettings();
    const days = mode === "week"
      ? Array.from({ length: 7 }, (_, index) => {
        const day = startOfDay(state.date);
        if (state.settings.weekStart !== "today") day.setDate(day.getDate() - day.getDay());
        day.setDate(day.getDate() + index);
        return day;
      })
      : [startOfDay(state.date)];
    const hourLabels = Array.from({ length: endHour - startHour }, (_, index) => `<div class="time-grid-hour-label">${formatGridHour(startHour + index)}</div>`).join("");
    
    const now = new Date();
    const currentHourDecimal = now.getHours() + now.getMinutes() / 60;
    const isCurrentTimeVisible = currentHourDecimal >= startHour && currentHourDecimal <= endHour;
    const currentTimeTop = (currentHourDecimal - startHour) * TIME_GRID_HOUR_HEIGHT;

    const dayColumns = days.map((day) => {
      const dayStart = startOfDay(day);
      const isToday = dateKey(day) === dateKey(now);
      const visibleStart = toSeconds(new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate(), startHour));
      const events = timedEventsForDay(day, startHour, endHour);
      const overlapGroups = [];
      events.forEach((item) => {
        const group = overlapGroups[overlapGroups.length - 1];
        if (!group || item.start >= group.end) {
          overlapGroups.push({ end: item.end, items: [item] });
        } else {
          group.end = Math.max(group.end, item.end);
          group.items.push(item);
        }
      });
      const positioned = [];
      overlapGroups.forEach((group) => {
        const laneEnds = [];
        const groupPositioned = group.items.map((item) => {
          let lane = laneEnds.findIndex((end) => end <= item.start);
          if (lane < 0) lane = laneEnds.length;
          laneEnds[lane] = item.end;
          return { item, lane };
        });
        const laneCount = laneEnds.length;
        groupPositioned.forEach((entry) => positioned.push({ ...entry, laneCount }));
      });
      const allDayEvents = eventsForDay(day).filter((event) => event.allDay);
      return { day, isToday, allDayEvents, positioned, visibleStart };
    });

    const maxAllDayCount = dayColumns.reduce((maximum, column) => Math.max(maximum, column.allDayEvents.length), 0);
    const allDayHeight = maxAllDayCount === 0 ? 36 : 10 + maxAllDayCount * 26 + Math.max(0, maxAllDayCount - 1) * 3;

    const columns = dayColumns.map(({ isToday, allDayEvents, positioned, visibleStart }) => {
      const currentTimeIndicator = (isToday && isCurrentTimeVisible)
        ? `<div class="current-time-line" style="top:${currentTimeTop}px" title="Current Time"></div>`
        : "";
      return `<div class="time-grid-column ${isToday ? "today" : ""}"><div class="time-grid-all-day">${allDayEvents.map(timeGridAllDayMarkup).join("")}</div><div class="time-grid-hours">${currentTimeIndicator}${positioned.map(({ item, lane, laneCount }) => timeGridEventMarkup(item, lane, laneCount, visibleStart)).join("")}</div></div>`;
    }).join("");

    const headers = days.map((day) => {
      const isToday = dateKey(day) === dateKey(now);
      return `<div class="time-grid-day-header ${isToday ? "today" : ""}"><span>${dayNames[day.getDay()]}</span><strong>${day.getDate()}</strong></div>`;
    }).join("");

    const target = mode === "week" ? $("weekView") : $("agendaView");
    target.classList.add("time-grid-host");
    target.innerHTML = `<div class="time-grid time-grid-${mode}" style="--grid-hours:${endHour - startHour};--grid-days:${days.length};--time-grid-all-day-height:${allDayHeight}px"><div class="time-grid-header"><div class="time-grid-corner"></div>${headers}</div><div class="time-grid-body"><div class="time-grid-label-column"><div class="time-grid-all-day-label">All day</div><div class="time-grid-hour-labels">${hourLabels}</div></div>${columns}</div></div>`;
    attachEventClicks(target);
  }

  function renderWeek() {
    $("weekView").classList.remove("time-grid-host");
    const range = rangeForView();
    let html = "";
    for (let index = 0; index < 7; index += 1) {
      const day = new Date(range.start); day.setDate(day.getDate() + index);
      const events = eventsForDay(day);
      const isToday = dateKey(day) === dateKey(new Date());
      html += `<div class="week-column ${isToday ? "today" : ""}"><div class="week-column-header">${dayNames[day.getDay()]}<strong>${day.getDate()}</strong></div><div class="week-events">${events.map(eventChip).join("") || "<span class=\"settings-help\">No events</span>"}</div></div>`;
    }
    $("weekView").innerHTML = html;
    attachEventClicks($("weekView"));
  }

  function renderAgenda() {
    $("agendaView").classList.remove("time-grid-host");
    const days = {};
    state.events.slice().sort((a, b) => a.start - b.start).forEach((event) => {
      const key = dateKey(fromSeconds(event.start));
      (days[key] ||= []).push(event);
    });
    const html = Object.entries(days).map(([key, events]) => {
      const date = new Date(`${key}T00:00:00`);
      return `<div class="agenda-day"><h3><span>✦</span> ${escapeHtml(dayFormatter.format(date))}</h3>${events.map((event) => `<button class="agenda-event" style="--event-color:${eventColor(event)}" data-event-id="${event.id}" data-occurrence="${event.start}"><span class="agenda-event-time">${event.allDay ? "All day" : escapeHtml(timeFormatter.format(fromSeconds(event.start)))}</span><span><span class="agenda-event-title">${escapeHtml(event.title)}</span>${event.location ? `<span class="agenda-event-meta">📍 ${escapeHtml(event.location)}</span>` : ""}</span></button>`).join("")}</div>`;
    }).join("");
    $("agendaView").innerHTML = html || `<p class="settings-help">No events in this range.</p>`;
    attachEventClicks($("agendaView"));
  }

  function calendarBadge(calendar) {
    if (calendar.syncMode === "ics_url" || calendar.syncMode === "ics_file") {
      const label = calendar.readOnly ? (calendar.syncMode === "ics_url" ? "One-way" : "Read-only") : "Two-way";
      const next = calendar.readOnly ? "two_way" : "incoming";
      return `<span class="calendar-badge calendar-direction-toggle" role="button" tabindex="0" data-calendar-direction-id="${calendar.id}" data-next-direction="${next}" title="Switch to ${next === "two_way" ? "two-way" : "incoming-only"} sync">${label}</span>`;
    }
    if (calendar.readOnly) return `<span class="calendar-badge">Read-only</span>`;
    return "";
  }

  function renderCalendars() {
    const sidebarCalendars = state.settings.showLocalCalendar === false
      ? state.calendars.filter((calendar) => Number(calendar.id) !== 1)
      : state.calendars;
    $("calendarList").innerHTML = sidebarCalendars.map((calendar) => {
      const syncButton = calendar.syncMode === "ics_url"
        ? `<button class="calendar-sync" data-sync-calendar-id="${calendar.id}" title="Sync now" aria-label="Sync now">↻</button>` : "";
      const deleteButton = Number(calendar.id) !== 1 && !calendar.synced
        ? `<button class="calendar-delete" data-delete-calendar-id="${calendar.id}" title="Delete calendar" aria-label="Delete calendar">×</button>` : "";
      const labelTitle = calendar.lastSyncError || calendar.title;
      return `<div class="calendar-row"><input type="checkbox" data-calendar-id="${calendar.id}" ${calendar.visible ? "checked" : ""} ${calendar.synced ? "disabled" : ""} aria-label="Toggle ${escapeHtml(calendar.title)}"><div class="calendar-color-picker"><button type="button" class="calendar-color-button" data-color-toggle="${calendar.id}" style="--calendar-color:${color(calendar.color)}" title="Choose ${escapeHtml(calendar.title)} color" aria-label="Choose ${escapeHtml(calendar.title)} color"></button><div class="color-palette" data-calendar-palette="${calendar.id}">${paletteMarkup(calendar.color, `data-calendar-palette-color-id="${calendar.id}"`)}<input type="color" class="color-palette-custom" data-calendar-custom-color-id="${calendar.id}" value="${color(calendar.color)}" title="Custom color"></div></div><label title="${escapeHtml(labelTitle)}">${escapeHtml(calendar.title)} ${calendarBadge(calendar)}</label>${syncButton}${deleteButton}</div>`;
    }).join("") || `<span class="settings-help">No calendars found.</span>`;
    
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
      button.classList.add("spinning");
      try {
        setStatus("Syncing ICS calendar…");
        await api(`/api/calendars/${button.dataset.syncCalendarId}/sync`, { method: "POST" });
        await load();
      } catch (error) {
        setStatus(error.message, true);
      } finally {
        button.disabled = false;
        button.classList.remove("spinning");
      }
    }));

    $("calendarList").querySelectorAll("[data-calendar-direction-id]").forEach((button) => button.addEventListener("click", async (event) => {
      event.stopPropagation();
      button.disabled = true;
      try {
        await api(`/api/calendars/${button.dataset.calendarDirectionId}`, { method: "PUT", body: JSON.stringify({ syncDirection: button.dataset.nextDirection }) });
        await load();
      } catch (error) {
        setStatus(error.message, true);
        button.disabled = false;
      }
    }));
    $("calendarList").querySelectorAll("[data-calendar-direction-id]").forEach((button) => button.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        button.click();
      }
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
    if (value >= 51 && value <= 67 || value >= 80 && value <= 82) return "🌧";
    return "☁";
  }

  function weatherNumber(value, suffix = "°") {
    const number = Number(value);
    return Number.isFinite(number) ? `${Math.round(number)}${suffix}` : "—";
  }

  function renderWeather() {
    const widget = $("weatherWidget");
    const weather = state.weather;
    const headerBadge = $("headerWeatherBadge");
    
    if (widget) widget.classList.remove("hidden");
    
    if (!weather || weather.configured === false) {
      if (widget) widget.innerHTML = `<div class="weather-unconfigured"><strong>Weather Station</strong>Set a ZIP code and location label in Settings to view live weather.</div>`;
      if (headerBadge) headerBadge.classList.add("hidden");
      return;
    }
    
    if (weather.error) {
      if (widget) widget.innerHTML = `<div class="weather-error"><strong>${escapeHtml(weather.label || "Weather")}</strong>${escapeHtml(weather.error)}</div>`;
      if (headerBadge) headerBadge.classList.add("hidden");
      return;
    }
    
    const current = weather.current || {};
    const today = weather.today || {};
    const air = weather.airQuality || {};
    const aqiValue = air.aqi === null || air.aqi === undefined ? "—" : `${Math.round(Number(air.aqi))} · ${escapeHtml(air.label || "")}`;
    const aqiClass = String(air.label || "").toLowerCase() === "good" ? " good" : "";
    const forecast = Array.isArray(weather.forecast) ? weather.forecast : [];
    
    if (headerBadge && current.temperature !== undefined) {
      headerBadge.textContent = `${weatherGlyph(current.weatherCode)} ${weatherNumber(current.temperature, "°F")}`;
      headerBadge.classList.remove("hidden");
    }

    if (widget) {
      widget.innerHTML = `
        <div class="weather-current">
          <div class="weather-place"><span class="weather-pin">📍</span><span class="weather-location">${escapeHtml(weather.label || weather.locationName || weather.zip)}</span></div>
          <div class="weather-main"><div class="weather-icon" aria-hidden="true">${weatherGlyph(current.weatherCode)}</div><div class="weather-temperature">${weatherNumber(current.temperature, "°F")}</div></div>
          <div class="weather-condition">${escapeHtml(current.condition || "Weather")}</div>
        </div>
        <div class="weather-rows">
          <div class="weather-row"><span class="weather-row-icon">🌡</span><span class="weather-row-label">High / Low</span><span class="weather-row-value">${weatherNumber(today.high)} / ${weatherNumber(today.low)}</span></div>
          <div class="weather-row"><span class="weather-row-icon">💧</span><span class="weather-row-label">Precipitation</span><span class="weather-row-value">${weatherNumber(current.precipitation, "%")}</span></div>
          <div class="weather-row"><span class="weather-row-icon">💨</span><span class="weather-row-label">Humidity</span><span class="weather-row-value">${weatherNumber(current.humidity, "%")}</span></div>
          <div class="weather-row"><span class="weather-row-icon">🍃</span><span class="weather-row-label">Air quality</span><span class="weather-row-value${aqiClass}">${aqiValue}</span></div>
          <div class="weather-row"><span class="weather-row-icon">🌅</span><span class="weather-row-label">Sun</span><span class="weather-row-value">${escapeHtml(today.sunrise || "—")} / ${escapeHtml(today.sunset || "—")}</span></div>
          <div class="weather-row"><span class="weather-row-icon">🌬</span><span class="weather-row-label">Wind</span><span class="weather-row-value">${escapeHtml(current.windDirection || "—")} ${weatherNumber(current.windSpeed, " mph")}</span></div>
        </div>
        <div class="weather-forecast">${forecast.map((day) => `<div class="weather-day"><div class="weather-day-name">${escapeHtml(day.date || "—")}</div><div class="weather-day-icon" aria-hidden="true">${weatherGlyph(day.weatherCode)}</div><div class="weather-day-high">${weatherNumber(day.high)}</div><div class="weather-day-low">${weatherNumber(day.low)}</div><div class="weather-day-rain">💧 ${weatherNumber(day.precipitation, "%")}</div></div>`).join("")}</div>`;
    }
  }

  function openNewEvent(date = state.date) {
    const editable = state.calendars.filter((item) => item.visible && item.outgoingEnabled !== false && !item.synced && !item.readOnly);
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
    $("eventSourceNote").textContent = "";
    $("eventSourceNote").classList.add("hidden");
    $("deleteEvent").classList.add("hidden");
    $("saveEvent").classList.remove("hidden");
    ["eventTitle", "eventDate", "eventAllDay", "eventStart", "eventEnd", "eventCalendar", "eventLocation", "eventDescription"].forEach((id) => $(id).disabled = false);
    $("formError").textContent = "";
    $("eventCalendar").disabled = false;
    $("eventCalendar").value = editable[0].id;
    $("eventDialog").showModal();
  }

  function openEvent(event) {
    const calendar = state.calendars.find((item) => Number(item.id) === Number(event.calendarId));
    const readOnly = Boolean(calendar?.readOnly || calendar?.synced);
    $("eventId").value = event.id;
    $("dialogTitle").textContent = readOnly ? "Event details" : event.repeatInterval ? "Edit repeating series" : "Edit event";
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
    const calendarSelect = $("eventCalendar");
    if (![...calendarSelect.options].some((option) => String(option.value) === String(event.calendarId))) {
      const option = document.createElement("option");
      option.value = event.calendarId;
      option.textContent = calendar?.title || "Calendar";
      calendarSelect.append(option);
    }
    $("eventCalendar").value = event.calendarId;
    $("eventSourceNote").textContent = readOnly ? `${calendar?.title || "This calendar"} is read-only; showing the incoming event details.` : "";
    $("eventSourceNote").classList.toggle("hidden", !readOnly);
    $("eventCalendar").disabled = readOnly;
    $("deleteEvent").classList.toggle("hidden", readOnly);
    $("saveEvent").classList.toggle("hidden", readOnly);
    ["eventTitle", "eventDate", "eventAllDay", "eventStart", "eventEnd", "eventLocation", "eventDescription"].forEach((id) => $(id).disabled = readOnly);
    $("formError").textContent = readOnly ? "" : event.repeatInterval ? "Saving edits updates the repeating series." : "";
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
    $("showNewEvent").checked = state.settings.showNewEvent !== false;
    $("defaultView").value = isWallView(state.settings.defaultView) ? normalizeView(state.settings.defaultView) : "month";
    $("weekAgendaLayout").value = state.settings.weekAgendaLayout === "timegrid" ? "timegrid" : "list";
    $("timeGridStart").value = String(Number.isFinite(Number(state.settings.timeGridStart)) ? state.settings.timeGridStart : 7);
    $("timeGridEnd").value = String(Number.isFinite(Number(state.settings.timeGridEnd)) ? state.settings.timeGridEnd : 22);
    $("weatherZip").value = state.settings.weatherZip || "";
    $("weatherLabel").value = state.settings.weatherLabel || "";
    
    const themeChoice = effectiveTheme(state.settings);
    $("wallThemeChoice").value = themeChoice;
    document.querySelectorAll("[data-theme-choice]").forEach((card) => {
      card.classList.toggle("active", card.dataset.themeChoice === themeChoice);
    });

    const shapeChoice = effectiveShape(state.settings);
    $("wallShapeChoice").value = shapeChoice;
    document.querySelectorAll("[data-shape-choice]").forEach((card) => {
      card.classList.toggle("active", card.dataset.shapeChoice === shapeChoice);
    });

    if ($("eventFontSize")) $("eventFontSize").value = effectiveEventFontSize(state.settings);
    if ($("eventAlign")) $("eventAlign").value = effectiveEventAlign(state.settings);
    if ($("eventFontFamily")) $("eventFontFamily").value = effectiveEventFontFamily(state.settings);
    if ($("eventFontWeight")) $("eventFontWeight").value = effectiveEventFontWeight(state.settings);

    $("settingsError").textContent = "";
    $("updateStatus").textContent = "";
    $("updateStatus").classList.remove("error");
    $("settingsDialog").showModal();
  }

  function openCalendarDialog(focusFile = false) {
    $("sourceTitle").value = "";
    $("sourceColor").value = COLOR_PALETTE[state.calendars.length % COLOR_PALETTE.length] || "#3b82f6";
    $("sourceColorCustom").value = $("sourceColor").value;
    renderSourceColorPalette();
    $("sourceFile").value = "";
    $("sourceUrl").value = "";
    $("sourceMode").value = focusFile ? "readonly" : "two_way";
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
          theme: $("wallThemeChoice").value,
          shape: $("wallShapeChoice").value,
          orientation: $("wallOrientation").value,
          adaptiveBrightness: $("adaptiveBrightness").checked,
          weekStart: $("weekStart").value,
          startWallMode: $("startWallMode").checked,
          showLocalCalendar: $("showLocalCalendar").checked,
          showNewEvent: $("showNewEvent").checked,
          defaultView: normalizeView($("defaultView").value),
          weekAgendaLayout: $("weekAgendaLayout").value,
          timeGridStart: Number($("timeGridStart").value),
          timeGridEnd: Number($("timeGridEnd").value),
          eventFontSize: $("eventFontSize") ? $("eventFontSize").value : "normal",
          eventAlign: $("eventAlign") ? $("eventAlign").value : "top",
          eventFontFamily: $("eventFontFamily") ? $("eventFontFamily").value : "plus-jakarta",
          eventFontWeight: $("eventFontWeight") ? $("eventFontWeight").value : "semibold",
          weatherZip: $("weatherZip").value.trim(),
          weatherLabel: $("weatherLabel").value.trim()
        })
      });
      state.settings = { ...state.settings, ...settings };
      if ($("weekStart").value === "today" && state.view === "week") {
        state.followToday = true;
        state.date = new Date();
      }
      if (isWallView(settings.defaultView)) {
        state.view = normalizeView(settings.defaultView);
        state.defaultViewApplied = true;
      }
      applyWallSettings(state.settings);
      $("settingsDialog").close();
      await load();
    } catch (error) { $("settingsError").textContent = error.message; }
  }

  async function checkForUpdates() {
    const button = $("checkForUpdates");
    const status = $("updateStatus");
    button.disabled = true;
    status.textContent = "Checking…";
    status.classList.remove("error");
    try {
      const result = await api("/api/check-updates");
      status.textContent = result.available
        ? "Version " + result.version + " is available. The calendar is opening the install prompt."
        : "You are using the latest version.";
    } catch (error) {
      status.textContent = error.message;
      status.classList.add("error");
    } finally {
      button.disabled = false;
    }
  }

  async function importCalendar() {
    const file = $("sourceFile").files[0];
    const url = $("sourceUrl").value.trim();
    const title = $("sourceTitle").value.trim() || "New calendar";
    if (!file && !url) {
      if ($("sourceMode").value !== "two_way") {
        $("calendarError").textContent = "Choose an .ics file or enter an ICS feed URL, or select Two-way (incoming + outgoing).";
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
    form.append("title", title === "New calendar" ? (file ? file.name.replace(/\.ics$/i, "") : "Imported calendar") : title);
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

  // Setup Theme Picker in Settings (Live Preview on click)
  document.querySelectorAll("[data-theme-choice]").forEach((card) => {
    card.addEventListener("click", () => {
      document.querySelectorAll("[data-theme-choice]").forEach((c) => c.classList.remove("active"));
      card.classList.add("active");
      const chosenTheme = card.dataset.themeChoice;
      $("wallThemeChoice").value = chosenTheme;
      document.body.dataset.theme = chosenTheme;
    });
  });

  // Setup Shape Picker in Settings (Live Preview on click)
  document.querySelectorAll("[data-shape-choice]").forEach((card) => {
    card.addEventListener("click", () => {
      document.querySelectorAll("[data-shape-choice]").forEach((c) => c.classList.remove("active"));
      card.classList.add("active");
      const chosenShape = card.dataset.shapeChoice;
      $("wallShapeChoice").value = chosenShape;
      document.body.dataset.shape = chosenShape;
    });
  });

  // Settings Tab Navigation
  document.querySelectorAll(".settings-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".settings-tab-btn").forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-selected", "false");
      });
      document.querySelectorAll(".settings-tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");
      const targetPanel = document.querySelector(`[data-tab-panel="${btn.dataset.tab}"]`);
      if (targetPanel) targetPanel.classList.add("active");
    });
  });

  // Typography Live Preview and Live Background Updates
  function updateLiveTypography() {
    if ($("eventFontSize")) document.body.dataset.eventSize = $("eventFontSize").value;
    if ($("eventAlign")) document.body.dataset.eventAlign = $("eventAlign").value;
    if ($("eventFontFamily")) document.body.dataset.eventFont = $("eventFontFamily").value;
    if ($("eventFontWeight")) document.body.dataset.eventWeight = $("eventFontWeight").value;
  }

  ["eventFontSize", "eventAlign", "eventFontFamily", "eventFontWeight"].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener("change", updateLiveTypography);
  });

  // Quick theme switcher button in header
  $("themeButton")?.addEventListener("click", async () => {
    const currentIndex = THEMES.indexOf(effectiveTheme(state.settings));
    const nextTheme = THEMES[(currentIndex + 1) % THEMES.length];
    state.settings.theme = nextTheme;
    applyWallSettings(state.settings);
    try {
      await api("/api/settings", { method: "PUT", body: JSON.stringify({ theme: nextTheme }) });
    } catch (_) {
      // Ignored for offline quick toggle
    }
  });

  $("prev")?.addEventListener("click", () => { moveDate(-1); load(); });
  $("next")?.addEventListener("click", () => { moveDate(1); load(); });
  $("today")?.addEventListener("click", () => { state.date = new Date(); state.followToday = true; load(); });
  $("newEvent")?.addEventListener("click", () => openNewEvent());
  $("closeDialog")?.addEventListener("click", () => $("eventDialog").close());
  $("cancelEvent")?.addEventListener("click", () => $("eventDialog").close());
  $("eventAllDay")?.addEventListener("change", () => document.querySelectorAll(".timed-fields").forEach((row) => row.classList.toggle("hidden", $("eventAllDay").checked)));
  $("eventForm")?.addEventListener("submit", async (event) => { event.preventDefault(); try { await saveEvent(formPayload()); } catch (error) { $("formError").textContent = error.message; } });
  $("deleteEvent")?.addEventListener("click", async () => { if (!confirm("Delete this event?")) return; try { await api(`/api/events/${$("eventId").value}`, { method: "DELETE" }); $("eventDialog").close(); await load(); } catch (error) { $("formError").textContent = error.message; } });
  $("addCalendar")?.addEventListener("click", () => openCalendarDialog());
  $("settingsButton")?.addEventListener("click", openSettings);
  $("importCalendar")?.addEventListener("click", () => openCalendarDialog(true));
  $("closeSettings")?.addEventListener("click", () => {
    // Revert un-saved live preview
    applyWallSettings(state.settings);
    $("settingsDialog").close();
  });
  $("cancelSettings")?.addEventListener("click", () => {
    applyWallSettings(state.settings);
    $("settingsDialog").close();
  });
  $("saveSettings")?.addEventListener("click", saveSettings);
  $("checkForUpdates")?.addEventListener("click", checkForUpdates);
  $("closeCalendar")?.addEventListener("click", () => $("calendarDialog").close());
  $("cancelCalendar")?.addEventListener("click", () => $("calendarDialog").close());
  $("doImport")?.addEventListener("click", importCalendar);
  $("sourceColorCustom")?.addEventListener("input", () => {
    $("sourceColor").value = $("sourceColorCustom").value;
    renderSourceColorPalette();
  });
  $("exitWallMode")?.addEventListener("click", async () => {
    $("settingsDialog").close();
    setStatus("Opening the native calendar…");
    try { await api("/api/exit-wall-mode", { method: "POST" }); }
    catch (error) { setStatus(error.message, true); }
  });
  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => {
    state.view = button.dataset.view;
    if (state.view === "week" && state.settings.weekStart === "today" && state.followToday) state.date = new Date();
    load();
  }));

  setInterval(() => {
    updateClock();
    const now = new Date();
    const todayKey = dateKey(now);
    if (todayKey !== state.todayKey) {
      state.todayKey = todayKey;
      if (state.followToday) {
        state.date = startOfDay(now);
        load();
      }
    }
  }, 1000);
  
  setInterval(load, 15000);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  load();
})();
