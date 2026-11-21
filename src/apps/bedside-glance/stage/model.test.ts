import { describe, expect, it } from 'vitest';
import type { FeedEntry, PeerStats } from '../../../../shared/types';
import { conflictText, deviceRows, latencyText, linkView, newestChain, NONE, replayText } from './model';

const peer = (o: Partial<PeerStats>): PeerStats => ({ device: 'glasses', v: 5, q: 0, rttMs: 42, lastSeenMs: 1, offlineSince: null, lastOfflineMs: null, ...o });

describe('deviceRows', () => {
  it('flips to behind when a connected peer holds an older version, and back to in sync', () => {
    const behind = deviceRows({ peers: [peer({ v: 4 })], serverVersion: 5 });
    expect(behind[0]).toMatchObject({ role: 'Glasses', rtt: '42 ms', version: 'v4', sync: 'behind' });
    expect(deviceRows({ peers: [peer({ v: 5 })], serverVersion: 5 })[0].sync).toBe('in sync');
  });
  it('offline peers are offline (not behind); unreported ones are dashes', () => {
    const rows = deviceRows({ peers: [peer({ offlineSince: 9, v: 1 }), peer({ device: 'phone', v: null, rttMs: null, instance: 'aaaaaaaa' })], serverVersion: 5 });
    expect(rows[0]).toMatchObject({ sync: 'offline', rtt: NONE });
    expect(rows[1]).toMatchObject({ role: 'Phone', sync: NONE, version: NONE, rtt: NONE });
  });
  it('hides the stage own instances and shows nothing before the first stats frame', () => {
    expect(deviceRows({ peers: [peer({ device: 'director', instance: 'self-1234' })], serverVersion: 5 }, ['self-1234'])).toEqual([]);
    expect(deviceRows(null)).toEqual([]);
  });
});

describe('unmeasured states are dashes, never targets', () => {
  it('replay, latency, conflicts, chain and link', () => {
    expect(replayText(undefined, null)).toBe(NONE);
    expect(replayText({ outboxQueuedMs: [] }, null)).toBe(NONE);
    expect(latencyText(undefined)).toBe(NONE);
    expect(latencyText({ doneToAckMs: [] })).toBe(NONE);
    expect(conflictText(undefined)).toBe(NONE);
    expect(conflictText([])).toBe(NONE);
    expect(newestChain(undefined)).toBeNull();
    expect(linkView({}, null, null).text).toBe(NONE);
  });
});

describe('measured text', () => {
  it('replay says 0 lost only when converged with empty outboxes', () => {
    const t = { outboxQueuedMs: [7800, 8123] };
    expect(replayText(t, { peers: [peer({ v: 5 })], serverVersion: 5 })).toBe('2 replayed · queued 8.1 s · 0 lost');
    expect(replayText(t, { peers: [peer({ q: 2 })], serverVersion: 5 })).toBe('2 replayed · queued 8.1 s · 2 still queued');
    expect(replayText(t, { peers: [peer({ v: 4 })], serverVersion: 5 })).toBe('2 replayed · queued 8.1 s · lost -');
    expect(replayText(t, null)).toBe('2 replayed · queued 8.1 s · lost -');
    // A just-reconnected peer that has not reported its version yet is not evidence of convergence.
    expect(replayText(t, { peers: [peer({ v: 5 }), peer({ device: 'phone', v: null })], serverVersion: 5 })).toBe('2 replayed · queued 8.1 s · lost -');
  });
  it('latency last, p50, n', () => {
    expect(latencyText({ doneToAckMs: [30, 10, 20, 50] })).toBe('last 50 ms · p50 20 ms · n=4');
  });
  it('conflict names the device that logged the newest dose', () => {
    const f = (o: Partial<FeedEntry>): FeedEntry => ({ seq: 1, atMs: 1, kind: 'med_given', device: 'phone', timeLabel: '2:05 PM', chain: [], ...o });
    expect(conflictText([f({ medName: 'Metformin 500 mg', device: 'glasses' }), f({ kind: 'wound_sent', device: 'phone' })])).toBe('First write wins: glasses logged Metformin 500 mg at 2:05 PM');
  });
  it('link: Not linked with a down timer, Linked with last outage', () => {
    expect(linkView({ glasses: 0 }, 4200, null)).toEqual({ linked: false, text: 'Not linked · down 4 s' });
    expect(linkView({ glasses: 0 }, null, null).text).toBe('Not linked');
    expect(linkView({ glasses: 1 }, null, 8100)).toEqual({ linked: true, text: 'Linked · last outage 8.1 s' });
    expect(linkView({ glasses: 1 }, null, null).text).toBe('Linked');
  });
  it('newest chain keeps the verification steps', () => {
    const c = newestChain([{ seq: 2, atMs: 1, kind: 'allergy_ack', device: 'glasses', medName: 'Amoxicillin 250 mg', room: '12', timeLabel: '2:01 PM', chain: ['Shown on glasses', 'Server accepted'] }]);
    expect(c).toEqual({ title: 'Allergy acknowledged · Amoxicillin 250 mg · Rm 12 · 2:01 PM', steps: ['Shown on glasses', 'Server accepted'] });
  });
});
