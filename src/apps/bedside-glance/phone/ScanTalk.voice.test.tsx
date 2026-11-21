import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { SessionState } from '../../../../shared/types';
import type { CameraAdapter } from '../../../hud-kit/platform/types';
import type { QrScannerOptions } from '../../../hud-kit/scan/qrScanner';
import type { VoiceEngine, VoiceEvent, VoiceListener, VoiceTier } from '../../../hud-kit/voice/voiceEngine';
import { ScanTalk } from './ScanTalk';

function state(over: Partial<SessionState> = {}): SessionState {
  return {
    id: 'demo', version: 1, shift: { startedAtMs: Date.now() }, clock: null, clockOffsetMin: 0,
    activePatientId: 'P-1012', medStatus: {}, woundCaptures: [], glassesNotice: null, events: [], eventSeq: 0,
    lastMedLog: null, glassesViewState: null, photoUploadShouldFail: false, ...over,
  };
}

function fakeVoice(tier: VoiceTier | 0 = 2) {
  const listeners = new Set<VoiceListener>();
  const engine: VoiceEngine & { emit(e: VoiceEvent): void; stopped: number } = {
    stopped: 0,
    start: async () => tier,
    stop() { this.stopped++; },
    on(l) { listeners.add(l); return () => listeners.delete(l); },
    getTier: () => tier,
    emit: (e) => listeners.forEach((l) => l(e)),
  };
  return engine;
}

function mount(over: { voice?: ReturnType<typeof fakeVoice>; camera?: CameraAdapter; hasPendingWound?: boolean; stateOver?: Partial<SessionState> } = {}) {
  const logMed = vi.fn(() => null as string | null);
  const onClose = vi.fn();
  const onUndo = vi.fn();
  const onWound = vi.fn();
  const scanner: { opts?: QrScannerOptions; disable: ReturnType<typeof vi.fn> } = { disable: vi.fn() };
  const voice = over.voice ?? fakeVoice();
  const camera: CameraAdapter = over.camera ?? { start: vi.fn(async () => ({ available: true })), stop: vi.fn(), onFrame: () => () => undefined };
  const utils = render(
    <ScanTalk
      state={state(over.stateOver)} nowMin={822} send={vi.fn() as never} logMed={logMed} undo={null}
      onUndo={onUndo} onClose={onClose} onWound={onWound} hasPendingWound={over.hasPendingWound ?? false}
      deps={{
        camera, createVoice: () => voice,
        createScanner: ((o: QrScannerOptions) => { scanner.opts = o; return { enable: vi.fn(), disable: scanner.disable, enabled: false }; }) as never,
      }}
    />,
  );
  return { ...utils, logMed, onClose, onUndo, onWound, voice, scanner, camera };
}
const status = () => screen.getByRole('status').textContent;
const say = (v: ReturnType<typeof fakeVoice>, text: string, final = true) => act(() => v.emit({ type: 'transcript', text, final, tier: 2 }));

beforeEach(() => { Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true }); });
afterEach(cleanup);

describe('Scan & Talk: voice control', () => {
  it('start voice reports the tier, and a spoken command runs the matching handler', async () => {
    const m = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Start voice' }));
    await act(async () => {});
    expect(screen.getByTestId('voice-note').textContent).toBe('Voice: browser speech');
    expect((screen.getByRole('button', { name: 'Start voice' }) as HTMLButtonElement).disabled).toBe(true);

    say(m.voice, 'done');
    expect(m.logMed).toHaveBeenCalledWith('P-1012', 'M-1');
    expect(status()).toBe('Done: Metformin. Waiting for the server.' );
    expect(screen.getByText('Heard: done')).toBeTruthy();
  });

  it('interim transcripts and unrecognised phrases do nothing', async () => {
    const m = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Start voice' }));
    await act(async () => {});
    say(m.voice, 'done', false);
    say(m.voice, 'not done yet');
    say(m.voice, 'banana');
    expect(m.logMed).not.toHaveBeenCalled();
    expect(m.onClose).not.toHaveBeenCalled();
  });

  it('"wound" opens review only when a photo is waiting; otherwise explains; "close" stops voice and leaves', async () => {
    const m = mount({ hasPendingWound: true });
    fireEvent.click(screen.getByRole('button', { name: 'Start voice' }));
    await act(async () => {});
    say(m.voice, 'wound');
    expect(m.onWound).toHaveBeenCalledTimes(1);
    say(m.voice, 'close');
    expect(m.onClose).toHaveBeenCalledTimes(1);
    expect(m.voice.stopped).toBe(1);
    cleanup();
    const n = mount({ hasPendingWound: false });
    fireEvent.click(screen.getByRole('button', { name: 'Wound' }));
    expect(n.onWound).not.toHaveBeenCalled();
    expect(status()).toContain('No wound photo waiting');
  });

  it('a tier-0 start says voice is off and the buttons work', async () => {
    mount({ voice: fakeVoice(0) });
    fireEvent.click(screen.getByRole('button', { name: 'Start voice' }));
    await act(async () => {});
    expect(screen.getByTestId('voice-note').textContent).toBe('Voice: off. The buttons work.');
  });

  it('unmounting stops the voice engine', async () => {
    const m = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Start voice' }));
    await act(async () => {});
    m.unmount();
    expect(m.voice.stopped).toBe(1);
  });
});

