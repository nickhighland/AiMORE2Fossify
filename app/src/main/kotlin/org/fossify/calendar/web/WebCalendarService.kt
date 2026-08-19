package org.fossify.calendar.web

import android.content.Context
import android.content.Intent
import android.graphics.Color
import org.fossify.calendar.BuildConfig
import org.fossify.calendar.R
import org.fossify.calendar.activities.MainActivity
import org.fossify.calendar.activities.SettingsActivity
import org.fossify.calendar.extensions.calendarsDB
import org.fossify.calendar.extensions.config
import org.fossify.calendar.extensions.eventsDB
import org.fossify.calendar.extensions.eventsHelper
import org.fossify.calendar.helpers.FLAG_ALL_DAY
import org.fossify.calendar.helpers.LOCAL_CALENDAR_ID
import org.fossify.calendar.helpers.REMINDER_NOTIFICATION
import org.fossify.calendar.helpers.REMINDER_OFF
import org.fossify.calendar.helpers.SOURCE_SIMPLE_CALENDAR
import org.fossify.calendar.helpers.TYPE_EVENT
import org.fossify.calendar.helpers.WEB_SYNC_ICS_FILE
import org.fossify.calendar.helpers.WEB_SYNC_ICS_URL
import org.fossify.calendar.helpers.WEB_SYNC_LOCAL
import org.fossify.calendar.helpers.getNowSeconds
import org.fossify.calendar.models.CalendarEntity
import org.fossify.calendar.models.Event
import org.fossify.calendar.updates.UpdateManager
import org.fossify.commons.extensions.getProperPrimaryColor
import org.joda.time.DateTime
import fi.iki.elonen.NanoHTTPD
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.io.File
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.Collections
import java.util.TimeZone

/**
 * Process-local HTTP server for the wall calendar. It deliberately exposes only
 * the calendar API and packaged static assets; it never evaluates arbitrary SQL
 * or reads arbitrary files from the device.
 */
object WebCalendarService {
    const val PORT = 8080

    @Volatile
    private var server: CalendarHttpServer? = null

    @Volatile
    private var settingsListener: ((Context) -> Unit)? = null

    @Synchronized
    fun start(context: Context) {
        if (server != null) return

        val instance = CalendarHttpServer(context.applicationContext, PORT)
        try {
            instance.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false)
            server = instance
        } catch (_: IOException) {
            // A port collision must not prevent the native Fossify app from starting.
            instance.stop()
        }
    }

    @Synchronized
    fun stop() {
        server?.stop()
        server = null
    }

    fun isRunning() = server != null

    fun lanAddresses(): List<String> = server?.lanAddresses() ?: emptyList()

    fun setSettingsListener(listener: ((Context) -> Unit)?) {
        settingsListener = listener
    }

    internal fun notifySettingsChanged(context: Context) {
        settingsListener?.invoke(context.applicationContext)
    }
}

