# Design system: Bedside Glance (phone + glasses)

Evidence: research read 2026-11-21 (Google Android XR glasses guidance, Even Realities docs, WCAG 2.2, ISMP, Joint Commission, NN/g-style practice). Items marked [judgment] have no published source. This file is the contract for both surfaces; `docs/UX-RULES.md` still applies.

## 0. Principles
1. **Calm clinical confidence.** It should feel like precision equipment, not a hacker toy: restraint, consistency, one accent used sparingly. Green is the brand, never the wallpaper.
2. **One thing at a time.** One primary action per screen, one hero value per HUD card.
3. **Meaning never lives in color alone.** Shape + word + position + color. [Google glasses guidance; WCAG]
4. **Safe by design.** Two identifiers before any administration; every override has a reason; reversible actions get Undo, not confirm dialogs. [NPSG.01.01.01, Koppel 2008]
5. **Honest about AI.** Anything model-written says "Draft for clinician review". Fallback text says "Sample result".

## 1. Brand
- Name: **Bedside Glance**. Mark: a rounded square holding four small corner ticks (the HUD bracket motif) around a single dot (the glance). Wordmark in the display face, sentence case.
- Voice: plain, verb-first, no jargon, no blame. Units spelled safely (no trailing zeros, no "U", no "QD" per ISMP).

## 2. Phone design tokens (CSS custom properties in one `phone/tokens.css`; nothing hard-coded elsewhere)
- **Color (dark-first, OKLCH, depth by lightness steps, few borders):**
  `--bg` (near-black with a faint cool tint), `--surface-1/2/3` (each +4-6% lightness), `--line` (very low-contrast hairline, used sparingly), `--fg` (high), `--fg-2` (secondary, >= 4.5:1), `--fg-3` (tertiary, large text only), `--accent` (calm mint-green, about oklch(0.84 0.15 158)), `--accent-ink` (text on accent), `--info`, `--warn` (amber), `--danger` (red), each with a `-bg` tint for chips. A light theme is optional; if added, mirror every token.
- **Type:** UI face **Geist Sans** variable (self-hosted woff2 via fontsource, no CDN), **Geist Mono** only for IDs and codes. Scale: 12 / 14 / 16 / 20 / 28 / 36 px; weights 400/500/600; sentence case; **tabular numerals on every number** (`font-variant-numeric: tabular-nums`). Body never below 16 px on inputs/actions, 14 px for secondary.
- **Space:** 4-pt scale (4, 8, 12, 16, 24, 32, 48). Card padding 16. **Radius:** 10 (chips), 16 (cards), 24 (sheets); never mix inside one component class.
- **Elevation:** surfaces step up in lightness; a single soft shadow only for sheets and the tab bar; blur (`backdrop-filter`) only on the bottom bar with an opaque fallback when unsupported or Reduce Transparency.
- **Icons:** one inline-SVG set, 24 px grid, 1.75 px stroke, round caps (Lucide style, ISC license; draw or copy the ~16 needed paths into `Icon.tsx`, no new dependency). No emoji anywhere.
- **Motion:** 150-250 ms, ease-out in / ease-in out; press = scale .97 + 8% darker; number and countdown changes without layout shift; `prefers-reduced-motion` keeps a 100 ms opacity fade only. No decorative looping animation.
- **Focus:** 2 px accent ring with 2 px offset on every interactive element.
- **Safe areas and viewport:** `viewport-fit=cover`, `env(safe-area-inset-*)`, `100dvh` with `100vh` fallback, `theme-color` meta matching `--bg`, `apple-touch-icon`, `manifest.webmanifest` (`display: standalone`), `-webkit-tap-highlight-color: transparent`, `overscroll-behavior: contain`.

## 3. Phone information architecture
- **Bottom tab bar (thumb zone, 56 px + safe area):** Shift, Patient, Wound, Activity. Active tab uses a filled icon + label; badge dot on Wound when review is pending.
- **Top bar:** small brand mark left; **connection chip** right (Connected, Reconnecting, Offline with queued count) using icon + word. A second chip shows glasses presence.
- **Shift (P1):** greeting with nurse name and the demo clock as a large tabular time; a single prominent **Start shift** button before the shift starts; patient cards sorted by soonest due, each showing initials avatar, name, room, next med with a live countdown, allergy chip; one tap opens the patient.
- **Patient (P2):** sticky **patient header** (initials avatar, name, age, room, attending) with a **fixed allergy bar** directly beneath it (icon ◆ + "Allergy: Penicillin"; amber, never color-only). Med list grouped **Due now / Upcoming / Given**. Each actionable med card: drug and dose (display weight), schedule and countdown (secondary), and a **48 px Log button** at the card's right. Not-yet-due meds show a muted "Log early" that opens a confirm sheet (reason pick-list + Give anyway). After logging: a **toast with an undo ring** (circular 10 s countdown, tabular seconds) that is also pinned on the card; conflict text stays exactly `Already given {time} via {device}`. Vitals as a compact stat row (12-hour times). PRN as its own card with eligibility countdown.
- **Wound (P3):** side-by-side previous and new photo with timestamps; a "Draft for clinician review" banner with the source badge (AI result / Sample result / Assessment unavailable); editable note; **Save to chart** and **Send to {attending}**; a **Dressing** card (nurse-entered type pick list, last changed, interval presets 24 h / 48 h / 72 h / Per protocol, `Documented by nurse`, nothing preselected; read-only once saved or sent; one line added to the draft on Save and Send); per-photo consent line; failed upload shows "Photo didn't upload" with a Retry button.
- **Activity (P4):** timeline grouped by time; each event shows patient, med, device icon (glasses or phone) and the **verification chain** as three small connected steps (Wristband matched, Nurse confirmed, Server accepted).
- **Director drawer:** bottom sheet from a discreet handle; sections (Scenario, Voice and input, Faults, Danger zone) with big labelled buttons; preflight panel on top; RESET lives alone in the Danger zone and needs press-and-hold 1.2 s.
- **Scan & Talk (Plan B):** full-screen camera with a centered reticle, large Done / Next / Undo / Vitals / Close / Wound buttons in a bottom grid.
- **Empty, loading, error states are designed:** skeleton rows for lists, empty states with one clear action, errors that say what to do.
- **Confirm only the irreversible;** Undo everything reversible. [practice]

