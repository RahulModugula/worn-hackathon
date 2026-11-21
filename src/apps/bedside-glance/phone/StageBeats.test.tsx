import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DirectorDrawer, HOLD_MS } from './DirectorDrawer';
import { computeStageChecks } from './Preflight';

afterEach(() => { cleanup(); vi.useRealTimers(); });

function drawer() {
  const send = vi.fn();
  render(<DirectorDrawer open onClose={() => undefined} send={send} forceOffline={false} setForceOffline={() => undefined} />);
  return send;
}

describe('Stage beats', () => {
  it('sit at the top of the drawer and send the twin actions', () => {
    const send = drawer();
    const first = screen.getAllByRole('button')[1];
    expect(first.textContent).toBe('1 Acknowledge allergy');
    fireEvent.click(first);
    expect(send).toHaveBeenLastCalledWith({ type: 'SIM_ACKNOWLEDGE', device: 'director' });
    fireEvent.click(screen.getByRole('button', { name: '2 Chaos: link down + done' }));
    expect(send).toHaveBeenLastCalledWith({ type: 'SIM_CHAOS_DROP', device: 'director', payload: { ms: 8000, thenDone: true } });
    fireEvent.click(screen.getByRole('button', { name: '3 Hand off Rm 12' }));
    expect(send).toHaveBeenLastCalledWith({ type: 'SIM_HANDOFF_OFFER', device: 'director', payload: { patientId: 'P-1012', toNurseId: 'N-02' } });
  });

  it('Reset to pre-stage needs a 1.2 s hold, then runs reset, start shift, conflicting order in order', () => {
    vi.useFakeTimers();
    const send = drawer();
    const b = screen.getByRole('button', { name: 'Reset to pre-stage' });
    fireEvent.pointerDown(b);
    act(() => { vi.advanceTimersByTime(HOLD_MS - 100); });
    fireEvent.pointerUp(b);
    act(() => { vi.advanceTimersByTime(500); });
    expect(send).not.toHaveBeenCalled(); // released early
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Reset to pre-stage' }));
    act(() => { vi.advanceTimersByTime(HOLD_MS + 10); });
    expect(send.mock.calls.map(c => c[0].type)).toEqual(['RESET_SESSION', 'START_SHIFT', 'SIM_ADD_CONFLICT_ORDER']);
  });
});

describe('computeStageChecks', () => {
  it('flags each missing piece with a plain-English fix', () => {
    const bad = computeStageChecks({ presence: { glasses: 0, phone: 0, director: 0 }, directorSelf: false });
    expect(bad.map(c => c.ok)).toEqual([false, false, false, false]);
    expect(bad.every(c => c.fix.length > 10)).toBe(true);
    const good = computeStageChecks({ extraOrdersPresent: true, presence: { glasses: 1, phone: 1, director: 1 }, directorSelf: true });
    expect(good.every(c => c.ok)).toBe(true);
  });
});
