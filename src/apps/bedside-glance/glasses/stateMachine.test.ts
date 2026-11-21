import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import patientsData from '../../../../data/patients.json';
import { parseIntent, type Intent } from '../triggers';
import { screenCopy } from './copy';
import {
  FALLBACK_ASSESSMENT, MISS_TOAST, initialState, reduce, type Effect, type GEvent, type GState, type Patient,
  type SessionCtx,
} from './stateMachine';

const PATIENTS = (patientsData as unknown as { patients: Patient[] }).patients;
const T0 = 1_000_000;
const SESSION: SessionCtx = {
  medStatus: {}, clock: { baseMin: 822, startedAtMs: T0 }, clockOffsetMin: 0, hasLastLog: false,
};

/** Drives the pure reducer under fake timers: a tick is scheduled for the next deadline after each event. */
function driver(initial?: Partial<GState>) {
  let state: GState = { ...initialState(PATIENTS), session: SESSION, ...initial };
  const effects: Effect[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    const ds = [state.fadeAtMs, state.toast?.untilMs].filter((x): x is number => typeof x === 'number');
    if (ds.length === 0) return;
    timer = setTimeout(() => send({ type: 'tick' }), Math.max(0, Math.min(...ds) - Date.now()));
  };
  const send = (e: GEvent) => {
    const r = reduce(state, e, Date.now());
    state = r.state;
    effects.push(...r.effects);
    schedule();
    return r;
  };
  return {
    send,
    effects,
    get state() { return state; },
    intent: (intent: Intent, force = false) => send({ type: 'intent', intent, force }),
    scan: (n: '12' | '14') => send({ type: 'scanLock', payload: `BG-P-10${n}` }),
    advance: (ms: number) => vi.advanceTimersByTime(ms),
    copy: () => screenCopy(state, Date.now()),
  };
}

const hero = (d: { copy: () => { rows: { role: string; text: string }[] } }) => d.copy().rows.find((r) => r.role === 'hero')!.text;

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); });
afterEach(() => { vi.useRealTimers(); });

describe('scan flow', () => {
  it('G1 -> G2 on first read, G2 -> G3 on timeout, G3 tap -> G1', () => {
    const d = driver();
    d.send({ type: 'scanRead' });
    expect(d.state.screen).toBe('G2');
    d.send({ type: 'scanTimeout' });
    expect(d.state.screen).toBe('G3');
    d.send({ type: 'tap' });
    expect(d.state.screen).toBe('G1');
  });
  it('lock loads the patient, shows G4 and dispatches SET_ACTIVE_PATIENT', () => {
    const d = driver();
    d.send({ type: 'scanRead' });
    d.scan('12');
    expect(d.state.screen).toBe('G4');
    expect(d.state.patientId).toBe('P-1012');
    expect(d.effects).toEqual([{ type: 'dispatch', action: { type: 'SET_ACTIVE_PATIENT', patientId: 'P-1012' } }]);
  });
  it('unknown code -> G3; scanner locks are ignored on G4 unless forced (director sim)', () => {
    const d = driver();
    d.send({ type: 'scanLock', payload: 'nope' });
    expect(d.state.screen).toBe('G3');
    d.scan('12');
    d.send({ type: 'scanLock', payload: 'BG-P-1014' });
    expect(d.state.patientId).toBe('P-1012');
    d.send({ type: 'scanLock', payload: 'BG-P-1014', force: true });
    expect(d.state.patientId).toBe('P-1014');
  });
  it('"room 12" loads locally WITHOUT SET_ACTIVE_PATIENT', () => {
    const d = driver();
    d.intent('room14');
    expect(d.state.patientId).toBe('P-1014');
    expect(d.state.screen).toBe('G4');
    expect(d.effects).toEqual([]);
  });
});