## 4. Glasses HUD rules (hardware constraints are NON-NEGOTIABLE)
Hard constraints: 640x480 canvas, black = see-through, **center x120-520/y90-290 always empty**, bottom card y300-440 with **528 px inner width**, text **>= 18 px**, every line nowrap + ellipsis, copy strings per `docs/FRD-v2.2.md` section 2, works on Android 9 WebView (**no flex gap, inset, aspect-ratio, clamp, :is, dvh, overflow:clip**), fonts self-hosted, no flashing > 3/s (we stay under 1 Hz), `npm test` copy-audit must stay green.

Deviation from FRD v2.2 typography (decided 2026-11-21, with reasons): FRD v2.2 chose monospace + uppercase. Research says emissive additive displays read best with **heavier, rounded, sentence-case** type (Google Glimmer: minimum 0.6 degree = 18 px at 30 PPD, rounded letterforms, increased weight and tracking, uppercase is harder to read), and monospace/ALL CAPS/`>`-prompt styling reads as "terminal", not premium. So:
1. **Typeface:** one heavy rounded sans for hero and body, self-hosted woff2 (shipped: **Nunito**, one variable woff2, weights 600/700; label 20/700, hero 36/700, body 22/600, hint and meta 20/600). Tabular numerals for times and doses. Keep JetBrains Mono only if needed for code-like IDs.
2. **Sentence case** everywhere (no `text-transform: uppercase`, no tracked-out caps); labels are short (<= 2 words).
3. **Luminance ladder (shipped):** hero and state 100%, body and action hint 75%, metadata 60% (raised from 50% for legibility; unmeasured on glass); nothing readable below 40%. One accent only in color mode (amber for warning, red for critical) and a single green in green mode.
4. **Icons:** 24x24 **filled** flat shapes with strokes >= 2 px; no hairlines, no outline-only icons. State vocabulary by shape: filled circle done, ring pending, filled diamond alert, triangle warning. Draw as inline SVG with `shape-rendering="crispEdges"` for rules; integer px positions.
5. **Hierarchy per card:** one hero line (drug and dose, or patient name) about 1.6-2x body, one body line, one metadata line, one action hint (the verb the wearer can say or tap). Max 3-4 lines; if a 4th is needed, drop something. Anatomy is the same on every card: **label row** (icon + at most 2 words, optional meta on the right), hero, body, **action hint bottom-left**. G4 label `Due now` (ring), conflict banner label `Already given` (triangle; the locked `Already given {time} via {device}` sentence at body weight, `None due / Next` as meta), G6 hint `Say "close"`, G7 hint `Say "photo"` (only real voice intents), G8 label `Wound · Sample result` or `AI result` (filled circle) with the assessment summary as hero.
6. **Progress:** a 2 px bar or a 6-8 dot stepper along the bottom edge for multiple due meds ("1 of 2") and for the 10-second undo window; opacity-only motion, 300-400 ms ease-out, no pulses above 1 Hz.
7. **Frame (shipped):** four corner ticks, **16 px arms, 2 px stroke** (the brand motif); the Critical Allergy card alone uses **24 px arms, 3 px stroke**; no fills, no glow, no blur, no gradients. A dark drop shadow behind text is allowed only if it measurably helps; default none.
8. **Critical allergy:** "Allergy" label, a **hero-height (36 px) filled diamond beside the allergen** (hero), one plain line ("Chart lists Penicillin allergy"), `Say "acknowledge"`; longer 3 px ticks and the status strip dimmed to 50% while it is up; position fixed, persists until acknowledged, color is a bonus not the signal.
9. **Status strip (shipped, no rule line):** brand word or "Rm 12 - Maria L." left at 75%; connection (`Linked`, offline `Not linked` at 75%) and the clock at 60%; `Listening` at 75% only while the mic is genuinely live; the clock only if width allows; tabular digits.
10. **Do not:** monospace body, box-drawing or `>` prompts, blinking cursors, ALL CAPS, glow/halo, hairline strokes, color-only meaning, saturated fills, anything flashing.
11. **Verify on glass:** every change is judged on the real glasses (brightness, halation, reading time) before we call it done; until then record "unmeasured". The 18 px floor assumes 30 PPD: confirm the M6 field of view (see BG-07).

## 5. Components (phone), small and reusable
`Button` (primary / secondary / danger / ghost; sizes 48 and 40), `Card`, `Chip`, `StatusDot`, `TabBar`, `Sheet`, `Toast` (with `UndoRing`), `Stat`, `Avatar` (initials), `Icon`, `Skeleton`, `EmptyState`, `VerificationSteps`. No other one-off visual primitives; every color, space and radius comes from tokens.

## 6. Acceptance for the redesign (reviewed from real screenshots)
- Phone: every screen passes a senior-designer critique at 390x844 (hierarchy, spacing rhythm, consistency, contrast >= 4.5:1, targets >= 44-48 px, no emoji, no mixed radii, tabular numerals).
- Glasses: all 640x480 states pass the HUD rules above, the copy-audit, `npm run check-legacy`, and `npm run check-budgets` (the /glasses bundle budget may be raised only with a measured reason).
- A non-engineer can find the next action on every screen within two seconds.
