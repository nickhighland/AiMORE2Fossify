package org.fossify.calendar.receivers

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.fossify.calendar.activities.WallCalendarActivity
import org.fossify.calendar.extensions.config
import org.fossify.calendar.extensions.getAlarmManager
import org.fossify.calendar.extensions.setExactAlarm
import org.fossify.calendar.helpers.WALL_REFRESH_REQUEST_CODE
import java.util.concurrent.TimeUnit

/**
 * Recreates the wall activity once a day. Recreating the WebView periodically
 * bounds any renderer-side resource growth without interrupting calendar sync.
 */
class WallRefreshReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val appContext = context.applicationContext
        if (!appContext.config.wallStartMode) {
            cancel(appContext)
            return
        }

        // Always arm the next refresh before starting the activity. This keeps
        // the schedule intact if launching the activity is temporarily denied.
        schedule(appContext)
        try {
            appContext.startActivity(
                Intent(appContext, WallCalendarActivity::class.java).apply {
                    action = ACTION_REFRESH
                    addFlags(
                        Intent.FLAG_ACTIVITY_NEW_TASK or
                            Intent.FLAG_ACTIVITY_CLEAR_TOP or
                            Intent.FLAG_ACTIVITY_SINGLE_TOP
                    )
                }
            )
        } catch (_: SecurityException) {
            // The alarm remains scheduled and the normal boot/app launch path
            // will still open wall mode when Android allows background starts.
        }
    }

    companion object {
        const val ACTION_REFRESH = "org.fossify.calendar.action.WALL_REFRESH"
        private val REFRESH_INTERVAL_MS = TimeUnit.DAYS.toMillis(1)

        fun schedule(context: Context) {
            val appContext = context.applicationContext
            val operation = pendingIntent(appContext)
            appContext.getAlarmManager().cancel(operation)
            appContext.setExactAlarm(
                triggerAtMillis = System.currentTimeMillis() + REFRESH_INTERVAL_MS,
                operation = operation
            )
        }

        fun cancel(context: Context) {
            val appContext = context.applicationContext
            appContext.getAlarmManager().cancel(pendingIntent(appContext))
        }

        private fun pendingIntent(context: Context): PendingIntent {
            return PendingIntent.getBroadcast(
                context,
                WALL_REFRESH_REQUEST_CODE,
                Intent(context, WallRefreshReceiver::class.java).setAction(ACTION_REFRESH),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }
    }
}
