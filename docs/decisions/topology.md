# Glasses topology and hardware findings (BG-07, BG-08)

Fill in with REAL outputs. Leave "NOT TESTED" until measured. Date and who measured every row.

| Question | Result | Evidence (command + output) | Who / when |
|---|---|---|---|
| `adb devices -l` shows the glasses | NOT TESTED | | |
| Chosen topology (A browser / B wrapper APK / C phone companion) | B (planned) | | |
| `npm run m6:install` launches /glasses | NOT TESTED | | |
| WebView version (`adb shell dumpsys webviewupdate`) | NOT TESTED | | |
| Camera works in the page (getUserMedia 1280x720) | NOT TESTED | | |
| Mic works in the page | NOT TESTED | | |
| Tap key code (BG_KEYS) | NOT TESTED | | |
| Long-press key code | NOT TESTED | | |
| Ring key code | NOT TESTED | | |
| Glasses on hotspot Wi-Fi (joined via the vendor companion app) | NOT TESTED | | |

## Decision
Chosen path: (full app on glasses / BG-15 display-only + phone sensors). Reason:

## Launch command that works
```
(paste)
```
