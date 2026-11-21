import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type { Action, SessionState, TelemetryMetric } from '../../../../shared/types';
import { chromeVersion, maxOf, p50 } from '../../../../shared/telemetry';
import { SIM_TYPES } from '../../../../shared/types';
import patientsData from '../../../../data/patients.json';
import { Canvas, type HudTheme } from '../../../hud-kit/components/Canvas';
import { PreviewFrame } from '../../../hud-kit/components/PreviewFrame';
import { createBrowserPlatform } from '../../../hud-kit/platform/browser';
import { createMicroLuminPlatform, getM6Bridge, type M6Bridge } from '../../../hud-kit/platform/microlumin';
import type { PlatformAdapter, RgbaFrame } from '../../../hud-kit/platform/types';
import { createQrScanner, type QrScanner } from '../../../hud-kit/scan/qrScanner';
import { getInstanceId, useSession } from '../../../hud-kit/sync/useSession';
import { createIntentMatcher } from '../../../hud-kit/voice/intentMatcher';
import { createVoiceEngine, type VoiceEngine } from '../../../hud-kit/voice/voiceEngine';
import { FINAL_ONLY_INTENTS, INTENT_PATTERNS, parseIntent, type Intent } from '../triggers';
import { assessPhoto, fetchFallbackPhoto, uploadPhoto, type FetchFn } from './photoApi';
import { SCREENS } from './screens';
import { simHandling } from './sim';
import {
  EMPTY_SESSION, SCAN_SCREENS, fromViewState, initialState, reduce, toViewState,
  type Effect, type GEvent, type GlassesDressing, type GState, type GlassesAction, type Med, type Patient, type SessionCtx,
} from './stateMachine';

export const PATIENTS = (patientsData as unknown as { patients: Patient[] }).patients;
/** Patients this nurse may load (data/patients.json). Anyone else gets G3 "Not on your list". */
export const ASSIGNED = (patientsData as unknown as { nurse?: { assignedPatientIds?: string[] } }).nurse?.assignedPatientIds ?? null;

/** What the glasses need to know about one server acknowledgement. */
export interface ResultLike { clientEventId: string; ok: boolean; message?: string; action?: { type: string } }

/** Minimal session surface the glasses need; useSession satisfies it. */
export interface SessionLike {
  state: SessionState | null;
  offline: boolean;
  forceOffline: boolean;
  outbox: unknown[];
  conflicts: Array<{ clientEventId: string; message?: string }>;
  /** True once the server has sent its state on this connection. Default: !offline. */
  synced?: boolean;
  /** Live acknowledgements (conflicts, 'Too late to undo'). Returns an unsubscribe. */
  subscribeResults?: (cb: (r: ResultLike) => void) => () => void;
  /** Actions that sat in the outbox and were just flushed (with how long they waited). Returns an unsubscribe. */
  subscribeFlushed?: (cb: (e: { clientEventId: string; queuedMs: number; action: { type: string } }) => void) => () => void;
  /** Sockets per device role (server presence). Lets the stage mirror notice that the glasses left. */
  presence?: Record<string, number>;
  dispatch(action: GlassesAction & { device: string }): { clientEventId: string };
  setForceOffline(v: boolean): void;
}

export function sessionCtx(st: SessionState | null): SessionCtx {
  if (!st) return EMPTY_SESSION;
  const dressings: Record<string, GlassesDressing> = {};
  for (const c of st.woundCaptures) { // oldest to newest: the newest documented dressing per patient wins
    const d = c.dressing;
    if (d && d.type !== 'none' && d.changedAtMin !== undefined) dressings[c.patientId] = { changedMin: d.changedAtMin, nextDueMin: d.nextDueMin };
  }
  return {
    medStatus: Object.fromEntries(Object.entries(st.medStatus).map(([k, v]) => [k, { status: v.status }])),
    clock: st.clock,
    clockOffsetMin: st.clockOffsetMin,
    hasLastLog: st.lastMedLog !== null,
    extraOrders: st.extraOrders as Record<string, Med[]> | undefined,
    dressings,
    allergyAcks: st.allergyAcks?.map((a) => a.key),
  };
}

/** Wound photo budget: 512px wide JPEG at quality 0.65 keeps the upload small on hospital wifi. */
export const PHOTO_MAX_WIDTH = 512;
export const PHOTO_QUALITY = 0.65;

