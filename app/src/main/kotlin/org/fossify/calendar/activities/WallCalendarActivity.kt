package org.fossify.calendar.activities

import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.ValueCallback
import android.widget.FrameLayout
import org.fossify.calendar.extensions.config
import org.fossify.calendar.web.WebCalendarService
import org.json.JSONObject
import java.util.Calendar

/** Full-screen wall surface backed by the same local web UI exposed on the LAN. */
class WallCalendarActivity : SimpleActivity() {
    private companion object {
        const val FILE_CHOOSER_REQUEST = 9021
    }

    private lateinit var webView: WebView
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private var hasLoadedWall = false
    private var hasResumedOnce = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        enterImmersiveMode()

        val root = FrameLayout(this).apply { setBackgroundColor(Color.rgb(13, 17, 24)) }
        webView = WebView(this).apply {
            setBackgroundColor(Color.rgb(13, 17, 24))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.loadsImagesAutomatically = true
            settings.mediaPlaybackRequiresUserGesture = false
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    return request.url.host != "127.0.0.1" && request.url.host != "localhost"
                }

                override fun onReceivedError(
                    view: WebView,
                    request: WebResourceRequest,
                    error: android.webkit.WebResourceError
                ) {
                    super.onReceivedError(view, request, error)
                    if (request.isForMainFrame) view.postDelayed({ view.reload() }, 1000L)
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(
                    view: WebView?,
                    callback: ValueCallback<Array<Uri>>?,
                    params: FileChooserParams?
                ): Boolean {
                    fileChooserCallback?.onReceiveValue(null)
                    fileChooserCallback = callback
                    return try {
                        startActivityForResult(
                            Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                                addCategory(Intent.CATEGORY_OPENABLE)
                                type = "*/*"
                                putExtra(
                                    Intent.EXTRA_MIME_TYPES,
                                    arrayOf("text/calendar", "text/plain", "application/ics")
                                )
                            },
                            FILE_CHOOSER_REQUEST
                        )
                        true
                    } catch (_: Exception) {
                        fileChooserCallback = null
                        false
                    }
                }
            }
        }
        root.addView(webView, FrameLayout.LayoutParams(-1, -1))
        setContentView(root)

        if (!WebCalendarService.isRunning()) WebCalendarService.start(applicationContext)
        WebCalendarService.setSettingsListener {
            runOnUiThread { applyWallSettings() }
        }
        applyWallSettings()
        loadWall()
    }

    private fun loadWall() {
        if (!hasLoadedWall) {
            webView.loadUrl("http://127.0.0.1:${WebCalendarService.PORT}/?client=app")
            hasLoadedWall = true
        } else {
            webView.reload()
        }
    }

    override fun onResume() {
        super.onResume()
        enterImmersiveMode()
        applyWallSettings()
        if (hasResumedOnce && ::webView.isInitialized && hasLoadedWall) webView.reload()
        hasResumedOnce = true
    }

    private fun applyWallSettings() {
        requestedOrientation = when (config.wallOrientation) {
            "landscape" -> ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
            "portrait" -> ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
            "auto" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR
            else -> ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
        }

        val resolvedMode = when (config.wallDisplayMode) {
            "day" -> "day"
            "night" -> "night"
            else -> {
                val hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
                if (hour in 7..18) "day" else "night"
            }
        }
        val attributes = window.attributes
        attributes.screenBrightness = if (config.wallAdaptiveBrightness) {
            WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
        } else if (resolvedMode == "night") {
            0.18f
        } else {
            0.85f
        }
        window.attributes = attributes

        if (::webView.isInitialized) {
            val settings = JSONObject()
                .put("displayMode", config.wallDisplayMode)
                .put("effectiveMode", resolvedMode)
                .put("adaptiveBrightness", config.wallAdaptiveBrightness)
                .put("orientation", config.wallOrientation)
                .put("weekStart", config.wallWeekStart)
                .put("defaultView", config.wallDefaultView)
            webView.evaluateJavascript("window.applyWallSettings && window.applyWallSettings($settings)", null)
        }
    }

    @Suppress("DEPRECATION")
    private fun enterImmersiveMode() {
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            )
    }

    override fun onDestroy() {
        WebCalendarService.setSettingsListener(null)
        fileChooserCallback?.onReceiveValue(null)
        fileChooserCallback = null
        if (::webView.isInitialized) {
            webView.stopLoading()
            webView.destroy()
        }
        super.onDestroy()
    }

    @Deprecated("Deprecated in Android API")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == FILE_CHOOSER_REQUEST) {
            fileChooserCallback?.onReceiveValue(
                if (resultCode == RESULT_OK) WebChromeClient.FileChooserParams.parseResult(resultCode, data) else null
            )
            fileChooserCallback = null
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }
}
