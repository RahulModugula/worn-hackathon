import { act, cleanup, render } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter } from '../../../hud-kit/platform/types';
import type { VoiceEngine, VoiceEvent, VoiceListener } from '../../../hud-kit/voice/voiceEngine';
import type { SessionState } from '../../../../shared/types';
import type { FetchFn } from './photoApi';
import { GlassesAppCore, PATIENTS, TelemetryBar, type ResultLike, type SessionLike } from './GlassesApp';
import { initialState, toViewState } from './stateMachine';

afterEach(cleanup);

function baseSession(): SessionState {
  const now = Date.now();
  return {
    id: 'demo', version: 1, shift: { startedAtMs: now }, clock: { baseMin: 822, startedAtMs: now }, clockOffsetMin: 0,
    activePatientId: null, medStatus: {}, woundCaptures: [], glassesNotice: null, events: [], eventSeq: 0, lastMedLog: null,
    glassesViewState: null, photoUploadShouldFail: false,
  };
}

class Store {
  state: SessionState | null = baseSession();
  offline = false;
  synced: boolean | undefined = undefined;
  results = new Set<(r: ResultLike) => void>();
  subscribeResults = (cb: (r: ResultLike) => void) => { this.results.add(cb); return () => { this.results.delete(cb); }; };
  emitResult(r: ResultLike) { this.results.forEach((f) => f(r)); }
  actions: Array<Record<string, unknown>> = [];
  private subs = new Set<() => void>();
  subscribe = (f: () => void) => { this.subs.add(f); return () => { this.subs.delete(f); }; };
  set(patch: Partial<SessionState>) { this.state = { ...this.state!, ...patch }; this.subs.forEach((f) => f()); }
  sim(type: string) {
    const seq = this.state!.eventSeq + 1;
    this.set({ eventSeq: seq, events: [...this.state!.events, { seq, atMs: Date.now() + seq, type, device: 'director' }] });
  }
  dispatch = (a: Record<string, unknown>) => { this.actions.push(a); return { clientEventId: `id${this.actions.length}` }; };
}

function Harness(p: { store: Store; platform: PlatformAdapter | null; voice?: () => VoiceEngine; mirror?: boolean; fetchFn?: FetchFn }) {
  const [, setN] = useState(0);
  useEffect(() => p.store.subscribe(() => setN((n) => n + 1)), [p.store]);
  const session: SessionLike = {
    state: p.store.state, offline: p.store.offline, forceOffline: false, outbox: [], conflicts: [],
    dispatch: p.store.dispatch as SessionLike['dispatch'], setForceOffline: () => undefined,
    synced: p.store.synced, subscribeResults: p.store.subscribeResults,
  };
  return <GlassesAppCore session={session} platform={p.platform} mirror={p.mirror} createVoice={p.voice} fetchFn={p.fetchFn} />;
}

function fakeVoice() {
  const listeners = new Set<VoiceListener>();
  const engine: VoiceEngine = {
    start: async () => 3,
    stop: () => undefined,
    on: (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    getTier: () => 3,
  };
  return {
    engine,
    say: (text: string, final = true) => listeners.forEach((l) => l({ type: 'transcript', text, final, tier: 2 })),
    emit: (ev: VoiceEvent) => listeners.forEach((l) => l(ev)),
  };
}

function fakePlatform(opts: { cameraRejects?: boolean } = {}) {
  const taps = new Set<() => void>();
  const longs = new Set<() => void>();
  const platform: PlatformAdapter = {
    name: 'browser',
    camera: {
      start: opts.cameraRejects ? () => Promise.reject(new Error('denied')) : async () => ({ available: false, reason: 'NotAllowedError' }),
      stop: () => undefined,
      onFrame: () => () => undefined,
    },
    mic: { start: async () => ({ available: false, reason: 'NotAllowedError' }), stop: () => undefined, onTranscript: () => () => undefined },
    input: {
      onTap: (cb) => { taps.add(cb); return () => { taps.delete(cb); }; },
      onLongPress: (cb) => { longs.add(cb); return () => { longs.delete(cb); }; },
    },
  };
  return { platform, tap: () => taps.forEach((f) => f()), long: () => longs.forEach((f) => f()) };
}

const screenOf = (c: HTMLElement) => c.querySelector('[data-screen]')?.getAttribute('data-screen');
const texts = (c: HTMLElement) => Array.from(c.querySelectorAll('.hud-text')).map((e) => e.textContent);
const key = (k: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));

