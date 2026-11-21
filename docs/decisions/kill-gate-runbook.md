# Kill-gate runbook: test on the real glasses (non-engineers)

Run these in order, on the real glasses and a real phone. Copy each command exactly. Write every result into [kill-gate.md](kill-gate.md). Nothing here is verified yet; every number you capture replaces a "NOT TESTED".

Needs: laptop with the repo, USB cable, glasses in Developer Mode (`adb devices` lists them), printed wristband QR from `/qr`.

1. **Start the server** (leave it running): `npm run dev` (or `npm start` after `npm run build`).
2. **Install in projection mode first:** `npm run m6:install -- --mirror`. The extra `--` is required. Expect the HUD on the lens.
3. **Install plain /glasses:** `npm run m6:install`. Expect the green HUD, no mirror.
4. **Scan:** hold the wristband 25-40 cm in the center of your view. Do it 10 times. Record x of 10 and whether each reached the Meds card within 2 s. Then hold it at the edge of view 10 times; it must scan 0 of 10.
5. **Done:** say "done", then try tapping. Record which works. The phone must show `{time} · via glasses`.
6. **Phone sync:** open `/phone?director=1` on the phone, same Wi-Fi. Time "done" to the phone check, 10 times; write p50 and max.
7. **Debug numbers:** open `/glasses?debug=1` on the glasses (add `?debug=1` to the URL). Photograph the bar showing p50/max per metric and the WebView Chrome version.
8. **WebView version:** `adb shell dumpsys webviewupdate`. Paste the output into the ticket.
9. **Battery before:** `adb shell dumpsys battery`. Paste. Keep the page active for 10 minutes (scanning and idle).
10. **Battery after:** `adb shell dumpsys battery` again. Paste. Note temple warmth by touch (note only).
11. **Video:** film 20 seconds with the phone camera held up to the lens, showing the HUD while you scan and say "done". Check nothing sits in the center clear zone.
12. **Preflight:** on the phone, open the Director drawer, Preflight, tap copy-status, paste into the ticket. It shows the active voice tier (Deepgram, browser speech, or tap only). Android 9 WebView probably lacks browser speech: unverified until you see it.
13. **Fill [kill-gate.md](kill-gate.md):** date/time, git sha (`git rev-parse --short HEAD`), your name, path used, and every row (scan x/10, edge 0/10, done-to-phone p50/max, mic tier, temple temperature). Decision by 11:45 AM: GO or FALLBACK.

## If scan, mic or keys fail: BG-15 (the phone senses)

Say this to the lead and in the pitch: "The glasses are a display; the phone scans and listens. Glance on the glasses, depth on the phone." Then: glasses show `/glasses?mirror=1`; phone opens `/phone?scan=1` over the https Render URL (camera needs https) and uses the on-screen Done/Next/Undo buttons. Record "Path used: BG-15" in kill-gate.md. Do not claim voice or scan on the glasses.
