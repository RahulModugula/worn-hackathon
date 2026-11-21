#!/usr/bin/env bash
# Read-only environment check for the Worn hackathon.
ok(){ printf "  [ok] %s\n" "$1"; }; bad(){ printf "  [MISSING] %s\n" "$1"; }
echo "Tooling:"
xcodebuild -version >/dev/null 2>&1 && ok "Xcode: $(xcodebuild -version | head -1)" || bad "Xcode (and accept license: sudo xcodebuild -license accept)"
command -v adb >/dev/null && ok "adb" || bad "adb (brew install android-platform-tools)"
[ -d "/Applications/Android Studio.app" ] && ok "Android Studio" || bad "Android Studio (only for Android/glasses apps)"
echo "Kit:"
[ -d kit ] && ok "kit/ present" || bad "kit/ (vendor SDK kit, not in this repo: get it from the organizers, unzip, link as ./kit)"
echo "Devices:"
adb devices 2>/dev/null | sed -n '2,$p' | grep -q device && ok "adb sees a device" || echo "  (no adb device; glasses need Developer Mode + replug)"
