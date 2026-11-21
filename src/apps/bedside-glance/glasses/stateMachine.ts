// Pure glasses state machine (FRD v2.2 section 3). No React, no timers, no I/O:
// reduce(state, event, nowMs) -> { state, effects }. The host runs the effects.
import { ACTIONABLE_WINDOW_MIN, DEMO_START_MIN, hhmmToMinutes, longTime } from '../../../../shared/clock';
import type { Action } from '../../../../shared/types';
import { checkAllergy } from '../../../../shared/allergy';
import demoResponses from '../../../../data/demo-responses.json';
import { makeUuid } from '../../../hud-kit/sync/useSession';
import { COOLDOWN_MS, type Intent } from '../triggers';

// ---------- data shapes (data/patients.json) ----------
export interface Med { id: string; name: string; dose: string; route: string; dueAt: string; allergyClasses?: string[] }
export interface Prn { id: string; name: string; dose: string; lastGivenAt: string; intervalHours: number }
export interface WoundRec { site: string; lastChangedAt: string; intervalHours: number; note: string }
export interface VitalsRec { bp: string; hr: number; tempF: number; spo2: number; takenAt: string; nextAt: string }
export interface Patient {
  id: string;
  qrPayload: string;
  name: string;
  room: string;
  attending: string;
  allergies: string[];
  diabetic: boolean;
  glucose: { valueMgDl: number; takenAt: string } | null;
  meds: Med[];
  prn: Prn[];
  wound: WoundRec | null;
  vitals: VitalsRec;
}

export type AssessmentSrc = 'gemini' | 'fallback' | 'unavailable';
export interface Assessment { finding: string; comparison: string; draftNote: string; source?: AssessmentSrc }
/** The fixed sample answer (no key, timeout, offline). Non-clinical: G8 shows 'Photo saved' and 'No AI review - see phone'. */
export const FALLBACK_ASSESSMENT: Assessment = { ...demoResponses.woundAssessment, source: 'fallback' };

// ---------- screens, timings ----------
export type ScreenId = 'G1' | 'G2' | 'G3' | 'G4' | 'G5' | 'G6' | 'G7' | 'H3' | 'G8' | 'G9' | 'VITALS' | 'ALLERGY';
export const SCREEN_IDS: readonly ScreenId[] = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'H3', 'G8', 'G9', 'VITALS', 'ALLERGY'];

/** Auto-fade durations. G4, G8, Vitals and Critical Allergy have none. */
export const FADE_MS: Partial<Record<ScreenId, number>> = { G5: 3000, G6: 10_000, G9: 6000 };
export const TOAST_MS = 3000;
export const MISS_TOAST = 'Try "done", "vitals", or "close"';
/** How long "Heard: done" stays up. */
export const HEARD_MS = 1500;
export const OFFLINE_QUEUED = 'Queued · offline';
export const NOT_ON_LIST = 'Not on your list';
/** 'done' on an allergy-conflicting med: the glasses never give it; the nurse confirms on the phone. */
export const ALLERGY_CONFIRM_PHONE = 'Allergy · confirm on phone';
export const PHOTO_FAILED = "Photo not sent · say 'retry'";

export const SCAN_SCREENS: readonly ScreenId[] = ['G1', 'G2', 'G3'];

// ---------- state ----------
export interface SessionCtx {
  medStatus: Record<string, { status: 'due' | 'given' }>;
  clock: { baseMin: number; startedAtMs: number } | null;
  clockOffsetMin: number;
  hasLastLog: boolean;
  /** Director-injected orders (SIM_ADD_CONFLICT_ORDER), keyed by patient id. */
  extraOrders?: Record<string, Med[]>;
  /** Nurse-entered dressing times per patient id (newest capture wins). Absent = show the chart default. */
  dressings?: Record<string, GlassesDressing>;
  /** `${patientId}:${medKey}` of allergy alerts any wearer acknowledged (server `allergyAcks`). */
  allergyAcks?: string[];
}
/** Minutes since midnight; nextDueMin is null for "per protocol". */
export interface GlassesDressing { changedMin: number; nextDueMin: number | null }
export const EMPTY_SESSION: SessionCtx = { medStatus: {}, clock: null, clockOffsetMin: 0, hasLastLog: false };

