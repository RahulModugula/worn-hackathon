import { describe, expect, it } from 'vitest';
import patientsData from '../../../../data/patients.json';
import {
  ALLERGY_CONFIRM_PHONE, dueMeds, initialState, reduce, shownMed, type GEvent, type GState, type Med, type Patient,
} from './stateMachine';

const PATIENTS = (patientsData as unknown as { patients: Patient[] }).patients;
const P12 = PATIENTS.find((p) => p.room === '12')!;
const T0 = 1_000_000;
// Order added at demo "now" (1:42 PM), so by dueAt it sorts BEFORE Metformin at 2:00 PM: the bug.
const ORDER: Med = { id: 'X-1', name: 'Amoxicillin', dose: '250 mg', route: 'PO', dueAt: '13:42', allergyClasses: ['penicillin'] };
const SESSION = { medStatus: {}, clock: { baseMin: 822, startedAtMs: T0 }, clockOffsetMin: 0, hasLastLog: false, extraOrders: { [P12.id]: [ORDER] } };

const withOrder = (): GState => ({ ...initialState(PATIENTS), session: SESSION, patientId: P12.id, screen: 'G4' });
const ev = (s: GState, e: GEvent, now = T0) => reduce(s, e, now);

describe('allergy acknowledged, then "done" (safety)', () => {
  it('the alert shows first; acknowledging dispatches ALLERGY_ACK with via voice', () => {
    const alert = ev(withOrder(), { type: 'session', session: SESSION }).state;
    expect(alert.screen).toBe('ALLERGY');
    const r = ev(alert, { type: 'intent', intent: 'acknowledge', via: 'voice' });
    expect(r.state.screen).toBe('G4');
    expect(r.effects).toEqual([{ type: 'dispatch', action: { type: 'ALLERGY_ACK', patientId: P12.id, medKey: 'X-1', via: 'voice' } }]);
  });
  it('a long-press acknowledge (mic off) reports via tap', () => {
    const alert = ev({ ...withOrder(), micOff: true }, { type: 'session', session: SESSION }).state;
    const r = ev(alert, { type: 'longPress' });
    expect(r.effects[0]).toMatchObject({ action: { type: 'ALLERGY_ACK', via: 'tap' } });
  });
  it('after acknowledging, the conflicting order sorts LAST and the hero is the next real med', () => {
    const alert = ev(withOrder(), { type: 'session', session: SESSION }).state;
    const g4 = ev(alert, { type: 'intent', intent: 'acknowledge' }).state;
    const due = dueMeds(g4, T0);
    expect(due.map((m) => m.id)).toEqual(['M-1', 'X-1']);
    expect(shownMed(g4, T0)?.id).toBe('M-1');
  });
  it('"done" never logs the allergen: Metformin goes first, then the allergen is refused with a toast and no dispatch', () => {
    const alert = ev(withOrder(), { type: 'session', session: SESSION }).state;
    const g4 = ev(alert, { type: 'intent', intent: 'acknowledge' }).state;
    const first = ev(g4, { type: 'intent', intent: 'done' });
    expect(first.effects[0]).toMatchObject({ action: { type: 'LOG_MED', medKey: 'M-1' } });
    // Metformin is now given; only the acknowledged allergen is left in the due list.
    const left = ev({ ...first.state, screen: 'G4' }, { type: 'session', session: { ...SESSION, medStatus: { [`${P12.id}:M-1`]: { status: 'given' as const } } } }).state;
    expect(shownMed(left, T0)?.id).toBe('X-1');
    const second = ev(left, { type: 'intent', intent: 'done' });
    expect(second.effects).toEqual([]);
    expect(second.state.toast?.text).toBe(ALLERGY_CONFIRM_PHONE);
    expect(second.state.pending).toEqual([]);
  });
  it('an unacknowledged conflict is never logged by "done" either', () => {
    const s: GState = { ...withOrder(), session: { ...SESSION, medStatus: { [`${P12.id}:M-1`]: { status: 'given' } } }, alert: null };
    const r = ev(s, { type: 'intent', intent: 'done' });
    expect(r.effects).toEqual([]);
    expect(r.state.toast?.text).toBe(ALLERGY_CONFIRM_PHONE);
  });
  it('another wearer: a session allergyAck seeds ackAlerts so the alert does not re-fire', () => {
    const seeded = { ...SESSION, allergyAcks: [`${P12.id}:X-1`] };
    const r = ev(withOrder(), { type: 'session', session: seeded });
    expect(r.state.screen).toBe('G4');
    expect(r.state.ackAlerts).toContain(`${P12.id}:X-1`);
    expect(shownMed(r.state, T0)?.id).toBe('M-1');
  });
  it('without the seeded ack the same session DOES alert (the seed is what suppresses it)', () => {
    expect(ev(withOrder(), { type: 'session', session: SESSION }).state.screen).toBe('ALLERGY');
  });
});
