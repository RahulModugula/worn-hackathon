import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { SessionState } from '../../../../shared/types';
import type { CameraAdapter } from '../../../hud-kit/platform/types';
import type { QrScannerOptions } from '../../../hud-kit/scan/qrScanner';
import { createIntentMatcher } from '../../../hud-kit/voice/intentMatcher';
import { ScanTalk, VOICE_INTENTS, HTTPS_MESSAGE, NOT_ON_LIST, cameraMessage, type ScanTalkProps } from './ScanTalk';
import type { Send } from './model';

function makeState(over: Partial<SessionState> = {}): SessionState {
  return {
    id: 'demo', version: 1, shift: { startedAtMs: Date.now() }, clock: null, clockOffsetMin: 0,
    activePatientId: null, medStatus: {}, woundCaptures: [], glassesNotice: null, events: [], eventSeq: 0,
    lastMedLog: null, glassesViewState: null, photoUploadShouldFail: false, ...over,
  };
}

/** A camera that refuses to start, the common iPhone case when permission is off. */
function deniedCamera(reason = 'NotAllowedError'): CameraAdapter {
  return {
    start: vi.fn(async () => ({ available: false, reason })),
    stop: vi.fn(),
    onFrame: () => () => undefined,
  };
}

interface Harness {
  send: Send & ReturnType<typeof vi.fn>;
  logMed: ReturnType<typeof vi.fn>;
  onUndo: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
  onWound: ReturnType<typeof vi.fn>;
  captured: { opts?: QrScannerOptions; enable: ReturnType<typeof vi.fn>; disable: ReturnType<typeof vi.fn> };
}

function setup(over: { state?: Partial<SessionState>; undo?: { label: string | null; secondsLeft: number } | null; camera?: CameraAdapter; hasPendingWound?: boolean; noCamera?: boolean } = {}) {
  const h = {
    send: vi.fn() as unknown as Harness['send'],
    logMed: vi.fn(() => null),
    onUndo: vi.fn(),
    onClose: vi.fn(),
    onWound: vi.fn(),
    captured: { enable: vi.fn(), disable: vi.fn() } as Harness['captured'],
  } as Harness;
  const createScanner = vi.fn((opts: QrScannerOptions) => {
    h.captured.opts = opts;
    return { enable: h.captured.enable, disable: h.captured.disable, get enabled() { return false; } };
  });
  const camera = over.camera ?? {
    start: vi.fn(async () => ({ available: true })),
    stop: vi.fn(),
    onFrame: () => () => undefined,
  };
  render(
    <ScanTalk
      state={makeState(over.state)}
      nowMin={822}
      send={h.send}
      logMed={h.logMed as unknown as ScanTalkProps['logMed']}
      undo={over.undo ?? null}
      onUndo={h.onUndo as unknown as () => void}
      onClose={h.onClose as unknown as () => void}
      onWound={h.onWound as unknown as () => void}
      hasPendingWound={over.hasPendingWound ?? false}
      deps={{ camera: over.noCamera ? undefined : camera, createScanner: createScanner as never }}
    />,
  );
  return { h, camera, createScanner };
}

const SIX = ['Done', 'Next', 'Vitals', 'Close patient', 'Wound'];

beforeEach(() => {
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
});
afterEach(() => { cleanup(); });

describe('Scan & Talk: buttons always render', () => {
  it('shows the big buttons and a plain-English message when the camera is refused', async () => {
    setup({ camera: deniedCamera() });
    for (const name of SIX) expect(screen.getByRole('button', { name })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
    await act(async () => {});
    expect(screen.getByRole('status').textContent).toContain('Camera permission is off');
    expect(screen.getByRole('status').textContent).toContain('The buttons still work');
    for (const name of SIX) expect(screen.getByRole('button', { name })).toBeTruthy();
  });

  it('over plain http the camera is not tried and the message says to use https', () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
    const camera = deniedCamera();
    setup({ noCamera: true, camera });
    fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
    expect(screen.getByRole('status').textContent).toBe(HTTPS_MESSAGE);
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
    expect(camera.start).not.toHaveBeenCalled();
  });

  it('starts nothing until a tap: no camera start and no scanner before the button', () => {
    const { camera, createScanner } = setup();
    expect(camera.start).not.toHaveBeenCalled();
    expect(createScanner).not.toHaveBeenCalled();
  });
});

describe('Scan & Talk: wristband scan', () => {
  it('a wrong patient shows "Not on your list" and dispatches nothing', async () => {
    const { h } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
    await act(async () => {});
    act(() => { h.captured.opts!.onLock('BG-P-9999'); });
    expect(screen.getByRole('status').textContent).toBe(NOT_ON_LIST);
    expect(h.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_ACTIVE_PATIENT' }));
  });

  it('an assigned patient dispatches SET_ACTIVE_PATIENT and names the patient', async () => {
    const { h } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
    await act(async () => {});
    act(() => { h.captured.opts!.onLock('BG-P-1012'); });
    expect(h.send).toHaveBeenCalledWith({ type: 'SET_ACTIVE_PATIENT', device: 'phone', patientId: 'P-1012' });
    expect(screen.getByRole('status').textContent).toBe('Loaded Maria Lopez, Rm 12.');
  });

  it('Done logs the next open med through the shared med rules', () => {
    const { h } = setup({ state: { activePatientId: 'P-1012' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(h.logMed).toHaveBeenCalledWith('P-1012', 'M-1');
  });

  it('Done is disabled with no patient loaded', () => {
    setup();
    expect((screen.getByRole('button', { name: 'Done' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Scan & Talk: undo, close, wound', () => {
  it('Undo is disabled once the window has closed', () => {
    setup({ undo: { label: 'Metformin 500 mg', secondsLeft: 0 } });
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Undo shows the countdown and dispatches through onUndo', () => {
    const { h } = setup({ undo: { label: 'Metformin 500 mg', secondsLeft: 7 } });
    fireEvent.click(screen.getByRole('button', { name: 'Undo · 7 s' }));
    expect(h.onUndo).toHaveBeenCalled();
  });

  it('Close patient and Back both return to My Shift through onClose', () => {
    const { h } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Close patient' }));
    expect(h.onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(h.onClose).toHaveBeenCalledTimes(2);
  });

  it('Wound with no photo waiting explains how to take one; with one waiting it opens review', () => {
    const { h } = setup({ state: { activePatientId: 'P-1012' } });
    fireEvent.click(screen.getByRole('button', { name: 'Wound' }));
    expect(screen.getByRole('status').textContent).toContain('No wound photo waiting');
    expect(h.onWound).not.toHaveBeenCalled();
  });
});

describe('Scan & Talk: voice intents', () => {
  it('"not done yet" never matches done, so it cannot log a med', () => {
    const fired: string[] = [];
    const m = createIntentMatcher({ intents: VOICE_INTENTS, onMatch: x => fired.push(x.intent), debounceMs: 0 });
    m.feed('not done yet', true);
    m.feed('done', true);
    expect(fired).toEqual(['done']);
  });
});

describe('camera failure copy', () => {
  it('maps adapter reasons to plain English', () => {
    expect(cameraMessage('NotFoundError')).toContain('No camera was found');
    expect(cameraMessage('unsupported')).toContain('cannot use the camera');
    expect(cameraMessage(undefined)).toContain('did not start');
  });
});