export interface Notice { label?: string; text: string }
export type CaptureStage = 'upload' | 'assess' | 'failed';
export type ScanFail = 'unknown' | 'unassigned';

export interface GState {
  screen: ScreenId;
  patients: Patient[];
  /** Patient ids this nurse may load; null = no restriction (tests, no roster). */
  assigned: string[] | null;
  /** Why G3 is showing. */
  scanFail: ScanFail | null;
  patientId: string | null;
  session: SessionCtx;
  offline: boolean;
  dueCursor: number;
  /** Keys given from this device that the server snapshot has not confirmed yet. */
  pending: string[];
  lastLogKey: string | null;
  logged: { name: string; at: string } | null;
  prev: ScreenId | null;
  returnTo: ScreenId | null;
  fadeAtMs: number | null;
  toast: { text: string; untilMs: number } | null;
  cooldowns: Record<string, number>;
  captureSeq: number;
  captureId: string | null;
  stage: CaptureStage;
  assessment: Assessment | null;
  notice: Notice | null;
  /** The patient whose wristband the camera locked (a real scan, not a voice room or Director jump). */
  wristbandId: string | null;
  /** Chart allergy vs a due or newly added order; shown on ALLERGY until acknowledged. */
  alert: { allergy: string; drug: string } | null;
  /** `${patientId}:${medId}` of conflicts the nurse acknowledged. */
  ackAlerts: string[];
  /** WOUND_SEND dispatched, server ack not back yet. */
  sending: boolean;
  /** The mic is live (Deepgram or browser speech): the strip says LISTENING. */
  listening: boolean;
  /** The mic was reported NOT live (live=false / unavailable). Hints then name keys, not spoken words. Unreported = false. */
  micOff: boolean;
}

export function initialState(patients: Patient[], assigned: string[] | null = null): GState {
  return {
    screen: 'G1', patients, assigned, scanFail: null, patientId: null, session: EMPTY_SESSION, offline: false, dueCursor: 0,
    pending: [], lastLogKey: null, logged: null, prev: null, returnTo: null, fadeAtMs: null, toast: null,
    cooldowns: {}, captureSeq: 0, captureId: null, stage: 'upload', assessment: null, notice: null,
    wristbandId: null, alert: null, ackAlerts: [], sending: false, listening: false, micOff: false,
  };
}

// ---------- events and effects ----------
export type GEvent =
  | { type: 'tick' }
  | { type: 'reset' }
  | { type: 'session'; session: SessionCtx }
  | { type: 'offline'; offline: boolean }
  | { type: 'scanRead' }
  | { type: 'scanLock'; payload: string; force?: boolean }
  | { type: 'scanTimeout' }
  | { type: 'intent'; intent: Intent; force?: boolean; via?: 'voice' | 'tap' }
  | { type: 'heard'; intent: Intent }
  /** The session's activePatientId changed elsewhere (the phone scanned). Loads that card; dispatches nothing. */
  | { type: 'adopt'; patientId: string }
  | { type: 'listening'; on: boolean }
  | { type: 'woundSent' }
  | { type: 'sendFailed'; message: string }
  | { type: 'tap' }
  | { type: 'longPress' }
  | { type: 'voiceMiss' }
  | { type: 'toast'; text: string }
  | { type: 'jump'; n: number }
  | { type: 'logConflict'; key: string; message: string }
  | { type: 'photoResult'; captureId: string; ok: boolean }
  | { type: 'assessment'; captureId: string; assessment: Assessment }
  | { type: 'notice'; notice: Notice };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** An action the glasses want sent; the host adds `device` and `clientEventId`. */
export type GlassesAction = DistributiveOmit<Action, 'clientEventId' | 'device'>;