function frameToJpeg(frame: RgbaFrame): string | null {
  try {
    const src = document.createElement('canvas');
    src.width = frame.width;
    src.height = frame.height;
    const c = src.getContext('2d');
    if (!c) return null;
    c.putImageData(new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height), 0, 0);
    const out = document.createElement('canvas');
    out.width = PHOTO_MAX_WIDTH;
    out.height = Math.round((PHOTO_MAX_WIDTH * frame.height) / frame.width);
    const o = out.getContext('2d');
    if (!o) return null;
    o.drawImage(src, 0, 0, out.width, out.height);
    return out.toDataURL('image/jpeg', PHOTO_QUALITY).split(',')[1] || null;
  } catch {
    return null;
  }
}

function isEditable(t: EventTarget | null): boolean {
  const el = t as { tagName?: unknown; isContentEditable?: unknown } | null;
  const tag = typeof el?.tagName === 'string' ? el.tagName.toUpperCase() : '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable === true;
}

const HOTKEY_INTENT: Record<string, { intent: Intent; force?: boolean }> = {
  p: { intent: 'pain', force: true }, w: { intent: 'wound', force: true }, d: { intent: 'done' },
  s: { intent: 'send', force: true }, r: { intent: 'retry' }, t: { intent: 'vitals' }, u: { intent: 'undo' },
  n: { intent: 'next' }, a: { intent: 'allergy', force: true },
};

/** Android KeyEvent codes sent by android-wrapper in the 'glasskey' event. */
const KEYCODE_BACK = 4;
const KEYCODE_DPAD_CENTER = 23;
const KEYCODE_ENTER = 66;

/** Maps a wrapper 'glasskey' detail to a tap or long press, or null. The wrapper sends {code, action, scanCode, source}. */
export function glassKeyKind(d: { key?: unknown; code?: unknown; action?: unknown }): 'tap' | 'longPress' | null {
  if (d.key === 'Enter') return 'tap';
  if (d.key === 'Escape') return 'longPress';
  if ((d.code === KEYCODE_DPAD_CENTER || d.code === KEYCODE_ENTER) && d.action === 'down') return 'tap';
  if (d.code === KEYCODE_BACK && d.action === 'long-press') return 'longPress';
  return null;
}

/**
 * The microlumin platform needs a bridge that really delivers camera frames. The Android wrapper's bridge only has
 * log/getInfo, so it must fall through to the browser platform (getUserMedia in the WebView).
 */
export function choosePlatform(bridge: M6Bridge | object | null): PlatformAdapter {
  const b = bridge as M6Bridge | null;
  return b && typeof b.onFrame === 'function' ? createMicroLuminPlatform(b) : createBrowserPlatform();
}

/** SIM_CHAOS_DROP with thenDone: the wearer says "done" this long after the link drops. */
const CHAOS_DONE_AFTER_MS = 1500;

/** A glasskey and its twin DOM keydown (the Android wrapper sends both) must count once. */
const GLASSKEY_DEDUPE_MS = 300;

export interface GlassesAppCoreProps {
  session: SessionLike;
  /** null in mirror mode (no camera, no mic, no input). */
  platform: PlatformAdapter | null;
  mirror?: boolean;
  /** /glasses?debug=1: latency bar (p50 / max per metric) and the WebView Chrome version. */
  debug?: boolean;
  theme?: HudTheme;
  zoom?: 1 | 2;
  onZoomChange?: (z: 1 | 2) => void;
  onThemeChange?: (t: HudTheme) => void;
  now?: () => number;
  createVoice?: () => VoiceEngine;
  fetchFn?: FetchFn;
}

