package com.bedsideglance.wrapper

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Gravity
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView

/**
 * Fullscreen black WebView wrapper for the MicroLumin M6 glasses (Android 9, API 28).
 *
 * Input discovery: every key event is logged under tag BG_KEYS and forwarded to the page
 * as a window CustomEvent 'glasskey'. Keys in DOM_KEY_NAMES are also re-dispatched as
 * standard KeyboardEvents and consumed, so the page sees one clean event.
 * BACK never exits the app: a short press goes to WebView history, a hold of
 * LONG_PRESS_MS sends 'Escape'.
 */
class MainActivity : Activity() {

    private lateinit var webView: WebView
    private lateinit var overlay: TextView
    private lateinit var pageUrl: String

    private val main = Handler(Looper.getMainLooper())
    private var backLongFired = false
    private val backLongPress = Runnable {
        backLongFired = true
        Log.d(TAG_KEYS, "BACK long-press -> Escape")
        sendGlassKey(KeyEvent.KEYCODE_BACK, "long-press", 0, "back")
        sendDomKey("Escape", down = true, repeat = false)
        sendDomKey("Escape", down = false, repeat = false)
    }

    private var pendingPermission: PermissionRequest? = null
    private var lastKeyLabel = "-"
    private var tapCount = 0
    private var lastTapAt = 0L
    private var errorShown = false
    private var lastMotionJsAt = 0L

    private val broadcastLogger = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val action = intent.action ?: return
            if (!(action.contains("KEY") || action.contains("TP") || action.contains("RING"))) return
            val extras = intent.extras?.keySet()?.joinToString() ?: ""
            Log.d(TAG_KEYS, "broadcast action=$action extras=[$extras]")
            val ke = intent.getParcelableExtra<KeyEvent>(Intent.EXTRA_KEY_EVENT)
            if (ke != null) {
                Log.d(TAG_KEYS, "broadcast KeyEvent keyCode=${ke.keyCode} action=${ke.action} scanCode=${ke.scanCode}")
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        enterImmersive()

        // Remote debugging (chrome://inspect) only for a debuggable build. The committed APK is the debug build, so it is on.
        val debuggable = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        WebView.setWebContentsDebuggingEnabled(debuggable)

        pageUrl = resolveUrl(intent)

        webView = WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                mediaPlaybackRequiresUserGesture = false
                loadWithOverviewMode = true
                useWideViewPort = true
            }
            webViewClient = object : WebViewClient() {
                /** Only our own server may be shown: block navigation to any other host. */
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val host = request.url?.host
                    if (isAllowedHost(host)) return false
                    Log.w(TAG_WRAP, "blocked navigation to host=$host")
                    return true
                }

