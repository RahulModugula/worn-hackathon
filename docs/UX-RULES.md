# HUD and phone UX rules (checklist for every screen change)

Evidence level is marked: **[sourced]** = found in a public source (read 2026-11-21), **[inferred]** = our reasoning, **[unverified]** = needs a real-glasses test. Details and URLs: research notes in the session log; main sources are Google's Android XR / Glimmer glasses guidance (developer.android.com/design/ui/ai-glasses, design.google/library/transparent-screens), Even Realities display docs (hub.evenrealities.com), a 2025 arXiv review of monocular see-through placement (arxiv.org/abs/2505.09047), WCAG 2.3.1.

## Glasses HUD (640x480, green or color, black = see-through)
1. **Text size:** 0.6 degrees is the minimum legible angle; at 30 pixels per degree that is 18 px, which is our floor. [sourced] The real angular size depends on the M6 field of view, which is NOT public: **ask MicroLumin (Dean) for the horizontal FOV, then check px = angle x (640 / FOV)**. [unverified]
2. **Bright glyphs on black; no filled light blocks.** The display can only add light; large white fills wash out and cause halation. Use text and small filled icons, never filled panels, glow, blur or gradients. [sourced]
3. **Bottom anchoring, empty center.** Keep x120-520/y90-290 empty (we do); anchor content in the lower band; avoid the top corners. [sourced/inferred]
4. **One primary thing per screen:** one value, one verb. Max 2-3 text sizes, short phrases. A glance is 1-3 seconds. [inferred]
5. **Weight and case:** heavy rounded sans (Nunito 600/700), sentence case, no uppercase, no monospace, no terminal styling; never thin or condensed. Halation blurs thin strokes, so icons are filled with strokes >= 2px. Luminance ladder: hero and state 100%, body and action 75%, metadata 60%, nothing under 40% (the strip drops to 50% while Critical Allergy is up). [sourced/inferred]
6. **Color is never the only signal.** Pair color with shape and words (e.g. a ▲ or ! glyph + "ALLERGY: Penicillin"). Reserve red/amber for warnings; red only for critical. [sourced/inferred] State shapes are SVG icons (filled disc done, ring pending, filled diamond alert, triangle warning), so the text glyph set is only what Nunito contains; the copy audit reads the font cmap with fontkit and fails on any missing glyph and measures every string with the real font. Critical Allergy pairs the `Allergy` label + a hero-height (36px) diamond beside the allergen + alert colour, with longer 3px corner ticks and the status strip dimmed to 50%. Every card follows one anatomy: label row (icon + at most 2 words, optional meta on the right), hero, body, action hint bottom-left; never advertise an action the app cannot perform (G6 `Say "close"`, G7 `Say "photo"`: both are real voice intents). G7 shows the nurse-entered dressing times (`Changed {time} · due {time}`, or `due per protocol`) on the existing body line and never adds a dressing action. Wound text is a documentation aid and a draft for clinician review; the phone Dressing card is labelled `Documented by nurse`, has 48px controls and preselects no type or interval.
7. **Motion:** nothing may flash more than 3 times per second; no red flashing. Notifications should fade in roughly 300-2000 ms (Google found 0.5 s fades went unnoticed). Input feedback (a tap or voice heard) must appear in under ~100 ms. [sourced/inferred]
8. **Timeouts:** 3 s / 6 s / 10 s in the FRD are our choice, not sourced. Info screens may time out; **critical alerts persist until acknowledged**. G4 and G8 never time out while a patient is loaded. [inferred]
9. **Confirm every input visibly:** after tap or voice, show state ("Heard: done", "Logging..."), and show errors in words (`Try "done", "vitals", or "close"`). Show a listening indicator (mic icon + `Listening`) only while the mic is genuinely live (permission granted and audio flowing), never when merely requested. [inferred]
10. **Test on the real device** in a dark room and in bright light, standing and walking, noting time-to-read. Walking raises fatigue. [sourced/unverified]

## Phone (iPhone Safari first, Android and Windows Chrome too)
1. One obvious next action per screen; the primary button is at least 48 px high and at the thumb.
2. Calm states: conflict banner text is exact (`Already given {time} via {device}`) and never blames the nurse; offline shows `Reconnecting...` and queued actions are visible.
3. 16 px minimum text, 16 px inputs (no iOS zoom), `dvh` heights, safe-area insets, no hover-only controls.
4. Never lose an action silently: if a dispatch fails, show it.
5. Director Drawer is for operators: big, labelled, and RESET needs a deliberate 2-step confirm.

## Verify
Every UI change: screenshot `/glasses` at 640x480 (1x) and `/phone?director=1` at 390x844, run `npm test` (the copy-audit test fails on any overflow), run `npm run check`.

## Legacy WebView (glasses must run on Android 9, Chromium ~69)
- No flex `gap` (use margins on siblings), no `inset:` (use top/right/bottom/left), no `aspect-ratio`, `clamp()`, `:is()`, `dvh` or `overflow: clip` in glasses CSS or inline styles.
- No `?.`/`??` source concerns: the build lowers them. Do not add new APIs from the failing list in `docs/COMPAT-PERF.md` without a polyfill in `src/polyfills.ts`.
- `npm run check-legacy` and `npm run check-budgets` must pass. Details: `docs/COMPAT-PERF.md`.