describe('G4 meds card and G5', () => {
  it('shows the locked copy for Maria (diabetic line 3)', () => {
    const d = driver();
    d.scan('12');
    const rows = d.copy().rows.map((r) => r.text);
    expect(rows).toEqual(['Due now', 'Metformin 500 mg', 'Due now · Gluc 182 (11:00a)', 'Say "done"']);
    expect(d.copy().rows[0]).toMatchObject({ role: 'label', icon: 'ring' });
    // The chart allergy rides on the action line as a filled diamond + words, so it never relies on colour.
    expect(d.copy().rows[3].aside).toEqual({ text: 'Allergy: Penicillin', icon: 'diamond', strong: true });
  });
  it('done logs the med, G5 fades after exactly 3s back to G4; none-due then disables done', () => {
    const d = driver();
    d.scan('12');
    d.effects.length = 0;
    d.intent('done');
    expect(d.state.screen).toBe('G5');
    expect(d.effects).toEqual([
      { type: 'dispatch', key: 'P-1012:M-1', action: { type: 'LOG_MED', patientId: 'P-1012', medKey: 'M-1', via: 'voice', scanLocked: true } },
    ]);
    d.advance(2999);
    expect(d.state.screen).toBe('G5');
    d.advance(1);
    expect(d.state.screen).toBe('G4');
    expect(d.copy().rows[2].text).toBe('None due · Next Lisinopril 6:00p');
    expect(d.copy().rows[3].text).toBe('Due 6:00 PM · in 258 min');
    d.effects.length = 0;
    d.intent('done');
    expect(d.effects).toEqual([]); // "done" is ignored in the None due state
    expect(d.state.screen).toBe('G4');
  });
  it('offline G5 shows "Queued · offline"', () => {
    const d = driver({ offline: true });
    d.scan('12');
    d.intent('done');
    expect(d.copy().rows[0].aside?.text).toBe('Queued · offline');
  });
  it('G4 never fades', () => {
    const d = driver();
    d.scan('12');
    d.advance(60 * 60_000);
    expect(d.state.screen).toBe('G4');
  });
  it('undo from G5 sends UNDO_LAST_MED and returns to G4 with the med due again', () => {
    const d = driver();
    d.scan('12');
    d.intent('done');
    d.intent('undo');
    expect(d.state.screen).toBe('G4');
    expect(d.effects.at(-1)).toEqual({ type: 'dispatch', action: { type: 'UNDO_LAST_MED' } });
    expect(hero(d)).toBe('Metformin 500 mg');
  });
  it('a first-write-wins conflict returns to G4 with the "Already given" banner for 3s', () => {
    const d = driver();
    d.scan('12');
    d.intent('done');
    d.send({ type: 'logConflict', key: 'P-1012:M-1', message: 'Already given 1:45 PM via phone' });
    expect(d.state.screen).toBe('G4');
    // Banner: triangle + "Already given" label, the locked sentence at body weight, card state as meta.
    const rows = d.copy().rows;
    expect(rows[0]).toMatchObject({ role: 'label', text: 'Already given', icon: 'triangle' });
    expect(rows.find((r) => r.role === 'body')!.text).toBe('Already given 1:45 PM via phone');
    expect(rows.at(-1)).toMatchObject({ role: 'meta' });
    expect(rows.at(-1)!.text).toMatch(/^None due · Next |^Due now/);
    d.advance(3000);
    expect(d.state.toast).toBeNull();
  });
});

describe('multi-med next (James Carter)', () => {
  it('only Aspirin is due at 1:42 PM; after Clock +30m "next" cycles both meds', () => {
    const d = driver();
    d.scan('14');
    expect(hero(d)).toBe('Aspirin 81 mg');
    d.intent('next');
    expect(d.state.dueCursor).toBe(0); // single due med: next does nothing
    d.send({ type: 'session', session: { ...SESSION, clockOffsetMin: 30 } });
    expect(d.copy().rows.at(-1)!.text).toBe('Say "done" · +1 due ("next")');
    d.intent('next');
    expect(hero(d)).toBe('Atorvastatin 20 mg');
    d.intent('next');
    expect(hero(d)).toBe('Aspirin 81 mg');
  });
  it('long press cycles when several are due; logging one leaves the other', () => {
    const d = driver({ session: { ...SESSION, clockOffsetMin: 30 } });
    d.scan('14');
    d.send({ type: 'longPress' });
    expect(hero(d)).toBe('Atorvastatin 20 mg');
    d.intent('done');
    d.advance(3000);
    expect(hero(d)).toBe('Aspirin 81 mg');
  });
});