private class CalendarHttpServer(
    private val appContext: Context,
    port: Int
) : NanoHTTPD("0.0.0.0", port) {

    fun lanAddresses(): List<String> = findLanAddresses()

    override fun serve(session: IHTTPSession): Response {
        return try {
            when {
                session.method == Method.OPTIONS -> emptyResponse(Response.Status.NO_CONTENT)
                session.method == Method.GET && session.uri == "/" -> assetResponse("index.html", "text/html")
                session.method == Method.GET && session.uri == "/styles.css" -> assetResponse("styles.css", "text/css")
                session.method == Method.GET && session.uri == "/app.js" -> assetResponse("app.js", "text/javascript")
                session.method == Method.GET && session.uri == "/manifest.webmanifest" -> assetResponse("manifest.webmanifest", "application/manifest+json")
                session.method == Method.GET && session.uri == "/icons/calendar.svg" -> assetResponse("icons/calendar.svg", "image/svg+xml")
                session.method == Method.GET && session.uri == "/sw.js" -> assetResponse("sw.js", "text/javascript")
                session.method == Method.GET && session.uri == "/api/status" -> statusResponse()
                session.method == Method.GET && session.uri == "/api/check-updates" -> checkUpdatesResponse()
                session.method == Method.GET && session.uri == "/api/settings" -> settingsResponse()
                session.method == Method.GET && session.uri == "/api/weather" -> weatherResponse()
                session.method == Method.PUT && session.uri == "/api/settings" -> updateSettings(session)
                session.method == Method.POST && session.uri == "/api/exit-wall-mode" -> exitWallMode()
                session.method == Method.GET && session.uri == "/api/calendars" -> calendarsResponse()
                session.method == Method.GET && session.uri == "/api/events" -> eventsResponse(session)
                session.method == Method.GET && session.uri.startsWith("/api/events/") ->
                    eventResponse(session.uri.removePrefix("/api/events/"))
                session.method == Method.POST && session.uri == "/api/events" -> createEvent(session)
                session.method == Method.PUT && session.uri.startsWith("/api/events/") ->
                    updateEvent(session.uri.removePrefix("/api/events/"), session)
                session.method == Method.DELETE && session.uri.startsWith("/api/events/") ->
                    deleteEvent(session.uri.removePrefix("/api/events/"))
                session.method == Method.POST && session.uri == "/api/calendars/import" -> importCalendar(session)
                session.method == Method.POST && session.uri == "/api/calendars" -> createCalendar(session)
                session.method == Method.POST && session.uri.startsWith("/api/calendars/") && session.uri.endsWith("/sync") ->
                    syncCalendar(session.uri.removePrefix("/api/calendars/").removeSuffix("/sync"))
                session.method == Method.DELETE && session.uri.startsWith("/api/calendars/") ->
                    deleteCalendar(session.uri.removePrefix("/api/calendars/"))
                session.method == Method.PUT && session.uri.startsWith("/api/calendars/") ->
                    updateCalendar(session.uri.removePrefix("/api/calendars/"), session)
                else -> jsonError(Response.Status.NOT_FOUND, "Not found")
            }
        } catch (e: IllegalArgumentException) {
            jsonError(Response.Status.BAD_REQUEST, e.message ?: "Invalid request")
        } catch (e: JSONException) {
            jsonError(Response.Status.BAD_REQUEST, "Malformed JSON request")
        } catch (_: Exception) {
            jsonError(Response.Status.INTERNAL_ERROR, "Calendar operation failed")
        }
    }

    private fun statusResponse(): Response {
        val result = JSONObject().apply {
            put("ok", true)
            put("running", true)
            put("port", WebCalendarService.PORT)
            put("localOnly", true)
            put("app", appContext.getString(R.string.app_launcher_name))
            put("version", BuildConfig.VERSION_NAME)
            put("timezone", TimeZone.getDefault().id)
            put("addresses", JSONArray(findLanAddresses()))
        }
        return jsonResponse(result)
    }

    private fun checkUpdatesResponse(): Response {
        val update = UpdateManager.checkNowBlocking(appContext)
        if (update == null) return jsonResponse(JSONObject().put("available", false))

        UpdateManager.queueUpdate(appContext, update)
        appContext.startActivity(
            Intent(appContext, SettingsActivity::class.java).addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            )
        )
        return jsonResponse(
            JSONObject()
                .put("available", true)
                .put("version", update.version)
        )
    }

    private fun calendarsResponse(): Response {
        val visible = appContext.config.displayCalendars
        val calendars = JSONArray()
        appContext.calendarsDB.getCalendars().forEach { calendar ->
            calendars.put(calendar.toJson(visible.contains(calendar.id.toString())))
        }
        return jsonResponse(JSONObject().put("calendars", calendars))
    }

    private fun settingsResponse(): Response {
        val config = appContext.config
        return jsonResponse(JSONObject().apply {
            put("startWallMode", config.wallStartMode)
            put("displayMode", config.wallDisplayMode)
            put("theme", config.wallTheme)
            put("shape", config.wallShape)
            put("adaptiveBrightness", config.wallAdaptiveBrightness)
            put("orientation", config.wallOrientation)
            put("weekStart", config.wallWeekStart)
            put("showLocalCalendar", config.wallShowLocalCalendar)
            put("showNewEvent", config.wallShowNewEvent)
            put("defaultView", config.wallDefaultView)
            put("weekAgendaLayout", config.wallWeekAgendaLayout)
            put("timeGridStart", config.wallTimeGridStart)
            put("timeGridEnd", config.wallTimeGridEnd)
            put("eventFontSize", config.wallEventFontSize)
            put("eventAlign", config.wallEventAlign)
            put("eventFontFamily", config.wallEventFontFamily)
            put("eventFontWeight", config.wallEventFontWeight)
            put("weatherZip", config.weatherZip)
            put("weatherLabel", config.weatherLabel)
            put("port", WebCalendarService.PORT)
        })
    }

    private fun weatherResponse(): Response {
        val config = appContext.config
        if (config.weatherZip.isBlank()) {
            return jsonResponse(JSONObject().put("configured", false))
        }
        return try {
            jsonResponse(WeatherService.get(config.weatherZip, config.weatherLabel))
        } catch (error: Exception) {
            jsonResponse(JSONObject().apply {
                put("configured", true)
                put("zip", config.weatherZip)
                put("label", config.weatherLabel)
                put("error", error.message ?: "Weather is unavailable")
            })
        }
    }

    private fun updateSettings(session: IHTTPSession): Response {
        val body = readJson(session)
        val config = appContext.config
        if (body.has("startWallMode")) config.wallStartMode = body.optBoolean("startWallMode", true)
        if (body.has("displayMode")) {
            val mode = body.optString("displayMode").lowercase()
            require(mode in setOf("auto", "day", "night")) { "displayMode must be auto, day, or night" }
            config.wallDisplayMode = mode
        }
        if (body.has("theme")) {
            val theme = body.optString("theme").lowercase()
            require(theme in setOf("midnight", "frost", "hearth", "botanical", "twilight", "minimal")) {
                "theme must be midnight, frost, hearth, botanical, twilight, or minimal"
            }
            config.wallTheme = theme
        }
        if (body.has("shape")) {
            val shape = body.optString("shape").lowercase()
            require(shape in setOf("rounded", "sharp")) {
                "shape must be rounded or sharp"
            }
            config.wallShape = shape
        }
        if (body.has("adaptiveBrightness")) {
            config.wallAdaptiveBrightness = body.optBoolean("adaptiveBrightness", true)
        }
        if (body.has("orientation")) {
            val orientation = body.optString("orientation").lowercase()
            require(orientation in setOf("portrait", "landscape", "auto")) {
                "orientation must be portrait, landscape, or auto"
            }
            config.wallOrientation = orientation
        }
        if (body.has("weekStart")) {
            val weekStart = body.optString("weekStart").lowercase()
            require(weekStart in setOf("sunday", "today")) { "weekStart must be sunday or today" }
            config.wallWeekStart = weekStart
        }
        if (body.has("showLocalCalendar")) {
            config.wallShowLocalCalendar = body.optBoolean("showLocalCalendar", true)
        }
        if (body.has("showNewEvent")) {
            config.wallShowNewEvent = body.optBoolean("showNewEvent", true)
        }
        if (body.has("defaultView")) {
            val requestedView = body.optString("defaultView").lowercase()
            val view = if (requestedView == "weekly") "week" else requestedView
            require(view in setOf("month", "monthday", "week", "agenda")) {
                "defaultView must be month, monthday, week, or agenda"
            }
            config.wallDefaultView = view
        }
        if (body.has("weekAgendaLayout")) {
            val layout = body.optString("weekAgendaLayout").lowercase()
            require(layout in setOf("list", "timegrid")) {
                "weekAgendaLayout must be list or timegrid"
            }
            config.wallWeekAgendaLayout = layout
        }
        if (body.has("timeGridStart") || body.has("timeGridEnd")) {
            val start = body.optInt("timeGridStart", config.wallTimeGridStart)
            val end = body.optInt("timeGridEnd", config.wallTimeGridEnd)
            require(start in 0..23 && end in 1..24 && end > start) {
                "timeGridEnd must be after timeGridStart and within a 24-hour day"
            }
            config.wallTimeGridStart = start
            config.wallTimeGridEnd = end
        }
        if (body.has("eventFontSize")) {
            val size = body.optString("eventFontSize").lowercase()
            if (size in setOf("compact", "normal", "large", "xlarge", "huge")) {
                config.wallEventFontSize = size
            }
        }
        if (body.has("eventAlign")) {
            val align = body.optString("eventAlign").lowercase()
            if (align in setOf("top", "center")) {
                config.wallEventAlign = align
            }
        }
        if (body.has("eventFontFamily")) {
            val font = body.optString("eventFontFamily").lowercase()
            if (font in setOf("plus-jakarta", "outfit", "inter", "lexend", "roboto", "space-grotesk", "system")) {
                config.wallEventFontFamily = font
            }
        }
        if (body.has("eventFontWeight")) {
            val weight = body.optString("eventFontWeight").lowercase()
            if (weight in setOf("normal", "medium", "semibold", "bold")) {
                config.wallEventFontWeight = weight
            }
        }
        if (body.has("weatherZip")) config.weatherZip = cleanText(body.optString("weatherZip"), 16)
        if (body.has("weatherLabel")) config.weatherLabel = cleanText(body.optString("weatherLabel"), 120)
        WebCalendarService.notifySettingsChanged(appContext)
        return settingsResponse()
    }

    private fun exitWallMode(): Response {
        appContext.config.wallStartMode = false
        appContext.startActivity(
            Intent(appContext, MainActivity::class.java).addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            )
        )
        return jsonResponse(JSONObject().put("exited", true))
    }

    private fun eventsResponse(session: IHTTPSession): Response {
        val from = session.parameters["start"]?.firstOrNull()?.let(::parseTimestamp)
            ?: (getNowSeconds() - 90 * 86400L)
        val to = session.parameters["end"]?.firstOrNull()?.let(::parseTimestamp)
            ?: (getNowSeconds() + 370 * 86400L)
        require(to >= from) { "end must be after start" }
        require(to - from <= 10 * 366 * 86400L) { "range is too large" }

        val events = ArrayList<Event>()
        appContext.eventsHelper.getEventsSync(from, to, applyTypeFilter = false) { found ->
            events.addAll(found)
        }
        val calendarColors = appContext.eventsHelper.getCalendarColors()
        val visibleCalendarIds = appContext.config.displayCalendars.mapNotNull { it.toLongOrNull() }.toSet()
        val payload = JSONArray()
        events.asSequence()
            .filter { it.type == TYPE_EVENT }
            .filter { visibleCalendarIds.isEmpty() || visibleCalendarIds.contains(it.calendarId) }
            .sortedWith(compareBy<Event> { it.startTS }.thenBy { it.title.lowercase() })
            .forEach {
            payload.put(it.toJson(calendarColors.get(it.calendarId, 0)))
        }
        return jsonResponse(JSONObject().put("events", payload).put("start", from).put("end", to))
    }

    private fun eventResponse(idValue: String): Response {
        val id = parseId(idValue)
        val event = appContext.eventsDB.getEventOrTaskWithId(id)
            ?: return jsonError(Response.Status.NOT_FOUND, "Event not found")
        return jsonResponse(JSONObject().put("event", event.toJson()))
    }

    private fun createEvent(session: IHTTPSession): Response {
        val body = readJson(session)
        val calendarId = body.optLong("calendarId", LOCAL_CALENDAR_ID)
        requireEditableCalendar(calendarId)
        val event = eventFromJson(body, null, calendarId)
        appContext.eventsHelper.insertEvent(
            event = event,
            addToCalDAV = false,
            showToasts = false,
            enableCalendar = true,
            updateWidgets = true
        )
        return jsonResponse(
            JSONObject().put("event", event.toJson()),
            Response.Status.CREATED
        )
    }

    private fun updateEvent(idValue: String, session: IHTTPSession): Response {
        val id = parseId(idValue)
        val existing = appContext.eventsDB.getEventOrTaskWithId(id)
            ?: return jsonError(Response.Status.NOT_FOUND, "Event not found")
        requireEditable(existing)
        val body = readJson(session)
        val calendarId = body.optLong("calendarId", existing.calendarId)
        requireLocalCalendar(calendarId)
        val updated = eventFromJson(body, existing, calendarId).apply { this.id = id }
        appContext.eventsHelper.updateEvent(
            event = updated,
            updateAtCalDAV = false,
            showToasts = false,
            enableCalendar = true,
            updateWidgets = true
        )
        return jsonResponse(JSONObject().put("event", updated.toJson()))
    }

    private fun deleteEvent(idValue: String): Response {
        val id = parseId(idValue)
        val event = appContext.eventsDB.getEventOrTaskWithId(id)
            ?: return jsonError(Response.Status.NOT_FOUND, "Event not found")
        requireEditable(event)
        appContext.eventsHelper.deleteEvent(id, deleteFromCalDAV = false)
        return jsonResponse(JSONObject().put("deleted", true).put("id", id))
    }

    private fun createCalendar(session: IHTTPSession): Response {
        val body = readJson(session)
        val title = cleanText(body.optString("title"), 120)
        require(title.isNotBlank()) { "title is required" }
        val color = parseColor(body.optString("color", "#4f7cff"))
        val calendar = CalendarEntity(id = null, title = title, color = color)
        val id = appContext.eventsHelper.insertOrUpdateCalendarSync(calendar)
        calendar.id = id
        return jsonResponse(JSONObject().put("calendar", calendar.toJson(true)), Response.Status.CREATED)
    }

    private fun importCalendar(session: IHTTPSession): Response {
        val files = HashMap<String, String>()
        session.parseBody(files)
        val multipart = session.headers["content-type"]?.startsWith("multipart/form-data") == true
        val body = files["postData"]?.let(::JSONObject)
        val title = cleanText(
            body?.optString("title")
                ?: session.parameters["title"]?.firstOrNull()
                ?: "Imported calendar",
            120
        )
        val mode = (
            body?.optString("mode")
                ?: session.parameters["mode"]?.firstOrNull()
                ?: "readonly"
            ).lowercase()
        require(mode in setOf("two_way", "two-way", "editable", "readonly", "one_way", "incoming")) {
            "mode must be two_way, readonly, or one_way"
        }
        val normalizedMode = when (mode) {
            "two-way", "editable" -> "two_way"
            "incoming" -> "one_way"
            else -> mode
        }
        val url = body?.optString("url")?.takeIf { it.isNotBlank() }
            ?: session.parameters["url"]?.firstOrNull()?.takeIf { it.isNotBlank() }
        val filePath = files["file"] ?: files.values.firstOrNull()
        require(url != null || (multipart && filePath != null)) { "Provide an ICS file or URL" }
        require(normalizedMode != "one_way" || url != null) { "one_way mode requires an ICS URL" }

        val syncMode = if (url != null) WEB_SYNC_ICS_URL else WEB_SYNC_ICS_FILE
        val calendar = CalendarEntity(
            id = null,
            title = title.ifBlank { "Imported calendar" },
            color = parseColor(body?.optString("color", "#4f7cff") ?: "#4f7cff"),
            webSyncMode = syncMode,
            webSyncUrl = url.orEmpty(),
            webReadOnly = normalizedMode == "one_way" || normalizedMode == "readonly"
        )
        calendar.id = appContext.eventsHelper.insertOrUpdateCalendarSync(calendar)
        try {
            if (url != null) {
                IcsCalendarSync.syncUrl(appContext, calendar.id!!)
            } else {
                IcsCalendarSync.importFile(appContext, calendar, File(filePath!!))
            }
        } catch (error: Exception) {
            if (filePath != null) File(filePath).delete()
            return jsonError(Response.Status.BAD_REQUEST, "ICS import failed: ${error.message ?: "invalid file"}")
        } finally {
            if (filePath != null) File(filePath).delete()
        }
        return jsonResponse(
            JSONObject().put("calendar", appContext.calendarsDB.getCalendarWithId(calendar.id!!)?.toJson(true)),
            Response.Status.CREATED
        )
    }

    private fun syncCalendar(idValue: String): Response {
        val id = parseId(idValue)
        val calendar = appContext.calendarsDB.getCalendarWithId(id)
            ?: return jsonError(Response.Status.NOT_FOUND, "Calendar not found")
        require(calendar.webSyncMode == WEB_SYNC_ICS_URL) { "Only ICS URL calendars can be synced" }
        IcsCalendarSync.syncUrl(appContext, id)
        return jsonResponse(JSONObject().put("calendar", appContext.calendarsDB.getCalendarWithId(id)?.toJson(isCalendarVisible(id))))
    }

    private fun updateCalendar(idValue: String, session: IHTTPSession): Response {
        val id = parseId(idValue)
        val existing = appContext.calendarsDB.getCalendarWithId(id)
            ?: return jsonError(Response.Status.NOT_FOUND, "Calendar not found")
        require(existing.caldavCalendarId == 0) { "Synced calendars are read-only here" }
        val body = readJson(session)
        val title = cleanText(body.optString("title", existing.title), 120)
        require(title.isNotBlank()) { "title is required" }
        val requestedDirection = when {
            body.has("syncDirection") -> body.optString("syncDirection").lowercase()
            body.has("outgoingEnabled") -> if (body.optBoolean("outgoingEnabled")) "two_way" else "incoming"
            else -> null
        }
        require(requestedDirection == null || requestedDirection in setOf("incoming", "one_way", "two_way", "two-way")) {
            "syncDirection must be incoming or two_way"
        }
        require(existing.webSyncMode != WEB_SYNC_LOCAL || requestedDirection != "incoming") {
            "The Local calendar must allow outgoing changes"
        }
        val outgoingEnabled = when (requestedDirection) {
            "two_way", "two-way" -> true
            "incoming", "one_way" -> false
            else -> !existing.webReadOnly
        }
        val updated = existing.copy(
            title = title,
            color = if (body.has("color")) parseColor(body.optString("color")) else existing.color,
            webReadOnly = !outgoingEnabled
        )
        appContext.eventsHelper.insertOrUpdateCalendarSync(updated)
        if (body.has("visible")) {
            setCalendarVisibility(id, body.optBoolean("visible", true))
        }
        return jsonResponse(JSONObject().put("calendar", updated.toJson(isCalendarVisible(id))))
    }

    private fun deleteCalendar(idValue: String): Response {
        val id = parseId(idValue)
        val calendar = appContext.calendarsDB.getCalendarWithId(id)
            ?: return jsonError(Response.Status.NOT_FOUND, "Calendar not found")
        require(id != LOCAL_CALENDAR_ID) { "The built-in local calendar cannot be deleted" }
        require(calendar.caldavCalendarId == 0) {
            "Remove CalDAV calendars from the native calendar settings"
        }

        // Deleting a calendar also removes its events/tasks, matching the
        // native Manage calendars behavior and preventing orphaned entries.
        appContext.eventsHelper.deleteCalendars(arrayListOf(calendar), deleteEvents = true)
        if (appContext.config.defaultCalendarId == id) {
            appContext.config.defaultCalendarId = LOCAL_CALENDAR_ID
        }
        if (appContext.config.lastUsedLocalCalendarId == id) {
            appContext.config.lastUsedLocalCalendarId = LOCAL_CALENDAR_ID
        }
        return jsonResponse(JSONObject().put("deleted", true).put("id", id))
    }

    private fun eventFromJson(body: JSONObject, existing: Event?, calendarId: Long): Event {
        val title = cleanText(body.optString("title", existing?.title ?: ""), 500)
        require(title.isNotBlank()) { "title is required" }
        val start = body.optTimestamp("start", existing?.startTS ?: 0L)
        var end = body.optTimestamp("end", existing?.endTS ?: start)
        val allDay = body.optBoolean("allDay", existing?.getIsAllDay() == true)
        if (allDay && end <= start) end = start + 86400L
        require(start > 0L && end >= start) { "start and end must be valid" }

        val flags = if (allDay) {
            (existing?.flags ?: 0) or FLAG_ALL_DAY
        } else {
            (existing?.flags ?: 0) and FLAG_ALL_DAY.inv()
        }
        return (existing?.copy() ?: Event(id = null)).apply {
            this.startTS = start
            this.endTS = end
            this.title = title
            this.location = cleanText(body.optString("location", existing?.location ?: ""), 1000)
            this.description = cleanText(body.optString("description", existing?.description ?: ""), 10000)
            this.calendarId = calendarId
            this.flags = flags
            this.type = TYPE_EVENT
            this.source = SOURCE_SIMPLE_CALENDAR
            this.timeZone = existing?.timeZone?.ifBlank { TimeZone.getDefault().id }
                ?: TimeZone.getDefault().id
            this.reminder1Minutes = existing?.reminder1Minutes ?: REMINDER_OFF
            this.reminder2Minutes = existing?.reminder2Minutes ?: REMINDER_OFF
            this.reminder3Minutes = existing?.reminder3Minutes ?: REMINDER_OFF
            this.reminder1Type = existing?.reminder1Type ?: REMINDER_NOTIFICATION
            this.reminder2Type = existing?.reminder2Type ?: REMINDER_NOTIFICATION
            this.reminder3Type = existing?.reminder3Type ?: REMINDER_NOTIFICATION
            this.lastUpdated = getNowSeconds()
        }
    }

    private fun requireLocalCalendar(id: Long): CalendarEntity {
        val calendar = appContext.calendarsDB.getCalendarWithId(id)
            ?: if (id == LOCAL_CALENDAR_ID) ensureDefaultCalendar() else null
        require(calendar != null) { "Calendar not found" }
        require(calendar.caldavCalendarId == 0) { "Synced calendars are read-only here" }
        return calendar
    }

    private fun requireEditableCalendar(id: Long): CalendarEntity {
        val calendar = requireLocalCalendar(id)
        require(!calendar.webReadOnly) { "This calendar is read-only and receives incoming changes only" }
        return calendar
    }

    private fun ensureDefaultCalendar(): CalendarEntity {
        val calendar = CalendarEntity(
            id = LOCAL_CALENDAR_ID,
            title = appContext.getString(R.string.regular_event),
            color = appContext.getProperPrimaryColor()
        )
        appContext.eventsHelper.insertOrUpdateCalendarSync(calendar)
        return calendar
    }

    private fun requireEditable(event: Event) {
        require(event.type == TYPE_EVENT) { "Tasks are not editable from the wall API" }
        requireEditableCalendar(event.calendarId)
    }

    private fun setCalendarVisibility(id: Long, visible: Boolean) {
        val config = appContext.config
        if (visible) config.addDisplayCalendar(id.toString())
        else config.removeDisplayCalendars(setOf(id.toString()))
    }

    private fun isCalendarVisible(id: Long): Boolean =
        appContext.config.displayCalendars.contains(id.toString())

    private fun readJson(session: IHTTPSession): JSONObject {
        val files = HashMap<String, String>()
        session.parseBody(files)
        val body = files["postData"] ?: files["content"]?.let { path ->
            File(path).readText().also { File(path).delete() }
        } ?: throw IllegalArgumentException("JSON body is required")
        return JSONObject(body)
    }

    private fun parseId(value: String): Long = value.toLongOrNull()?.takeIf { it > 0 }
        ?: throw IllegalArgumentException("Invalid id")

    private fun parseTimestamp(value: String): Long {
        value.toLongOrNull()?.let { return if (it > 100_000_000_000L) it / 1000L else it }
        return try {
            DateTime.parse(value).millis / 1000L
        } catch (_: Exception) {
            throw IllegalArgumentException("Invalid timestamp")
        }
    }

    private fun JSONObject.optTimestamp(name: String, fallback: Long): Long {
        if (!has(name) || isNull(name)) return fallback
        val value = get(name)
        return when (value) {
            is Number -> if (value.toLong() > 100_000_000_000L) value.toLong() / 1000L else value.toLong()
            else -> parseTimestamp(value.toString())
        }
    }

    private fun cleanText(value: String, maxLength: Int): String = value.trim().take(maxLength)

    private fun parseColor(value: String): Int {
        return try {
            Color.parseColor(value.trim())
        } catch (_: IllegalArgumentException) {
            throw IllegalArgumentException("color must be a CSS hex color")
        }
    }

    private fun assetResponse(name: String, mimeType: String): Response {
        val text = appContext.assets.open("web/$name").bufferedReader().use { it.readText() }
        return newFixedLengthResponse(Response.Status.OK, "$mimeType; charset=utf-8", text)
            .withHeaders()
    }

    private fun jsonResponse(body: JSONObject, status: Response.Status = Response.Status.OK): Response =
        newFixedLengthResponse(status, "application/json; charset=utf-8", body.toString()).withHeaders()

    private fun jsonError(status: Response.Status, message: String): Response =
        jsonResponse(JSONObject().put("error", message), status)

    private fun emptyResponse(status: Response.Status): Response =
        newFixedLengthResponse(status, "text/plain", "").withHeaders()

    private fun Response.withHeaders(): Response = apply {
        addHeader("Access-Control-Allow-Origin", "*")
        addHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
        addHeader("Access-Control-Allow-Headers", "Content-Type")
        addHeader("Cache-Control", "no-store")
    }

    private fun findLanAddresses(): List<String> {
        val result = ArrayList<String>()
        try {
            val interfaces = Collections.list(NetworkInterface.getNetworkInterfaces())
            interfaces.forEach { networkInterface ->
                Collections.list(networkInterface.inetAddresses).forEach { address ->
                    if (address is Inet4Address && !address.isLoopbackAddress && address.isSiteLocalAddress) {
                        result.add(address.hostAddress ?: "")
                    }
                }
            }
        } catch (_: Exception) {
        }
        return result.distinct().sorted()
    }

    private fun Event.toJson(calendarColor: Int = 0) = JSONObject().apply {
        put("id", id ?: JSONObject.NULL)
        put("title", title)
        put("calendarId", calendarId)
        put("start", startTS)
        put("end", endTS)
        put("allDay", getIsAllDay())
        put("location", location)
        put("description", description)
        put("color", if (color != 0) color else calendarColor)
        put("repeatInterval", repeatInterval)
        put("repeatRule", repeatRule)
        put("repeatLimit", repeatLimit)
        put("parentId", parentId)
        put("source", source)
        put("type", type)
    }

    private fun CalendarEntity.toJson(visible: Boolean) = JSONObject().apply {
        put("id", id ?: JSONObject.NULL)
        put("title", title)
        put("color", color)
        put("type", type)
        put("synced", isSyncedCalendar())
        put("visible", visible)
        put("syncMode", webSyncMode)
        put("syncUrl", webSyncUrl)
        put("syncIntervalMinutes", webSyncIntervalMinutes)
        val incomingOnly = webReadOnly || isSyncedCalendar()
        put("readOnly", incomingOnly)
        put("syncDirection", if (incomingOnly) "incoming" else "two_way")
        put("outgoingEnabled", !incomingOnly)
        put("lastSync", webSyncLastUpdated)
        put("lastSyncError", webSyncLastError)
    }
}
