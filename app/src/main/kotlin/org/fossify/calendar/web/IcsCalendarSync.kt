package org.fossify.calendar.web

import android.content.Context
import org.fossify.calendar.extensions.eventsDB
import org.fossify.calendar.extensions.eventsHelper
import org.fossify.calendar.extensions.calendarsDB
import org.fossify.calendar.helpers.IcsImporter
import org.fossify.calendar.helpers.WEB_SYNC_ICS_URL
import org.fossify.calendar.helpers.getNowSeconds
import org.fossify.calendar.models.CalendarEntity
import java.io.File
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL

/** Downloads and imports one-way ICS feeds using Fossify's existing ICS parser. */
object IcsCalendarSync {
    private const val MAX_FEED_BYTES = 10L * 1024L * 1024L

    fun syncUrl(context: Context, calendarId: Long) {
        val calendar = context.calendarsDB.getCalendarWithId(calendarId)
            ?: error("Calendar not found")
        require(calendar.webSyncMode == WEB_SYNC_ICS_URL && calendar.webSyncUrl.isNotBlank()) {
            "Calendar is not an ICS URL feed"
        }

        val temp = File.createTempFile("wall-calendar-", ".ics", context.cacheDir)
        try {
            download(calendar.webSyncUrl, temp)
            importIntoCalendar(context, calendar, temp)
            context.eventsHelper.insertOrUpdateCalendarSync(
                calendar.copy(webSyncLastUpdated = getNowSeconds(), webSyncLastError = "")
            )
        } catch (error: Exception) {
            context.eventsHelper.insertOrUpdateCalendarSync(
                calendar.copy(webSyncLastError = error.message.orEmpty().take(500))
            )
            throw error
        } finally {
            temp.delete()
        }
    }

    fun importFile(context: Context, calendar: CalendarEntity, file: File) {
        importIntoCalendar(context, calendar, file)
        context.eventsHelper.insertOrUpdateCalendarSync(
            calendar.copy(webSyncLastUpdated = getNowSeconds(), webSyncLastError = "")
        )
    }

    private fun importIntoCalendar(context: Context, calendar: CalendarEntity, file: File) {
        val existingIds = context.eventsDB.getEventAndTasksIdsByCalendar(calendar.id!!).toMutableList()
        if (existingIds.isNotEmpty()) {
            context.eventsHelper.deleteEvents(
                existingIds,
                deleteFromCalDAV = false,
                allowReadOnlyCalendar = true
            )
        }

        val result = IcsImporter(context).importEvents(
            path = file.absolutePath,
            defaultCalendarId = calendar.id!!,
            calDAVCalendarId = 0,
            overrideFileCalendars = true,
            eventReminders = null,
            loadFromAssets = false
        )
        require(result != IcsImporter.ImportResult.IMPORT_FAIL) { "ICS import failed" }
    }

    private fun download(source: String, destination: File) {
        val uri = URI(source.trim())
        require(uri.scheme == "http" || uri.scheme == "https") { "ICS URL must use HTTP or HTTPS" }
        val connection = URL(source).openConnection() as HttpURLConnection
        connection.connectTimeout = 15_000
        connection.readTimeout = 30_000
        connection.instanceFollowRedirects = true
        connection.setRequestProperty("Accept", "text/calendar,text/plain;q=0.9,*/*;q=0.1")
        try {
            require(connection.responseCode in 200..299) { "ICS feed returned HTTP ${connection.responseCode}" }
            require(connection.contentLengthLong <= MAX_FEED_BYTES || connection.contentLengthLong < 0) {
                "ICS feed is larger than 10 MB"
            }
            connection.inputStream.use { input ->
                destination.outputStream().use { output ->
                    val buffer = ByteArray(8192)
                    var total = 0L
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        total += read
                        require(total <= MAX_FEED_BYTES) { "ICS feed is larger than 10 MB" }
                        output.write(buffer, 0, read)
                    }
                }
            }
        } finally {
            connection.disconnect()
        }
    }
}
