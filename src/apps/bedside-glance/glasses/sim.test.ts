import { describe, expect, it } from 'vitest';
import patientsData from '../../../../data/patients.json';
import { initialState, reduce, type Patient } from './stateMachine';
import { simHandling } from './sim';

const PATIENTS = (patientsData as unknown as { patients: Patient[] }).patients;
const base = () => initialState(PATIENTS);

describe('simHandling: Director commands become the events real inputs produce', () => {
  it('scan commands lock the matching room even without a real scan, and do nothing for an unknown room', () => {
    for (const [type, room] of [['SIM_SCAN_RM_12', '12'], ['SIM_SCAN_RM_14', '14']] as const) {
      const h = simHandling(type, base())!;
      const target = PATIENTS.find((p) => p.room === room)!;
      expect(h.events).toEqual([{ type: 'scanLock', payload: target.qrPayload, force: true }]);
      const after = reduce(base(), h.events[0], 1000).state;
      expect(after.patientId).toBe(target.id);
    }
    expect(simHandling('SIM_SCAN_RM_12', { ...base(), patients: [] })!.events).toEqual([]);
  });

  it('voice and trigger commands map to the right intent, forced where the drawer overrides gating', () => {
    expect(simHandling('SIM_VOICE_DONE', base())!.events).toEqual([{ type: 'intent', intent: 'done' }]);
    expect(simHandling('SIM_VOICE_NEXT', base())!.events).toEqual([{ type: 'intent', intent: 'next' }]);
    expect(simHandling('SIM_VOICE_UNDO', base())!.events).toEqual([{ type: 'intent', intent: 'undo' }]);
    for (const [type, intent] of [['SIM_TRIGGER_PAIN', 'pain'], ['SIM_TRIGGER_WOUND', 'wound'], ['SIM_SEND_TO_PHONE', 'send'], ['SIM_ALLERGY_ALERT', 'allergy']] as const) {
      expect(simHandling(type, base())!.events).toEqual([{ type: 'intent', intent, force: true }]);
    }
  });

  it('SIM_CAPTURE_WOUND loads Rm 12 first only when no patient is loaded, and flags the fallback photo', () => {
    const cold = simHandling('SIM_CAPTURE_WOUND', base())!;
    expect(cold.simCapture).toBe(true);
    expect(cold.events.map((e) => e.type)).toEqual(['scanLock', 'intent']);
    const loaded = simHandling('SIM_CAPTURE_WOUND', { ...base(), patientId: PATIENTS[0].id })!;
    expect(loaded.events.map((e) => e.type)).toEqual(['intent']);
  });

  it('SIM_HANDOFF_OFFER loads Rm 12 first only when no patient is loaded, then offers with the director payload', () => {
    const cold = simHandling('SIM_HANDOFF_OFFER', base(), { toNurseId: 'N-02', severity: 'Watch' })!;
    expect(cold.events.map((e) => e.type)).toEqual(['scanLock', 'handoffOffer']);
    expect(cold.events[1]).toEqual({ type: 'handoffOffer', toNurseId: 'N-02', severity: 'Watch' });
    const loaded = simHandling('SIM_HANDOFF_OFFER', { ...base(), patientId: PATIENTS[0].id }, undefined)!;
    expect(loaded.events).toEqual([{ type: 'handoffOffer' }]);
  });

  it('SIM_CHAOS_DROP replays a chaos event with the validated payload; a bad payload replays nothing', () => {
    expect(simHandling('SIM_CHAOS_DROP', base(), { ms: 5000, thenDone: true })!.chaos).toEqual({ ms: 5000, thenDone: true });
    expect(simHandling('SIM_CHAOS_DROP', base(), { ms: 5000 })!.chaos).toEqual({ ms: 5000, thenDone: false });
    for (const bad of [undefined, {}, { ms: 10 }, { ms: 99999 }, { ms: 'x' }]) expect(simHandling('SIM_CHAOS_DROP', base(), bad)!.chaos).toBeUndefined();
  });

  it('data-driven and server-answered commands replay nothing; unknown commands return null', () => {
    for (const t of ['SIM_FAIL_PHOTO_UPLOAD', 'SIM_ADD_CONFLICT_ORDER', 'SIM_CLOCK_PLUS_30', 'SIM_DR_REPLY']) {
      expect(simHandling(t, base())).toEqual({ events: [] });
    }
    expect(simHandling('SIM_NOPE', base())).toBeNull();
  });
});