describe('auto-fade rules', () => {
  it('G6 fades at 10s, G9 at 6s, voice toast at 3s', () => {
    const d = driver();
    d.scan('12');
    d.intent('pain');
    expect(d.state.screen).toBe('G6');
    d.advance(9999);
    expect(d.state.screen).toBe('G6');
    d.advance(1);
    expect(d.state.screen).toBe('G4');

    d.send({ type: 'notice', notice: { text: 'Hello there' } });
    expect(d.state.screen).toBe('G9');
    d.advance(5999);
    expect(d.state.screen).toBe('G9');
    d.advance(1);
    expect(d.state.screen).toBe('G4');

    d.send({ type: 'voiceMiss' });
    expect(d.copy().rows.at(-1)!.text).toBe(MISS_TOAST);
    d.advance(2999);
    expect(d.state.toast).not.toBeNull();
    d.advance(1);
    expect(d.state.toast).toBeNull();
  });
  it('G9 notice returns to the screen it interrupted', () => {
    const d = driver();
    d.scan('12');
    d.intent('vitals');
    d.send({ type: 'notice', notice: { text: 'Hi' } });
    d.advance(6000);
    expect(d.state.screen).toBe('VITALS');
    d.intent('close');
    expect(d.state.screen).toBe('G4');
  });
  it('Vitals does not fade', () => {
    const d = driver();
    d.scan('12');
    d.intent('vitals');
    d.advance(120_000);
    expect(d.state.screen).toBe('VITALS');
  });
});

describe('Critical Allergy', () => {
  it('never fades and only "acknowledge" dismisses it', () => {
    const d = driver();
    d.scan('12');
    d.intent('allergy', true);
    expect(d.state.screen).toBe('ALLERGY');
    d.advance(10 * 60_000);
    expect(d.state.screen).toBe('ALLERGY');
    for (const e of ['done', 'close', 'next', 'undo', 'vitals', 'pain', 'wound', 'room14'] as Intent[]) d.intent(e);
    d.send({ type: 'tap' });
    d.send({ type: 'longPress' });
    d.send({ type: 'notice', notice: { text: 'x' } });
    expect(d.state.screen).toBe('ALLERGY');
    d.intent('acknowledge');
    expect(d.state.screen).toBe('G4');
  });
});

describe('context triggers', () => {
  it('pain only with PRN, 60s per-patient cooldown', () => {
    const d = driver();
    d.scan('14');
    d.intent('pain');
    expect(d.state.screen).toBe('G4'); // James has no PRN
    d.scan('12'); // ignored on G4, so load locally
    d.intent('room12');
    d.intent('pain');
    expect(d.state.screen).toBe('G6');
    d.advance(10_000);
    d.intent('pain');
    expect(d.state.screen).toBe('G4'); // inside the cooldown
    d.advance(49_999);
    d.intent('pain');
    expect(d.state.screen).toBe('G4');
    d.advance(1);
    d.intent('pain');
    expect(d.state.screen).toBe('G6');
  });
  it('wound only with a wound record; cooldown applies per trigger', () => {
    const d = driver();
    d.scan('14');
    d.intent('wound');
    expect(d.state.screen).toBe('G4');
    d.intent('room12');
    d.intent('wound');
    expect(d.state.screen).toBe('G7');
    expect(d.copy().rows[2].text).toBe('Changed 9:00 AM · due 9:00 PM');
    d.intent('close');
    d.intent('wound');
    expect(d.state.screen).toBe('G4');
    d.intent('pain'); // a different trigger has its own cooldown
    expect(d.state.screen).toBe('G6');
  });
  it('trigger regexes', () => {
    expect(parseIntent('the pain is like a 7')).toBe('pain');
    expect(parseIntent("it's like a 7")).toBe('pain');
    expect(parseIntent('it hurts')).toBe('pain');
    expect(parseIntent('check the wound')).toBe('wound');
    expect(parseIntent('Room 12')).toBe('room12');
    expect(parseIntent('room fourteen')).toBe('room14');
    expect(parseIntent('DONE')).toBe('done');
    expect(parseIntent('send to phone')).toBe('send');
    expect(parseIntent('hello nurse')).toBeNull();
  });
});

