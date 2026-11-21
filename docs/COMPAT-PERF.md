# /glasses compatibility and performance

Target: the `/glasses` page must run in the **Android 9 WebView** on the M6 glasses themselves (the glasses run Android 9; this page is not rendered on the phone), and load fast.
The WebView is Chromium around 69. Its factory version is **unknown**, so we build for 69 and guard it.

Status: built and guarded on 2026-11-21. **Not yet tested on a device.** Confirm the WebView version and run the page on it (see below).

## Compatibility table (researched 2026-11-21, MDN browser-compat-data)

| Feature | First Chromium | Effect on Chromium 69 |
|---|---|---|
| Optional chaining `?.`, nullish `??` | 80 | Parse error (whole bundle fails) |
| `Array.prototype.at` | 92 | Missing API |
| `Object.fromEntries` | 73 | Missing API |
| `Promise.allSettled` | 76 | Missing API |
| `AbortSignal.timeout` | 103 | Missing API |
| `structuredClone` | 98 | Missing API |
| `queueMicrotask` | 71 | Missing API |
| CSS `clamp()` | 79 | Declaration dropped |
| CSS `inset` | 87 | Declaration dropped |
| CSS `aspect-ratio` | 88 | Declaration dropped |
| CSS `:is()` | 88 | Whole rule dropped |
| CSS `overflow: clip` | 90 | Declaration dropped |
| Flexbox `gap` | 84 | Spacing lost (elements touch) |
| CSS `dvh` units | 108 | Declaration dropped |

Also guarded: `min()`/`max()` (79), `:where()` (88), `:focus-visible` (86), `:has()` (105), `replaceAll` (85), `Object.hasOwn` (93), `findLast` (97), logical assignment (85), numeric separators (75), class fields (72), private `#names` (74), class static blocks (94).

Not a problem on 69: `dynamic import()` (63), `import.meta` (64), ES2019 syntax (optional catch binding is 66), `globalThis` (71; our code only references it behind `typeof`).

## What is guarded

1. **Build target.** `vite.config.ts` sets `build.target` and `build.cssTarget` to `chrome69`. Vite 8 defaults to Chrome 111, which would leave `?.` and `??` in the output. We verified the lowering: the source has `?.` and `??` (for example `src/hud-kit/scan/qrScanner.ts`), and the built bundle has none.
2. **`npm run check-legacy`** (`scripts/check-legacy.mjs`, pure Node):
   - Parses every `dist/assets/*.js` at the ES2018 level and fails on syntax errors and on ES2019+ features Chromium 69 lacks. Reports `file:line`.
   - Scans CSS for the failing features. The entry stylesheet (the one `dist/index.html` links) and the `src/hud-kit` and `glasses` CSS **fail**. Phone and impact CSS (modern iPhones) **warn**.
   - Scans source for failing runtime APIs. Polyfilled APIs are reported as info. Unpolyfilled uses fail.
   - Scans inline JSX styles for `display: flex` with `gap`, which fails for the same reason as the CSS.
3. **Polyfills** (`src/polyfills.ts`, imported first in `src/main.tsx`). Hand-written, no core-js. Each one installs only when the native API is missing: `Object.fromEntries`, `Array.prototype.at`, `Promise.allSettled`, `queueMicrotask`, `structuredClone` (JSON round-trip, plain data only), `AbortSignal.timeout`. `src/polyfills.test.ts` runs them in a VM context with the natives removed.
4. **Route code splitting** (`src/main.tsx`). `/phone`, `/impact` and `/qr` are `React.lazy` chunks behind a black `Suspense` fallback. `/glasses` does not load them. `npm run check-budgets` proves it with sentinel strings.
5. **`npm run check-budgets`** (`scripts/check-budgets.mjs`, after build): gzips the `/glasses` entry JS and CSS (from `dist/.vite/manifest.json`, with static imports followed), fails over budget, and fails if any phone, impact or qr sentinel string is in the `/glasses` graph. It also checks that each sentinel exists in a lazy chunk, so the check cannot pass vacuously.
6. **`npm run bench`** (`scripts/bench-decode.mjs`): times `qr/decode.js` on a 480x480 RGBA frame. Input: a Version 1 code, which must decode to its payload before timing starts, and a blank frame.

`npm run check` runs typecheck, lint-boundary, audit-pii, check-docs, build, check-legacy, check-budgets, then test.

## Reading the WebView version

- **In the page:** `navigator.userAgent` on Android WebView contains `; wv)` and `Version/4.0` plus `Chrome/<major>.<minor>.<build>.<patch>`. The `Chrome/` number is the WebView's Chromium version.
- **On the phone (adb):** `adb shell dumpsys webviewupdate` shows the current WebView provider package and its `versionName`. The provider is usually `com.google.android.webview` or `com.android.webview`.
- **The m6 install script** (`npm run m6:install`) prints only the `adb version` line today. It does not print the WebView version. Adding the `dumpsys webviewupdate` read to it is an open item.

Record the Chromium major version for each test device here before relying on any number below.

## Measured numbers

| Measure | Value | Date | Method |
|---|---|---|---|
| `/glasses` JS, gzip | 125,947 B (about 123 KiB) | 2026-11-21 | `npm run build`, then `check-budgets` gzip level 9. Vite's own report (gzip default) shows 127.81 kB for the entry chunk alone; the gap is the gzip level and the shared graph. |
| `/glasses` CSS, gzip | 1,828 B (was 1,309 before the HUD redesign) | 2026-11-21 | same method; Nunito-Variable.woff2 (39 KB) is a font file, not counted |
| Budget JS | 140,000 B | set 2026-11-21 | measured x 1.15, rounded up |
| Budget CSS | 2,010 B | raised 2026-11-21 | 1,746 x 1.15, rounded up (icons, asides, progress, 5 type roles) |
| Lazy chunks (gzip, Vite report) | phone 14.73 kB, shared ui 3.21 kB, impact 4.63 kB, qr 1.43 kB | 2026-11-21 | `npm run build` output |
| Decode, Version 1 code | median 0.36 ms, p95 0.46 ms | 2026-11-21 | `npm run bench`, 200 runs after 20 warm-up, Node 26, Apple Silicon Mac |
| Decode, blank frame | median 0.68 ms, p95 0.77 ms | 2026-11-21 | same |