export type Effect =
  | { type: 'dispatch'; action: GlassesAction; key?: string; track?: 'send' }
  | { type: 'capturePhoto'; captureId: string }
  | { type: 'uploadPhoto'; captureId: string }
  | { type: 'assess'; captureId: string };

export interface Result { state: GState; effects: Effect[] }

// ---------- selectors (used by the reducer and the copy builders) ----------
export function currentPatient(s: GState): Patient | null {
  return s.patients.find((p) => p.id === s.patientId) ?? null;
}

export function demoNowMin(session: SessionCtx, nowMs: number): number {
  const base = session.clock
    ? session.clock.baseMin + Math.max(0, Math.floor((nowMs - session.clock.startedAtMs) / 60_000))
    : DEMO_START_MIN;
  return base + session.clockOffsetMin;
}

/** The chart meds plus any Director-injected orders for this patient. */
export function medsOf(s: GState, p: Patient): Med[] {
  return [...p.meds, ...(s.session.extraOrders?.[p.id] ?? [])];
}

function isGiven(s: GState, key: string): boolean {
  return s.session.medStatus[key]?.status === 'given' || s.pending.includes(key);
}

/** An allergy-conflicting order the wearer already acknowledged: it must never be the hero while a real med is waiting. */
function isAckedConflict(s: GState, p: Patient, m: Med): boolean {
  return s.ackAlerts.includes(`${p.id}:${m.id}`) && checkAllergy(p, m) !== null;
}

function ungiven(s: GState, p: Patient): Med[] {
  const rank = (m: Med): number => (isAckedConflict(s, p, m) ? 1 : 0);
  return medsOf(s, p)
    .filter((m) => !isGiven(s, `${p.id}:${m.id}`))
    .sort((a, b) => rank(a) - rank(b) || hhmmToMinutes(a.dueAt) - hhmmToMinutes(b.dueAt));
}

/** Meds that are not given and due within the 30-minute actionable window. */
export function dueMeds(s: GState, nowMs: number): Med[] {
  const p = currentPatient(s);
  if (!p) return [];
  const nowMin = demoNowMin(s.session, nowMs);
  return ungiven(s, p).filter((m) => hhmmToMinutes(m.dueAt) - nowMin <= ACTIONABLE_WINDOW_MIN);
}

/** Earliest ungiven med that is not yet actionable, or null. */
export function nextMed(s: GState, nowMs: number): Med | null {
  const p = currentPatient(s);
  if (!p) return null;
  const nowMin = demoNowMin(s.session, nowMs);
  return ungiven(s, p).find((m) => hhmmToMinutes(m.dueAt) - nowMin > ACTIONABLE_WINDOW_MIN) ?? null;
}

export function shownMed(s: GState, nowMs: number): Med | null {
  const due = dueMeds(s, nowMs);
  return due.length ? due[Math.min(Math.max(s.dueCursor, 0), due.length - 1)] : null;
}

// ---------- reducer ----------
const NONE: Effect[] = [];

function home(s: GState): ScreenId {
  return s.patientId ? 'G4' : 'G1';
}

function enter(s: GState, screen: ScreenId, now: number, patch: Partial<GState> = {}): GState {
  const fade = FADE_MS[screen];
  return { ...s, ...patch, screen, scanFail: screen === 'G3' ? (patch.scanFail ?? null) : null, toast: null, fadeAtMs: fade === undefined ? null : now + fade };
}

function isAssigned(s: GState, p: Patient): boolean {
  return s.assigned === null || s.assigned.includes(p.id);
}

function loadPatient(s: GState, p: Patient, now: number, wristband = false): GState {
  const next = enter(s, 'G4', now, {
    patientId: p.id, dueCursor: 0, assessment: null, notice: null, captureId: null, sending: false,
    wristbandId: wristband ? p.id : null, alert: null,
  });
  return withConflictAlert(next, now);
}

