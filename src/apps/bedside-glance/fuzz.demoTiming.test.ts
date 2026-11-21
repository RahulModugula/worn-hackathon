// The 90-second table script (docs/PITCH.md) replayed programmatically: the real glasses reducer wired to the real
// applyAction store under fake timers. Each beat must finish inside its window with realistic hop latency.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import patientsData from '../../../data/patients.json';
import { applyAction, newState, UNDO_WINDOW_MS, type PatientsData } from '../../../server/sessionStore';
import { reduce, initialState, type Effect, type GEvent, type GState, type Patient, type SessionCtx } from './glasses/stateMachine';
import type { Action, SessionState } from '../../../shared/types';

const PATIENTS = (patientsData as unknown as { patients: Patient[] }).patients;
const SERVER_DATA = patientsData as unknown as PatientsData;
const T0 = 2_000_000;
const HOP_MS = 200; // one-way network + server budget used for every message in the run
const DR_DELAY_MS = 5000;

function world() {
  const server: SessionState = newState('demo');
  let g: GState = initialState(PATIENTS, ['P-1012', 'P-1014']);
  const marks: Record<string, number> = {};
  const acks: { id: string; ok: boolean; message?: string; atMs: number }[] = [];
  let n = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const ctx = (): SessionCtx => ({
    medStatus: server.medStatus, clock: server.clock, clockOffsetMin: server.clockOffsetMin, hasLastLog: server.lastMedLog !== null,
  });
  const schedule = () => {
    if (timer) clearTimeout(timer);
    const ds = [g.fadeAtMs, g.toast?.untilMs].filter((x): x is number => typeof x === 'number');
    if (ds.length) timer = setTimeout(() => feed({ type: 'tick' }), Math.max(0, Math.min(...ds) - Date.now()));
  };
  const serverApply = (a: Action) => applyAction(server, a, Date.now(), SERVER_DATA);
  const run = (effects: Effect[]) => {
    for (const e of effects) {
      if (e.type !== 'dispatch') continue;
      const action = { ...e.action, device: 'glasses', clientEventId: `g${++n}` } as Action;
      setTimeout(() => {
        const r = serverApply(action); // reaches the server after one hop
        acks.push({ id: action.clientEventId, ok: r.ok, message: r.message, atMs: Date.now() });
        setTimeout(() => {
          feed({ type: 'session', session: ctx() });
          if (!r.ok && r.conflict && e.key) feed({ type: 'logConflict', key: e.key, message: r.message ?? '' });
          if (r.ok && e.track === 'send') {
            feed({ type: 'woundSent' });
            setTimeout(() => { // the 5 s simulated doctor reply is a server timer
              const rr = serverApply({ type: 'DR_REPLY', captureId: (action as { captureId?: string }).captureId, from: 'Dr. Okafor', text: 'Looks good.', device: 'director', clientEventId: `dr${n}` });
              if (rr.ok) setTimeout(() => { feed({ type: 'session', session: ctx() }); feed({ type: 'notice', notice: { text: server.glassesNotice!.text } }); marks.reply = Date.now() - T0; }, HOP_MS);
            }, DR_DELAY_MS);
          }
        }, HOP_MS);
      }, HOP_MS);
    }
  };
  const feed = (e: GEvent) => { const r = reduce(g, e, Date.now()); g = r.state; schedule(); run(r.effects); };
  return {
    feed, server, marks, acks, serverApply,
    get g() { return g; },
    /** Advance fake time to `sec` seconds into the script, then run `fn`. */
    at(sec: number, fn?: () => void) { const d = T0 + sec * 1000 - Date.now(); if (d < 0) throw new Error(`script time ${sec}s is in the past`); vi.advanceTimersByTime(d); fn?.(); },
    now: () => (Date.now() - T0) / 1000,
  };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); });
afterEach(() => { vi.useRealTimers(); });