describe('honest wound send and unavailable assessment', () => {
  const toG8 = (assessment: GState['assessment']) => {
    const d = driver();
    d.scan('12');
    d.intent('wound');
    d.send({ type: 'tap' });
    const id = d.state.captureId!;
    d.send({ type: 'photoResult', captureId: id, ok: true });
    d.send({ type: 'assessment', captureId: id, assessment: assessment! });
    d.effects.length = 0;
    return { d, id };
  };
  it('a failed WOUND_SEND stays on G8 with the server message and never says Sent', () => {
    const { d } = toG8(FALLBACK_ASSESSMENT);
    d.intent('send');
    d.send({ type: 'sendFailed', message: 'Already sent to Dr. Okafor' });
    expect(d.state.screen).toBe('G8');
    expect(d.state.sending).toBe(false);
    expect(d.copy().rows.at(-1)!.text).toBe('Already sent to Dr. Okafor');
  });
  it('unavailable assessment: no finding on screen, no send, only the notice', () => {
    const { d } = toG8({ finding: 'Assessment unavailable: no photo captured', comparison: '', draftNote: '', source: 'unavailable' });
    const rows = d.copy().rows.map((r) => r.text);
    expect(rows).toContain('Assessment unavailable: no photo captured');
    expect(rows.join(' ')).not.toMatch(/Sample|AI result|redness|drainage/i);
    d.intent('send');
    expect(d.effects).toEqual([]);
    expect(d.state.sending).toBe(false);
  });
  it('the no-AI fallback is non-clinical: Photo saved, No AI review - see phone, no finding text', () => {
    const { d } = toG8(FALLBACK_ASSESSMENT);
    const rows = d.copy().rows;
    expect(rows.find((r) => r.role === 'hero')!.text).toBe('Photo saved');
    expect(rows.find((r) => r.role === 'body')!.text).toBe('No AI review - see phone');
    const all = rows.map((r) => r.text).join(' ');
    expect(all).not.toMatch(/similar|no change|AI result|redness|drainage|incision|closed|intact/i);
  });
  it('a clinical-sounding finding with source fallback is still never shown on G8', () => {
    const { d } = toG8({ finding: 'Incision edges closed. No redness seen.', comparison: 'c', draftNote: 'n', source: 'fallback' });
    expect(d.copy().rows.map((r) => r.text).join(' ')).not.toMatch(/Incision|redness/i);
  });
});

describe('adopting a patient set elsewhere', () => {
  it('adopt loads the card as G4 and dispatches nothing', () => {
    const d = driver();
    d.send({ type: 'adopt', patientId: 'P-1014' });
    expect(d.state.screen).toBe('G4');
    expect(d.state.patientId).toBe('P-1014');
    expect(d.effects).toEqual([]);
  });
  it('respects the assignment check, an unknown id, and does not interrupt H3 or ALLERGY', () => {
    const a = driver({ assigned: ['P-1012'] });
    a.send({ type: 'adopt', patientId: 'P-1014' });
    expect(a.state.screen).toBe('G3');
    expect(a.state.scanFail).toBe('unassigned');
    const b = driver();
    b.send({ type: 'adopt', patientId: 'nope' });
    expect(b.state.screen).toBe('G1');
    const c = driver();
    c.scan('12');
    c.intent('wound');
    c.send({ type: 'tap' });
    expect(c.state.screen).toBe('H3');
    c.send({ type: 'adopt', patientId: 'P-1014' });
    expect(c.state.screen).toBe('H3');
  });
});

