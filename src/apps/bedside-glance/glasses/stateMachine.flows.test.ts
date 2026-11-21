import { describe, expect, it } from 'vitest';
import patientsData from '../../../../data/patients.json';
import { screenCopy } from './copy';
import {
  FALLBACK_ASSESSMENT, MISS_TOAST, initialState, reduce, type GEvent, type GState, type Patient, type ScreenId,
} from './stateMachine';

const PATIENTS = (patientsData as unknown as { patients: Patient[] }).patients;
const P12 = PATIENTS.find((p) => p.room === '12')!;
const P14 = PATIENTS.find((p) => p.room === '14')!;
const T0 = 1_000_000;
const SESSION = { medStatus: {}, clock: { baseMin: 822, startedAtMs: T0 }, clockOffsetMin: 0, hasLastLog: false };

const base = (o: Partial<GState> = {}): GState => ({ ...initialState(PATIENTS), session: SESSION, ...o });
const on = (screen: ScreenId, o: Partial<GState> = {}): GState => base({ screen, patientId: P12.id, ...o });
const step = (s: GState, e: GEvent, now = T0) => reduce(s, e, now);

describe('jump (Director screen jumps)', () => {
  it('1-3 clear the patient and land on the scan screens', () => {
    for (const [n, scr] of [[1, 'G1'], [2, 'G2'], [3, 'G3']] as const) {
      const r = step(on('G4'), { type: 'jump', n });
      expect(r.state.screen).toBe(scr);
      expect(r.state.patientId).toBeNull();
    }
  });
  it('4 keeps the loaded patient, or loads the first one when none is loaded', () => {
    expect(step(on('G1', { patientId: P14.id }), { type: 'jump', n: 4 }).state.patientId).toBe(P14.id);
    expect(step(base(), { type: 'jump', n: 4 }).state.patientId).toBe(PATIENTS[0].id);
    expect(step(base({ patients: [] }), { type: 'jump', n: 4 }).state.screen).toBe('G1');
  });
  it('5 shows the logged-confirmation for an actual ungiven med of a patient who has meds', () => {
    const r = step(base(), { type: 'jump', n: 5 });
    expect(r.state.screen).toBe('G5');
    expect(r.state.logged?.name).toMatch(/Metformin|Aspirin|Atorvastatin|Lisinopril/);
    expect(r.state.fadeAtMs).toBe(T0 + 3000);
  });
  it('6, 7 and 8 pick a patient that actually has PRN or a wound, even when a different one is loaded', () => {
    expect(step(on('G4', { patientId: P14.id }), { type: 'jump', n: 6 }).state.patientId).toBe(P12.id); // Rm 14 has no PRN
    expect(step(on('G4', { patientId: P14.id }), { type: 'jump', n: 7 }).state.patientId).toBe(P12.id); // nor a wound
    const g8 = step(base(), { type: 'jump', n: 8 }).state;
    expect(g8.screen).toBe('G8');
    expect(g8.assessment).toEqual(FALLBACK_ASSESSMENT);
    expect(g8.fadeAtMs).toBeNull(); // G8 never auto-fades
  });
  it('an unknown jump number changes nothing', () => {
    const s = on('G4');
    expect(step(s, { type: 'jump', n: 99 }).state).toBe(s);
  });
});

