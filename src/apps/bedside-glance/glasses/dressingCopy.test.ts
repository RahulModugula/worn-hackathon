import { describe, expect, it } from 'vitest';
import patientsData from '../../../../data/patients.json';
import { screenCopy } from './copy';
import { initialState, type GState, type Patient } from './stateMachine';
import { sessionCtx } from './GlassesApp';
import { newState } from '../../../../server/sessionStore';
import type { SessionState, WoundCapture } from '../../../../shared/types';

const data = (patientsData as unknown as { patients: Patient[] }).patients;
const base = (dressings?: GState['session']['dressings']): GState => ({
  ...initialState(data), screen: 'G7', patientId: 'P-1012',
  session: { medStatus: {}, clock: { baseMin: 822, startedAtMs: 0 }, clockOffsetMin: 0, hasLastLog: false, dressings },
});
const body = (s: GState) => screenCopy(s, 0).rows.find((r) => r.role === 'body')?.text;
const hint = (s: GState) => screenCopy(s, 0).rows.find((r) => r.role === 'hint')?.text;

describe('G7 dressing line (nurse-entered)', () => {
  it('shows the chart default when nothing was documented', () => {
    expect(body(base())).toBe('Changed 9:00 AM · due 9:00 PM');
  });
  it('shows the nurse-entered times in the verbatim FRD pattern', () => {
    expect(body(base({ 'P-1012': { changedMin: 845, nextDueMin: 845 } }))).toBe('Changed 2:05 PM · due 2:05 PM');
    expect(body(base({ 'P-1012': { changedMin: 845, nextDueMin: 600 } }))).toBe('Changed 2:05 PM · due 10:00 AM');
  });
  it('per protocol sets no due time', () => {
    expect(body(base({ 'P-1012': { changedMin: 845, nextDueMin: null } }))).toBe('Changed 2:05 PM · due per protocol');
  });
  it('only advertises the photo action, never a dressing action', () => {
    const h = hint(base({ 'P-1012': { changedMin: 845, nextDueMin: 845 } }));
    expect(['Say "photo"', 'Tap to take photo']).toContain(h);
    expect(screenCopy(base({ 'P-1012': { changedMin: 845, nextDueMin: 845 } }), 0).rows.map((r) => r.text).join(' ')).not.toMatch(/dressing|change it|due now/i);
  });
  it('a different patient keeps its own line', () => {
    expect(body({ ...base({ 'P-1014': { changedMin: 1, nextDueMin: 2 } }) })).toBe('Changed 9:00 AM · due 9:00 PM');
  });
});

describe('sessionCtx dressings', () => {
  const cap = (over: Partial<WoundCapture>): WoundCapture => ({
    captureId: 'c', patientId: 'P-1012', status: 'pending_review', photoUploadFailed: false, finding: 'f', comparison: 'c', draftNote: 'd',
    source: 'glasses', capturedAtMs: 0, ...over,
  });
  const st = (caps: WoundCapture[]): SessionState => ({ ...newState('x'), woundCaptures: caps });
  it('uses the newest capture per patient that has a dressing time', () => {
    const d1 = { type: 'foam' as const, changedAtMin: 100, intervalHours: 24, nextDueMin: 100, enteredBy: 'phone' as const, atMs: 1 };
    const d2 = { ...d1, changedAtMin: 200, nextDueMin: null, intervalHours: null };
    expect(sessionCtx(st([cap({ captureId: 'a', dressing: d1 }), cap({ captureId: 'b', dressing: d2 })])).dressings)
      .toEqual({ 'P-1012': { changedMin: 200, nextDueMin: null } });
  });
  it('ignores type none and captures without a dressing', () => {
    const none = { type: 'none' as const, nextDueMin: null, enteredBy: 'phone' as const, atMs: 1 };
    expect(sessionCtx(st([cap({ dressing: none })])).dressings).toEqual({});
    expect(sessionCtx(st([cap({})])).dressings).toEqual({});
  });
});

describe('Director forced wound trigger vs the 60s cooldown', () => {
  it('a forced SIM_TRIGGER_WOUND re-shows G7 inside the cooldown (so the demo can show the dressing line), a voice trigger does not', async () => {
    const { reduce } = await import('./stateMachine');
    const T = 1_000_000;
    let s: GState = { ...initialState(data), screen: 'G4', patientId: 'P-1012' };
    s = reduce(s, { type: 'intent', intent: 'wound', force: true }, T).state;
    expect(s.screen).toBe('G7');
    s = { ...s, screen: 'G8' };
    expect(reduce(s, { type: 'intent', intent: 'wound' }, T + 5000).state.screen).toBe('G8');
    expect(reduce(s, { type: 'intent', intent: 'wound', force: true }, T + 5000).state.screen).toBe('G7');
  });
});