describe('data-driven allergy alert, heard and listening', () => {
  const ORDER = { id: 'X-1', name: 'Amoxicillin', dose: '250 mg', route: 'PO', dueAt: '13:42', allergyClasses: ['penicillin'] };
  it('scanning a patient with a conflicting due order shows the Critical Allergy alert from data', () => {
    const d = driver({ session: { ...SESSION, extraOrders: { 'P-1012': [ORDER] } } });
    d.scan('12');
    expect(d.state.screen).toBe('ALLERGY');
    expect(d.copy().rows.map((r) => r.text)).toEqual([
      'Allergy', 'Amoxicillin 250 mg', 'Chart lists Penicillin allergy', 'Say "acknowledge"',
    ]);
    expect(d.copy().alert).toBe(true);
  });
  it('an order added while the patient is open raises the alert; only "acknowledge" clears it, and it never blocks "done"', () => {
    const d = driver();
    d.scan('12');
    expect(d.state.screen).toBe('G4');
    d.send({ type: 'session', session: { ...SESSION, extraOrders: { 'P-1012': [ORDER] } } });
    expect(d.state.screen).toBe('ALLERGY');
    d.send({ type: 'tap' });
    d.intent('done');
    d.advance(60_000);
    expect(d.state.screen).toBe('ALLERGY'); // persists; no tap or timeout clears it
    d.intent('acknowledge');
    expect(d.state.screen).toBe('G4');
    d.send({ type: 'session', session: { ...SESSION, extraOrders: { 'P-1012': [ORDER] } } });
    expect(d.state.screen).toBe('G4'); // acknowledged: not raised again
    d.effects.length = 0;
    d.intent('done'); // the due order is still loggable
    expect(d.effects).toHaveLength(1);
  });
  it('a med without allergyClasses never alerts', () => {
    const d = driver();
    d.scan('12');
    expect(d.state.screen).toBe('G4');
  });
  it('"Heard: done" shows for 1.5s, then goes away; the miss hint is unchanged', () => {
    const d = driver();
    d.scan('14');
    d.send({ type: 'heard', intent: 'next' });
    expect(d.copy().rows.at(-1)!.text).toBe('Heard: next');
    d.advance(1499);
    expect(d.copy().rows.at(-1)!.text).toBe('Heard: next');
    d.advance(1);
    expect(d.copy().rows.at(-1)!.text).not.toMatch(/Heard/);
    d.send({ type: 'voiceMiss' });
    expect(d.copy().rows.at(-1)!.text).toBe('Try "done", "vitals", or "close"');
  });
  it('the strip shows Listening only while the mic is live; offline swaps the connection item', () => {
    const d = driver();
    const keys = () => d.copy().items.map((i) => i.key);
    expect(keys()).not.toContain('listening');
    expect(d.copy().items[0]).toMatchObject({ key: 'conn', text: 'Linked', icon: 'link' });
    d.send({ type: 'listening', on: true });
    expect(d.copy().items.find((i) => i.key === 'listening')).toMatchObject({ text: 'Listening', icon: 'mic' });
    d.send({ type: 'listening', on: false });
    expect(keys()).not.toContain('listening');
    d.send({ type: 'offline', offline: true });
    expect(d.copy().items[0]).toMatchObject({ key: 'conn', text: 'Not linked', icon: 'link-off' });
  });
  it('the undo drain bar follows the 10s window from the moment of logging; "n of m" due shows a stepper', () => {
    const d = driver();
    d.scan('12');
    d.intent('done');
    expect(d.copy().progress).toEqual({ kind: 'bar', fraction: 1 });
    d.advance(2000);
    expect(d.copy().progress).toEqual({ kind: 'bar', fraction: 0.8 });
    const m = driver({ session: { ...SESSION, clockOffsetMin: 30 } });
    m.scan('14');
    expect(m.copy().progress).toEqual({ kind: 'steps', index: 0, total: 2 });
    m.intent('next');
    expect(m.copy().progress).toEqual({ kind: 'steps', index: 1, total: 2 });
  });
});