/** First due or newly added order that conflicts with a chart allergy and was not acknowledged. */
export function findConflict(s: GState, nowMs: number): { key: string; allergy: string; drug: string } | null {
  const p = currentPatient(s);
  if (!p) return null;
  for (const m of dueMeds(s, nowMs)) {
    const key = `${p.id}:${m.id}`;
    if (s.ackAlerts.includes(key)) continue;
    const hit = checkAllergy(p, m);
    if (hit) return { key, ...hit };
  }
  return null;
}

/** Never blocks: it only shows ALLERGY (until "acknowledge") on top of whatever the nurse was doing. */
function withConflictAlert(s: GState, now: number): GState {
  if (!s.patientId || s.screen === 'ALLERGY' || s.screen === 'H3' || SCAN_SCREENS.includes(s.screen)) return s;
  const c = findConflict(s, now);
  if (!c) return s;
  const prev: ScreenId = s.screen === 'G5' || s.screen === 'G6' || s.screen === 'G9' ? home(s) : s.screen;
  return enter(s, 'ALLERGY', now, { prev, alert: { allergy: c.allergy, drug: c.drug } });
}

function done(s: GState): Result {
  return { state: s, effects: NONE };
}

function toast(s: GState, text: string, now: number): GState {
  return { ...s, toast: { text, untilMs: now + TOAST_MS } };
}

function onTick(s: GState, now: number): Result {
  let n = s;
  if (n.toast && now >= n.toast.untilMs) n = { ...n, toast: null };
  if (n.fadeAtMs !== null && now >= n.fadeAtMs) {
    if (n.screen === 'G5' || n.screen === 'G6') n = enter(n, home(n), now);
    else if (n.screen === 'G9') n = enter(n, n.returnTo ?? home(n), now, { returnTo: null, notice: null });
    else n = { ...n, fadeAtMs: null };
  }
  return done(n);
}

function cooldownOk(s: GState, patientId: string, trigger: string, now: number): boolean {
  const last = s.cooldowns[`${patientId}:${trigger}`];
  return last === undefined || now - last >= COOLDOWN_MS;
}

const TRIGGER_FROM: readonly ScreenId[] = ['G4', 'G5', 'G6', 'G7', 'G9', 'VITALS'];
const OVERLAY_FROM: readonly ScreenId[] = ['G4', 'G5', 'G6', 'G7', 'G8', 'G9'];

