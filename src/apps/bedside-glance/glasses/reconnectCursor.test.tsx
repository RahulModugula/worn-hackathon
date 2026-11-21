import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionState } from '../../../../shared/types';
import type { VoiceEngine } from '../../../hud-kit/voice/voiceEngine';
import { GlassesAppCore, choosePlatform, type SessionLike } from './GlassesApp';

afterEach(cleanup);
const base = (over: Partial<SessionState> = {}): SessionState => {
  const now = Date.now();
  return {
    id: 'demo', version: 1, shift: { startedAtMs: now }, clock: { baseMin: 822, startedAtMs: now }, clockOffsetMin: 0,
    activePatientId: null, medStatus: {}, woundCaptures: [], glassesNotice: null, events: [], eventSeq: 0, lastMedLog: null,
    glassesViewState: null, photoUploadShouldFail: false, ...over,
  };
};
const sess = (state: SessionState, offline: boolean, synced: boolean): SessionLike => ({
  state, offline, synced, forceOffline: false, outbox: [], conflicts: [], dispatch: () => ({ clientEventId: 'x' }), setForceOffline: () => undefined,
});
const voice = (): VoiceEngine => ({ start: async () => 3, stop: () => undefined, on: () => () => undefined, getTier: () => 3 });
const screenOf = (c: HTMLElement) => c.querySelector('[data-screen]')?.getAttribute('data-screen');
const ev = (seq: number, type: string) => ({ seq, atMs: seq, type, device: 'director' as const });

describe('director commands across a reconnect', () => {
  it('a SIM command sent while the glasses were offline runs after reconnect; older events are not replayed at first load', async () => {
    const platform = choosePlatform(null);
    // First load: an old event already in the session is baselined, not replayed.
    const old = base({ eventSeq: 1, events: [ev(1, 'SIM_SCAN_RM_14')] });
    const { container, rerender } = render(<GlassesAppCore session={sess(old, false, true)} platform={platform} createVoice={voice} />);
    expect(screenOf(container)).toBe('G1');
    // Connection drops; the persisted (stale) state is shown, unsynced.
    await act(async () => { rerender(<GlassesAppCore session={sess(old, true, false)} platform={platform} createVoice={voice} />); });
    // Reconnect: the server's state now holds a command issued during the gap.
    const fresh = base({ eventSeq: 2, events: [ev(1, 'SIM_SCAN_RM_14'), ev(2, 'SIM_SCAN_RM_12')] });
    await act(async () => { rerender(<GlassesAppCore session={sess(fresh, false, true)} platform={platform} createVoice={voice} />); });
    expect(screenOf(container)).toBe('G4');
  });
});
