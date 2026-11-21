# src/hud-kit: reusable glasses UI kit (READ BEFORE EDITING)

This folder must stay **generic**. A test (`npm run lint-boundary`) fails the build if you break these:
- Never import from `src/apps/` (or `../apps`).
- Never write app words here: patient, med, wound, Bedside, Glance, nurse, allergy, Maria, etc. Put them in `src/apps/bedside-glance/`.

Display law (details: `docs/FRD-v2.2.md` section 1): canvas 640x480, black bg, clear zone x120-520/y90-290 stays EMPTY, bottom card y300-440 with 528px inner width, text >=18px, every text line `white-space:nowrap; overflow:hidden; text-overflow:ellipsis`. Fonts are local woff2 in `public/fonts/`; never load fonts from the internet. Tokens live in `tokens.css`; no CSS framework.

Platform adapters (`platform/`): the app talks to hardware only through `PlatformAdapter`. Camera/mic/key failures must resolve with `{available:false, reason}`, never throw. `microlumin.ts` is chosen only when the injected `window.__M6_BRIDGE__` really provides `onFrame` (the Android wrapper's bridge has only log/getInfo, so it uses the browser platform and getUserMedia). The camera may offer optional `pause()`/`resume()`; the browser adapter stops the frame pump and disables tracks on pause. Browser input: Space or Enter is a tap, Escape a long press.

Sync (`sync/useSession.ts`): generic client. `makeUuid` must keep working without `crypto.randomUUID` (plain-http LAN origins). It exposes `presence`, `synced` (a state frame arrived on this connection), `lastResult` / `onResult` (server acks), a 10s ping / 5s pong heartbeat, and reconnects on `visibilitychange`, `pageshow` and `online`. Keep it free of app words.

Voice (`voice/voiceEngine.ts`): if the tier-1 socket closes at any time, including while the mic prompt is pending, the engine falls to tier 2/3.

Scanner (`scan/qrScanner.ts`): 4 FPS, center 480x480 crop of a 1280x720 frame, 3 matching reads in 1.2s to lock. The AC#4 test proves edge-of-view codes never decode; if you change the crop, that test must still pass.

Verify: `npm run typecheck && npm run lint-boundary && npm test`.