function onIntent(s: GState, intent: Intent, now: number, force: boolean, via: 'voice' | 'tap' = 'voice'): Result {
  const p = currentPatient(s);
  const scr = s.screen;

  if (scr === 'ALLERGY') {
    if (intent !== 'acknowledge') return done(s);
    const c = s.alert ? findConflict({ ...s, alert: null }, now) : null;
    const ack = c ? [...s.ackAlerts, c.key] : s.ackAlerts;
    const next = enter(s, s.prev ?? home(s), now, { prev: null, alert: null, ackAlerts: ack });
    if (!c || !p) return done(next);
    // Record it on the server so another wearer does not re-alert and the phone can show it. Never consent to give the drug.
    return { state: next, effects: [{ type: 'dispatch', action: { type: 'ALLERGY_ACK', patientId: p.id, medKey: c.key.slice(p.id.length + 1), via: via === 'tap' ? 'tap' : 'voice' } }] };
  }

  switch (intent) {
    case 'done': {
      if (scr !== 'G4' || !p) return done(s);
      const med = shownMed(s, now);
      if (!med) return done(s); // None due: "done" is disabled
      // The server refuses an allergy conflict without allergyConfirmed (phone only). Do not even try from the glasses.
      if (checkAllergy(p, med)) return done(toast(s, ALLERGY_CONFIRM_PHONE, now));
      const key = `${p.id}:${med.id}`;
      const at = longTime(demoNowMin(s.session, now));
      const next = enter(s, 'G5', now, {
        pending: [...s.pending, key], lastLogKey: key, logged: { name: `${med.name} ${med.dose}`, at },
      });
      return {
        state: next,
        effects: [{
          type: 'dispatch', key,
          action: { type: 'LOG_MED', patientId: p.id, medKey: med.id, via, ...(s.wristbandId === p.id ? { scanLocked: true } : {}) },
        }],
      };
    }
    case 'next': {
      const due = dueMeds(s, now);
      if (scr !== 'G4' || due.length < 2) return done(s);
      return done({ ...s, dueCursor: (Math.min(s.dueCursor, due.length - 1) + 1) % due.length });
    }
    case 'undo': {
      if (!p || (scr !== 'G5' && !(scr === 'G4' && s.session.hasLastLog))) return done(s);
      const pending = s.lastLogKey ? s.pending.filter((k) => k !== s.lastLogKey) : s.pending;
      const next = scr === 'G5' ? enter(s, 'G4', now, { pending, dueCursor: 0 }) : { ...s, pending };
      return { state: next, effects: [{ type: 'dispatch', action: { type: 'UNDO_LAST_MED' } }] };
    }
    case 'vitals': {
      if (!p || !(OVERLAY_FROM.includes(scr) && scr !== 'G9')) return done(s);
      return done(enter(s, 'VITALS', now, { prev: scr === 'G5' || scr === 'G6' ? 'G4' : scr }));
    }
    case 'close':
      return done(close(s, now));
    case 'pain': {
      if (!p || p.prn.length === 0 || !cooldownOk(s, p.id, 'pain', now)) return done(s);
      if (!(TRIGGER_FROM.includes(scr) || (force && scr !== 'H3'))) return done(s);
      return done(enter(s, 'G6', now, { cooldowns: { ...s.cooldowns, [`${p.id}:pain`]: now } }));
    }
    case 'wound': {
      if (!p || !p.wound || !(force || cooldownOk(s, p.id, 'wound', now))) return done(s); // a Director-forced trigger skips the cooldown
      if (!(TRIGGER_FROM.includes(scr) || (force && scr !== 'H3'))) return done(s);
      return done(enter(s, 'G7', now, { cooldowns: { ...s.cooldowns, [`${p.id}:wound`]: now } }));
    }
    case 'capture': {
      if (!p) return done(s);
      // Forced (director SIM_CAPTURE_WOUND) starts the same capture from any card, without the G7 tap.
      if (scr === 'G7' || (force && p.wound && TRIGGER_FROM.includes(scr))) return startCapture(s, p, now);
      return done(s);
    }
    case 'retry': {
      if (scr !== 'H3' || s.stage !== 'failed' || !s.captureId) return done(s);
      return { state: { ...s, stage: 'upload' }, effects: [{ type: 'uploadPhoto', captureId: s.captureId }] };
    }
    case 'send': {
      const ok = scr === 'G8' || (force && (scr === 'G7' || scr === 'H3'));
      if (!ok || !p || s.sending) return done(s);
      const a = s.assessment;
      if (!s.captureId || !a || a.source === 'unavailable') return done(toast(s, 'Nothing to send', now));
      // Stay on G8 until the server accepts WOUND_SEND; only then does the glasses say "Sent".
      return {
        state: { ...s, sending: true },
        effects: [{ type: 'dispatch', track: 'send', action: { type: 'WOUND_SEND', captureId: s.captureId, draftNote: a.draftNote } }],
      };
    }
    case 'allergy': {
      if (!p || scr === 'G1' || scr === 'G2' || scr === 'G3') return done(s);
      return done(enter(s, 'ALLERGY', now, { alert: null, prev: scr === 'G5' || scr === 'G6' || scr === 'G9' ? home(s) : scr }));
    }
    case 'room12':
    case 'room14': {
      const room = intent === 'room12' ? '12' : '14';
      const target = s.patients.find((x) => x.room === room);
      if (!target || scr === 'H3') return done(s);
      if (!isAssigned(s, target)) return done(enter(s, 'G3', now, { scanFail: 'unassigned' }));
      return done(loadPatient(s, target, now)); // local only: no SET_ACTIVE_PATIENT
    }
    case 'acknowledge':
      return done(s);
  }
}