describe('wound flow, photo retry, G8', () => {
  function toCapture() {
    const d = driver();
    d.scan('12');
    d.intent('wound');
    d.effects.length = 0;
    d.send({ type: 'tap' }); // G7 tap -> H3
    return d;
  }
  it('H3 capture -> failed upload -> retry same captureId -> assess -> G8 never fades -> send -> G9', () => {
    const d = toCapture();
    expect(d.state.screen).toBe('H3');
    const id = d.state.captureId!;
    expect(d.effects).toEqual([{ type: 'capturePhoto', captureId: id }]); // WOUND_CAPTURED is sent by the host once there is a result
    d.send({ type: 'photoResult', captureId: id, ok: false });
    expect(d.copy().rows.at(-1)!.text).toBe("Photo not sent · say 'retry'");
    d.effects.length = 0;
    d.intent('retry');
    expect(d.effects).toEqual([{ type: 'uploadPhoto', captureId: id }]);
    d.send({ type: 'photoResult', captureId: id, ok: true });
    expect(d.effects.at(-1)).toEqual({ type: 'assess', captureId: id });
    d.send({ type: 'assessment', captureId: id, assessment: FALLBACK_ASSESSMENT });
    expect(d.state.screen).toBe('G8');
    d.advance(5 * 60_000);
    expect(d.state.screen).toBe('G8');
    d.effects.length = 0;
    d.intent('send');
    // Not "Sent" yet: WOUND_SEND is dispatched with the captureId and G8 waits for the server ack.
    expect(d.state.screen).toBe('G8');
    expect(d.copy().rows.at(-1)!.text).toBe('Sending to Dr. Okafor…');
    expect(d.effects).toEqual([{
      type: 'dispatch', track: 'send',
      action: { type: 'WOUND_SEND', captureId: id, draftNote: FALLBACK_ASSESSMENT.draftNote },
    }]);
    d.effects.length = 0;
    d.intent('send'); // a second "send" while waiting does nothing
    expect(d.effects).toEqual([]);
    d.send({ type: 'woundSent' });
    expect(d.state.screen).toBe('G9');
    expect(d.copy().rows[1].text).toBe('Sent to Dr. Okafor');
    d.advance(6000);
    expect(d.state.screen).toBe('G4');
  });
  it('stale photo results for another capture are ignored', () => {
    const d = toCapture();
    d.send({ type: 'photoResult', captureId: 'other', ok: false });
    expect(d.state.stage).toBe('upload');
    d.send({ type: 'assessment', captureId: 'other', assessment: FALLBACK_ASSESSMENT });
    expect(d.state.screen).toBe('H3');
  });
  it('a phone notice does not interrupt H3', () => {
    const d = toCapture();
    d.send({ type: 'notice', notice: { text: 'x' } });
    expect(d.state.screen).toBe('H3');
  });
});

describe('session sync and reset', () => {
  it('server-confirmed given removes the pending entry; reset returns to G1', () => {
    const d = driver();
    d.scan('12');
    d.intent('done');
    expect(d.state.pending).toEqual(['P-1012:M-1']);
    d.send({ type: 'session', session: { ...SESSION, medStatus: { 'P-1012:M-1': { status: 'given' } } } });
    expect(d.state.pending).toEqual([]);
    d.send({ type: 'reset' });
    expect(d.state.screen).toBe('G1');
    expect(d.state.patientId).toBeNull();
  });
});