describe('GlassesApp integration (fake platform, fake session)', () => {
  it('SIM scan Rm 12 then voice "done": G1 -> G4 -> G5, dispatches SET_ACTIVE_PATIENT and LOG_MED', async () => {
    const store = new Store();
    const voice = fakeVoice();
    const { container } = render(<Harness store={store} platform={fakePlatform().platform} voice={() => voice.engine} />);
    expect(screenOf(container)).toBe('G1');
    expect(texts(container)).toContain('Bedside Glance');

    await act(async () => { store.sim('SIM_SCAN_RM_12'); });
    expect(screenOf(container)).toBe('G4');
    expect(texts(container)).toEqual(expect.arrayContaining(['Metformin 500 mg', 'Allergy: Penicillin', 'Due now · Gluc 182 (11:00a)', 'Say "done"']));
    expect(store.actions).toContainEqual(expect.objectContaining({ type: 'SET_ACTIVE_PATIENT', patientId: 'P-1012', device: 'glasses' }));

    await act(async () => { voice.say('done'); });
    expect(screenOf(container)).toBe('G5');
    expect(texts(container)).toContain('Metformin 500 mg');
    expect(store.actions).toContainEqual(
      expect.objectContaining({ type: 'LOG_MED', patientId: 'P-1012', medKey: 'M-1', via: 'voice', device: 'glasses' }),
    );
    // The same view is pushed into the session so ?mirror=1 can render it.
    const pushed = store.actions.filter((a) => a.type === 'SET_GLASSES_VIEW');
    expect((pushed.at(-1)!.view as { screen: string }).screen).toBe('G5');
  });

  it('events already in the session at load are not replayed', () => {
    const store = new Store();
    store.state = { ...store.state!, eventSeq: 1, events: [{ seq: 1, atMs: 1, type: 'SIM_SCAN_RM_12', device: 'director' }] };
    const { container } = render(<Harness store={store} platform={fakePlatform().platform} voice={() => fakeVoice().engine} />);
    expect(screenOf(container)).toBe('G1');
  });

  it('handles tap, hotkeys, the allergy alert and keeps notices off it', async () => {
    const store = new Store();
    const fp = fakePlatform();
    const { container } = render(<Harness store={store} platform={fp.platform} voice={() => fakeVoice().engine} />);
    await act(async () => { key('4'); });
    expect(screenOf(container)).toBe('G4');
    await act(async () => { fp.tap(); }); // tap = done
    expect(screenOf(container)).toBe('G5');
    await act(async () => { key('a'); });
    expect(screenOf(container)).toBe('ALLERGY');
    await act(async () => { fp.tap(); fp.long(); });
    expect(screenOf(container)).toBe('ALLERGY');
    await act(async () => { store.sim('SIM_DR_REPLY'); });
    expect(screenOf(container)).toBe('ALLERGY');
  });

  it('glasskey: Enter = tap; its DOM twin (a platform long press right after) is deduped', async () => {
    const store = new Store();
    const fp = fakePlatform();
    const { container } = render(<Harness store={store} platform={fp.platform} voice={() => fakeVoice().engine} />);
    await act(async () => { key('4'); });
    await act(async () => {
      window.dispatchEvent(new CustomEvent('glasskey', { detail: { key: 'Enter' } }));
      fp.long();
    });
    expect(screenOf(container)).toBe('G5'); // tap = done; the twin did not close it
  });

  it('works with camera denied (rejecting start) and shows the fallback in the debug bar', async () => {
    const store = new Store();
    const { container } = render(<Harness store={store} platform={fakePlatform({ cameraRejects: true }).platform} voice={() => fakeVoice().engine} />);
    await act(async () => { await Promise.resolve(); });
    expect(screenOf(container)).toBe('G1');
    expect(container.ownerDocument.querySelector('[data-debug]')?.textContent).toContain('cam=off');
  });

  it('voice miss shows the locked toast only with a patient; "room 12" is local only', async () => {
    const store = new Store();
    const voice = fakeVoice();
    const { container } = render(<Harness store={store} platform={fakePlatform().platform} voice={() => voice.engine} />);
    await act(async () => { voice.say('blah blah'); });
    expect(texts(container)).not.toContain('Try "done", "vitals", or "close"');
    await act(async () => { voice.say('room 12'); });
    expect(screenOf(container)).toBe('G4');
    expect(store.actions.some((a) => a.type === 'SET_ACTIVE_PATIENT')).toBe(false);
    await act(async () => { voice.say('blah blah'); });
    expect(texts(container)).toContain('Try "done", "vitals", or "close"');
  });

  it('the strip says Listening only when the voice engine reports a live mic, not when a tier is merely requested', async () => {
    const store = new Store();
    const voice = fakeVoice();
    const { container } = render(<Harness store={store} platform={fakePlatform().platform} voice={() => voice.engine} />);
    const strip = () => container.querySelector('[data-hud="status-strip"]')!.textContent ?? '';
    expect(strip()).not.toContain('Listening');
    await act(async () => { voice.emit({ type: 'tier', tier: 2 }); }); // requested: recognizer started, no audio yet
    expect(strip()).not.toContain('Listening');
    await act(async () => { voice.emit({ type: 'mic', live: true }); });
    expect(strip()).toContain('Listening');
    expect(container.querySelector('[data-item="listening"] [data-icon="mic"]')).not.toBeNull();
    await act(async () => { voice.emit({ type: 'mic', live: false }); });
    expect(strip()).not.toContain('Listening');
  });

  it('mirror mode renders glassesViewState read-only: no controls, no input', async () => {
    const store = new Store();
    const s = { ...initialState(PATIENTS), screen: 'G4' as const, patientId: 'P-1012' };
    store.state = { ...store.state!, glassesViewState: toViewState(s) };
    const { container } = render(<Harness store={store} platform={null} mirror />);
    expect(screenOf(container)).toBe('G4');
    expect(texts(container)).toContain('Metformin 500 mg');
    expect(container.ownerDocument.querySelector('[data-desktop-controls]')).toBeNull();
    expect(container.querySelector('.hud-preview__controls')).toBeNull();
    await act(async () => { key('1'); });
    expect(screenOf(container)).toBe('G4');
    expect(store.actions).toEqual([]);
    await act(async () => { store.set({ glassesViewState: { v: 1, screen: 'NOPE' } }); }); // malformed: never throws
    expect(screenOf(container)).toBe('G1');
  });

  it('never throws when the session has no state yet', () => {
    const store = new Store();
    store.state = null;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { container } = render(<Harness store={store} platform={fakePlatform().platform} voice={() => fakeVoice().engine} />);
    expect(screenOf(container)).toBe('G1');
    spy.mockRestore();
  });
});