                override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                    Log.w(TAG_WRAP, "load error code=${error.errorCode} desc=${error.description} url=${request.url}")
                    if (request.isForMainFrame && !errorShown) {
                        errorShown = true
                        showLoadError(request.url?.toString() ?: pageUrl, error.description?.toString() ?: "")
                    }
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onPermissionRequest(request: PermissionRequest) {
                    val host = request.origin?.host
                    if (!isAllowedHost(host)) {
                        Log.w(TAG_WRAP, "web permission denied (untrusted origin): host=$host")
                        request.deny()
                        return
                    }
                    handlePermissionRequest(request)
                }
            }
            addJavascriptInterface(M6Bridge(applicationContext), "__M6_BRIDGE__")
        }

        overlay = TextView(this).apply {
            setBackgroundColor(Color.argb(160, 0, 0, 0))
            setTextColor(Color.WHITE)
            textSize = 12f
            setPadding(8, 4, 8, 4)
            visibility = View.GONE
        }

        val root = FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
            addView(webView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            val overlayParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.TOP or Gravity.START
            )
            // Qualified: inside FrameLayout.apply, bare `overlay` resolves to View.getOverlay().
            addView(this@MainActivity.overlay, overlayParams)
        }
        setContentView(root)

        if (pageUrl.contains("debug=1")) overlay.visibility = View.VISIBLE
        updateOverlay()

        registerReceiver(broadcastLogger, IntentFilter().apply {
            GUESSED_BROADCAST_ACTIONS.forEach { addAction(it) }
        })

        requestCameraAndMicIfNeeded()
        webView.loadUrl(pageUrl)
        Log.d(TAG_WRAP, "loaded $pageUrl")
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        pageUrl = resolveUrl(intent)
        errorShown = false
        webView.loadUrl(pageUrl)
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        enterImmersive()
    }

    override fun onPause() {
        webView.onPause()
        super.onPause()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) enterImmersive()
    }

    override fun onDestroy() {
        main.removeCallbacks(backLongPress)
        try {
            unregisterReceiver(broadcastLogger)
        } catch (e: IllegalArgumentException) {
            Log.w(TAG_WRAP, "receiver was not registered: ${e.message}")
        }
        webView.destroy()
        super.onDestroy()
    }

    // ---- Key discovery -----------------------------------------------------

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val action = actionName(event.action)
        val device = event.device?.name ?: "unknown"
        val codeName = KeyEvent.keyCodeToString(event.keyCode)
        Log.d(
            TAG_KEYS,
            "key code=${event.keyCode} ($codeName) action=$action scanCode=${event.scanCode} " +
                "device=\"$device\" source=${event.source} repeat=${event.repeatCount}"
        )
        lastKeyLabel = "$codeName $action (scan ${event.scanCode})"
        updateOverlay()

        if (event.action == KeyEvent.ACTION_MULTIPLE) return super.dispatchKeyEvent(event)

        if (event.keyCode == KeyEvent.KEYCODE_BACK) {
            sendGlassKey(event.keyCode, action, event.scanCode, device)
            handleBack(event)
            return true
        }

        val domKey = DOM_KEY_NAMES[event.keyCode]
        sendGlassKey(event.keyCode, action, event.scanCode, device)
        if (domKey != null) {
            sendDomKey(domKey, down = event.action == KeyEvent.ACTION_DOWN, repeat = event.repeatCount > 0)
            return true
        }
        // Unmapped keys: let the WebView and Activity handle them as usual.
        return super.dispatchKeyEvent(event)
    }

    /** Fallback only: dispatchKeyEvent sees key events first and handles the mapped ones. */
    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        Log.d(TAG_KEYS, "onKeyDown(fallback) code=$keyCode (${KeyEvent.keyCodeToString(keyCode)}) " +
            "scanCode=${event.scanCode} device=\"${event.device?.name ?: "unknown"}\"")
        return super.onKeyDown(keyCode, event)
    }

    override fun onGenericMotionEvent(event: MotionEvent): Boolean {
        val device = event.device?.name ?: "unknown"
        val action = "action${event.actionMasked}"  // MotionEvent.actionToString is API 29+
        Log.d(
            TAG_KEYS,
            "motion action=$action source=${event.source} device=\"$device\" " +
                "x=${event.x} y=${event.y}"
        )
        // Throttled: a ring or touchpad can emit hundreds of motion events a second; evaluateJavascript is not free.
        val nowMs = android.os.SystemClock.uptimeMillis()
        if (nowMs - lastMotionJsAt >= MOTION_JS_MIN_INTERVAL_MS) {
            lastMotionJsAt = nowMs
            sendGlassKey(0, "motion:$action", 0, device)
        }
        // Not consumed: the WebView still gets scroll and pointer events.
        return super.onGenericMotionEvent(event)
    }

    private fun handleBack(event: KeyEvent) {
        when (event.action) {
            KeyEvent.ACTION_DOWN -> {
                if (event.repeatCount == 0) {
                    backLongFired = false
                    main.postDelayed(backLongPress, LONG_PRESS_MS)
                }
            }
            KeyEvent.ACTION_UP -> {
                main.removeCallbacks(backLongPress)
                if (!backLongFired && webView.canGoBack()) {
                    webView.goBack()
                }
            }
        }
    }

    // ---- Page bridge helpers ------------------------------------------------

    /** Dispatches window CustomEvent 'glasskey' with {code, action, scanCode, source}. */
    private fun sendGlassKey(code: Int, action: String, scanCode: Int, source: String) {
        val js = "window.dispatchEvent(new CustomEvent('glasskey',{detail:" +
            "{code:$code,action:'${jsEscape(action)}',scanCode:$scanCode,source:'${jsEscape(source)}'}}));"
        runOnPage(js)
    }

    /** Dispatches a standard KeyboardEvent so existing hotkeys keep working. */
    private fun sendDomKey(key: String, down: Boolean, repeat: Boolean) {
        val type = if (down) "keydown" else "keyup"
        val js = "(function(){var t=document.activeElement||document.body||document;" +
            "t.dispatchEvent(new KeyboardEvent('$type',{key:'$key',code:'$key',bubbles:true,cancelable:true," +
            "repeat:$repeat}));})();"
        runOnPage(js)
    }

    private fun runOnPage(js: String) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            webView.evaluateJavascript(js, null)
        } else {
            main.post { webView.evaluateJavascript(js, null) }
        }
    }

    private fun jsEscape(s: String): String = s
        .replace("\\", "\\\\")
        .replace("'", "\\'")
        .replace("\n", "\\n")
        .replace("\r", "\\r")
        .replace(" ", "\\u2028")
        .replace(" ", "\\u2029")

    // ---- Touch: 5 quick taps toggles the debug overlay ------------------------

    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        if (ev.actionMasked == MotionEvent.ACTION_DOWN) {
            val now = System.currentTimeMillis()
            if (now - lastTapAt > TAP_WINDOW_MS) tapCount = 0
            lastTapAt = now
            tapCount++
            if (tapCount >= 5) {
                tapCount = 0
                overlay.visibility = if (overlay.visibility == View.VISIBLE) View.GONE else View.VISIBLE
                updateOverlay()
            }
        }
        return super.dispatchTouchEvent(ev)
    }

    private fun updateOverlay() {
        if (!::overlay.isInitialized) return
        overlay.text = "last key: $lastKeyLabel\nurl: $pageUrl\nsdk ${android.os.Build.VERSION.SDK_INT} / ${android.os.Build.MODEL}"
    }

    // ---- Permissions ----------------------------------------------------------

    private fun requestCameraAndMicIfNeeded() {
        val missing = arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)
            .filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) {
            requestPermissions(missing.toTypedArray(), REQ_PERMS)
        }
    }

    /** Grant a web camera/mic request only for runtime permissions the app already holds. */
    private fun handlePermissionRequest(request: PermissionRequest) {
        val wanted = request.resources.filter { permissionFor(it) != null }
        if (wanted.isEmpty()) {
            Log.d(TAG_WRAP, "web permission denied (unsupported): ${request.resources.joinToString()}")
            request.deny()
            return
        }
        val held = wanted.filter { hasPermission(it) }
        if (held.size == wanted.size) {
            Log.d(TAG_WRAP, "web permission granted: ${held.joinToString()}")
            request.grant(held.toTypedArray())
            return
        }
        // Ask for the missing runtime permissions and answer the page once the user responds.
        pendingPermission?.deny()
        pendingPermission = request
        val toAsk = wanted.mapNotNull { permissionFor(it) }.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        requestPermissions(toAsk.toTypedArray(), REQ_WEB_PERMS)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        Log.d(TAG_WRAP, "runtime permission result code=$requestCode " +
            permissions.zip(grantResults.toList()).joinToString { "${it.first}=${it.second}" })
        if (requestCode == REQ_WEB_PERMS) {
            val req = pendingPermission ?: return
            pendingPermission = null
            val ok = req.resources.filter { hasPermission(it) }
            if (ok.isEmpty()) req.deny() else req.grant(ok.toTypedArray())
        }
    }

    private fun permissionFor(webResource: String): String? = when (webResource) {
        PermissionRequest.RESOURCE_VIDEO_CAPTURE -> Manifest.permission.CAMERA
        PermissionRequest.RESOURCE_AUDIO_CAPTURE -> Manifest.permission.RECORD_AUDIO
        else -> null
    }

    private fun hasPermission(webResource: String): Boolean {
        val perm = permissionFor(webResource) ?: return false
        return checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED
    }

    // ---- Helpers ----------------------------------------------------------------

    private fun showLoadError(url: String, desc: String) {
        val html = """
            <html><body style="background:#000;color:#fff;font-family:sans-serif;padding:16px">
            <h3>Cannot reach the app</h3>
            <p>Could not load $url<br>($desc)</p>
            <p>On your computer, start the web app, then run<br><code>node scripts/m6-install.mjs</code>.</p>
            </body></html>
        """.trimIndent()
        webView.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
    }

    /** Immersive sticky, hides the status and navigation bars (API 28 flags). */
    @Suppress("DEPRECATION")
    private fun enterImmersive() {
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            )
    }

    private fun actionName(action: Int): String = when (action) {
        KeyEvent.ACTION_DOWN -> "down"
        KeyEvent.ACTION_UP -> "up"
        KeyEvent.ACTION_MULTIPLE -> "multiple"
        else -> "action$action"
    }

    private fun resolveUrl(i: Intent?): String {
        val extra = i?.getStringExtra("url")?.trim()
        if (extra.isNullOrEmpty()) return DEFAULT_URL
        if (!(extra.startsWith("http://") || extra.startsWith("https://"))) return DEFAULT_URL
        val host = try { Uri.parse(extra).host } catch (e: Exception) { null }
        if (!isAllowedHost(host)) {
            Log.w(TAG_WRAP, "rejected url extra: host not allowed ($host)")
            return DEFAULT_URL
        }
        return extra
    }

    companion object {
        const val TAG_KEYS = "BG_KEYS"
        const val TAG_PAGE = "BG_PAGE"
        const val TAG_WRAP = "BG_WRAP"
        const val DEFAULT_URL = "http://localhost:3001/glasses"
        const val LONG_PRESS_MS = 600L
        const val TAP_WINDOW_MS = 1500L
        const val MOTION_JS_MIN_INTERVAL_MS = 100L
        const val REQ_PERMS = 1
        const val REQ_WEB_PERMS = 2

        private val PRIVATE_LAN = Regex(
            "^(10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}|192\\.168\\.\\d{1,3}\\.\\d{1,3}|172\\.(1[6-9]|2\\d|3[01])\\.\\d{1,3}\\.\\d{1,3})$"
        )

        /** Hosts the page may load from and may get camera/mic: localhost, a private LAN address, or our Render deploy. */
        fun isAllowedHost(host: String?): Boolean {
            if (host.isNullOrEmpty()) return false
            val h = host.lowercase()
            return h == "localhost" || h == "127.0.0.1" || PRIVATE_LAN.matches(h) || h.endsWith(".onrender.com")
        }

        /** DPAD_CENTER and ENTER both become 'Enter'; arrows become Arrow* keys. */
        val DOM_KEY_NAMES: Map<Int, String> = mapOf(
            KeyEvent.KEYCODE_DPAD_CENTER to "Enter",
            KeyEvent.KEYCODE_ENTER to "Enter",
            KeyEvent.KEYCODE_NUMPAD_ENTER to "Enter",
            KeyEvent.KEYCODE_DPAD_UP to "ArrowUp",
            KeyEvent.KEYCODE_DPAD_DOWN to "ArrowDown",
            KeyEvent.KEYCODE_DPAD_LEFT to "ArrowLeft",
            KeyEvent.KEYCODE_DPAD_RIGHT to "ArrowRight",
        )

        /**
         * Broadcast actions to log. Android cannot subscribe to a wildcard, so these are
         * GUESSES. The standard media-button actions are real; the others are unverified.
         * Replace them with real names once discovered on the device.
         */
        val GUESSED_BROADCAST_ACTIONS = listOf(
            Intent.ACTION_MEDIA_BUTTON,
            "android.intent.action.CAMERA_BUTTON",
            "com.microlumin.action.KEY",
            "com.microlumin.action.TP",
            "com.microlumin.action.RING",
        )
    }
}