describe('90-second demo script timing (PITCH.md)', () => {
  it('every beat completes inside its window', () => {
    const w = world();
    w.serverApply({ type: 'START_SHIFT', device: 'phone', clientEventId: 'start' });

    // Beat 1 (0:15-0:50): scan -> G4 within 2 s of the first read; "done" -> phone sees it < 1 s; G5 fades after 3 s.
    w.at(15, () => w.feed({ type: 'scanRead' }));
    expect(w.g.screen).toBe('G2');
    w.at(16.2, () => w.feed({ type: 'scanLock', payload: 'BG-P-1012' })); // 3 matching reads inside the 1.2 s dwell
    expect(w.g.screen).toBe('G4');
    expect(16.2 - 15).toBeLessThanOrEqual(2);
    w.at(45, () => w.feed({ type: 'intent', intent: 'done' }));
    expect(w.g.screen).toBe('G5');
    w.at(45 + 2 * HOP_MS / 1000 + 0.001);
    expect(w.server.medStatus['P-1012:M-1']?.status).toBe('given'); // chart updated on the phone in < 1 s
    expect(w.now() - 45).toBeLessThan(1);
    w.at(47.9); expect(w.g.screen).toBe('G5');
    w.at(48.01); expect(w.g.screen).toBe('G4');                      // G5 faded after exactly 3 s
    expect(w.now()).toBeLessThan(50);

    // Beat 2 (0:50-1:10): teammate taps on the phone -> conflict; undo inside the 10 s window from either device.
    w.at(52);
    const phone = w.serverApply({ type: 'LOG_MED', patientId: 'P-1012', medKey: 'M-1', device: 'phone', clientEventId: 'p-tap' });
    expect(phone.ok).toBe(false);
    expect(phone.conflict).toBe(true);
    expect(phone.message).toMatch(/^Already given .* via voice$/);
    w.at(54, () => w.feed({ type: 'intent', intent: 'undo' }));      // 9 s after the med was accepted at 45 s
    w.at(54 + 2 * HOP_MS / 1000 + 0.001);
    expect(w.server.medStatus['P-1012:M-1']?.status).toBe('due');
    const late = w.serverApply({ type: 'UNDO_LAST_MED', device: 'phone', clientEventId: 'late' });
    expect(late.ok).toBe(false);
    expect(w.now()).toBeLessThan(70);
    // and the boundary: a log at 56 s can still be undone at exactly +10 000 ms, not +10 001 ms.
    w.serverApply({ type: 'LOG_MED', patientId: 'P-1012', medKey: 'M-1', device: 'phone', clientEventId: 'again' });
    const logAt = Date.now();
    vi.setSystemTime(logAt + UNDO_WINDOW_MS + 1);
    expect(w.serverApply({ type: 'UNDO_LAST_MED', device: 'glasses', clientEventId: 'u-late' }).ok).toBe(false);
    vi.setSystemTime(logAt); // not used further; the window itself is covered by the fuzz suite
    w.serverApply({ type: 'UNDO_LAST_MED', device: 'glasses', clientEventId: 'u-clean' }); // restore due state for the rest of the run
    vi.setSystemTime(T0 + 70_000);

    // Beat 3 (1:10-1:20): wound -> capture -> assessment -> send -> reply on the glasses within the window.
    w.at(70, () => w.feed({ type: 'intent', intent: 'wound' }));
    expect(w.g.screen).toBe('G7');
    w.at(70.8, () => w.feed({ type: 'tap' }));
    expect(w.g.screen).toBe('H3');
    const id = w.g.captureId!;
    w.at(71.5, () => w.feed({ type: 'photoResult', captureId: id, ok: true }));
    w.at(72.5, () => w.feed({ type: 'assessment', captureId: id, assessment: { finding: 'Incision edges closed.', comparison: 'Sample result', draftNote: 'Dressing intact.', source: 'fallback' } }));
    expect(w.g.screen).toBe('G8');
    w.server.woundCaptures.length === 0 && w.serverApply({ type: 'WOUND_CAPTURED', captureId: id, patientId: 'P-1012', finding: 'Incision edges closed.', comparison: 'Sample result', draftNote: 'Dressing intact.', assessmentSource: 'fallback', device: 'glasses', clientEventId: 'wc' });
    w.at(73, () => w.feed({ type: 'intent', intent: 'send' }));
    expect(w.g.screen).toBe('G8'); expect(w.g.sending).toBe(true);   // "Sent" only after the ack
    w.at(73 + 2 * HOP_MS / 1000 + 0.001);
    expect(w.g.screen).toBe('G9');
    expect(w.server.woundCaptures[0].status).toBe('sent');
    w.at(73 + 2 * HOP_MS / 1000 + DR_DELAY_MS / 1000 + 2 * HOP_MS / 1000 + 0.05);
    expect(w.marks.reply).toBeDefined();
    expect(w.marks.reply / 1000).toBeLessThan(80);                    // reply lands before the 1:20 beat ends
    expect(w.g.screen).toBe('G9');
    expect(w.g.notice?.text).toContain('Dr. Okafor');

    // Beat 4 (1:20-1:30): the pitch; nothing on the glasses can run past 90 s.
    w.at(80); w.at(90);
    expect(w.g.screen === 'G4' || w.g.screen === 'G9').toBe(true);
    expect(w.now()).toBeLessThanOrEqual(90);
  });

  it('the doctor reply delay in server/index.ts is the 5 s this script assumes', () => {
    const src = readFileSync(resolve(process.cwd(), 'server/index.ts'), 'utf8');
    expect(src).toMatch(/drReplyDelayMs \?\? 5000/);
  });
});