function startCapture(s: GState, _p: Patient, now: number): Result {
  const seq = s.captureSeq + 1;
  // Unguessable (the photo is served by id): crypto-random via makeUuid, which falls back to Math.random only without WebCrypto.
  const captureId = `cap-${makeUuid().replace(/-/g, '')}`;
  return {
    state: enter(s, 'H3', now, { captureSeq: seq, captureId, stage: 'upload', assessment: null }),
    effects: [{ type: 'capturePhoto', captureId }],
  };
}

function close(s: GState, now: number): GState {
  switch (s.screen) {
    case 'G2':
    case 'G3':
      return enter(s, 'G1', now);
    case 'G4':
      return enter(s, 'G1', now, { patientId: null, dueCursor: 0 }); // leaves the room, local only
    case 'G5':
    case 'G6':
    case 'G7':
    case 'H3':
    case 'G8':
      return enter(s, 'G4', now, { captureId: null, assessment: null });
    case 'G9':
      return enter(s, s.returnTo ?? home(s), now, { returnTo: null, notice: null });
    case 'VITALS':
      return enter(s, s.prev ?? home(s), now, { prev: null });
    default:
      return s;
  }
}

function onTap(s: GState, now: number): Result {
  switch (s.screen) {
    case 'G3': return done(enter(s, 'G1', now));
    case 'G4': return onIntent(s, 'done', now, false, 'tap');
    case 'G7': return onIntent(s, 'capture', now, false);
    case 'H3': return onIntent(s, 'retry', now, false);
    case 'G8': return onIntent(s, 'send', now, false);
    case 'G5': case 'G6': case 'G9': case 'VITALS': return done(close(s, now));
    default: return done(s); // ALLERGY needs "acknowledge", never a tap
  }
}

function onLongPress(s: GState, now: number): Result {
  // Mic off: a deliberate long press is the only way to acknowledge (a tap never is). Mic live: speech only.
  if (s.screen === 'ALLERGY') return s.micOff ? onIntent(s, 'acknowledge', now, false, 'tap') : done(s);
  if (s.screen === 'G4' && dueMeds(s, now).length > 1) return onIntent(s, 'next', now, false);
  return done(close(s, now));
}

function jump(s: GState, n: number, now: number): Result {
  const cur = currentPatient(s);
  const pick = (ok: (p: Patient) => boolean): Patient | null =>
    cur && ok(cur) ? cur : (s.patients.find(ok) ?? null);
  switch (n) {
    case 1: return done(enter(s, 'G1', now, { patientId: null }));
    case 2: return done(enter(s, 'G2', now, { patientId: null }));
    case 3: return done(enter(s, 'G3', now, { patientId: null }));
    case 4: {
      const p = pick(() => true);
      return done(p ? loadPatient(s, p, now) : s);
    }
    case 5: {
      const p = pick((x) => x.meds.length > 0);
      if (!p) return done(s);
      const med = ungiven(s, p)[0] ?? p.meds[0];
      const at = longTime(demoNowMin(s.session, now));
      return done(enter(s, 'G5', now, { patientId: p.id, logged: { name: `${med.name} ${med.dose}`, at } }));
    }
    case 6: {
      const p = pick((x) => x.prn.length > 0);
      return done(p ? enter(s, 'G6', now, { patientId: p.id }) : s);
    }
    case 7: {
      const p = pick((x) => x.wound !== null);
      return done(p ? enter(s, 'G7', now, { patientId: p.id }) : s);
    }
    case 8: {
      const p = pick((x) => x.wound !== null);
      return done(p ? enter(s, 'G8', now, { patientId: p.id, assessment: s.assessment ?? FALLBACK_ASSESSMENT, sending: false }) : s);
    }
    default: return done(s);
  }
}

