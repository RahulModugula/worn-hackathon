// Pure helpers for the phone UI. No React, no network: easy to test and reuse.
import patientsJson from '../../../../data/patients.json';
import { DRESSING_LABELS } from '../../../../shared/types';
import type {
  Action, HandoffPacket, AssessmentSource, Device, FeedEntry, WoundDressing, LastMedLog, MedStatus, SessionState, TelemetryMetric, WoundCapture,
} from '../../../../shared/types';
import { hhmmToMinutes, isActionable, longTime, minutesUntil } from '../../../../shared/clock';

export interface Med { id: string; name: string; dose: string; route: string; dueAt: string; allergyClasses?: string[] }
export interface PrnMed { id: string; name: string; dose: string; lastGivenAt: string; intervalHours: number }
export interface Wound { site: string; lastChangedAt: string; intervalHours: number; note: string; previousPhoto: string }
export interface Vitals { bp: string; hr: number; tempF: number; spo2: number; takenAt: string; nextAt: string }
export interface Patient {
  id: string; qrPayload?: string; name: string; age: number; room: string; attending: string; allergies: string[];
  diabetic: boolean; glucose: { valueMgDl: number; takenAt: string } | null;
  meds: Med[]; prn: PrnMed[]; wound: Wound | null; vitals: Vitals;
}
export interface Assessment { finding: string; comparison: string; draftNote: string; source: AssessmentSource }

export interface RosterNurse { id: string; name: string }
interface PatientsFile { nurse: { id: string; name: string; assignedPatientIds?: string[] }; handoffNurses?: RosterNurse[]; patients: Patient[] }

/** Seconds an Undo stays available after a med log (server UNDO_WINDOW_MS). */
export const UNDO_WINDOW_MS = 10_000;

// JSON literal types are too narrow (e.g. `glucose: null` vs object), so cast once here.
export const NURSE = (patientsJson as unknown as PatientsFile).nurse;
/** Nurses a handoff can go to (data/patients.json handoffNurses). */
export const HANDOFF_NURSES: RosterNurse[] = (patientsJson as unknown as PatientsFile).handoffNurses ?? [];
export const PATIENTS = (patientsJson as unknown as PatientsFile).patients;

export function patientById(id: string | null | undefined): Patient | undefined {
  return id ? PATIENTS.find(p => p.id === id) : undefined;
}

/** Wristband payload to patient, the same rule the glasses use: the qrPayload or the plain patient id. */
export function patientByCode(code: string): Patient | undefined {
  return PATIENTS.find(p => p.qrPayload === code || p.id === code);
}

/** The server refuses SET_ACTIVE_PATIENT for anyone not on this nurse's list. Mirror that check before sending. */
export function isAssigned(patientId: string): boolean {
  const assigned = NURSE.assignedPatientIds;
  return !assigned || assigned.includes(patientId);
}

/** Glasses-facing device names: a voice log is a glasses log. */
export function deviceLabel(s: Pick<MedStatus, 'via' | 'by'>): string {
  const v: string | undefined = s.via ?? s.by;
  if (v === 'glasses' || v === 'voice') return 'glasses';
  if (v === 'director') return 'director';
  return 'phone';
}

export function medStatusOf(state: SessionState | null, patientId: string, medId: string): MedStatus | undefined {
  return state?.medStatus[`${patientId}:${medId}`];
}

/** Exact conflict copy from FRD section 2: `Already given {time} via {device}`. */
export function conflictText(s: MedStatus): string {
  return `Already given ${s.givenAtLabel ?? 'earlier'} via ${deviceLabel(s)}`;
}

export function givenText(s: MedStatus): string {
  return `✓ ${s.givenAtLabel ?? ''} · via ${deviceLabel(s)}`;
}

export interface MedRow { med: Med; dueMin: number; given: MedStatus | undefined }

/** Chart meds plus Director-injected orders (SIM_ADD_CONFLICT_ORDER), so the phone can show and confirm an allergen order. */
export function medsWithOrders(p: Patient, state: SessionState | null): Med[] {
  const extra = state?.extraOrders && Object.hasOwn(state.extraOrders, p.id) ? state.extraOrders[p.id] : [];
  return [...p.meds, ...extra];
}

