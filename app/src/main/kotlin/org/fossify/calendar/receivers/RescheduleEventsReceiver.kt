package org.fossify.calendar.receivers

import android.annotation.SuppressLint
import android.app.AlarmManager
import android.app.ActivityOptions
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import org.fossify.calendar.activities.SplashActivity
import org.fossify.calendar.extensions.notifyRunningEvents
import org.fossify.calendar.jobs.AppStartupWorker
import org.fossify.commons.helpers.ensureBackgroundThread

class RescheduleEventsReceiver : BroadcastReceiver() {

    private companion object {
        const val STARTUP_REQUEST_CODE = 9182
    }

    @SuppressLint("UnsafeProtectedBroadcastReceiver")
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action == Intent.ACTION_BOOT_COMPLETED
            || action == Intent.ACTION_LOCKED_BOOT_COMPLETED
            || action == Intent.ACTION_MY_PACKAGE_REPLACED
            || action == Intent.ACTION_USER_UNLOCKED
            || action == "android.intent.action.QUICKBOOT_POWERON"
            || action == "com.htc.intent.action.QUICKBOOT_POWERON"
        ) {
            val launchIntent = Intent(context, SplashActivity::class.java).addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            )
            try {
                context.startActivity(launchIntent)
            } catch (_: SecurityException) {
                scheduleStartup(context, launchIntent)
            }
        }
        AppStartupWorker.start(
            context = context,
            replaceExistingWork = action == Intent.ACTION_TIME_CHANGED
                    || action == Intent.ACTION_TIMEZONE_CHANGED
        )

        val shouldNotifyRunningEvents = action != Intent.ACTION_TIME_CHANGED
                && action != Intent.ACTION_TIMEZONE_CHANGED
                && action != Intent.ACTION_MY_PACKAGE_REPLACED

        if (shouldNotifyRunningEvents) {
            val result = goAsync()
            ensureBackgroundThread {
                context.notifyRunningEvents()
                result.finish()
            }
        }
    }

    private fun scheduleStartup(context: Context, launchIntent: Intent) {
        val pendingIntentOptions = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ActivityOptions.makeBasic().apply {
                setPendingIntentCreatorBackgroundActivityStartMode(
                    ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED
                )
            }.toBundle()
        } else {
            null
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            STARTUP_REQUEST_CODE,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            pendingIntentOptions
        )
        val alarmManager = context.getSystemService(AlarmManager::class.java)
        val triggerAt = System.currentTimeMillis() + 3_000L
        val alarmInfo = AlarmManager.AlarmClockInfo(triggerAt, pendingIntent)
        alarmManager.setAlarmClock(alarmInfo, pendingIntent)
    }
}