describe('back / close, tap and long-press navigation', () => {
  it('close walks every screen back to where it came from', () => {
    expect(step(base({ screen: 'G2' }), { type: 'intent', intent: 'close' }).state.screen).toBe('G1');
    expect(step(base({ screen: 'G3' }), { type: 'intent', intent: 'close' }).state.screen).toBe('G1');
    const g4 = step(on('G4', { dueCursor: 1 }), { type: 'intent', intent: 'close' }).state;
    expect(g4.screen).toBe('G1');
    expect(g4.patientId).toBeNull();
    for (const scr of ['G5', 'G6', 'G7', 'H3', 'G8'] as const) {
      const r = step(on(scr, { captureId: 'x', assessment: FALLBACK_ASSESSMENT }), { type: 'intent', intent: 'close' }).state;
      expect([scr, r.screen, r.captureId, r.assessment]).toEqual([scr, 'G4', null, null]);
    }
    expect(step(on('G9', { returnTo: 'G7', notice: { text: 'n' } }), { type: 'intent', intent: 'close' }).state).toMatchObject({ screen: 'G7', notice: null });
    expect(step(on('G9'), { type: 'intent', intent: 'close' }).state.screen).toBe('G4');
    expect(step(on('VITALS', { prev: 'G7' }), { type: 'intent', intent: 'close' }).state.screen).toBe('G7');
    expect(step(base({ screen: 'G1' }), { type: 'intent', intent: 'close' }).state.screen).toBe('G1');
  });

  it('a tap acts per screen: back out of G3, done on G4, capture on G7, retry on H3, send on G8, dismiss overlays, never acknowledge ALLERGY', () => {
    expect(step(base({ screen: 'G3' }), { type: 'tap' }).state.screen).toBe('G1');
    expect(step(on('G4'), { type: 'tap' }).effects[0]).toMatchObject({ type: 'dispatch', action: { type: 'LOG_MED' } });
    const cap = step(on('G7'), { type: 'tap' });
    expect(cap.state.screen).toBe('H3');
    expect(cap.effects).toEqual([{ type: 'capturePhoto', captureId: cap.state.captureId }]);
    const retry = step(on('H3', { stage: 'failed', captureId: 'c1' }), { type: 'tap' });
    expect(retry.state.stage).toBe('upload');
    expect(retry.effects).toEqual([{ type: 'uploadPhoto', captureId: 'c1' }]);
    const send = step(on('G8', { captureId: 'c1', assessment: { ...FALLBACK_ASSESSMENT, source: 'gemini' } }), { type: 'tap' });
    expect(send.state.sending).toBe(true);
    expect(send.effects[0]).toMatchObject({ type: 'dispatch', track: 'send', action: { type: 'WOUND_SEND', captureId: 'c1' } });
    for (const scr of ['G5', 'G6', 'G9', 'VITALS'] as const) expect(step(on(scr), { type: 'tap' }).state.screen).toBe('G4');
    const allergy = on('ALLERGY');
    expect(step(allergy, { type: 'tap' }).state).toBe(allergy);
    expect(step(allergy, { type: 'longPress' }).state).toBe(allergy);
    const g1 = base();
    expect(step(g1, { type: 'tap' }).state).toBe(g1);
  });

  it('long-press cycles the due list on G4 when there are several, otherwise backs out', () => {
    const lateClock = { ...SESSION, clock: { baseMin: 14 * 60 + 40, startedAtMs: T0 } }; // both Rm 14 meds due
    const two = step(on('G4', { patientId: P14.id, session: lateClock }), { type: 'longPress' }).state;
    expect(two.screen).toBe('G4');
    expect(two.dueCursor).toBe(1);
    expect(step(on('G6'), { type: 'longPress' }).state.screen).toBe('G4');
  });
});

