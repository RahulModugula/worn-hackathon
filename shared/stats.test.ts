import { describe, expect, it } from 'vitest';
import { convergence, parsePing } from './stats';
import type { PeerStats } from './types';

const peer = (over: Partial<PeerStats>): PeerStats => ({ device: 'glasses', v: 5, q: 0, rttMs: 20, lastSeenMs: 0, offlineSince: null, lastOfflineMs: null, ...over });

describe('convergence', () => {
  it('is converged when every connected peer holds the server version', () => {
    expect(convergence([peer({}), peer({ device: 'phone' })], 5)).toMatchObject({ status: 'converged', behind: [] });
  });
  it('flips to behind when a connected peer holds a different version, and names it', () => {
    const r = convergence([peer({}), peer({ device: 'phone', v: 4 })], 5);
    expect(r.status).toBe('behind');
    expect(r.behind.map((p) => p.device)).toEqual(['phone']);
  });
  it('flips back to converged once the lagging peer reports the new version', () => {
    expect(convergence([peer({ v: 4 })], 5).status).toBe('behind');
    expect(convergence([peer({ v: 5 })], 5).status).toBe('converged');
  });
  it('an unreported version is unknown, not behind; an offline peer is listed separately, not as behind', () => {
    expect(convergence([peer({ v: null })], 5).status).toBe('converged');
    const r = convergence([peer({}), peer({ device: 'phone', v: 1, offlineSince: 100 })], 5);
    expect(r.status).toBe('converged');
    expect(r.offline.map((p) => p.device)).toEqual(['phone']);
  });
  it('is idle with nobody connected', () => {
    expect(convergence([], 5).status).toBe('idle');
    expect(convergence([peer({ offlineSince: 1 })], 5).status).toBe('idle');
  });
});

describe('parsePing (untrusted)', () => {
  it('accepts bounded numbers and drops everything else', () => {
    expect(parsePing({ t: 'ping', v: 7, q: 2, rtt: 31.4, offlineMs: 4000 })).toEqual({ v: 7, q: 2, rttMs: 31, offlineMs: 4000 })
    expect(parsePing({ t: 'ping', n: 9 })).toEqual({ n: 9 })
    expect(parsePing({ t: 'ping', n: -1 })).toEqual({});
    expect(parsePing({ t: 'ping' })).toEqual({});
    expect(parsePing(null)).toEqual({});
    expect(parsePing({ t: 'ping', v: -1, q: 1e9, rtt: Infinity, offlineMs: 'x' })).toEqual({});
    expect(parsePing({ t: 'ping', v: 1.5 })).toEqual({});
    expect(parsePing({ t: 'ping', v: NaN, q: null })).toEqual({});
  });
});
