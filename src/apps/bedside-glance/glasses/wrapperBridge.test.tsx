import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionState } from '../../../../shared/types';
import { createMicroLuminPlatform } from '../../../hud-kit/platform/microlumin';
import type { VoiceEngine } from '../../../hud-kit/voice/voiceEngine';
import { GlassesAppCore, choosePlatform, type SessionLike } from './GlassesApp';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** Exactly what android-wrapper/M6Bridge.kt exposes: log and getInfo, nothing else. */
const wrapperBridge = () => ({ log: () => undefined, getInfo: () => '{}' });

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
const screenOf = (c: HTMLElement) => c.querySelector('[data-screen]')?.getAttribute('data-screen');
const key = (k: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));
const glasskey = (detail: object) => window.dispatchEvent(new CustomEvent('glasskey', { detail }));

describe('Android wrapper bridge (log + getInfo only)', () => {
  it('uses the browser platform, so the real getUserMedia camera path runs', async () => {
    const platform = choosePlatform(wrapperBridge());
    expect(platform.name).toBe('browser');
    const getUserMedia = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    const r = await platform.camera.start();
    expect(getUserMedia).toHaveBeenCalled();
    expect(r).toEqual({ available: false, reason: 'NotAllowedError' });
  });

  it('uses the microlumin platform only when the bridge provides frames', () => {
    expect(choosePlatform({ onFrame: () => undefined }).name).toBe('microlumin');
    expect(choosePlatform(null).name).toBe('browser');
  });

  it('glasskey DPAD_CENTER (23) down = tap, up does nothing; its DOM Enter twin is not a second tap', async () => {
    const { container } = render(<GlassesAppCore session={session()} platform={choosePlatform(wrapperBridge())} createVoice={voice} />);
    await act(async () => { key('4'); });
    expect(screenOf(container)).toBe('G4');
    await act(async () => { glasskey({ code: 23, action: 'up', scanCode: 0, source: 'k' }); });
    expect(screenOf(container)).toBe('G4');
    await act(async () => { glasskey({ code: 23, action: 'down', scanCode: 0, source: 'k' }); key('Enter'); });
    expect(screenOf(container)).toBe('G5'); // one tap = done
  });

  it('ENTER (66) down = tap; BACK long-press (4) = long press', async () => {
    const { container } = render(<GlassesAppCore session={session()} platform={choosePlatform(wrapperBridge())} createVoice={voice} />);
    await act(async () => { key('4'); });
    await act(async () => { glasskey({ code: 66, action: 'down' }); });
    expect(screenOf(container)).toBe('G5');
    await act(async () => { key('4'); });
    expect(screenOf(container)).toBe('G4');
    await act(async () => { glasskey({ code: 4, action: 'long-press' }); });
    expect(screenOf(container)).not.toBe('G4');
  });

  it('DOM Enter = tap and Escape = long press on the microlumin stub platform too', async () => {
    const platform = createMicroLuminPlatform({ onFrame: () => undefined });
    const { container } = render(<GlassesAppCore session={session()} platform={platform} createVoice={voice} />);
    await act(async () => { key('4'); });
    await act(async () => { key('Enter'); });
    expect(screenOf(container)).toBe('G5');
    await act(async () => { key('4'); });
    await act(async () => { key('Escape'); });
    expect(screenOf(container)).not.toBe('G4');
  });
});

describe('voice: done is final-only and short-only', () => {
  it('an interim "done" does nothing, a final "done" acts, "not done yet" never acts', async () => {
    const listeners = new Set<(e: unknown) => void>();
    const engine: VoiceEngine = { start: async () => 3, stop: () => undefined, on: (l) => { listeners.add(l as never); return () => undefined; }, getTier: () => 3 };
    const say = (text: string, final: boolean) => listeners.forEach((l) => l({ type: 'transcript', text, final, tier: 2 }));
    const { container } = render(<GlassesAppCore session={session()} platform={choosePlatform(wrapperBridge())} createVoice={() => engine} />);
    await act(async () => { key('4'); });
    await act(async () => { say('done', false); });
    expect(screenOf(container)).toBe('G4');
    await act(async () => { say('not done yet', true); });
    expect(screenOf(container)).toBe('G4');
    await act(async () => { say('done', true); });
    expect(screenOf(container)).toBe('G5');
  });
});