/** The glasses acknowledged this allergy alert: who, and when (demo clock label). */
export function allergyAcksFor(state: SessionState | null, patientId: string): { key: string; label: string; device: Device }[] {
  return (state?.allergyAcks ?? []).filter(a => a.key.startsWith(`${patientId}:`)).map(a => ({ key: a.key, label: a.label, device: a.device }));
}

export function medRows(p: Patient, state: SessionState | null): MedRow[] {
  return medsWithOrders(p, state).map(med => ({ med, dueMin: hhmmToMinutes(med.dueAt), given: medStatusOf(state, p.id, med.id) }));
}

/** Soonest med not yet given, or null when all are given. */
export function nextDue(p: Patient, state: SessionState | null): MedRow | null {
  const open = medRows(p, state).filter(r => r.given?.status !== 'given');
  return open.sort((a, b) => a.dueMin - b.dueMin)[0] ?? null;
}

/** Every med not yet given, soonest first. */
export function openMeds(p: Patient, state: SessionState | null): MedRow[] {
  return medRows(p, state).filter(r => r.given?.status !== 'given').sort((a, b) => a.dueMin - b.dueMin);
}

/** Countdown copy. `nowMin` is null before the shift starts. */
export function countdownText(mins: number | null): string {
  if (mins === null) return 'Start shift to see times';
  if (mins < 0) return `Overdue ${-mins} min`;
  if (isActionable(mins)) return mins === 0 ? 'Due now' : `Due now · ${mins} min left`;
  return `Due in ${mins} min`;
}

export function minutesLeft(dueMin: number, nowMin: number | null): number | null {
  return nowMin === null ? null : minutesUntil(dueMin, nowMin);
}

/** True when a med is more than the actionable window (30 min) away. Unknown (false) before the shift starts. */
export function isNotYetDue(dueMin: number, nowMin: number | null): boolean {
  return nowMin !== null && !isActionable(minutesUntil(dueMin, nowMin));
}

/** Patients ordered by their soonest open med. Patients with nothing open go last. */
export function sortedPatients(state: SessionState | null): { patient: Patient; next: MedRow | null }[] {
  return PATIENTS.map(patient => ({ patient, next: nextDue(patient, state) }))
    .sort((a, b) => (a.next?.dueMin ?? Infinity) - (b.next?.dueMin ?? Infinity));
}

export function prnNextMin(p: PrnMed): number {
  return hhmmToMinutes(p.lastGivenAt) + p.intervalHours * 60;
}

export function woundDueMin(w: Wound): number {
  return hhmmToMinutes(w.lastChangedAt) + w.intervalHours * 60;
}

/** Clock label for a wound or vitals time, e.g. `9:00 PM`. */
export function clockLabel(minOfDay: number): string {
  return longTime(minOfDay);
}

/**
 * The assessment on a capture, or null while it is still waiting for one (upload failed or in flight).
 * `unavailable` captures have no finding text, so they still return an Assessment (the notice is rendered instead).
 */
export function captureAssessment(c: WoundCapture): Assessment | null {
  const source: AssessmentSource = c.assessmentSource ?? 'fallback';
  if (source === 'unavailable') return { finding: '', comparison: '', draftNote: c.draftNote, source };
  return c.finding ? { finding: c.finding, comparison: c.comparison, draftNote: c.draftNote, source } : null;
}

/**
 * Plain-English label for a wound result. Only the real model earns "AI result"; a no-AI fallback or a
 * missing assessment is never presented as an AI finding.
 */
export function assessmentLabel(source: AssessmentSource | undefined): string {
  if (source === 'gemini') return 'AI result';
  if (source === 'unavailable') return 'Assessment unavailable';
  return 'No AI review';
}

export function latestCapture(state: SessionState | null): WoundCapture | null {
  const list = state?.woundCaptures ?? [];
  return list.length ? list[list.length - 1] : null;
}

/** The newest capture waiting for this nurse to save or send. Status lives on the server, shared by every device. */
export function pendingReview(state: SessionState | null): WoundCapture | null {
  const c = latestCapture(state);
  return c && c.status === 'pending_review' ? c : null;
}

/**
 * Milliseconds left in the Undo window, measured on the PHONE clock only: `receivedAtMs` is when this phone
 * first saw the log. The server's `acceptedAtMs` is never compared with the phone clock, so skew of any size
 * cannot shorten or stretch the countdown (the server still enforces the real window).
 */
