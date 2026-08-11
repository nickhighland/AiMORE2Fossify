package org.fossify.calendar.updates

import android.app.AlertDialog
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.widget.Toast
import androidx.core.app.NotificationCompat
import androidx.core.app.PendingIntentCompat
import androidx.core.content.FileProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.fossify.calendar.BuildConfig
import org.fossify.calendar.R
import org.fossify.calendar.activities.SettingsActivity
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

data class UpdateInfo(
    val version: String,
    val downloadUrl: String,
    val releaseUrl: String,
    val notes: String
)

object UpdateManager {
    private const val RELEASES_URL =
        "https://api.github.com/repos/nickhighland/AiMORE2Fossify/releases/latest"
    private const val PREFS = "aimore_updates"
    private const val LAST_CHECK = "last_check"
    private const val IGNORED_VERSION = "ignored_version"
    private const val PENDING_VERSION = "pending_version"
    private const val PENDING_DOWNLOAD_URL = "pending_download_url"
    private const val PENDING_RELEASE_URL = "pending_release_url"
    private const val PENDING_NOTES = "pending_notes"
    private const val CHANNEL_ID = "aimore_updates"
    private const val NOTIFICATION_ID = 2204
    private const val CHECK_INTERVAL_MS = 24L * 60L * 60L * 1000L
    private const val APK_MIME = "application/vnd.android.package-archive"