describe('send, retry, undo, vitals and allergy guards', () => {
  it('send with no assessment (or an unavailable one) toasts "Nothing to send" and never dispatches WOUND_SEND', () => {
    const none = step(on('G8', { captureId: 'c', assessment: null }), { type: 'intent', intent: 'send' });
    expect(none.effects).toEqual([]);
    expect(none.state.toast?.text).toBe('Nothing to send');
    const unavailable = step(on('G8', { captureId: 'c', assessment: { ...FALLBACK_ASSESSMENT, source: 'unavailable' } }), { type: 'intent', intent: 'send' });
    expect(unavailable.effects).toEqual([]);
  });
  it('a second send while one is in flight is ignored; a failed send clears the flag and tells the nurse', () => {
    const s = on('G8', { captureId: 'c', sending: true, assessment: FALLBACK_ASSESSMENT });
    expect(step(s, { type: 'intent', intent: 'send' }).effects).toEqual([]);
    const failed = step(s, { type: 'sendFailed', message: 'Offline' }).state;
    expect(failed.sending).toBe(false);
    expect(failed.toast?.text).toBe('Offline');
  });
  it('retry only works from a failed H3 capture', () => {
    expect(step(on('H3', { stage: 'upload', captureId: 'c' }), { type: 'intent', intent: 'retry' }).effects).toEqual([]);
    expect(step(on('G4'), { type: 'intent', intent: 'retry' }).effects).toEqual([]);
  });
  it('undo works on G5 and on G4 only when there is something to undo', () => {
    expect(step(on('G4'), { type: 'intent', intent: 'undo' }).effects).toEqual([]);
    const g4 = step(on('G4', { session: { ...SESSION, hasLastLog: true }, pending: ['k1', 'k2'], lastLogKey: 'k2' }), { type: 'intent', intent: 'undo' });
    expect(g4.effects).toEqual([{ type: 'dispatch', action: { type: 'UNDO_LAST_MED' } }]);
    expect(g4.state.pending).toEqual(['k1']);
    const g5 = step(on('G5', { pending: ['k2'], lastLogKey: 'k2' }), { type: 'intent', intent: 'undo' });
    expect(g5.state.screen).toBe('G4');
    expect(g5.state.pending).toEqual([]);
  });
  it('vitals opens from a card and returns to the right place; it never interrupts G9, G1 or G3', () => {
    expect(step(on('G5'), { type: 'intent', intent: 'vitals' }).state).toMatchObject({ screen: 'VITALS', prev: 'G4' });
    expect(step(on('G7'), { type: 'intent', intent: 'vitals' }).state).toMatchObject({ screen: 'VITALS', prev: 'G7' });
    for (const scr of ['G9', 'G1', 'G3'] as const) expect(step(on(scr), { type: 'intent', intent: 'vitals' }).state.screen).toBe(scr);
  });
  it('allergy needs a loaded patient and is unreachable from the scan screens', () => {
    expect(step(base({ screen: 'G1' }), { type: 'intent', intent: 'allergy', force: true }).state.screen).toBe('G1');
    expect(step(on('G1'), { type: 'intent', intent: 'allergy' }).state.screen).toBe('G1');
    expect(step(on('G6'), { type: 'intent', intent: 'allergy' }).state).toMatchObject({ screen: 'ALLERGY', prev: 'G4' });
  });
  it('pain and wound triggers respect cooldowns, the PRN/wound data and the forced override', () => {
    const first = step(on('G4'), { type: 'intent', intent: 'pain' }).state;
    expect(first.screen).toBe('G6');
    expect(step({ ...first, screen: 'G4', fadeAtMs: null }, { type: 'intent', intent: 'pain' }, T0 + 1000).state.screen).toBe('G4'); // cooling down
    expect(step(on('G4', { patientId: P14.id }), { type: 'intent', intent: 'pain', force: true }).state.screen).toBe('G4'); // no PRN
    expect(step(on('G4', { patientId: P14.id }), { type: 'intent', intent: 'wound', force: true }).state.screen).toBe('G4'); // no wound
    expect(step(on('G8'), { type: 'intent', intent: 'wound' }).state.screen).toBe('G8'); // not a trigger screen
    expect(step(on('G8'), { type: 'intent', intent: 'wound', force: true }).state.screen).toBe('G7'); // forced from anywhere but H3
    expect(step(on('H3'), { type: 'intent', intent: 'wound', force: true }).state.screen).toBe('H3');
  });
  it('a forced capture starts from a plain card with a wound, an unforced one does not', () => {
    expect(step(on('G4'), { type: 'intent', intent: 'capture' }).state.screen).toBe('G4');
    expect(step(on('G4'), { type: 'intent', intent: 'capture', force: true }).state.screen).toBe('H3');
    expect(step(base(), { type: 'intent', intent: 'capture', force: true }).state.screen).toBe('G1');
  });
  it('room voice commands load the room locally, refuse unassigned rooms and are ignored mid-capture', () => {
    expect(step(base(), { type: 'intent', intent: 'room14' }).state.patientId).toBe(P14.id);
    const restricted = step(base({ assigned: [P12.id] }), { type: 'intent', intent: 'room14' }).state;
    expect([restricted.screen, restricted.scanFail, restricted.patientId]).toEqual(['G3', 'unassigned', null]);
    expect(step(on('H3'), { type: 'intent', intent: 'room14' }).state.patientId).toBe(P12.id);
    const none = step(base({ patients: [] }), { type: 'intent', intent: 'room12' }).state;
    expect(none.screen).toBe('G1');
  });
});

