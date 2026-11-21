# Bedside Glance Android wrapper (MicroLumin M6)

A fullscreen black WebView app that loads our web page (default `http://localhost:3001/glasses`)
on the M6 glasses (Android 9, API 28). Source only: the APK is not built yet (see status below).

## Status

- Source: written, not compiled. This machine had no Android SDK and no Gradle at the time of writing.
- Prebuilt APK: `prebuilt/bedside-wrapper-debug.apk` does not exist yet. `scripts/m6-install.mjs`
  will stop with a clear message until it does.

## Build (Windows or macOS)

Requirements: Android Studio (it bundles a JDK in its JBR folder; JDK 17 or newer works), and the
Android SDK Platform 36 plus Build-Tools 36 (Android Studio installs these from SDK Manager).

### Option A: Android Studio (easiest)

1. Open Android Studio, choose **File > Open**, and select the `android-wrapper` folder.
2. Wait for Gradle sync to finish. If it asks for the SDK, accept the suggested location.
3. Choose **Build > Build Bundle(s) / APK(s) > Build APK(s)**.
4. The APK is at `app/build/outputs/apk/debug/app-debug.apk`.
5. Copy it to `prebuilt/bedside-wrapper-debug.apk` (rename to that exact name).

### Option B: command line

Windows (PowerShell, in `android-wrapper`):

```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
.\gradlew.bat assembleDebug
Copy-Item app\build\outputs\apk\debug\app-debug.apk prebuilt\bedside-wrapper-debug.apk
```

macOS (Terminal, in `android-wrapper`):

```sh
export ANDROID_HOME="$HOME/Library/Android/sdk"
./gradlew assembleDebug
cp app/build/outputs/apk/debug/app-debug.apk prebuilt/bedside-wrapper-debug.apk
```

If `JAVA_HOME` is not set, point it at Android Studio's JBR (`.../Android Studio.app/Contents/jbr/Contents/Home`).

Check that the APK has compiled code: `unzip -l prebuilt/bedside-wrapper-debug.apk | grep classes.dex`.

## Install and run on the glasses

From the repo root, with the web app running on port 3001:

```sh
node scripts/m6-install.mjs
node scripts/m6-logcat.mjs      # in a second terminal, to see button codes
```

See `scripts/m6-keys.md` for the button-discovery steps.

## Versions (pinned in this folder)

- Gradle 9.9.2 (`gradle/wrapper/gradle-wrapper.properties`, SHA-256 checked against services.gradle.org)
- Android Gradle Plugin 9.5.2 (`build.gradle.kts`), compileSdk 36, minSdk 28, targetSdk 36
- AGP 9 includes Kotlin support, so no separate Kotlin plugin is applied.
- No AndroidX or third-party libraries.

Versions were checked against Google's Maven repository and services.gradle.org on 2026-11-21.
They have not been built yet, so a build failure on the first try is possible; if so, the error
message from Gradle is the next thing to fix.