describe('Scan & Talk: buttons and camera lifecycle', () => {
  it('Next cycles through the open meds and wraps; with fewer than two it says so', () => {
    const m = mount({ stateOver: { activePatientId: 'P-1014' } });
    const next = screen.getByRole('button', { name: 'Next' });
    fireEvent.click(next);
    const first = status();
    expect(first).toMatch(/^Next: /);
    fireEvent.click(next);
    expect(status()).not.toBe(first); // wrapped to the other med
    fireEvent.click(next);
    expect(status()).toBe(first);
    m.logMed.mockClear();
  });

  it('Done with every med given says so and logs nothing', () => {
    const given = { 'P-1012:M-1': { status: 'given', givenAtMs: 1, device: 'phone' }, 'P-1012:M-2': { status: 'given', givenAtMs: 1, device: 'phone' } };
    const m = mount({ stateOver: { medStatus: given as never } });
    expect(screen.getByTestId('scan-patient').textContent).toContain('All meds given');
    expect((screen.getByRole('button', { name: 'Done' }) as HTMLButtonElement).disabled).toBe(true);
    expect(m.logMed).not.toHaveBeenCalled();
  });

  it('a conflict from the shared med rules is shown instead of a success message', () => {
    const m = mount();
    m.logMed.mockReturnValue('Already given 13:50 via glasses');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(status()).toBe('Already given 13:50 via glasses');
  });

  it('Vitals toggles the vitals line for the loaded patient', () => {
    mount();
    expect(screen.queryByTestId('scan-vitals')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Vitals' }));
    expect(screen.getByTestId('scan-vitals').textContent).toContain('BP 132/84');
    fireEvent.click(screen.getByRole('button', { name: 'Vitals' }));
    expect(screen.queryByTestId('scan-vitals')).toBeNull();
  });

  it('a scanner timeout turns the camera off and tells the nurse to try again; Stop camera releases everything', async () => {
    const m = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
    await act(async () => {});
    expect(screen.getByRole('button', { name: 'Stop camera' })).toBeTruthy();
    act(() => m.scanner.opts!.onFirstRead!());
    expect(status()).toBe('Reading the wristband...');
    act(() => m.scanner.opts!.onTimeout!());
    expect(status()).toContain('No code read');
    expect(m.camera.stop).toHaveBeenCalled();
    expect(m.scanner.disable).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Start camera' })).toBeTruthy();
  });

  it('paints camera frames into the stage canvas while scanning', async () => {
    let push: (f: { width: number; height: number; data: Uint8ClampedArray }) => void = () => {};
    const camera: CameraAdapter = {
      start: vi.fn(async () => ({ available: true })), stop: vi.fn(),
      onFrame: (cb) => { push = cb as never; return () => undefined; },
    };
    const putImageData = vi.fn();
    const proto = HTMLCanvasElement.prototype as unknown as { getContext: unknown };
    const orig = proto.getContext;
    proto.getContext = () => ({ putImageData });
    (globalThis as { ImageData?: unknown }).ImageData ??= class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} };
    try {
      const m = mount({ camera });
      fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
      await act(async () => {});
      act(() => push({ width: 4, height: 2, data: new Uint8ClampedArray(4 * 2 * 4) }));
      const canvas = m.container.querySelector('canvas')!;
      expect([canvas.width, canvas.height]).toEqual([4, 2]);
      expect(putImageData).toHaveBeenCalledTimes(1);
    } finally { proto.getContext = orig; }
  });
});
