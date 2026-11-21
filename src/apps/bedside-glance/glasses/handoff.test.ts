import { describe, expect, it } from 'vitest';
import patientsData from '../../../../data/patients.json';
import { screenCopy } from './copy';
import { initialState, reduce, type GEvent, type GState, type Patient } from './stateMachine';

const PATIENTS = (patientsData as unknown as { patients: Patient[] }).patients;
const P12 = PATIENTS.find((p) => p.room === '12')!;
const T0 = 1_000_000;
const SESSION = { medStatus: {}, clock: { baseMin: 822, startedAtMs: T0 }, clockOffsetMin: 0, hasLastLog: false };
const g4 = (o: Partial<GState> = {}): GState => ({ ...initialState(PATIENTS), session: SESSION, patientId: P12.id, screen: 'G4', ...o });
const ev = (s: GState, e: GEvent, now = T0) => reduce(s, e, now);

describe('handoff from the glasses', () => {
  it('the voice intent dispatches one HANDOFF_OFFER to the other nurse for the loaded patient', () => {
    const r = ev(g4(), { type: 'intent', intent: 'handoff' });
    expect(r.effects).toHaveLength(1);
    const a = (r.effects[0] as { action: Record<string, unknown> }).action;
    expect(a).toMatchObject({ type: 'HANDOFF_OFFER', patientId: P12.id, toNurseId: 'N-02' });
    expect(a.handoffId).toMatch(/^ho-[0-9a-f]{32}$/);
    expect('severity' in a).toBe(false); // never chosen for the nurse
  });
  it('the sim event carries the director payload (nurse, severity)', () => {
    const r = ev(g4(), { type: 'handoffOffer', toNurseId: 'N-02', severity: 'Unstable' });
    expect((r.effects[0] as { action: unknown }).action).toMatchObject({ type: 'HANDOFF_OFFER', toNurseId: 'N-02', severity: 'Unstable' });
  });
  it('needs a loaded patient, and never fires over the allergy alert or the camera', () => {
    expect(ev(initialState(PATIENTS), { type: 'intent', intent: 'handoff' }).effects).toEqual([]);
    expect(ev(g4({ screen: 'ALLERGY', alert: { allergy: 'Penicillin', drug: 'X' } }), { type: 'intent', intent: 'handoff' }).effects).toEqual([]);
    expect(ev(g4({ screen: 'H3' }), { type: 'handoffOffer' }).effects).toEqual([]);
  });
  it('a 60 s cooldown stops a repeated "hand off" from stacking offers', () => {
    const first = ev(g4(), { type: 'intent', intent: 'handoff' });
    expect(first.effects).toHaveLength(1);
    expect(ev(first.state, { type: 'intent', intent: 'handoff' }, T0 + 1000).effects).toEqual([]);
    expect(ev(first.state, { type: 'intent', intent: 'handoff' }, T0 + 61_000).effects).toHaveLength(1);
  });
  it('the notices render on G9 with the locked copy', () => {
    for (const text of ['Handoff sent · Marcus T.', 'Handoff accepted · Marcus T.']) {
      const s = ev(g4(), { type: 'notice', notice: { text } }).state;
      expect(s.screen).toBe('G9');
      expect(screenCopy(s, T0).rows.map((r) => r.text)).toContain(text);
    }
  });
});