export function undoRemainingSinceReceipt(receivedAtMs: number, nowMs: number): number {
  return Math.max(0, UNDO_WINDOW_MS - Math.max(0, nowMs - receivedAtMs));
}

/** What the last med log was, for the Undo label, e.g. "Metformin 500 mg". Null if unknown. */
export function undoLabel(log: LastMedLog | null): string | null {
  if (!log) return null;
  const [patientId, medId] = log.key.split(':');
  const med = patientById(patientId)?.meds.find(m => m.id === medId);
  return med ? `${med.name} ${med.dose}` : null;
}

/** Verification chain for a P4 event (chips), from the server feed entry with the same seq. */
export function chainFor(feed: FeedEntry[] | undefined, seq: number): string[] {
  return feed?.find(f => f.seq === seq)?.chain ?? [];
}

export const DEVICE_LABELS: Record<Device, string> = { glasses: 'glasses', phone: 'phone', director: 'director' };

/** Phone-facing copy for a log entry. */
export function eventLabel(type: string): string {
  const map: Record<string, string> = {
    START_SHIFT: 'Shift started',
    SET_ACTIVE_PATIENT: 'Patient loaded',
    LOG_MED: 'Med logged',
    UNDO_LAST_MED: 'Med undone',
    WOUND_CAPTURED: 'Wound photo taken',
    WOUND_RETRY_UPLOAD: 'Photo re-sent',
    WOUND_SAVE: 'Wound saved to chart',
    WOUND_SEND: 'Wound sent to doctor',
    DR_REPLY: 'Doctor replied',
    SIM_CAPTURE_WOUND: 'Photo captured (sim)',
    SET_GLASSES_NOTICE: 'Glasses notice',
    SEND_TO_PHONE: 'Message to phone',
    RESET_SESSION: 'Demo reset',
    ALLERGY_ACK: 'Allergy alert acknowledged',
    WOUND_SET_DRESSING: 'Dressing documented',
    HANDOFF_OFFER: 'Handoff offered',
    HANDOFF_READBACK: 'Critical item read back',
    HANDOFF_ACCEPT: 'Handoff accepted',
  };
  const scan = /^SIM_SCAN_RM_(\d+)$/.exec(type);
  if (scan) return `Wristband scan simulated, Rm ${scan[1]}`;
  if (map[type]) return map[type];
  const words = type.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export interface LatencySummary { metric: TelemetryMetric; label: string; n: number; p50: number; max: number }
const METRIC_LABELS: Record<TelemetryMetric, string> = {
  scanToCardMs: 'Scan to card',
  doneToAckMs: 'Done to phone',
  assessMs: 'Photo to assessment',
  outboxQueuedMs: 'Offline to flushed',
};

/** p50 and max per metric from the server's rolling samples. Metrics with no samples are left out. */
export function latencySummaries(telemetry: SessionState['telemetry']): LatencySummary[] {
  if (!telemetry) return [];
  const out: LatencySummary[] = [];
  for (const metric of Object.keys(METRIC_LABELS) as TelemetryMetric[]) {
    const xs = (telemetry[metric] ?? []).filter(x => Number.isFinite(x)).slice().sort((a, b) => a - b);
    if (xs.length === 0) continue;
    out.push({ metric, label: METRIC_LABELS[metric], n: xs.length, p50: xs[Math.floor((xs.length - 1) / 2)], max: xs[xs.length - 1] });
  }
  return out;
}

/** An Action without clientEventId (the sync client adds it). Distributes over the union. */
export type ActionInput = Action extends infer U ? (U extends unknown ? Omit<U, 'clientEventId'> : never) : never;
export type Send = (a: ActionInput) => void;

/** Compact relative time for cards: `in 18 min`, `in 4 h 18 min`, `now`, `5 min late`. Null before the shift starts. */
export function relativeDue(mins: number | null): string {
  if (mins === null) return '';
  if (mins < 0) return `${-mins} min late`;
  if (mins === 0) return 'now';
  if (mins < 60) return `in ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `in ${h} h` : `in ${h} h ${m} min`;
}

export type MedGroup = 'due' | 'upcoming' | 'given';

/** Which list a med belongs to. Before the shift starts nothing can be "due now", so open meds are upcoming. */
export function medGroupOf(row: MedRow, nowMin: number | null): MedGroup {
  if (row.given?.status === 'given') return 'given';
  return nowMin !== null && !isNotYetDue(row.dueMin, nowMin) ? 'due' : 'upcoming';
}

/** Reasons a nurse can pick when giving a med before its window opens. */
export const EARLY_REASONS = [
  'Prescriber approved giving it early',
  'Patient needs it now',
  'Chart time looks wrong',
  'Other, will note in the chart',
] as const;

// ---------- nurse-entered dressing documentation (a documentation aid; nothing here recommends an interval) ----------

const DRESSING_LINE_PREFIX = 'Dressing (documented by nurse):';

/** `Hydrogel · Changed 2:05 PM · due 2:05 PM`, `... · due per protocol`, or just `None`. */
export function dressingSummary(d: WoundDressing): string {
  const name = DRESSING_LABELS[d.type];
  if (d.type === 'none' || d.changedAtMin === undefined) return name;
  return `${name} · Changed ${longTime(d.changedAtMin)} · due ${d.nextDueMin === null ? 'per protocol' : longTime(d.nextDueMin)}`;
}

/** The line added to the draft note on Save and Send. */
export function dressingNoteLine(d: WoundDressing): string {
  const name = DRESSING_LABELS[d.type];
  if (d.type === 'none' || d.changedAtMin === undefined) return `${DRESSING_LINE_PREFIX} ${name}.`;
  const next = d.nextDueMin === null ? 'next change per protocol' : `next due ${longTime(d.nextDueMin)}`;
  return `${DRESSING_LINE_PREFIX} ${name}. Changed ${longTime(d.changedAtMin)}; ${next}.`;
}

/** Draft note with exactly one dressing line at the end (an older one is replaced). Untouched when nothing was documented. */
export function withDressingLine(draft: string, d: WoundDressing | undefined): string {
  if (!d) return draft;
  const kept = draft.split('\n').filter(l => !l.startsWith(DRESSING_LINE_PREFIX)).join('\n').replace(/\s+$/, '');
  return kept ? `${kept}\n${dressingNoteLine(d)}` : dressingNoteLine(d);
}

/** Minutes since midnight to an `<input type="time">` value (`14:05`), and back. Null when blank or malformed. */
export function minToTimeInput(min: number): string {
  const m = ((Math.floor(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
export function timeInputToMin(v: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(v);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// ---------- handoff (FRD v2.2 section 4): the phone only displays and dispatches; the server decides ----------

/** `?nurse=N-02` to a roster nurse; anything not on the roster means the default signed-in nurse. */
export function nurseFromId(id: string | null | undefined): RosterNurse {
  return HANDOFF_NURSES.find(n => n.id === id) ?? { id: NURSE.id, name: NURSE.name };
}

/** The next roster nurse after `meId` (wraps), or undefined when the roster has nobody else. */
export function nextNurse(meId: string): RosterNurse | undefined {
  const others = HANDOFF_NURSES.filter(n => n.id !== meId);
  if (others.length === 0) return undefined;
  const i = HANDOFF_NURSES.findIndex(n => n.id === meId);
  return HANDOFF_NURSES.slice(i + 1).find(n => n.id !== meId) ?? others[0];
}

export function nurseName(id: string): string {
  return HANDOFF_NURSES.find(n => n.id === id)?.name ?? id;
}

/** The open offer waiting for this nurse (newest), or null. */
export function offeredTo(state: SessionState | null, nurseId: string): HandoffPacket | null {
  const list = (state?.handoffs ?? []).filter(h => h.status === 'offered' && h.toNurseId === nurseId);
  return list.length ? list[list.length - 1] : null;
}

/** Newest packet this nurse offered for a patient, or null. */
export function offeredBy(state: SessionState | null, nurseId: string, patientId: string): HandoffPacket | null {
  const list = (state?.handoffs ?? []).filter(h => h.fromNurseId === nurseId && h.patientId === patientId);
  return list.length ? list[list.length - 1] : null;
}

/** Critical item indexes not yet read back. */
export function unreadCritical(p: HandoffPacket): number[] {
  return p.items.flatMap((it, i) => (it.critical && !p.readBack.includes(i) ? [i] : []));
}