describe('server-driven events', () => {
  it('woundSent moves to the confirmation naming the attending, only while a send is in flight', () => {
    const sent = step(on('G8', { sending: true, captureId: 'c', assessment: FALLBACK_ASSESSMENT }), { type: 'woundSent' }).state;
    expect(sent).toMatchObject({ screen: 'G9', sending: false, captureId: null, assessment: null, returnTo: 'G4' });
    expect(sent.notice?.text).toBe(`Sent to ${P12.attending}`);
    const idle = on('G8', { sending: false });
    expect(step(idle, { type: 'woundSent' }).state).toBe(idle);
  });
  it('photo and assessment results for a stale capture id are ignored', () => {
    const s = on('H3', { captureId: 'cap-2', stage: 'upload' });
    expect(step(s, { type: 'photoResult', captureId: 'cap-1', ok: true }).state).toBe(s);
    expect(step(s, { type: 'assessment', captureId: 'cap-1', assessment: FALLBACK_ASSESSMENT }).state).toBe(s);
    expect(step(s, { type: 'photoResult', captureId: 'cap-2', ok: false }).state.stage).toBe('failed');
    const ok = step(s, { type: 'photoResult', captureId: 'cap-2', ok: true });
    expect(ok.state.stage).toBe('assess');
    expect(ok.effects).toEqual([{ type: 'assess', captureId: 'cap-2' }]);
    expect(step(s, { type: 'assessment', captureId: 'cap-2', assessment: FALLBACK_ASSESSMENT }).state.screen).toBe('G8');
  });
  it('a doctor notice interrupts a card and returns to it, but never H3 or ALLERGY; our own echo is not shown twice', () => {
    const n = { label: 'Dr', text: 'Reply' };
    expect(step(on('G7'), { type: 'notice', notice: n }).state).toMatchObject({ screen: 'G9', returnTo: 'G7' });
    expect(step(on('G5'), { type: 'notice', notice: n }).state).toMatchObject({ screen: 'G9', returnTo: 'G4' });
    for (const scr of ['H3', 'ALLERGY'] as const) { const s = on(scr); expect(step(s, { type: 'notice', notice: n }).state).toBe(s); }
    const showing = on('G9', { notice: n, returnTo: 'G4' });
    expect(step(showing, { type: 'notice', notice: n }).state).toBe(showing);
    expect(step(showing, { type: 'notice', notice: { text: 'Other' } }).state.notice?.text).toBe('Other');
  });
  it('a lost med race bounces G5 back to the card with the server message, and still clears pending behind an allergy alert', () => {
    const r = step(on('G5', { pending: ['k'] }), { type: 'logConflict', key: 'k', message: 'Already given' }).state;
    expect([r.screen, r.pending, r.toast?.text]).toEqual(['G4', [], 'Already given']);
    const a = step(on('ALLERGY', { pending: ['k'] }), { type: 'logConflict', key: 'k', message: 'x' }).state;
    expect([a.screen, a.pending, a.toast]).toEqual(['ALLERGY', [], null]);
  });
  it('adopt loads a patient chosen elsewhere, but not mid-capture, over an alert, for the same patient or an unassigned one', () => {
    expect(step(base(), { type: 'adopt', patientId: P14.id }).state.patientId).toBe(P14.id);
    for (const s of [on('H3'), on('ALLERGY'), on('G4')]) expect(step(s, { type: 'adopt', patientId: s.patientId === P12.id && s.screen === 'G4' ? P12.id : 'P-zzz' }).state).toBe(s);
    expect(step(base({ assigned: [P12.id] }), { type: 'adopt', patientId: P14.id }).state.scanFail).toBe('unassigned');
  });
  it('heard, voiceMiss and toast are quiet during H3 and ALLERGY and with no patient', () => {
    const quiet = [base(), on('H3'), on('ALLERGY')];
    for (const s of quiet) {
      expect(step(s, { type: 'heard', intent: 'done' }).state).toBe(s);
      expect(step(s, { type: 'voiceMiss' }).state).toBe(s);
    }
    expect(step(on('ALLERGY'), { type: 'toast', text: 't' }).state.toast).toBeNull();
    expect(step(on('G4'), { type: 'voiceMiss' }).state.toast?.text).toBe(MISS_TOAST);
    expect(step(on('G4'), { type: 'heard', intent: 'room12' }).state.toast?.text).toBe('Heard: room 12');
    expect(step(on('G4'), { type: 'heard', intent: 'room14' }).state.toast?.text).toBe('Heard: room 14');
  });
  it('scan events only move the scan screens; a failed lock distinguishes unknown from unassigned', () => {
    expect(step(base(), { type: 'scanRead' }).state.screen).toBe('G2');
    expect(step(on('G4'), { type: 'scanRead' }).state.screen).toBe('G4');
    expect(step(base(), { type: 'scanTimeout' }).state.screen).toBe('G3');
    expect(step(on('G4'), { type: 'scanTimeout' }).state.screen).toBe('G4');
    expect(step(base(), { type: 'scanLock', payload: 'BG-P-9999' }).state.scanFail).toBe('unknown');
    expect(step(on('G4'), { type: 'scanLock', payload: P14.qrPayload }).state.patientId).toBe(P12.id); // not a scan screen
    const r = step(base(), { type: 'scanLock', payload: P14.qrPayload });
    expect(r.state.wristbandId).toBe(P14.id);
    expect(r.effects).toEqual([{ type: 'dispatch', action: { type: 'SET_ACTIVE_PATIENT', patientId: P14.id } }]);
  });
  it('offline and listening only produce a new state when the value changes; reset keeps offline', () => {
    const s = base({ offline: true, listening: true });
    expect(step(s, { type: 'offline', offline: true }).state).toBe(s);
    expect(step(s, { type: 'listening', on: true }).state).toBe(s);
    expect(step(s, { type: 'listening', on: false }).state.listening).toBe(false);
    const r = step(on('G8', { offline: true }), { type: 'reset' }).state;
    expect([r.screen, r.patientId, r.offline]).toEqual(['G1', null, true]);
  });
  it('a session update drops pending keys the server now confirms as given', () => {
    const key = `${P12.id}:M-1`;
    const r = step(on('G4', { pending: [key, 'other'] }), { type: 'session', session: { ...SESSION, medStatus: { [key]: { status: 'given' } } as never } }).state;
    expect(r.pending).toEqual(['other']);
  });
});