describe('assignment safety (G3 "Not on your list")', () => {
  const ASSIGNED = ['P-1012'];
  const assigned = () => driver({ assigned: ASSIGNED });
  it('scanning an unassigned patient shows G3 with the exact copy and dispatches nothing', () => {
    const d = assigned();
    d.scan('14');
    expect(d.state.screen).toBe('G3');
    expect(d.state.patientId).toBeNull();
    expect(d.copy().rows.map((r) => r.text)).toContain('Not on your list');
    expect(d.effects).toEqual([]);
  });
  it('a typed patient id works like a scan, for assigned and unassigned alike', () => {
    const d = assigned();
    d.send({ type: 'scanLock', payload: 'P-1014' });
    expect(d.state.screen).toBe('G3');
    expect(d.copy().rows.map((r) => r.text)).toContain('Not on your list');
    d.send({ type: 'tap' });
    d.send({ type: 'scanLock', payload: 'P-1012' });
    expect(d.state.patientId).toBe('P-1012');
    expect(d.effects).toEqual([{ type: 'dispatch', action: { type: 'SET_ACTIVE_PATIENT', patientId: 'P-1012' } }]);
  });
  it('an unknown code still says Band not recognized', () => {
    const d = assigned();
    d.send({ type: 'scanLock', payload: 'nope' });
    expect(d.copy().rows.map((r) => r.text)).toContain('Band not recognized');
  });
  it('voice "room 14" for an unassigned patient is refused too and the loaded patient stays', () => {
    const d = assigned();
    d.scan('12');
    d.effects.length = 0;
    d.intent('room14');
    expect(d.state.screen).toBe('G3');
    expect(d.state.patientId).toBe('P-1012');
    expect(d.effects).toEqual([]);
  });
  it('the failure reason clears when leaving G3', () => {
    const d = assigned();
    d.scan('14');
    d.send({ type: 'tap' });
    expect(d.state.scanFail).toBeNull();
    d.send({ type: 'scanLock', payload: 'nope' });
    expect(d.copy().rows.map((r) => r.text)).not.toContain('Not on your list');
  });
});

describe('forced capture (director SIM_CAPTURE_WOUND) and result toasts', () => {
  it('forced capture from G4 starts H3 through the same capture effect as a real capture', () => {
    const d = driver();
    d.scan('12');
    d.effects.length = 0;
    d.intent('capture', true);
    expect(d.state.screen).toBe('H3');
    expect(d.effects).toEqual([{ type: 'capturePhoto', captureId: d.state.captureId! }]);
  });
  it('unforced capture is ignored outside G7, and a patient without a wound cannot be captured', () => {
    const d = driver();
    d.scan('12');
    d.intent('capture');
    expect(d.state.screen).toBe('G4');
    const d2 = driver({ patients: PATIENTS.map((p) => ({ ...p, wound: null })) });
    d2.scan('12');
    d2.intent('capture', true);
    expect(d2.state.screen).toBe('G4');
  });
  it('a toast event shows text on the card for 3s, but never over the allergy alert', () => {
    const d = driver();
    d.scan('12');
    d.send({ type: 'toast', text: 'Too late to undo' });
    expect(d.copy().rows.map((r) => r.text)).toContain('Too late to undo');
    d.advance(3100);
    expect(d.state.toast).toBeNull();
    d.intent('allergy', true);
    d.send({ type: 'toast', text: 'x' });
    expect(d.state.toast).toBeNull();
  });
});

describe('capture ids are unguessable (wound photo privacy)', () => {
  it('are not sequential or time-derived: two captures at the same instant differ and carry a long random part', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const d = driver();
      d.scan('12');
      d.intent('wound');
      d.send({ type: 'tap' });
      ids.add(d.state.captureId!);
    }
    expect(ids.size).toBe(5);
    for (const id of ids) {
      expect(id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
      expect(id).not.toMatch(/^cap-\d+-[0-9a-z]{1,9}$/);
      expect(id.length).toBeGreaterThanOrEqual(32);
    }
  });
});