export function reduce(s: GState, e: GEvent, now: number): Result {
  switch (e.type) {
    case 'tick':
      return onTick(s, now);
    case 'reset': {
      const fresh = initialState(s.patients, s.assigned);
      return done({ ...fresh, offline: s.offline });
    }
    case 'session': {
      const pending = s.pending.filter((k) => e.session.medStatus[k]?.status !== 'given');
      // Alerts another wearer (or an earlier session of this one) acknowledged must not re-alert here.
      const seeded = (e.session.allergyAcks ?? []).filter((k) => !s.ackAlerts.includes(k));
      const ackAlerts = seeded.length ? [...s.ackAlerts, ...seeded] : s.ackAlerts;
      return done(withConflictAlert({ ...s, session: e.session, pending, ackAlerts }, now)); // a newly added order can conflict
    }
    case 'offline':
      return done(s.offline === e.offline ? s : { ...s, offline: e.offline });
    case 'scanRead':
      return done(s.screen === 'G1' || s.screen === 'G3' ? enter(s, 'G2', now) : s);
    case 'scanTimeout':
      return done(s.screen === 'G1' || s.screen === 'G2' ? enter(s, 'G3', now) : s);
    case 'scanLock': {
      const open = SCAN_SCREENS.includes(s.screen) || (e.force === true && s.screen !== 'ALLERGY' && s.screen !== 'H3');
      if (!open) return done(s);
      const p = s.patients.find((x) => x.qrPayload === e.payload || x.id === e.payload); // a typed id works like a scan
      if (!p) return done(enter(s, 'G3', now, { scanFail: 'unknown' }));
      if (!isAssigned(s, p)) return done(enter(s, 'G3', now, { scanFail: 'unassigned' })); // no SET_ACTIVE_PATIENT
      return {
        state: loadPatient(s, p, now, e.force !== true), // a Director scan is not a wristband match
        effects: [{ type: 'dispatch', action: { type: 'SET_ACTIVE_PATIENT', patientId: p.id } }],
      };
    }
    case 'intent':
      return onIntent(s, e.intent, now, e.force === true, e.via);
    case 'adopt': {
      const p = s.patients.find((x) => x.id === e.patientId);
      if (!p || s.patientId === p.id || s.screen === 'H3' || s.screen === 'ALLERGY') return done(s);
      if (!isAssigned(s, p)) return done(enter(s, 'G3', now, { scanFail: 'unassigned' }));
      return done(loadPatient(s, p, now)); // no SET_ACTIVE_PATIENT: the server already has it (no echo loop)
    }
    case 'heard':
      if (!s.patientId || s.screen === 'ALLERGY' || s.screen === 'H3') return done(s);
      return done({ ...s, toast: { text: `Heard: ${e.intent === 'room12' ? 'room 12' : e.intent === 'room14' ? 'room 14' : e.intent}`, untilMs: now + HEARD_MS } });
    case 'listening':
      return done(s.listening === e.on && s.micOff === !e.on ? s : { ...s, listening: e.on, micOff: !e.on });
    case 'woundSent': {
      const p = currentPatient(s);
      if (!s.sending || !p) return done(s);
      return done(enter(s, 'G9', now, {
        sending: false, notice: { label: 'Wound note', text: `Sent to ${p.attending}` }, returnTo: 'G4', assessment: null, captureId: null,
      }));
    }
    case 'sendFailed':
      return done(toast({ ...s, sending: false }, e.message, now));
    case 'tap':
      return onTap(s, now);
    case 'longPress':
      return onLongPress(s, now);
    case 'voiceMiss':
      if (!s.patientId || s.screen === 'ALLERGY' || s.screen === 'H3') return done(s);
      return done(toast(s, MISS_TOAST, now));
    case 'jump':
      return jump(s, e.n, now);
    case 'toast':
      return done(s.screen === 'ALLERGY' ? s : toast(s, e.text, now));
    case 'logConflict': {
      const pending = s.pending.filter((k) => k !== e.key);
      const back = s.screen === 'G5' ? enter(s, 'G4', now, { pending, dueCursor: 0 }) : { ...s, pending };
      return done(s.screen === 'ALLERGY' ? { ...s, pending } : toast(back, e.message, now));
    }
    case 'photoResult': {
      if (s.screen !== 'H3' || s.captureId !== e.captureId) return done(s);
      if (!e.ok) return done({ ...s, stage: 'failed' });
      return { state: { ...s, stage: 'assess' }, effects: [{ type: 'assess', captureId: e.captureId }] };
    }
    case 'assessment': {
      if (s.screen !== 'H3' || s.captureId !== e.captureId) return done(s);
      return done(enter(s, 'G8', now, { assessment: e.assessment }));
    }
    case 'notice': {
      if (s.screen === 'H3' || s.screen === 'ALLERGY') return done(s);
      if (s.screen === 'G9' && s.notice?.text === e.notice.text) return done(s); // our own echo (the ack already showed it)
      const returnTo =
        s.screen === 'G9' ? s.returnTo : s.screen === 'G5' || s.screen === 'G6' ? home(s) : s.screen;
      return done(enter(s, 'G9', now, { notice: e.notice, returnTo }));
    }
  }
}

