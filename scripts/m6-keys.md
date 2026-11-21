# Finding the glasses' button codes (for non-engineers)

1. Plug the glasses into the computer, turn them on, and accept "Allow USB debugging" on them.
2. In a terminal in the project folder, run `node scripts/m6-install.mjs` so the app starts on the glasses.
3. In a second terminal, run `node scripts/m6-logcat.mjs --clear`. Leave it running.
4. Tap the ring or touchpad once, then wait 2 seconds. Repeat 3 times.
5. Long-press the BACK button (hold it for about 1 second), then release. Repeat 3 times.
6. Each press prints a line like `key code=... action=down ... device="..."`. Copy the lines into a note.
7. Write down, next to each one: which button you pressed, and whether it was a tap or a long press.
8. If nothing prints for a button, run `node scripts/m6-logcat.mjs --getevent` and press it again.
9. Put the mapping (button name to key code, with the date and the device name) in `docs/` as a short note.
10. Tell the developers the code numbers. They update the key table in `android-wrapper/app/src/main/kotlin/com/bedsideglance/wrapper/MainActivity.kt` (`DOM_KEY_NAMES`).
