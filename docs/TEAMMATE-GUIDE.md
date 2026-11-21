# Teammate guide: run, test on the glasses, and finish Bedside Glance

You do not need to be an engineer. Follow the steps in order. Anything in a `code block` you copy into a terminal (Mac: Terminal, Windows: PowerShell). **Stuck for more than 10 minutes? Skip to "Plan B" (section 6) and keep the demo alive.**

Deadlines (Sat Nov 21): glasses test 8:30-11:30 AM · **11:30 AM go/no-go** · rehearse 12:00-1:15 · **freeze 1:30 PM** · **submit before 1:50 PM** (hard deadline 2:00 PM, no late edits) · expo 2:15 PM.

## 0. What you need
- Node 22+ (`node -v`). Mac: `brew install node`. Windows: `winget install OpenJS.NodeJS.LTS`, then reopen PowerShell.
- Git (`git --version`). Windows: `winget install Git.Git`.
- adb (talks to the glasses over USB). Mac: `brew install android-platform-tools`. Windows: `winget install Google.PlatformTools`, reopen PowerShell, check `adb version`.
- **Windows only, once:** if `npm` says "running scripts is disabled", run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` in PowerShell and answer Y (or type `npm.cmd` instead of `npm`).
- **Windows only:** clone into a plain folder like `C:\dev`, NOT inside OneDrive/Documents (OneDrive makes `npm ci` fail or crawl).
- Claude Code (optional but recommended): paste the prompts in section 8.
- **Never** put the SDK kit (`kit/`, the MicroLumin zip) in this repo or share it anywhere. Never paste API keys in chat or commit them.

## 1. Get the code running (5 minutes, no glasses needed)
```
git clone https://github.com/RahulModugula/worn-hackathon.git
cd worn-hackathon
git checkout main
npm ci
npm run doctor
npm run build
npm start
```
(If your lead gave you a different branch name, use `git checkout <that name>` instead of `main`.)

`npm run doctor` prints OK / WARN / FAIL with a plain-English fix for each line. FAIL means stop and fix. WARN about missing API keys is fine (the app has built-in fallbacks).

When the server starts it prints web addresses. Open them:
| What | Address |
|---|---|
| Glasses screen (preview on laptop) | `http://localhost:3001/glasses` |
| Phone app | `http://localhost:3001/phone` |
| Phone app with the secret **Director** buttons | `http://localhost:3001/phone?director=1` |
| Stage projector view (read-only) | `http://localhost:3001/glasses?mirror=1` |
| Printable wristband QR codes | `http://localhost:3001/qr` |

**2-minute demo with no glasses:** open `/glasses` and `/phone?director=1` side by side. On the phone tap **Start Shift**, open the ⚡ drawer, tap **Sim Scan Rm 12**, then **Voice: Done**. The glasses show Maria's meds card, then "logged", and the phone shows the green check. **RESET DEMO** (confirm twice) puts everything back.

## 2. Use an iPhone (or any phone)
1. Put the laptop and the phone on the **same hotspot/Wi-Fi**.
2. Use the `Phone (iPhone Safari)` address the server printed, like `http://192.168.x.x:3001/phone`.
3. Phone camera and microphone **only work on https**. For those, use the deployed Render address (section 7), not the `192.168...` one.
4. If the page will not load: same Wi-Fi? On Windows the first `npm start` pops up a "Windows Defender Firewall" window for node.exe: tick **Private networks** and click **Allow access**. Also make sure Windows marks the hotspot network as **Private** (Settings > Network > the Wi-Fi > Network profile: Private). Then try `npm run doctor`.

## 3. Put the app on the glasses (needs real glasses)
Order matters. Stop at the first step that fails and note the exact message.

