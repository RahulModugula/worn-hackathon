import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { PeerStats, SessionState } from '../../../../shared/types';
import { StageView, STAGE_FOOTER } from './StageView';

afterEach(cleanup);

const peer = (o: Partial<PeerStats>): PeerStats => ({ device: 'glasses', v: 5, q: 0, rttMs: 42, lastSeenMs: 1, offlineSince: null, lastOfflineMs: null, ...o });
const hud = <div>HUD</div>;

describe('StageView', () => {
  it('renders every panel, the honest footer and dashes when nothing is measured', () => {
    render(<StageView state={null} presence={{ glasses: 1, phone: 1, director: 1 }} stats={null} hud={hud} />);
    for (const n of ['Devices', 'Link', 'Replay', 'Conflicts']) expect(screen.getByRole('region', { name: n })).toBeTruthy();
    expect(screen.getByText(STAGE_FOOTER)).toBeTruthy();
    expect(screen.getByTestId('replay-text').textContent).toBe('-');
    expect(screen.getByTestId('latency-text').textContent).toBe('-');
    expect(screen.getByTestId('conflict-text').textContent).toBe('-');
    expect(screen.getByTestId('devices-empty').textContent).toBe('-');
    expect(screen.getByTestId('hud')).toBeTruthy();
  });

  it('shows Not linked when glasses presence is 0', () => {
    render(<StageView state={null} presence={{ glasses: 0, phone: 1, director: 1 }} stats={null} hud={hud} />);
    expect(screen.getByTestId('link-chip').textContent).toBe('Glasses: Not linked');
    expect(screen.getByTestId('link-text').textContent).toContain('Not linked');
  });

  it('flips a device between in sync and behind as the stats frame changes', () => {
    const { rerender } = render(<StageView state={null} presence={{ glasses: 1 }} stats={{ peers: [peer({ v: 5 })], serverVersion: 5 }} hud={hud} />);
    expect(screen.getByText('in sync')).toBeTruthy();
    rerender(<StageView state={null} presence={{ glasses: 1 }} stats={{ peers: [peer({ v: 5 })], serverVersion: 6 }} hud={hud} />);
    expect(screen.getByText('behind')).toBeTruthy();
  });

  it('shows measured replay, latency and the newest chain', () => {
    const state = {
      telemetry: { outboxQueuedMs: [8000], doneToAckMs: [40] },
      feed: [{ seq: 1, atMs: 1, kind: 'med_given', device: 'glasses', medName: 'Metformin 500 mg', room: '12', timeLabel: '2:05 PM', chain: ['Wristband matched', 'Server accepted'] }],
    } as unknown as SessionState;
    render(<StageView state={state} presence={{ glasses: 1 }} stats={{ peers: [peer({})], serverVersion: 5 }} hud={hud} />);
    expect(screen.getByTestId('replay-text').textContent).toBe('1 replayed · queued 8.0 s · 0 lost');
    expect(screen.getByTestId('latency-text').textContent).toBe('last 40 ms · p50 40 ms · n=1');
    expect(screen.getByText('Wristband matched')).toBeTruthy();
  });

  it('runs a down timer while the glasses are away', () => {
    let t = 1000;
    render(<StageView state={null} presence={{ glasses: 0 }} stats={null} hud={hud} now={() => t} />);
    act(() => { t = 5000; });
    return new Promise<void>((done) => setTimeout(() => {
      expect(screen.getByTestId('link-text').textContent).toBe('Not linked · down 4 s');
      done();
    }, 700));
  });
});