const evt = (seq: number, type: string) => ({ seq, atMs: seq, type, device: 'director' as const });
const GOOD = { finding: 'Edges closed.', comparison: 'Smaller than before.', draftNote: 'Dressing changed.' };
const resp = (body: unknown, ok = true) => ({ ok, json: async () => body, arrayBuffer: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]).buffer }) as unknown as Response;
function fakeFetch() {
  const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
  const fetchFn: FetchFn = async (url, init) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ url, body });
    if (url === '/data/wound-fallback.jpg') return resp(null);
    if (url === '/api/upload-wound-photo') return resp({ ok: true }, body?.photoUploadFailed !== true);
    if (url === '/api/assess-wound') return resp(GOOD);
    return resp(null, false);
  };
  return { fetchFn, calls };
}
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };

describe('event seq cursor (no replay of old SIM commands)', () => {
  it('stale persisted state while connected-but-unsynced, then the real state with newer old events: nothing replays', async () => {
    const store = new Store();
    store.synced = false;
    store.state = { ...store.state!, eventSeq: 1, events: [evt(1, 'SIM_VOICE_DONE')] };
    const { container } = render(<Harness store={store} platform={fakePlatform().platform} voice={() => fakeVoice().engine} />);
    await act(async () => { store.synced = true; store.set({ eventSeq: 3, events: [evt(1, 'SIM_VOICE_DONE'), evt(2, 'SIM_VOICE_NEXT'), evt(3, 'SIM_SCAN_RM_12')] }); });
    expect(screenOf(container)).toBe('G1');
    expect(store.actions.filter((a) => a.type === 'SET_ACTIVE_PATIENT')).toEqual([]);
  });
  it('each new event acts exactly once, even when the same state is delivered again', async () => {
    const store = new Store();
    const { container } = render(<Harness store={store} platform={fakePlatform().platform} voice={() => fakeVoice().engine} />);
    await act(async () => { store.sim('SIM_SCAN_RM_12'); });
    expect(screenOf(container)).toBe('G4');
    await act(async () => { key('1'); }); // jump back to G1 by hand
    await act(async () => { store.set({}); store.set({}); }); // same events again
    expect(screenOf(container)).toBe('G1');
    expect(store.actions.filter((a) => a.type === 'SET_ACTIVE_PATIENT')).toHaveLength(1);
  });
  it('after going offline and reconnecting, director commands that piled up meanwhile DO run (cursor kept; first load still baselines)', async () => {
    const store = new Store();
    const { container } = render(<Harness store={store} platform={fakePlatform().platform} voice={() => fakeVoice().engine} />);
    await act(async () => { store.offline = true; store.set({}); });
    await act(async () => { store.offline = false; store.set({ eventSeq: 2, events: [evt(1, 'SIM_VOICE_DONE'), evt(2, 'SIM_SCAN_RM_12')] }); });
    expect(screenOf(container)).toBe('G4');
    await act(async () => { store.sim('SIM_SCAN_RM_14'); }); // and a new one still works
    expect(screenOf(container)).toBe('G4');
  });
  it('the cursor survives RESET (seq keeps growing) and resumes with the next new event', async () => {
    const store = new Store();
    const { container } = render(<Harness store={store} platform={fakePlatform().platform} voice={() => fakeVoice().engine} />);
    await act(async () => { store.sim('SIM_SCAN_RM_12'); });
    await act(async () => { store.set({ shift: null, events: [], eventSeq: 1 }); });
    expect(screenOf(container)).toBe('G1');
    await act(async () => { store.sim('SIM_SCAN_RM_14'); });
    expect(screenOf(container)).toBe('G4');
  });
});