export function GlassesAppCore(props: GlassesAppCoreProps) {
  const { session, platform, mirror = false, theme = 'green', zoom = 1 } = props;
  const nowFn = props.now ?? Date.now;
  const [ver, bump] = useReducer((x: number) => x + 1, 0);

  const stateRef = useRef<GState>(initialState(PATIENTS, ASSIGNED));
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const nowRef = useRef(nowFn);
  nowRef.current = nowFn;
  const fetchRef = useRef<FetchFn>(props.fetchFn ?? ((u, i) => fetch(u, i)));
  const tracked = useRef(new Map<string, string>());
  const photos = useRef(new Map<string, string>());
  /** Per capture: which patient, who started it, and whether the last upload failed (drives WOUND_* actions). */
  const captures = useRef(new Map<string, { patientId: string; source: 'glasses' | 'director'; failed: boolean }>());
  const simCaptureArmed = useRef(false);
  /** clientEventIds of WOUND_SEND awaiting their server ack (the confirmation shows only after it). */
  const sendIds = useRef(new Set<string>());
  /** LOG_MED dispatch time per clientEventId, for done-to-ack latency (online dispatches only). */
  const logT0 = useRef(new Map<string, number>());
  const scanT0 = useRef<number | null>(null);
  const samples = useRef<Record<TelemetryMetric, number[]>>({ scanToCardMs: [], doneToAckMs: [], assessMs: [], outboxQueuedMs: [] });
  const lastFrame = useRef<RgbaFrame | null>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const cameraRef = useRef<PlatformAdapter['camera'] | null>(null);
  const cameraAsleep = useRef(false);
  const glassKeyAt = useRef(Number.NEGATIVE_INFINITY);
  const diag = useRef({ cam: 'pending', tier: 0 as number });

  const syncScanner = useCallback(() => {
    const sc = scannerRef.current;
    if (!sc) return;
    const want = SCAN_SCREENS.includes(stateRef.current.screen);
    if (want && !sc.enabled) sc.enable();
    else if (!want && sc.enabled) sc.disable();
  }, []);

  /** The camera only runs while it is needed: scanning (G1-G3) or taking a photo (H3). Otherwise it sleeps (battery, heat). */
  const syncCamera = useCallback(() => {
    const cam = cameraRef.current;
    if (!cam || !cam.pause || !cam.resume) return;
    const need = SCAN_SCREENS.includes(stateRef.current.screen) || stateRef.current.screen === 'H3';
    if (need && cameraAsleep.current) { cameraAsleep.current = false; cam.resume(); }
    else if (!need && !cameraAsleep.current) { cameraAsleep.current = true; cam.pause(); }
  }, []);

  const send = useCallback((e: GEvent): void => {
    if (mirror) return;
    try {
      const prev = stateRef.current;
      const r = reduce(prev, e, nowRef.current());
      stateRef.current = r.state;
      if (e.type === 'scanLock' && e.force !== true && prev.screen !== 'G4' && r.state.screen === 'G4') scanT0.current = nowRef.current();
      for (const eff of r.effects) runEffect(eff);
      syncScanner();
      syncCamera();
      if (r.state !== prev) bump();
    } catch (err) {
      console.error('glasses event failed', err);
    }
    // runEffect only touches refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mirror, syncScanner, syncCamera]);

  /** Keeps the sample for the debug bar and reports it to the server (online only: a queued sample would be stale). */
  const sample = (metric: TelemetryMetric, ms: number, connected = false): void => {
    if (!Number.isFinite(ms) || ms < 0) return;
    const arr = samples.current[metric];
    arr.push(Math.round(ms));
    if (arr.length > 20) arr.shift();
    if (sessionRef.current.offline && !connected) return;
    try { sessionRef.current.dispatch({ type: 'TELEMETRY_SAMPLE', metric, ms: Math.round(ms), device: 'glasses' } as GlassesAction & { device: string }); } catch { /* telemetry never breaks the app */ }
  };

  const dispatchAction = (action: GlassesAction, key?: string, track?: 'send'): void => {
    try {
      const a = sessionRef.current.dispatch({ ...action, device: 'glasses' } as GlassesAction & { device: string });
      if (key && a?.clientEventId) tracked.current.set(a.clientEventId, key);
      if (track === 'send' && a?.clientEventId) sendIds.current.add(a.clientEventId);
      if (action.type === 'LOG_MED' && a?.clientEventId && !sessionRef.current.offline) logT0.current.set(a.clientEventId, nowRef.current());
    } catch (err) {
      console.error('dispatch failed', err);
    }
  };

  const doUpload = async (captureId: string): Promise<void> => {
    // SIM_FAIL_PHOTO_UPLOAD is a toggle in the session: uploads fail for as long as it is on.
    const fail = sessionRef.current.state?.photoUploadShouldFail === true;
    const ok = await uploadPhoto(fetchRef.current, captureId, photos.current.get(captureId) ?? null, fail);
    const meta = captures.current.get(captureId);
    if (meta && !ok) {
      meta.failed = true;
      dispatchAction({
        type: 'WOUND_CAPTURED', captureId, patientId: meta.patientId, photoUploadFailed: true, source: meta.source,
        finding: '', comparison: '', draftNote: '',
      });
    } else if (meta && ok && meta.failed) {
      meta.failed = false;
      dispatchAction({ type: 'WOUND_RETRY_UPLOAD', captureId }); // same captureId: the cached photo is re-sent, not re-shot
    }
    send({ type: 'photoResult', captureId, ok });
  };

  const doCapture = async (captureId: string, sim: boolean): Promise<void> => {
    let jpeg: string | null = null;
    if (sim) {
      jpeg = await fetchFallbackPhoto(fetchRef.current);
    } else {
      let frame: RgbaFrame | null = lastFrame.current;
      for (let i = 0; i < 16 && !frame && diag.current.cam === 'ok'; i++) {
        await new Promise((r) => setTimeout(r, 125));
        frame = lastFrame.current;
      }
      jpeg = frame ? frameToJpeg(frame) : null;
    }
    if (jpeg) photos.current.set(captureId, jpeg);
    await doUpload(captureId);
  };

  const doAssess = async (captureId: string): Promise<void> => {
    const t0 = nowRef.current();
    const assessment = await assessPhoto(fetchRef.current, captureId);
    sample('assessMs', nowRef.current() - t0);
    const meta = captures.current.get(captureId);
    if (meta) {
      const { source: assessmentSource, ...text } = assessment;
      dispatchAction({
        type: 'WOUND_CAPTURED', captureId, patientId: meta.patientId, photoUploadFailed: false, source: meta.source,
        assessmentSource: assessmentSource ?? 'fallback', ...text,
      });
    }
    send({ type: 'assessment', captureId, assessment });
  };

  function runEffect(eff: Effect): void {
    switch (eff.type) {
      case 'dispatch': dispatchAction(eff.action, eff.key, eff.track); break;
      case 'capturePhoto': {
        const sim = simCaptureArmed.current;
        simCaptureArmed.current = false;
        lastFrame.current = null; // never photograph a stale frame from before the camera slept
        const patientId = stateRef.current.patientId;
        if (patientId) captures.current.set(eff.captureId, { patientId, source: sim ? 'director' : 'glasses', failed: false });
        void doCapture(eff.captureId, sim);
        break;
      }
      case 'uploadPhoto': void doUpload(eff.captureId); break;
      case 'assess': void doAssess(eff.captureId); break;
    }
  }

  // ---- hardware: camera, scanner, voice, keys (never in mirror mode) ----
  useEffect(() => {
    if (mirror || !platform) return;
    const cleanups: Array<() => void> = [];
    let alive = true;

    const scanner = createQrScanner({
      camera: platform.camera,
      onFirstRead: () => send({ type: 'scanRead' }),
      onLock: (payload) => send({ type: 'scanLock', payload }),
      onTimeout: () => send({ type: 'scanTimeout' }),
    });
    scannerRef.current = scanner;
    cleanups.push(() => { scanner.disable(); scannerRef.current = null; });
    syncScanner();

    cameraRef.current = platform.camera;
    cameraAsleep.current = false;
    cleanups.push(() => { cameraRef.current = null; });
    cleanups.push(platform.camera.onFrame((f) => { lastFrame.current = f; }));
    platform.camera.start().then(
      (r) => { diag.current.cam = r.available ? 'ok' : `off (${r.reason ?? 'unavailable'})`; syncCamera(); if (alive) bump(); },
      () => { diag.current.cam = 'off (error)'; if (alive) bump(); },
    );
    cleanups.push(() => platform.camera.stop());

    // done/undo move the workflow, so only a FINAL transcript may fire them (the guard reads the flag set in onTranscript).
    let feedingFinal = true;
    const matcher = createIntentMatcher({
      intents: INTENT_PATTERNS.map(({ intent, patterns }) => ({
        intent, patterns, ...(FINAL_ONLY_INTENTS.includes(intent) ? { guard: () => feedingFinal } : {}),
      })),
      onMatch: (m) => {
        send({ type: 'intent', intent: m.intent as Intent, via: 'voice' });
        send({ type: 'heard', intent: m.intent as Intent }); // after the intent, so the screen change does not wipe it
      },
    });
    const onTranscript = (text: string, final: boolean): void => {
      if (parseIntent(text, final) === null) {
        if (final && text.trim()) send({ type: 'voiceMiss' });
        return;
      }
      feedingFinal = final;
      matcher.feed(text, final);
    };
    cleanups.push(platform.mic.onTranscript((t) => onTranscript(t.text, t.final)));
    if (platform.name === 'microlumin') {
      void platform.mic.start().then((r) => { if (alive) send({ type: 'listening', on: r.available }); }, () => { if (alive) send({ type: 'listening', on: false }); });
    }

    let engine: VoiceEngine | null = null;
    try {
      engine = (props.createVoice ?? (() => createVoiceEngine()))();
      cleanups.push(engine.on((ev) => {
        if (ev.type === 'transcript') onTranscript(ev.text, ev.final);
        else if (ev.type === 'tier') {
          diag.current.tier = ev.tier;
          if (alive) bump();
        } else if (ev.type === 'mic') {
          // 'Listening' only while audio is really flowing (tier 1 after getUserMedia, tier 2 after onaudiostart), never when merely requested.
          if (platform.name !== 'microlumin') send({ type: 'listening', on: ev.live });
        }
      }));
      engine.start().catch(() => undefined);
      const eng = engine;
      cleanups.push(() => eng.stop());
    } catch (err) {
      console.error('voice engine failed to start', err);
    }

    // Platform tap / long press. DOM key twins of a glasskey are dropped.
    const dedupe = (): boolean => nowRef.current() - glassKeyAt.current < GLASSKEY_DEDUPE_MS;
    cleanups.push(platform.input.onTap(() => { if (!dedupe()) send({ type: 'tap' }); }));
    cleanups.push(platform.input.onLongPress(() => { if (!dedupe()) send({ type: 'longPress' }); }));

    const onGlassKey = (ev: Event): void => {
      const d = (ev as CustomEvent<{ key?: unknown; code?: unknown; action?: unknown }>).detail ?? {};
      const kind = glassKeyKind(d);
      if (kind === null) return;
      send({ type: kind });
      glassKeyAt.current = nowRef.current();
    };
    window.addEventListener('glasskey', onGlassKey);
    cleanups.push(() => window.removeEventListener('glasskey', onGlassKey));

    // The browser adapter maps Enter/Escape itself; every other platform gets the DOM twin here.
    if (platform.name !== 'browser') {
      const onDomKey = (ev: KeyboardEvent): void => {
        if (ev.repeat || isEditable(ev.target)) return;
        if (dedupe()) return;
        if (ev.key === 'Enter') send({ type: 'tap' });
        else if (ev.key === 'Escape') send({ type: 'longPress' });
      };
      window.addEventListener('keydown', onDomKey);
      cleanups.push(() => window.removeEventListener('keydown', onDomKey));
    }

    const onKey = (ev: KeyboardEvent): void => {
      if (ev.repeat || ev.metaKey || ev.ctrlKey || ev.altKey || isEditable(ev.target)) return;
      const k = ev.key.toLowerCase();
      if (/^[1-8]$/.test(k)) { send({ type: 'jump', n: Number(k) }); return; }
      const h = HOTKEY_INTENT[k];
      if (h) send({ type: 'intent', intent: h.intent, force: h.force });
    };
    window.addEventListener('keydown', onKey);
    cleanups.push(() => window.removeEventListener('keydown', onKey));

    return () => {
      alive = false;
      for (const fn of cleanups.reverse()) {
        try { fn(); } catch { /* best-effort teardown */ }
      }
    };
    // props.createVoice is read once per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mirror, platform, send, syncScanner, syncCamera]);

  // ---- session -> state machine ----
  // `cursor` is the highest event seq this client has acted on. null = not baselined yet: a fresh page adopts the
  // server's current eventSeq WITHOUT replaying anything already in the session. A reconnect keeps its cursor.
  const seen = useRef<{ cursor: number | null; notice: string; conflicts: Set<string>; active: string | null }>({ cursor: null, notice: '', conflicts: new Set(), active: null });
  const prevSnap = useRef<{ shift: boolean; events: number } | null>(null);
  useEffect(() => {
    if (mirror) return;
    send({ type: 'offline', offline: session.offline });
    const st = session.state;
    if (!st) return;

    const prev = prevSnap.current;
    const wasReset = prev !== null && ((prev.shift && st.shift === null) || (prev.events > 0 && st.events.length === 0));
    prevSnap.current = { shift: st.shift !== null, events: st.events.length };
    if (wasReset) {
      send({ type: 'reset' });
      tracked.current.clear();
      sendIds.current.clear();
      logT0.current.clear();
      photos.current.clear();
      captures.current.clear();
    }
    send({ type: 'session', session: sessionCtx(st) });

    const noticeKey = st.glassesNotice ? `${st.glassesNotice.atMs}|${st.glassesNotice.text}` : '';
    // Persisted state is not the server's state: wait for a state frame on this connection.
    const synced = session.synced ?? !session.offline;
    // Keep the cursor across a reconnect (same page session): commands sent while we were away must still run.
    if (session.offline || !synced) return;
    // A patient set elsewhere (the phone scanned) flips this display to that card. Only a CHANGE counts, so our own
    // scan lock (patient already loaded) and a local "room 12" (server value unchanged) never loop or get overridden.
    if (st.activePatientId !== seen.current.active) {
      seen.current.active = st.activePatientId;
      if (st.activePatientId) send({ type: 'adopt', patientId: st.activePatientId });
    }
    if (seen.current.cursor === null || wasReset || st.eventSeq < seen.current.cursor) {
      seen.current.cursor = st.eventSeq;
      seen.current.notice = noticeKey;
      return;
    }
    const cursor = seen.current.cursor;
    for (const e of st.events) {
      if (e.seq <= cursor) continue;
      seen.current.cursor = Math.max(seen.current.cursor, e.seq);
      if (!(SIM_TYPES as readonly string[]).includes(e.type)) continue;
      const h = simHandling(e.type, stateRef.current, e.detail);
      if (!h) continue;
      simCaptureArmed.current = h.simCapture === true;
      for (const ge of h.events) send(ge);
      simCaptureArmed.current = false;
      if (h.chaos) runChaos(h.chaos.ms, h.chaos.thenDone);
    }
    if (noticeKey && noticeKey !== seen.current.notice) {
      seen.current.notice = noticeKey;
      const n = st.glassesNotice;
      if (n && n.kind !== 'phone') send({ type: 'notice', notice: { text: n.text } });
    }
    for (const c of session.conflicts) {
      if (seen.current.conflicts.has(c.clientEventId)) continue;
      seen.current.conflicts.add(c.clientEventId);
      const key = tracked.current.get(c.clientEventId);
      if (key) send({ type: 'logConflict', key, message: c.message || 'Already given' });
    }
  }, [mirror, session.state, session.offline, session.synced, session.conflicts, send]);

  // ---- live acknowledgements: lost first-write-wins races and "Too late to undo" ----
  const subscribeResults = session.subscribeResults;
  useEffect(() => {
    if (mirror || !subscribeResults) return;
    return subscribeResults((r) => {
      const t0 = logT0.current.get(r.clientEventId);
      if (t0 !== undefined) { logT0.current.delete(r.clientEventId); sample('doneToAckMs', nowRef.current() - t0); }
      if (sendIds.current.delete(r.clientEventId)) {
        // The "Sent to Dr. Okafor" confirmation exists only after the server accepted WOUND_SEND.
        send(r.ok ? { type: 'woundSent' } : { type: 'sendFailed', message: r.message || 'Not sent' });
        return;
      }
      if (r.ok) return;
      seen.current.conflicts.add(r.clientEventId); // the conflicts list must not toast it a second time
      const key = tracked.current.get(r.clientEventId);
      if (key) send({ type: 'logConflict', key, message: r.message || 'Already given' });
      else if (r.action?.type === 'UNDO_LAST_MED') send({ type: 'toast', text: r.message || 'Too late to undo' });
      else if (r.action?.type === 'HANDOFF_OFFER') send({ type: 'toast', text: r.message || 'Handoff not sent' });
    });
  }, [mirror, subscribeResults, send]);

  // ---- offline outbox: how long each action waited before it was flushed ----
  const subscribeFlushed = session.subscribeFlushed;
  useEffect(() => {
    if (mirror || !subscribeFlushed) return;
    return subscribeFlushed((e) => {
      // Telemetry and view pushes would feed back into themselves; only real commands are timed. The flush itself proves we are connected.
      if (e.action.type === 'TELEMETRY_SAMPLE' || e.action.type === 'SET_GLASSES_VIEW') return;
      sample('outboxQueuedMs', Math.min(e.queuedMs, 600_000), true);
    });
    // sample only touches refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mirror, subscribeFlushed]);

  // ---- Director chaos: go offline, optionally say "done" while dark, come back (client timers only) ----
  const chaosTimers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const chaosActive = useRef(false);
  const clearChaos = (): void => { for (const tm of chaosTimers.current) clearTimeout(tm); chaosTimers.current = []; };
  const runChaos = (ms: number, thenDone: boolean): void => {
    clearChaos();
    chaosActive.current = true;
    sessionRef.current.setForceOffline(true);
    if (thenDone) chaosTimers.current.push(setTimeout(() => send({ type: 'intent', intent: 'done', via: 'voice' }), CHAOS_DONE_AFTER_MS));
    chaosTimers.current.push(setTimeout(() => { chaosActive.current = false; sessionRef.current.setForceOffline(false); }, ms));
  };
  useEffect(() => () => {
    clearChaos();
    if (chaosActive.current) { chaosActive.current = false; try { sessionRef.current.setForceOffline(false); } catch { /* unmounting */ } }
  }, []);

  // ---- scan lock -> G4 render latency: measured once the committed render shows the Meds card ----
  useEffect(() => {
    if (mirror || scanT0.current === null || stateRef.current.screen !== 'G4') return;
    const t0 = scanT0.current;
    scanT0.current = null;
    sample('scanToCardMs', nowRef.current() - t0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ver, mirror]);

  // ---- fades: wake at the next deadline; clock label refresh every 5s ----
  useEffect(() => {
    if (mirror) return;
    const s = stateRef.current;
    const deadlines = [s.fadeAtMs, s.toast?.untilMs].filter((x): x is number => x !== null && x !== undefined);
    if (deadlines.length === 0) return;
    const wait = Math.max(0, Math.min(...deadlines) - nowRef.current()) + 5;
    const t = setTimeout(() => send({ type: 'tick' }), wait);
    return () => clearTimeout(t);
  }, [ver, mirror, send]);

  useEffect(() => {
    const t = setInterval(bump, 5000);
    return () => clearInterval(t);
  }, []);

  // ---- push the view into the session so ?mirror=1 can render it ----
  const lastPushed = useRef('');
  useEffect(() => {
    if (mirror || session.offline) return;
    const view = toViewState(stateRef.current);
    const json = JSON.stringify({ ...view, offline: false });
    if (json === lastPushed.current) return;
    lastPushed.current = json;
    dispatchAction({ type: 'SET_GLASSES_VIEW', view });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ver, mirror, session.offline]);

  // ---- render ----
  const nowMs = nowFn();
  let view: GState = stateRef.current;
  if (mirror) {
    // The glasses push their view only while online, so when they drop it freezes. Presence says they are gone:
    // show the frozen view as Not linked. No pushed view yet (display-only flow, glasses ARE the mirror) stays as is.
    const glassesGone = session.presence?.glasses === 0 && session.state?.glassesViewState != null;
    const base = { ...initialState(PATIENTS, ASSIGNED), session: sessionCtx(session.state), offline: session.offline || glassesGone };
    view = fromViewState(session.state?.glassesViewState, base, nowMs) ?? base;
    // Display-only flow: no glasses are pushing a view, but the phone set the patient. Show that card.
    const active = session.state?.activePatientId;
    if (active && (view.patientId === null) && (view.screen === 'G1' || view.screen === 'G2')) {
      view = reduce(view, { type: 'adopt', patientId: active }, nowMs).state;
    }
  }
  const Screen = SCREENS[view.screen];
  const s = stateRef.current;
  const sessionId = session.state?.id ?? '-';
  const debug =
    `screen=${s.screen} patient=${s.patientId ?? '-'} cam=${diag.current.cam} voice=tier${diag.current.tier || '-'} ` +
    `online=${!session.offline} outbox=${session.outbox.length} session=${sessionId}`;

  const hud = (
    <Canvas theme={theme}>
      <Screen state={view} nowMs={nowMs} />
    </Canvas>
  );
  if (mirror) {
    return (
      <PreviewFrame mirror zoom={1} theme={theme} onZoomChange={() => undefined} onThemeChange={() => undefined}>
        {hud}
      </PreviewFrame>
    );
  }
  return (
    <>
      <PreviewFrame
        mirror={false}
        zoom={zoom}
        theme={theme}
        onZoomChange={props.onZoomChange ?? (() => undefined)}
        onThemeChange={props.onThemeChange ?? (() => undefined)}
      >
        {hud}
      </PreviewFrame>
      <div
        data-desktop-controls="1"
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center',
          padding: '6px 12px', background: '#111', color: '#888', font: '12px ui-monospace, monospace', zIndex: 10,
        }}
      >
        <button
          type="button"
          aria-pressed={session.forceOffline}
          onClick={() => session.setForceOffline(!session.forceOffline)}
          style={{ font: 'inherit', color: session.forceOffline ? '#ffc24b' : '#aaa', background: '#151515', border: '1px solid #333', padding: '4px 10px', marginRight: 12, cursor: 'pointer' }}
        >
          Force Offline
        </button>
        <span data-debug="1">{debug}</span>
      </div>
      {props.debug === true && <TelemetryBar samples={samples.current} />}
    </>
  );
}

const BAR_LABEL: Array<[TelemetryMetric, string]> = [['scanToCardMs', 'scan>card'], ['doneToAckMs', 'done>ack'], ['assessMs', 'assess'], ['outboxQueuedMs', 'queued']];

/** /glasses?debug=1: p50 / max per metric (this device's last 20) and the WebView's Chrome version. */
export function TelemetryBar({ samples, ua }: { samples: Record<TelemetryMetric, number[]>; ua?: string }) {
  const agent = ua ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  const parts = BAR_LABEL.map(([k, label]) => {
    const xs = samples[k];
    return xs.length ? `${label} p50 ${p50(xs)} max ${maxOf(xs)} ms (n=${xs.length})` : `${label} n/a`;
  });
  return (
    <div
      data-telemetry-bar="1"
      style={{ position: 'fixed', left: 0, right: 0, bottom: 30, padding: '4px 12px', background: '#000', color: '#9f9', font: '11px ui-monospace, monospace', zIndex: 11 }}
    >
      {parts.join(' | ')} | Chrome {chromeVersion(agent) ?? 'unknown'}
    </div>
  );
}

export interface GlassesAppProps {
  mirror?: boolean;
  debug?: boolean;
  sessionId?: string;
  theme?: HudTheme;
  zoom?: 1 | 2;
  onZoomChange?: (z: 1 | 2) => void;
  onThemeChange?: (t: HudTheme) => void;
}

/** The read-only stage mirror shows as director, so it passes the page's `key` when the server requires DIRECTOR_KEY. */
function mirrorKey(mirror: boolean): string {
  if (!mirror) return '';
  try { const k = new URLSearchParams(window.location.search).get('key'); return k ? `&key=${encodeURIComponent(k)}` : ''; } catch { return ''; }
}

function wsUrl(sessionId: string, mirror: boolean): string {
  const loc = window.location;
  // The stage mirror is read-only: it must not count as the glasses in presence.
  return `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}/ws?session=${encodeURIComponent(sessionId)}&device=${mirror ? 'director' : 'glasses'}&instance=${encodeURIComponent(getInstanceId())}${mirrorKey(mirror)}`;
}
/** Wired glasses app: real session socket and the platform adapter for this host. */
export function GlassesApp(props: GlassesAppProps) {
  const sessionId = props.sessionId ?? 'demo';
  const mirror = props.mirror === true;
  const resultSubs = useRef(new Set<(r: ResultLike) => void>());
  const subscribeResults = useCallback((cb: (r: ResultLike) => void) => { resultSubs.current.add(cb); return () => { resultSubs.current.delete(cb); }; }, []);
  const flushedSubs = useRef(new Set<NonNullable<Parameters<NonNullable<SessionLike['subscribeFlushed']>>[0]>>());
  const subscribeFlushed = useCallback<NonNullable<SessionLike['subscribeFlushed']>>((cb) => { flushedSubs.current.add(cb); return () => { flushedSubs.current.delete(cb); }; }, []);
  const s = useSession<SessionState, Action>({
    url: wsUrl(sessionId, mirror),
    storageKey: `bg-glasses-${sessionId}${mirror ? '-mirror' : ''}`,
    onResult: (e) => resultSubs.current.forEach((cb) => cb(e)),
    onFlushed: (e) => flushedSubs.current.forEach((cb) => cb({ clientEventId: e.clientEventId, queuedMs: e.queuedMs, action: { type: String(e.action.type) } })),
  });
  const platform = useMemo<PlatformAdapter | null>(() => {
    if (mirror) return null;
    return choosePlatform(getM6Bridge());
  }, [mirror]);
  const session: SessionLike = {
    state: s.state,
    offline: s.offline,
    forceOffline: s.forceOffline,
    outbox: s.outbox,
    conflicts: s.conflicts,
    synced: s.synced,
    presence: s.presence,
    subscribeResults,
    subscribeFlushed,
    dispatch: (a) => s.dispatch(a as never),
    setForceOffline: s.setForceOffline,
  };
  return <GlassesAppCore {...props} mirror={mirror} session={session} platform={platform} />;
}