**Step A. See the glasses on the laptop.** The glasses must have Developer Mode on. That toggle is in the vendor companion iPhone app (from the vendor SDK kit, not included here; needs a Mac with Xcode to build; ask a teammate who already has it running): connect the glasses and enable Developer Mode. Then unplug and replug the glasses USB cable, accept any prompt on the glasses, and run:
```
adb devices -l
```
You want a line for the glasses. Not there? Try another cable (it must carry data), another USB port, replug, re-toggle Developer Mode.

**Step B. Install our glasses app and open the page.**
Keep `npm start` running in its own terminal window. Open a **second** terminal in the same folder and run:
```
npm run m6:install
```
This forwards port 3001 to the glasses (`adb reverse`), installs the wrapper app (`android-wrapper/prebuilt/bedside-wrapper-debug.apk`), grants camera and mic, and opens `/glasses` on the glasses. You should see the green HUD. For stage mode run `npm run m6:install -- --mirror` (the extra `--` is required so npm passes `--mirror` on to the script). If it says `adb` is not found but you installed it, set the full path once: PowerShell `$env:ADB="C:\path\to\adb.exe"`, Mac `export ADB=/path/to/adb`.
If there is no prebuilt APK, build it once: open the `android-wrapper/` folder in Android Studio and press Run, or follow `android-wrapper/README.md`.

**Step C. Discover the buttons.** Nobody has documented what the temple touchpad and ring send to a normal app, so we measure it:
```
npm run m6:logcat
```
Tap, long-press the temple, press the ring. Lines with `BG_KEYS` show the key codes. Send them to the lead / write them in `docs/decisions/topology.md`. If tap shows up as Enter/DPAD_CENTER it already works (tap = primary action, long-press = close).

**Step D. Test camera.** Hold the printed QR (`/qr`, 5 cm, matte paper) 25-40 cm in the **center** of your view. It should go Scanning, then Maria's card in about 2 seconds.

**Step E. Test voice.** Say "done". If nothing happens: no mic on the glasses, or Android 9 WebView lacks Web Speech (unverified on device; the Preflight panel shows the active tier). Use tap/ring for Done, or Plan B.

Open the page on the laptop in Chrome at `chrome://inspect` to see the glasses page console if something looks wrong.

## 4. The 11:30 AM go/no-go (ticket BG-09)
Copy-paste checklist for non-engineers: [docs/decisions/kill-gate-runbook.md](decisions/kill-gate-runbook.md).
Do the full loop 10 times: scan wristband, glasses show meds, "done" (or tap), phone checks it (target under a second; this is what you are measuring). Write the result (x of 10) in the ticket. If scan or "done" fails more than 1 in 10, switch to **Plan B**.

## 5. Demo day cheat sheet
- Before every run: **RESET DEMO** in the Director drawer.
- Presenter holds the glasses; one teammate holds the phone with `/phone?director=1`.
- 90-second script: `docs/demo-script.md` (BG-12). Stage finalists get 3 minutes.
- If voice fails: tap/ring or Director **Voice: Done**. If scan fails: Director **Sim Scan Rm 12**. If Wi-Fi drops: **Force Offline** shows the queue, reconnect and it syncs. The audience can't tell.
- Phone shows a conflict banner when both devices log the same med: that is a feature, show it on purpose.

## 6. Plan B: Display-only glasses (ticket BG-15)
If the glasses camera, mic or buttons do not work: the glasses only **show** the screen (`/glasses?mirror=1`), and the **phone** does the scanning and listening (`/phone?scan=1`, tap the on-screen Done/Next/Undo buttons). This still tells the Seamless Handoff story: glance on glasses, depth on phone. Use the Render https address so the phone camera works.