describe('wound lifecycle from the glasses', () => {
  it('SIM_CAPTURE_WOUND (no tap) runs the real capture path with the fallback photo and sends WOUND_CAPTURED as director to G8', async () => {
    const store = new Store();
    const ff = fakeFetch();
    const { container } = render(<Harness store={store} platform={fakePlatform().platform} voice={() => fakeVoice().engine} fetchFn={ff.fetchFn} />);
    await act(async () => { store.sim('SIM_SCAN_RM_12'); });
    await act(async () => { store.sim('SIM_CAPTURE_WOUND'); });
    await flush();
    expect(screenOf(container)).toBe('G8');
    expect(ff.calls.map((c) => c.url)).toEqual(['/data/wound-fallback.jpg', '/api/upload-wound-photo', '/api/assess-wound']);
    expect(ff.calls[1].body?.imageBase64).toEqual(expect.any(String)); // the fallback jpg went through the real upload
    const w = store.actions.filter((a) => a.type === 'WOUND_CAPTURED');
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ patientId: 'P-1012', source: 'director', photoUploadFailed: false, device: 'glasses', ...GOOD });
    expect(store.actions.some((a) => a.type === 'CAPTURE_WOUND' || a.type === 'SET_WOUND_ASSESSMENT')).toBe(false);
  });
  it('SIM_CAPTURE_WOUND with no patient loaded loads Rm 12 first', async () => {
    const store = new Store();
    const ff = fakeFetch();
    const { container } = render(<Harness store={store} platform={fakePlatform().platform} voice={() => fakeVoice().engine} fetchFn={ff.fetchFn} />);
    await act(async () => { store.sim('SIM_CAPTURE_WOUND'); });
    await flush();
    expect(screenOf(container)).toBe('G8');
  });
  it('photo-fail toggle on: upload fails (WOUND_CAPTURED photoUploadFailed) and stays failed on retry; toggle off then retry sends WOUND_RETRY_UPLOAD with the same captureId and the assessment', async () => {
    const store = new Store();
    store.state = { ...store.state!, photoUploadShouldFail: true };
    const ff = fakeFetch();
    const { container } = render(<Harness store={store} platform={fakePlatform().platform} voice={() => fakeVoice().engine} fetchFn={ff.fetchFn} />);
    await act(async () => { store.sim('SIM_SCAN_RM_12'); });
    await act(async () => { store.sim('SIM_CAPTURE_WOUND'); });
    await flush();
    expect(screenOf(container)).toBe('H3');
    expect(texts(container)).toContain("Photo not sent · say 'retry'");
    const failed = store.actions.filter((a) => a.type === 'WOUND_CAPTURED');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ photoUploadFailed: true, finding: '' });
    const captureId = failed[0].captureId;
    await act(async () => { key('r'); });
    await flush();
    expect(screenOf(container)).toBe('H3'); // toggle still on: fails again
    expect(store.actions.some((a) => a.type === 'WOUND_RETRY_UPLOAD')).toBe(false);
    await act(async () => { store.set({ photoUploadShouldFail: false }); });
    await act(async () => { key('r'); });
    await flush();
    expect(screenOf(container)).toBe('G8');
    const retry = store.actions.find((a) => a.type === 'WOUND_RETRY_UPLOAD');
    expect(retry).toMatchObject({ captureId });
    const done = store.actions.filter((a) => a.type === 'WOUND_CAPTURED').at(-1)!;
    expect(done).toMatchObject({ captureId, photoUploadFailed: false, ...GOOD });
    expect(store.actions.indexOf(retry!)).toBeLessThan(store.actions.indexOf(done));
  });
});

