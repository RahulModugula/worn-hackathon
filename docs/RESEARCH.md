# Research notes (read 2026-11-21, Haiku agents + primary sources)

Nothing here was compiled or run. Every item marked **VERIFY** must be checked by the ticket that uses it.

## Gemini (BG-06)
- Model: **`gemini-3.5-flash-lite`** (Stable, image input, low latency, thinking defaults to minimal). Not `gemini-2.5-flash`. Make it configurable: `GEMINI_MODEL` env, default above. AI Studio's table also lists newer ids (gemini-3.6-flash, 3.8-flash, 4-*) that were **not corroborated**; BG-06 must probe the model with one real call and keep `gemini-3.5-flash-lite` as the default if the probe passes.
- SDK: `@google/genai` 3.6.1 (published 2026-11-18), **Node >= 22**. Its README still says to pin <3.0.0; ignore that.
- Thinking: use `thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL }` (3.x control). The brief's `thinkingBudget: 0` is not confirmed for 3.5 Flash-Lite: **VERIFY**.
- Timeout: `config.abortSignal` is client-side only (the request is not cancelled server-side). Keep `Promise.race` with 3.5s and fall back to `data/demo-responses.json`.
- Sources: aistudio.google.com/docs/models, github.com/googleapis/js-genai (types.ts), registry.npmjs.org/@google/genai.

## Deepgram (BG-05 voice tier 1)
- Nova-3 still current: `wss://api.deepgram.com/v1/listen?model=nova-3&encoding=linear16&sample_rate=16000&interim_results=true&endpointing=300&keyterm=done&keyterm=next...`. **Flux** (`flux-general-en`, `/v2/listen`, turn-based events) is newer; measure time-to-final on the real command set and switch via `DEEPGRAM_MODEL` only if clearly faster. Default: nova-3 (simpler interim handling).
- Auth: `Authorization: Token <key>` header from the server (never from the browser). KeepAlive text frame `{"type":"KeepAlive"}` every 3-5s; 10s of silence with no KeepAlive closes the socket. Use raw `ws` for the proxy, not `@deepgram/sdk` (5.20.0).
- Browser capture: AudioWorklet downsample to 16kHz linear16, ~80ms frames (2560 bytes). **VERIFY** (no canonical example found).
- Sources: developers.deepgram.com (model, listen-streaming, listen-flux, keep-alive, authenticating).

## QR / camera / fonts (BG-03, BG-05)
- `qr` (paulmillr) 0.7.2, Node >= 20.19. Decode: `import decodeQR from 'qr/decode.js'`, input `{width,height,data}` RGBA, **throws when no QR found**. Encode: `import encodeQR from 'qr'`.
- `BarcodeDetector` `qr_code`: Chrome for Android yes; iOS Safari disabled by default; **Android WebView unverified** (so the `qr` decoder fallback is mandatory, not optional).
- Camera and mic need a **secure context**: https, or `localhost`. Plain `http://192.168.x.x` over a hotspot will NOT get camera/mic. Use the Render https URL, or `adb reverse tcp:3001 tcp:3001` and load `http://localhost:3001` on the glasses.
- JetBrains Mono: `@fontsource/jetbrains-mono` 5.3.0 (copy the 400 and 500 latin woff2 into `public/fonts/`). Advance assumed 600/1000 em: **VERIFY** by parsing `hmtx` in the copy-audit test.

## Stack versions (npm registry, 2026-11-21)
vite 8.3.8 (node ^20.19 || >=22.12) · react 19.3.1 · react-router-dom 7.18.6 · express 5.3.0 · ws 8.23.0 · tsx 4.23.15 · vitest 5.1.1 (node >=22.12) · qrcode.react 4.2.0 · typescript 7.0.2 (**new major; use `typescript@^5` if any tool balks**). Dev machine has Node 26.13; Render must be set to Node 22+.
