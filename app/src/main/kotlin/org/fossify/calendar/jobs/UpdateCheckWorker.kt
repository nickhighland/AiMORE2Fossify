package org.fossify.calendar.jobs

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import org.fossify.calendar.updates.UpdateManager
import java.util.concurrent.TimeUnit

class UpdateCheckWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        UpdateManager.checkDaily(applicationContext)?.let {
            UpdateManager.notifyUpdate(applicationContext, it)
        }
        return Result.success()
    }

    companion object {
        private const val WORK_NAME = "aimore_daily_update_check"

        fun schedule(context: Context) {
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<UpdateCheckWorker>(24, TimeUnit.HOURS)
                    .setInitialDelay(5, TimeUnit.MINUTES)
                    .build()
            )
        }
    }
}
