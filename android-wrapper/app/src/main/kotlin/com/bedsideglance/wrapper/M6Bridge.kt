package com.bedsideglance.wrapper

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject

/**
 * Exposed to the page as window.__M6_BRIDGE__.
 * Methods run on a background thread, not the UI thread.
 * Only the page we load (our own localhost app) can reach this object.
 */
class M6Bridge(private val context: Context? = null) {

    @JavascriptInterface
    fun log(msg: String) {
        Log.d(MainActivity.TAG_PAGE, msg.take(2000))
    }

    @JavascriptInterface
    fun getInfo(): String {
        val wv = WebView.getCurrentWebViewPackage()
        return JSONObject()
            .put("wrapper", "bedside-wrapper")
            .put("model", Build.MODEL)
            .put("manufacturer", Build.MANUFACTURER)
            .put("sdkInt", Build.VERSION.SDK_INT)
            .put("release", Build.VERSION.RELEASE)
            .put("webview", wv?.versionName ?: "unknown")
            .put("webviewPackage", wv?.packageName ?: "unknown")
            .apply { batteryPercent()?.let { put("battery", it) } }
            .toString()
    }

    /** Battery 0-100 from the sticky ACTION_BATTERY_CHANGED broadcast, or null when unavailable. */
    private fun batteryPercent(): Int? = try {
        val i = context?.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = i?.getIntExtra("level", -1) ?: -1
        val scale = i?.getIntExtra("scale", -1) ?: -1
        if (level >= 0 && scale > 0) level * 100 / scale else null
    } catch (e: Exception) { null }
}