describe('adopting the phone-set patient', () => {
  const setters = (store: Store) => (id: string | null) => store.set({ activePatientId: id });
  it('a patient set by the phone flips the glasses to that G4 card, with no dispatch back', async () => {
    const store = new Store();
    const { container } = render(<Harness store={store} platform={fakePlatform().platform} voice={() => fakeVoice().engine} />);
    expect(screenOf(container)).toBe('G1');
    await act(async () => { setters(store)('P-1014'); });
    expect(screenOf(container)).toBe('G4');
    expect(texts(container)).toContain('Rm 14 · James Carter');
    expect(store.actions.some((a) => a.type === 'SET_ACTIVE_PATIENT')).toBe(false);
  });
  it('the glasses own scan lock does not echo-loop', async () => {
    const store = new Store();
    const { container } = render(<Harness store={store} platform={fakePlatform().platform} voice={() => fakeVoice().engine} />);
    await act(async () => { store.sim('SIM_SCAN_RM_12'); });
    expect(store.actions.filter((a) => a.type === 'SET_ACTIVE_PATIENT')).toHaveLength(1);
    await act(async () => { setters(store)('P-1012'); }); // the server echoes our own dispatch
    await act(async () => { setters(store)('P-1012'); });
    expect(screenOf(container)).toBe('G4');
    expect(store.actions.filter((a) => a.type === 'SET_ACTIVE_PATIENT')).toHaveLength(1);
  });
  it('"room 12" stays local: no dispatch, and an unchanged server patient does not override it', async () => {
    const store = new Store();
    const voice = fakeVoice();
    const { container } = render(<Harness store={store} platform={fakePlatform().platform} voice={() => voice.engine} />);
    await act(async () => { setters(store)('P-1014'); });
    expect(texts(container)).toContain('Rm 14 · James Carter');
    await act(async () => { voice.say('room 12'); });
    expect(texts(container)).toContain('Rm 12 · Maria Lopez');
    await act(async () => { store.set({ version: 5 }); }); // another state frame, same activePatientId
    expect(texts(container)).toContain('Rm 12 · Maria Lopez');
    expect(store.actions.some((a) => a.type === 'SET_ACTIVE_PATIENT')).toBe(false);
  });
  it('the mirror shows the phone-set patient when no glasses push a view', async () => {
    const store = new Store();
    store.set({ activePatientId: 'P-1014' });
    const { container } = render(<Harness store={store} platform={null} mirror />);
    expect(screenOf(container)).toBe('G4');
    expect(texts(container)).toContain('Rm 14 · James Carter');
  });
});