## 7. Deploy to Render (2 minutes, free tier is fine)
1. render.com > New > Blueprint > pick this repo (the lead must give Render access). It reads `render.yaml`.
2. Optional keys: in the Render dashboard add `GEMINI_API_KEY` and `DEEPGRAM_API_KEY` (never in the repo). Without them the demo still works with fallbacks.
3. Wait for the green deploy, open `https://<name>.onrender.com/api/health` (must show `"ok":true`), then `/phone?director=1`.
4. Free-tier servers sleep: open the health URL 2 minutes before every demo.
5. Public deploy? Set `DIRECTOR_KEY` (any secret string) in Render. Then RESET, Sim and Clock actions need the key: open `/phone?director=1&key=<your key>` (and `/glasses?mirror=1&key=<your key>` for the stage mirror). Without `DIRECTOR_KEY` the Director drawer works for anyone, which is fine on the LAN. Only a connection opened with `device=director` or `director=1` (the phone does this when the drawer is enabled) can send those actions; the server ignores the `device` field inside a message.

## 8. Prompts to paste into Claude Code (from the repo folder)
- **Diagnose:** `Read CLAUDE.md and docs/TEAMMATE-GUIDE.md. I ran <command> and got <paste output>. Find the cause and fix it with the smallest change. Show me the test or command that proves it.`
- **Tune a screen:** `Read CLAUDE.md and docs/FRD-v2.2.md. On the glasses screen <name>, <what looks wrong>. Fix it without breaking the display rules (528px width, empty clear zone, 18px minimum text). Run npm run check.`
- **Before you push:** `Run npm run check and show me the output. Do not push if anything fails.`
- **Check test coverage:** `Run npm run coverage and show me the summary.` It prints totals and writes an HTML report to coverage/ (not committed); it fails if a covered area drops below its threshold.
- **Fill in a ticket:** `Open GitHub issue BG-<n> (gh issue view <n>), do each checklist item, paste evidence into the issue as a comment.`

## 9. Rules that protect the team
- Run `npm run check` before every push; a red GitHub run emails the CTO.
- Use `npm run ship` (it pushes to main after the checks). No force-push, no `--no-verify`. Ask the lead before changing anything after 1:30 PM; after 2:00 PM `ship` refuses.
- Do not edit `src/hud-kit/` to mention patients, meds or wounds (a test fails if you do).
- Do not install the kit's files, APKs or docs into this repo.
- Everything here is fake data. Do not type real patient info anywhere.

## 11. Changing things safely
You push straight to main; the computer checks your work first so nobody can break the demo by accident.
1. Edit (with Claude Code or by hand). Preview with `npm start`.
2. Ship: `npm run ship -- "what you changed, in a sentence"`. It checks everything (about a minute), saves, pulls teammates' latest, pushes, and marks this version as the last one known to work.
3. If it stops, it says why in plain English. Paste the first error to your AI assistant: "fix this without weakening any test or guard".
4. Not sure the app is OK? `npm run health` prints PASS / WARN / FAIL with a fix for each.
5. Something is broken and you cannot fix it fast? `npm run rollback` restores the last good version (your work is saved on a backup branch first). Add `-- --push` to share it.
6. Never run `git push --no-verify` or `--force`. After 2:00 PM Saturday `ship` refuses by design. Full details: [docs/GUARDRAILS.md](GUARDRAILS.md).

## 10. Quick fixes
| Problem | Do this |
|---|---|
| `npm: command not found` | Reopen the terminal after installing Node. |
| Port 3001 busy | Close the other terminal running the server, or use another port: Mac `PORT=3002 npm start`, Windows `$env:PORT=3002; npm start` (the glasses install script and doctor read the same `PORT`). |
| Phone cannot open the address | Same Wi-Fi, allow Windows Firewall, use the address the server printed. |
| `adb` not found | Install it (section 0), reopen the terminal. |
| `adb devices` empty | Developer Mode on, other cable, replug, accept the glasses prompt. |
| Glasses page blank/white | Server running? Run `npm run m6:install` again (the port forward resets when unplugged). |
| Text cut off | Do not change fonts or sizes; run `npm test` to see which screen. |
| Everything is weird | Director drawer > RESET DEMO, refresh both pages. |

Tip: `render.yaml` already declares `DIRECTOR_KEY` (sync: false); set its value in the Render dashboard before a public demo, and open the phone with `?director=1&key=<your key>`.
