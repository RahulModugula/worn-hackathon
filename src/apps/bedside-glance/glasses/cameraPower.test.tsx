import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionState } from '../../../../shared/types';
import { createBrowserCamera } from '../../../hud-kit/platform/browser';
import type { PlatformAdapter } from '../../../hud-kit/platform/types';
import type { VoiceEngine } from '../../../hud-kit/voice/voiceEngine';
import { GlassesAppCore, type SessionLike } from './GlassesApp';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function session(): SessionLike {
  const now = Date.now();
  const st: SessionState = {
    id: 'demo', version: 1, shift: { startedAtMs: now }, clock: { baseMin: 822, startedAtMs: now }, clockOffsetMin: 0,
    activePatientId: null, medStatus: {}, woundCaptures: [], glassesNotice: null, events: [], eventSeq: 0, lastMedLog: null,
    glassesViewState: null, photoUploadShouldFail: false,
  };
  return { state: st, offline: false, forceOffline: false, outbox: [], conflicts: [], dispatch: () => ({ clientEventId: 'x' }), setForceOffline: () => undefined };
}
const voice = (): VoiceEngine => ({ start: async () => 3, stop: () => undefined, on: () => () => undefined, getTier: () => 3 });
const key = (k: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));

describe('camera power', () => {
  it('pauses the camera once a patient is loaded and resumes on return to the scan screens', async () => {
    const pause = vi.fn(), resume = vi.fn();
    const platform: PlatformAdapter = {
      name: 'browser',
      camera: { start: async () => ({ available: true }), stop: () => undefined, onFrame: () => () => undefined, pause, resume },
      mic: { start: async () => ({ available: false }), stop: () => undefined, onTranscript: () => () => undefined },
      input: { onTap: () => () => undefined, onLongPress: () => () => undefined },
    };
    render(<GlassesAppCore session={session()} platform={platform} createVoice={voice} />);
    await act(async () => { await Promise.resolve(); });
    expect(pause).not.toHaveBeenCalled();
    await act(async () => { key('4'); }); // G4: patient loaded, scanner disabled
    expect(pause).toHaveBeenCalledTimes(1);
    await act(async () => { key('1'); }); // back to G1
    expect(resume).toHaveBeenCalled();
  });

  it('browser camera: pause stops the getImageData pump and disables tracks; resume restarts both', async () => {
    vi.useFakeTimers();
    const track = { enabled: true, stop: vi.fn() };
    const stream = { getTracks: () => [track] };
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => stream } });
    const getImageData = vi.fn(() => ({ data: new Uint8ClampedArray(4) }));
    const ctx = { drawImage: vi.fn(), getImageData };
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'video') return { muted: false, playsInline: false, srcObject: null, readyState: 4, play: async () => undefined } as unknown as HTMLElement;
      if (tag === 'canvas') return { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLElement;
      return realCreate(tag);
    });
    const cam = createBrowserCamera();
    cam.onFrame(() => undefined);
    expect((await cam.start()).available).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    const running = getImageData.mock.calls.length;
    expect(running).toBeGreaterThan(0);
    cam.pause!();
    expect(track.enabled).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(getImageData.mock.calls.length).toBe(running);
    cam.resume!();
    expect(track.enabled).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(getImageData.mock.calls.length).toBeGreaterThan(running);
    vi.restoreAllMocks();
  });
});