describe('hints follow the input tier (mic live vs off)', () => {
  const hint = (s: GState) => screenCopy(s, T0).rows.filter((r) => r.role === 'hint').map((r) => r.text).join(' | ');
  const micOff = (s: GState) => step(s, { type: 'listening', on: false }).state;
  const micOn = (s: GState) => step(micOff(s), { type: 'listening', on: true }).state;
  const gem = { ...FALLBACK_ASSESSMENT, source: 'gemini' as const, finding: 'Dressing dry.' };
  const screens: Array<[string, () => GState]> = [
    ['G4', () => on('G4')], ['G7', () => on('G7')], ['G8', () => on('G8', { captureId: 'c', assessment: gem })],
    ['ALLERGY', () => on('ALLERGY', { alert: { allergy: 'Penicillin', drug: 'Amoxicillin' } })],
  ];
  it('with no mic, no hint tells the nurse to say a word the mic cannot hear', () => {
    for (const [name, mk] of screens) {
      const h = hint(micOff(mk()));
      expect(h, name).not.toMatch(/say "(done|photo|acknowledge|send to phone)"/i);
      expect(h, name).toMatch(/tap|hold/i);
    }
    expect(hint(micOff(on('G4')))).toMatch(/Tap to confirm/);
  });
  it('with the mic live (or not yet reported) the Say hints stay', () => {
    expect(hint(on('G4'))).toBe('Say "done"');
    expect(hint(micOn(on('G4')))).toBe('Say "done"');
    expect(hint(micOn(on('G7')))).toBe('Say "photo"');
    expect(hint(micOn(screens[2][1]()))).toBe('Say "send to phone"');
    expect(hint(micOn(screens[3][1]()))).toBe('Say "acknowledge"');
  });
  it('allergy: with the mic off a long press acknowledges; with the mic on it still does nothing', () => {
    const al = on('ALLERGY', { alert: { allergy: 'Penicillin', drug: 'Amoxicillin' } });
    expect(step(micOff(al), { type: 'longPress' }).state.screen).not.toBe('ALLERGY');
    expect(step(micOn(al), { type: 'longPress' }).state.screen).toBe('ALLERGY');
    expect(step(micOff(al), { type: 'tap' }).state.screen).toBe('ALLERGY');
  });
});
