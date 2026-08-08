package org.fossify.calendar.models

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import org.fossify.calendar.helpers.OTHER_EVENT
import org.fossify.calendar.helpers.WEB_SYNC_LOCAL

@Entity(tableName = "event_types", indices = [(Index(value = ["id"], unique = true))])
data class CalendarEntity(
    @PrimaryKey(autoGenerate = true) var id: Long?,
    @ColumnInfo(name = "title") var title: String,
    @ColumnInfo(name = "color") var color: Int,
    @ColumnInfo(name = "caldav_calendar_id") var caldavCalendarId: Int = 0,
    @ColumnInfo(name = "caldav_display_name") var caldavDisplayName: String = "",
    @ColumnInfo(name = "caldav_email") var caldavEmail: String = "",
    @ColumnInfo(name = "type") var type: Int = OTHER_EVENT,
    @ColumnInfo(name = "web_sync_mode") var webSyncMode: String = WEB_SYNC_LOCAL,
    @ColumnInfo(name = "web_sync_url") var webSyncUrl: String = "",
    @ColumnInfo(name = "web_sync_interval_minutes") var webSyncIntervalMinutes: Int = 15,
    @ColumnInfo(name = "web_read_only") var webReadOnly: Boolean = false,
    @ColumnInfo(name = "web_sync_last_updated") var webSyncLastUpdated: Long = 0L,
    @ColumnInfo(name = "web_sync_last_error") var webSyncLastError: String = ""
) {
    fun getDisplayTitle() =
        if (caldavCalendarId == 0) title else "$caldavDisplayName ($caldavEmail)"

    fun isSyncedCalendar() = caldavCalendarId != 0
}