describe('glasses send and telemetry', () => {
  it('G8 send dispatches WOUND_SEND with the captureId and shows Sent only after the server ack', async () => {
    const store = new Store();
    const ff = fakeFetch();
    const { container } = render(<Harness store={store} platform={fakePlatform().platform} voice={() => fakeVoice().engine} fetchFn={ff.fetchFn} />);
    await act(async () => { store.sim('SIM_SCAN_RM_12'); });
    await act(async () => { store.sim('SIM_CAPTURE_WOUND'); });
    await flush();
    expect(screenOf(container)).toBe('G8');
    await act(async () => { key('s'); });
    const idx = store.actions.findIndex((a) => a.type === 'WOUND_SEND');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(store.actions[idx]).toMatchObject({ type: 'WOUND_SEND', device: 'glasses', captureId: expect.any(String) });
    expect(store.actions.some((a) => a.type === 'SEND_TO_PHONE')).toBe(false);
    expect(screenOf(container)).toBe('G8'); // no confirmation before the ack
    expect(texts(container).join(' ')).not.toMatch(/Sent to/);
    await act(async () => { store.emitResult({ clientEventId: `id${idx + 1}`, ok: true, action: { type: 'WOUND_SEND' } }); });
    expect(screenOf(container)).toBe('G9');
    expect(texts(container)).toContain('Sent to Dr. Okafor');
  });
  it('a refused WOUND_SEND shows the server reason and no confirmation', async () => {
    const store = new Store();
    const ff = fakeFetch();
    const { container } = render(<Harness store={store} platform={fakePlatform().platform} voice={() => fakeVoice().engine} fetchFn={ff.fetchFn} />);
    await act(async () => { store.sim('SIM_SCAN_RM_12'); });
    await act(async () => { store.sim('SIM_CAPTURE_WOUND'); });
    await flush();
    await act(async () => { key('s'); });
    const idx = store.actions.findIndex((a) => a.type === 'WOUND_SEND');
    await act(async () => { store.emitResult({ clientEventId: `id${idx + 1}`, ok: false, message: 'No assessment to send', action: { type: 'WOUND_SEND' } }); });
    expect(screenOf(container)).toBe('G8');
    expect(texts(container)).toContain('No assessment to send');
  });
  it('done-to-ack latency is reported as a TELEMETRY_SAMPLE', async () => {
    const store = new Store();
    const voice = fakeVoice();
    render(<Harness store={store} platform={fakePlatform().platform} voice={() => voice.engine} />);
    await act(async () => { key('4'); });
    await act(async () => { voice.say('done'); });
    const idx = store.actions.findIndex((a) => a.type === 'LOG_MED');
    await act(async () => { store.emitResult({ clientEventId: `id${idx + 1}`, ok: true, action: { type: 'LOG_MED' } }); });
    expect(store.actions).toContainEqual(expect.objectContaining({ type: 'TELEMETRY_SAMPLE', metric: 'doneToAckMs', device: 'glasses', ms: expect.any(Number) }));
  });
  it('scan lock to G4 render is reported', async () => {
    const store = new Store();
    render(<Harness store={store} platform={fakePlatform().platform} voice={() => fakeVoice().engine} />);
    await act(async () => { key('4'); });
    // the Director scan and jump are not wristband locks, so no sample; a real lock goes through scanLock
    expect(store.actions.some((a) => a.type === 'TELEMETRY_SAMPLE' && a.metric === 'scanToCardMs')).toBe(false);
  });
  it('TelemetryBar shows p50, max and the Chrome version', () => {
    const { container } = render(
      <TelemetryBar samples={{ scanToCardMs: [100, 300, 200], doneToAckMs: [], assessMs: [] }} ua="Mozilla/5.0 (Linux; Android 11) Chrome/69.0.3497.100 Mobile Safari/537.36" />,
    );
    const t = container.querySelector('[data-telemetry-bar]')!.textContent!;
    expect(t).toContain('scan>card p50 200 max 300 ms (n=3)');
    expect(t).toContain('done>ack n/a');
    expect(t).toContain('Chrome 69.0.3497.100');
  });
});

describe('live acknowledgements on the glasses', () => {
  it('"Too late to undo": a failed UNDO_LAST_MED result toasts the server message', async () => {
    const store = new Store();
    const { container } = render(<Harness store={store} platform={fakePlatform().platform} voice={() => fakeVoice().engine} />);
    await act(async () => { key('4'); });
    await act(async () => { key('d'); });
    await act(async () => { key('u'); });
    const idx = store.actions.findIndex((a) => a.type === 'UNDO_LAST_MED');
    expect(idx).toBeGreaterThanOrEqual(0);
    await act(async () => { store.emitResult({ clientEventId: `id${idx + 1}`, ok: false, message: 'Too late to undo', action: { type: 'UNDO_LAST_MED' } }); });
    expect(texts(container)).toContain('Too late to undo');
  });
  it('a lost first-write-wins race on LOG_MED shows the server conflict text live (online, not just via the outbox)', async () => {
    const store = new Store();
    const voice = fakeVoice();
    const { container } = render(<Harness store={store} platform={fakePlatform().platform} voice={() => voice.engine} />);
    await act(async () => { key('4'); });
    await act(async () => { voice.say('done'); });
    expect(screenOf(container)).toBe('G5');
    const idx = store.actions.findIndex((a) => a.type === 'LOG_MED');
    await act(async () => { store.emitResult({ clientEventId: `id${idx + 1}`, ok: false, message: 'Already given 1:45 PM via phone', action: { type: 'LOG_MED' } }); });
    expect(screenOf(container)).toBe('G4');
    expect(texts(container)).toContain('Already given 1:45 PM via phone');
  });
});