**Headroom.** The scanner runs at 4 FPS, so each decode must finish in 250 ms. The worst p95 measured here is 0.77 ms, which is about 326x headroom.

**Old phones are not measured.** The bench runs on a desktop CPU in Node, not in the WebView. Plan with a safety factor of 10x: the device may be up to about 33x slower than this machine and still fit the 250 ms budget. Confirm on the real Android 9 device before relying on it. The scanner also does a crop and RGBA conversion per frame, which the bench does not include.

## Known limits

- **Parser.** `acorn` is not installed in this repo and adding a dependency needs the owner's sign-off. The syntax check uses the TypeScript parser (already a devDependency). It reports real syntax errors and the ES2019+ features listed above. It does not gate the script goal as strictly as acorn would at ecmaVersion 2018. The script-goal check is informational. Switch to acorn if it is approved.
- **CSS checks are heuristic.** The flex-gap check looks at the same declaration block as `display: flex`. It cannot see a flex parent set in a different rule. Review new layout CSS by hand.
- **Not tested on a WebView.** Nothing here runs in an actual Chromium 69 engine. The guards catch the features listed, not every behaviour difference.
- **Open violations** (owned by other files; the check reports them until they are fixed): see the output of `npm run check-legacy`.

## Stress results

Measured 2026-11-21 on a MacBook (Darwin 25.6, Node v26.13.0), localhost, real server (`server/index.ts`) in its own process, load from `scripts/stress/soak.mjs` (`ws` clients). Each session has a glasses, a phone and a director socket running the demo flow (start shift, scan Rm 12, done, phone conflict, undo, wound capture + send, doctor reply, reset) while a chaos monkey kills sockets, forces clients offline (outbox flush on return), sends garbage frames and replays duplicate events. Doctor reply delay was 100 ms instead of 5 s so 20 loops fit; everything else is the real path. Latency samples exclude actions that overlapped a chaos event on their session (n is the count kept). Peer latency is send to the moment another client in the session receives the state with the resulting version. Server event loop lag is `perf_hooks.monitorEventLoopDelay` (10 ms resolution subtracted); memory is the server process RSS and heap after a forced GC.

| Run | Sessions x iterations | Actions acked | Ack p50 / p95 / p99 / max (ms) | Peer broadcast p50 / p95 / p99 / max (ms) | Server loop lag p50 / p99 / max (ms) | Server RSS before to after | Heap after GC before to after |
|---|---|---|---|---|---|---|---|
| Soak (`npm run stress`), 59 s | 50 x 20 = 1000 flows | 10,000 of 10,000 | 0.43 / 7.39 / 113 / 360 (n=8,893) | 0.61 / 8.02 / 110 / 360 (n=15,926) | 0.40 / 4.6 / 65 | 51.6 to 111.1 MB | 14.8 to 16.6 MB |
| Sustained 60 s (`npm run stress -- --duration 60 --pause 150`) | 50 x 3,297 flows | 32,970 of 32,970 (536/s) | 0.27 / 2.86 / 100 / 375 (n=29,868) | 0.36 / 3.10 / 90 / 375 (n=53,582) | 0.22 / 2.9 / 35 | 51.6 to 110.3 MB | 14.8 to 16.7 MB |

Chaos injected in the soak run: 1,996 socket kills, 3,347 offline toggles, 1,659 garbage frames, 1,354 duplicate events. Results: zero ack timeouts, zero uncaught exceptions or unhandled rejections on server and client, `/api/health` ok afterwards, and after each session settled all three clients' final state deep-equalled the server's snapshot (convergence). Leak check: RSS rises about 59 MB in both runs although the second did 3.3x the work, and heap after GC grows under 2 MB, so memory plateaus (socket buffers and allocator) rather than leaking. The check can fail: dropping 3% of state broadcasts in `server/index.ts` produced `CONVERGENCE ... client version 49 != server 50` and exit 1.

Other stress suites (all in `npm test`):
- `server/stress.fuzz.test.ts`: 20,000 seeded action sequences (+20 long ones of 1,500 steps), invariants checked after every step (one `given` per med, first writer wins, duplicate id never changes state, undo only within 10,000 ms, RESET clears every FRD section 4 field and keeps `eventSeq` monotonic, caps, JSON-stable state, unassigned patient never active, wound status never moves backwards, no prototype pollution). Seed in every failure message; rerun with `STRESS_SEED=<n> STRESS_RUNS=1`. Mutation checks (undo window +1 ms, first-write-wins off, RESET leaving `extraOrders`) each failed within a few sequences.
- `server/stress.abuse.test.ts`: oversized, nested, 4.5k-key, binary and numeric-edge frames, 1,000 reconnects, 200 sockets in one session (exactly one winner of a 200-way race), slow-loris partial frames, session flood, REST abuse of `/api/assess-wound`.
- `src/apps/bedside-glance/fuzz.triggers.test.ts`: 300+ phrase intent corpus (recall, precision, zero false positives for done/undo/acknowledge) and a 10,000-character adversarial timing check (each under 50 ms).
- `src/apps/bedside-glance/fuzz.demoTiming.test.ts`: the 90-second script under fake timers against the real reducer and store.
