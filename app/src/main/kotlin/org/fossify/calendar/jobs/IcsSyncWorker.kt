package org.fossify.calendar.jobs

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import org.fossify.calendar.extensions.calendarsDB
import org.fossify.calendar.helpers.WEB_SYNC_ICS_URL
import org.fossify.calendar.web.IcsCalendarSync
import java.util.concurrent.TimeUnit

class IcsSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        var failed = false
        applicationContext.calendarsDB.getCalendars()
            .filter { it.webSyncMode == WEB_SYNC_ICS_URL && it.webSyncUrl.isNotBlank() }
            .forEach { calendar ->
                try {
                    IcsCalendarSync.syncUrl(applicationContext, calendar.id!!)
                } catch (_: Exception) {
                    failed = true
                }
            }
        return if (failed) Result.retry() else Result.success()
    }

    companion object {
        private const val WORK_NAME = "wall_calendar_ics_sync"

        fun schedule(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
            val request = PeriodicWorkRequestBuilder<IcsSyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                // UPDATE is important on upgrades: KEEP would leave an older
                // hourly schedule in place for users who already ran the app.
                ExistingPeriodicWorkPolicy.UPDATE,
                request
            )
        }
    }
}