    fun checkNow(context: Context, callback: (UpdateInfo?, Throwable?) -> Unit) {
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            val result = runCatching { fetchLatest() }
            val update = result.getOrNull()?.takeIf(::isNewer)
            if (result.isSuccess) {
                context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit()
                    .putLong(LAST_CHECK, System.currentTimeMillis())
                    .apply()
            }
            Handler(Looper.getMainLooper()).post {
                callback(update, result.exceptionOrNull())
            }
        }
    }

    /** Synchronous check for the local wall-settings endpoint, which runs off the main thread. */
    fun checkNowBlocking(context: Context): UpdateInfo? {
        val result = runCatching { fetchLatest() }
        if (result.isSuccess) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putLong(LAST_CHECK, System.currentTimeMillis())
                .apply()
        }
        return result.getOrThrow()?.takeIf(::isNewer)
    }

    /** Queue a manually discovered update so SettingsActivity can show its approval dialog. */
    fun queueUpdate(context: Context, update: UpdateInfo) {
        savePending(context, update)
    }

    suspend fun checkDaily(context: Context): UpdateInfo? {
        val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val now = System.currentTimeMillis()
        if (now - preferences.getLong(LAST_CHECK, 0L) < CHECK_INTERVAL_MS) return null
        return try {
            val update = fetchLatest()?.takeIf(::isNewer)
            preferences.edit().putLong(LAST_CHECK, now).apply()
            update
        } catch (_: Throwable) {
            null
        }
    }

    fun notifyUpdate(context: Context, update: UpdateInfo) {
        if (ignoredVersion(context) == update.version) return
        savePending(context, update)
        val notificationManager = context.getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            notificationManager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    context.getString(R.string.app_name),
                    NotificationManager.IMPORTANCE_DEFAULT
                )
            )
        }
        val intent = Intent(context, SettingsActivity::class.java)
        val pendingIntent = PendingIntentCompat.getActivity(
            context,
            NOTIFICATION_ID,
            intent,
            android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE,
            false
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_calendar_vector)
            .setContentTitle(context.getString(R.string.update_available))
            .setContentText(context.getString(R.string.update_available_version, update.version))
            .setStyle(NotificationCompat.BigTextStyle().bigText(context.getString(R.string.update_available_message, update.version)))
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .build()
        try {
            notificationManager.notify(NOTIFICATION_ID, notification)
        } catch (_: SecurityException) {
            // Notifications may be disabled by the user or unavailable on this firmware.
        }
    }

    fun takePendingUpdate(context: Context): UpdateInfo? {
        val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val version = preferences.getString(PENDING_VERSION, null) ?: return null
        val downloadUrl = preferences.getString(PENDING_DOWNLOAD_URL, null) ?: return null
        val update = UpdateInfo(
            version = version,
            downloadUrl = downloadUrl,
            releaseUrl = preferences.getString(PENDING_RELEASE_URL, "").orEmpty(),
            notes = preferences.getString(PENDING_NOTES, "").orEmpty()
        )
        preferences.edit()
            .remove(PENDING_VERSION)
            .remove(PENDING_DOWNLOAD_URL)
            .remove(PENDING_RELEASE_URL)
            .remove(PENDING_NOTES)
            .apply()
        return update
    }

    fun showInstallDialog(context: Context, update: UpdateInfo) {
        val message = buildString {
            append(context.getString(R.string.update_available_message, update.version))
            if (update.notes.isNotBlank()) {
                append("\n\n")
                append(update.notes.take(1200))
            }
        }
        AlertDialog.Builder(context)
            .setTitle(R.string.update_available)
            .setMessage(message)
            .setNegativeButton(R.string.not_now) { _, _ ->
                ignoredVersion(context, update.version)
            }
            .setPositiveButton(R.string.install_update) { _, _ ->
                downloadAndInstall(context, update)
            }
            .show()
    }

    private fun downloadAndInstall(context: Context, update: UpdateInfo) {
        Toast.makeText(context, R.string.downloading_update, Toast.LENGTH_SHORT).show()
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            val result = runCatching { download(context, update) }
            Handler(Looper.getMainLooper()).post {
                result.onSuccess { install(context, it) }
                    .onFailure {
                        Toast.makeText(context, R.string.update_download_failed, Toast.LENGTH_LONG).show()
                    }
            }
        }
    }

    private fun install(context: Context, apk: File) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            && !context.packageManager.canRequestPackageInstalls()
        ) {
            Toast.makeText(context, R.string.update_install_permission, Toast.LENGTH_LONG).show()
            try {
                context.startActivity(
                    Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:${context.packageName}")
                    ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                )
            } catch (_: ActivityNotFoundException) {
                context.startActivity(
                    Intent(Settings.ACTION_SECURITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                )
            }
            return
        }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.provider", apk)
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, APK_MIME)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(intent)
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(context, R.string.update_install_failed, Toast.LENGTH_LONG).show()
        }
    }

    private suspend fun download(context: Context, update: UpdateInfo): File = withContext(Dispatchers.IO) {
        val directory = File(context.cacheDir, "updates").apply { mkdirs() }
        val destination = File(directory, "AiMORE2Fossify-${update.version}.apk")
        val connection = (URL(update.downloadUrl).openConnection() as HttpURLConnection).apply {
            connectTimeout = 20_000
            readTimeout = 120_000
            instanceFollowRedirects = true
            requestMethod = "GET"
            setRequestProperty("User-Agent", "AiMORE2Fossify/${BuildConfig.VERSION_NAME}")
            setRequestProperty("Accept", APK_MIME)
        }
        connection.connect()
        if (connection.responseCode !in 200..299) {
            connection.disconnect()
            error("Download failed with HTTP ${connection.responseCode}")
        }
        connection.inputStream.use { input ->
            destination.outputStream().use { output -> input.copyTo(output) }
        }
        connection.disconnect()
        destination
    }

    private fun fetchLatest(): UpdateInfo? {
        val connection = (URL(RELEASES_URL).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 30_000
            instanceFollowRedirects = true
            requestMethod = "GET"
            setRequestProperty("Accept", "application/vnd.github+json")
            setRequestProperty("User-Agent", "AiMORE2Fossify/${BuildConfig.VERSION_NAME}")
        }
        connection.connect()
        if (connection.responseCode !in 200..299) {
            connection.disconnect()
            error("GitHub returned HTTP ${connection.responseCode}")
        }
        val release = connection.inputStream.bufferedReader().use { JSONObject(it.readText()) }
        connection.disconnect()
        val assets = release.optJSONArray("assets") ?: return null
        var downloadUrl: String? = null
        for (index in 0 until assets.length()) {
            val asset = assets.optJSONObject(index) ?: continue
            if (asset.optString("name").lowercase().endsWith(".apk")) {
                downloadUrl = asset.optString("browser_download_url").takeIf { it.isNotBlank() }
                if (downloadUrl != null) break
            }
        }
        val tag = release.optString("tag_name").removePrefix("v").ifBlank { return null }
        return UpdateInfo(
            version = tag,
            downloadUrl = downloadUrl ?: return null,
            releaseUrl = release.optString("html_url"),
            notes = release.optString("body")
        )
    }

    private fun isNewer(update: UpdateInfo): Boolean =
        compareVersions(update.version, BuildConfig.VERSION_NAME) > 0

    private fun compareVersions(first: String, second: String): Int {
        val left = Regex("\\d+").findAll(first).map { it.value.toInt() }.toList()
        val right = Regex("\\d+").findAll(second).map { it.value.toInt() }.toList()
        for (index in 0 until maxOf(left.size, right.size)) {
            val difference = (left.getOrNull(index) ?: 0) - (right.getOrNull(index) ?: 0)
            if (difference != 0) return difference
        }
        return 0
    }

    private fun savePending(context: Context, update: UpdateInfo) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(PENDING_VERSION, update.version)
            .putString(PENDING_DOWNLOAD_URL, update.downloadUrl)
            .putString(PENDING_RELEASE_URL, update.releaseUrl)
            .putString(PENDING_NOTES, update.notes)
            .apply()
    }

    private fun ignoredVersion(context: Context): String? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(IGNORED_VERSION, null)

    private fun ignoredVersion(context: Context, version: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(IGNORED_VERSION, version)
            .apply()
    }
}
