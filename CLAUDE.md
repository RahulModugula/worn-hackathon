# Worn Smart Glasses Hackathon (Nov 20-21, 2026, City Tech Brooklyn)

Team project for the MicroLumin M6 glasses. Submission deadline Sat Nov 21, 2:00 PM EST; open-house review from 2:15 PM.

## Hard rules
- The SDK kit is confidential. It lives at `./kit` (symlink or local copy), which is gitignored.
  Never commit, push, paste or share any file from it. No public repos, shared drive links or chats.
- Real phone + real glasses required: the iOS Simulator and Android emulators cannot do Bluetooth.
- Never commit secrets; reference env vars by name.

## Setup
- Run `scripts/check-setup.sh` to see what's missing on a machine.
- iOS: Xcode, then build the vendor's demo app from the kit (not included in this repo; follow its README).
  Set your own Apple ID team and a unique bundle ID.
- Glasses: turn on Developer Mode with the vendor's companion app (see the kit docs), then `adb devices`.
- Docs: the vendor SDK kit (not included) has the setup guide, iOS API and known-bug list.
- Help: the hackathon organizers and the event chat.

## Layout
- `src/`, `server/`, `shared/`, `data/`, `public/` our own code for Bedside Glance (repo root, per FRD; `app/` is unused). Commit only code we wrote.
- `docs/` plan, decisions, demo script.
- `scripts/` helpers.

## Conventions
- Branch per person/feature, small PRs, no force-push to main.
- Run the build before pushing.

## Bedside Glance (our project): invariants every session must preserve
Spec: `docs/FRD-v2.2.md` (source of truth). Tickets: GitHub issues BG-01..BG-14, each with a testable DoD. Freeze: Sat 2:00 PM ET.
- **Stack:** one Vite+React+TS SPA + one Node/Express/`ws` server (`server/`); `shared/types.ts` and `shared/clock.ts` are imported by both. No Firebase, no storage buckets, no CSS framework on `/glasses` (CSS variables in `src/hud-kit/tokens.css`). One port (`PORT||3001`) in prod; dev = Vite 5173 proxying `/api` and `/ws` to 3001.
- **Module boundary (AC#10):** `src/hud-kit/` has ZERO Bedside-Glance strings and ZERO imports from `src/apps/`. A test enforces it; keep it green.
- **Display law:** 640x480, black bg, clear zone x120-520/y90-290 ALWAYS empty, bottom card y300-440 (528px inner), text >=18px, every line nowrap+ellipsis, copy verbatim from FRD section 2.
- **Sync:** server authoritative, synchronous `applyAction` (no awaits inside), first-write-wins on `LOG_MED`, 10s cross-device undo, idempotent `clientEventId`, localStorage outbox.
- **Fade rules:** G4/G8 never auto-fade with a patient loaded; G5 3s, G6 10s, G9 6s; Critical Allergy needs "acknowledge".
- **Scanner:** center 480x480 of 1280x720 only, 4 FPS, only on G1-G3, 3-read dwell within 1.2s.
- **Secrets:** never commit keys. `GEMINI_API_KEY` and `DEEPGRAM_API_KEY` are env vars only; `.env.example` lists names. The hardware sponsor can read this repo. Never copy anything from `kit/` (confidential) into `docs/` or any tracked file.
- **Models:** use the newest model ids in `docs/RESEARCH.md`; do not use `gemini-2.5-flash`.
- **Everything has a fallback:** no key, camera, mic or network must never crash the demo. Fall back to `data/demo-responses.json`, `/data/wound-fallback.jpg`, the Director Drawer and hotkeys.
- **Verify before done:** `npm run typecheck && npm test && npm run build`, then the live smoke test. `npm run coverage` (about 6 s, v8; thresholds in `vite.config.ts` fail on regression: server/shared/hud-kit statements >=90 and branches >=80) before a large refactor; it is not in `npm run check`. Teammates demo without a keyboard, so Director Drawer + `[RESET DEMO]` must always work.
- **Windows + iPhone teammates:** all npm scripts and helper scripts must run on Windows (node scripts, no bash-only syntax, no `cp`/`rm`/`export`); `.gitattributes` forces LF. Server binds `0.0.0.0` and prints LAN URLs. The phone UI must work in iPhone Safari (`dvh`, safe-area insets, `playsinline`, camera/mic only from a button tap, https needed for camera/mic so use the Render URL). `npm run doctor` is the first thing teammates run.
- **Glasses may be display-only:** the vendor docs available to us do not document ring/touchpad key codes, plain-app mic or camera on the glasses. BG-15 (phone scans + listens, glasses `?mirror=1` shows the HUD) is a first-class fallback, not an afterthought.
- **Quality bar:** scan->Meds <=2s, "done"->phone <1s, assess-wound <=3.5s with fallback, no text over 528px, every external dependency has a fallback.
- **Glasses topology:** Android 9 with plain Android APIs, no glasses-side SDK. Plan = native APK with fullscreen WebView (Topology B) reaching the server via `adb reverse tcp:3001 tcp:3001` (localhost is a secure context for camera/mic) or the https Render URL.
