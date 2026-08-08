package org.fossify.calendar

import org.fossify.calendar.extensions.hasDummyAlarm
import org.fossify.calendar.jobs.AppStartupWorker
import org.fossify.calendar.jobs.IcsSyncWorker
import org.fossify.calendar.web.WebCalendarService
import org.fossify.commons.FossifyApp

class App : FossifyApp() {
    override fun onCreate() {
        super.onCreate()
        if (!hasDummyAlarm()) {
            AppStartupWorker.start(this)
        }
        WebCalendarService.start(this)
        IcsSyncWorker.schedule(this)
    }
}