// ---------- view state (pushed into the session so ?mirror=1 can render it) ----------
export interface GlassesViewState {
  v: 1;
  screen: ScreenId;
  patientId: string | null;
  dueCursor: number;
  toast: string | null;
  logged: GState['logged'];
  stage: CaptureStage;
  assessment: Assessment | null;
  notice: Notice | null;
  offline: boolean;
  scanFail?: ScanFail | null;
  alert?: GState['alert'];
  sending?: boolean;
  listening?: boolean;
  micOff?: boolean;
}

export function toViewState(s: GState): GlassesViewState {
  return {
    v: 1, screen: s.screen, patientId: s.patientId, dueCursor: s.dueCursor, toast: s.toast?.text ?? null,
    logged: s.logged, stage: s.stage, assessment: s.assessment, notice: s.notice, offline: s.offline, scanFail: s.scanFail,
    alert: s.alert, sending: s.sending, listening: s.listening, micOff: s.micOff,
  };
}

const isStr = (v: unknown): v is string => typeof v === 'string';

/** Rebuilds a renderable state from an untrusted view. Returns null when it is malformed. */
export function fromViewState(view: unknown, base: GState, nowMs: number): GState | null {
  if (!view || typeof view !== 'object') return null;
  const v = view as Partial<GlassesViewState>;
  if (v.v !== 1 || !SCREEN_IDS.includes(v.screen as ScreenId)) return null;
  const patientId = isStr(v.patientId) && base.patients.some((p) => p.id === v.patientId) ? v.patientId : null;
  const asm = v.assessment;
  const assessment =
    asm && isStr(asm.finding) && isStr(asm.comparison) && isStr(asm.draftNote) ? { finding: asm.finding, comparison: asm.comparison, draftNote: asm.draftNote, source: asm.source === 'gemini' ? 'gemini' as const : asm.source === 'unavailable' ? 'unavailable' as const : 'fallback' as const } : null;
  const alert = v.alert && isStr(v.alert.allergy) && isStr(v.alert.drug) ? { allergy: v.alert.allergy, drug: v.alert.drug } : null;
  const notice = v.notice && isStr(v.notice.text) ? { text: v.notice.text, label: isStr(v.notice.label) ? v.notice.label : undefined } : null;
  const logged = v.logged && isStr(v.logged.name) && isStr(v.logged.at) ? v.logged : null;
  return {
    ...base,
    screen: v.screen as ScreenId,
    patientId,
    dueCursor: typeof v.dueCursor === 'number' && v.dueCursor >= 0 ? Math.floor(v.dueCursor) : 0,
    toast: isStr(v.toast) ? { text: v.toast, untilMs: nowMs + TOAST_MS } : null,
    logged, assessment, notice,
    scanFail: v.scanFail === 'unknown' || v.scanFail === 'unassigned' ? v.scanFail : null,
    stage: v.stage === 'assess' || v.stage === 'failed' ? v.stage : 'upload',
    alert, sending: v.sending === true, listening: v.listening === true, micOff: v.micOff === true,
    offline: base.offline,
  };
}
