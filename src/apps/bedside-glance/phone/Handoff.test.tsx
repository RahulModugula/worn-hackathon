import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { FeedEntry, HandoffPacket, SessionEvent, SessionState } from '../../../../shared/types';
import { PhoneApp, GIVEN_BANNER_MS } from './PhoneApp';
import { HandoffSheet } from './HandoffSheet';
import { P4ActivityFeed } from './P4ActivityFeed';
import { nextNurse, nurseFromId, offeredBy, offeredTo, unreadCritical } from './model';
import { useBedsideSession } from './useBedsideSession';

vi.mock('./useBedsideSession', () => ({ useBedsideSession: vi.fn() }));
type Session = ReturnType<typeof useBedsideSession>;
const mocked = vi.mocked(useBedsideSession);

const packet = (over: Partial<HandoffPacket> = {}): HandoffPacket => ({
  handoffId: 'H-1', patientId: 'P-1012', fromNurseId: 'N-01', toNurseId: 'N-02', status: 'offered',
  offeredByInstance: 'a'.repeat(8), offeredVia: 'glasses', createdLabel: '2:05 PM', readBack: [],
  items: [
    { section: 'I', text: 'Illness severity: Not stated', critical: false },
    { section: 'P', text: 'Maria Lopez · Rm 12', critical: false },
    { section: 'P', text: 'Allergies: Penicillin', critical: true },
    { section: 'A', text: 'Metformin 500 mg due 2:30 PM', critical: false },
    { section: 'A', text: 'Lisinopril 10 mg given 1:50 PM', critical: true },
    { section: 'S', text: 'Wound dressing due 4:00 PM', critical: false },
  ],
  ...over,
});

function makeState(over: Partial<SessionState> = {}): SessionState {
  return {
    id: 'demo', version: 1, shift: { startedAtMs: Date.now() }, clock: { baseMin: 822, startedAtMs: Date.now() },
    clockOffsetMin: 0, activePatientId: 'P-1012', medStatus: {}, woundCaptures: [], glassesNotice: null, events: [], eventSeq: 0,
    lastMedLog: null, glassesViewState: null, photoUploadShouldFail: false, ...over,
  };
}
const makeSession = (state: SessionState, extra: Record<string, unknown> = {}): Session =>
  ({ state, offline: false, forceOffline: false, conflicts: [], presence: {}, lastResult: null, setForceOffline: vi.fn(), clearConflicts: vi.fn(), send: vi.fn(), ...extra }) as unknown as Session;

beforeEach(() => { mocked.mockReset(); window.history.pushState({}, '', '/phone'); });
afterEach(() => { cleanup(); vi.useRealTimers(); window.history.pushState({}, '', '/'); });

describe('model helpers', () => {
  it('maps ?nurse ids to the roster and falls back to the signed-in nurse', () => {
    expect(nurseFromId('N-02').name).toBe('Marcus T.');
    expect(nurseFromId('bogus').id).toBe('N-01');
    expect(nurseFromId(null).id).toBe('N-01');
  });
  it('picks the next roster nurse, wrapping, never yourself', () => {
    expect(nextNurse('N-01')?.id).toBe('N-02');
    expect(nextNurse('N-02')?.id).toBe('N-01');
  });
  it('finds offers by receiver and sender, and unread critical indexes', () => {
    const st = makeState({ handoffs: [packet(), packet({ handoffId: 'H-2', status: 'accepted' })] });
    expect(offeredTo(st, 'N-02')?.handoffId).toBe('H-1');
    expect(offeredTo(st, 'N-01')).toBeNull();
    expect(offeredBy(st, 'N-01', 'P-1012')?.handoffId).toBe('H-2');
    expect(unreadCritical(packet({ readBack: [2] }))).toEqual([4]);
  });
});

describe('HandoffSheet', () => {
  it('shows the sections, honest copy and "Not stated" severity', () => {
    render(<HandoffSheet packet={packet()} send={vi.fn()} lastResult={null} onClose={vi.fn()} />);
    expect(screen.getByText(/Built from the shift log, not written by AI/)).toBeTruthy();
    expect(within(screen.getByTestId('handoff-severity')).getByText('Not stated')).toBeTruthy();
    for (const name of ['Patient', 'Action list', 'Situation', 'Synthesis']) expect(screen.getByRole('region', { name })).toBeTruthy();
    expect(screen.getByText('Metformin 500 mg due 2:30 PM')).toBeTruthy();
  });
  it('shows a nurse-selected severity', () => {
    render(<HandoffSheet packet={packet({ severity: 'Watch' })} send={vi.fn()} lastResult={null} onClose={vi.fn()} />);
    expect(within(screen.getByTestId('handoff-severity')).getByText('Watch')).toBeTruthy();
  });
  it('gives only critical items a Read back control and dispatches HANDOFF_READBACK with the item index', () => {
    const send = vi.fn();
    render(<HandoffSheet packet={packet()} send={send} lastResult={null} onClose={vi.fn()} />);
    const buttons = screen.getAllByRole('button', { name: /^Read back:/ });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]);
    expect(send).toHaveBeenCalledWith({ type: 'HANDOFF_READBACK', device: 'phone', handoffId: 'H-1', index: 4 });
  });
  it('disables Accept until every critical item is read back, then dispatches HANDOFF_ACCEPT', () => {
    const send = vi.fn();
    const { rerender } = render(<HandoffSheet packet={packet({ readBack: [2] })} send={send} lastResult={null} onClose={vi.fn()} />);
    const accept = () => screen.getByRole('button', { name: 'Accept handoff' }) as HTMLButtonElement;
    expect(accept().disabled).toBe(true);
    expect(screen.getByTestId('handoff-progress').textContent).toBe('Read back 1 of 2 critical items');
    fireEvent.click(accept());
    expect(send).not.toHaveBeenCalled();
    rerender(<HandoffSheet packet={packet({ readBack: [2, 4] })} send={send} lastResult={null} onClose={vi.fn()} />);
    expect(accept().disabled).toBe(false);
    expect(screen.getByTestId('readback-done-2')).toBeTruthy();
    fireEvent.click(accept());
    expect(send).toHaveBeenCalledWith({ type: 'HANDOFF_ACCEPT', device: 'phone', handoffId: 'H-1' });
  });
  it('shows the server refusal text (accept refused) and clears it on the next success', () => {
    const p = packet({ readBack: [2, 4] });
    const { rerender } = render(<HandoffSheet packet={p} send={vi.fn()} lastResult={{ seq: 1, ok: true }} onClose={vi.fn()} />);
    expect(screen.queryByRole('alert')).toBeNull(); // a result from before the sheet opened is ignored
    rerender(<HandoffSheet packet={p} send={vi.fn()} lastResult={{ seq: 2, ok: false, message: "Accept on the receiving nurse's device" }} onClose={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toContain("Accept on the receiving nurse's device");
    rerender(<HandoffSheet packet={p} send={vi.fn()} lastResult={{ seq: 3, ok: true }} onClose={vi.fn()} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('shows the read-back refusal text', () => {
    const p = packet();
    const { rerender } = render(<HandoffSheet packet={p} send={vi.fn()} lastResult={null} onClose={vi.fn()} />);
    rerender(<HandoffSheet packet={p} send={vi.fn()} lastResult={{ seq: 1, ok: false, message: "Read back on the receiving nurse's device" }} onClose={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toContain("Read back on the receiving nurse's device");
  });
  it('Not now closes the sheet', () => {
    const onClose = vi.fn();
    render(<HandoffSheet packet={packet()} send={vi.fn()} lastResult={null} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('receiving nurse (?nurse=N-02)', () => {
  it('opens the sheet for an offer addressed to this nurse and labels the top bar', () => {
    window.history.pushState({}, '', '/phone?nurse=N-02');
    mocked.mockReturnValue(makeSession(makeState({ handoffs: [packet()] })));
    render(<PhoneApp />);
    expect(screen.getByRole('dialog', { name: /Handoff/ })).toBeTruthy();
    expect(screen.getByTestId('nurse-label').textContent).toBe('Marcus T.');
  });
  it('does not open for the offering nurse, for another nurse, or for an accepted packet', () => {
    mocked.mockReturnValue(makeSession(makeState({ handoffs: [packet()] })));
    render(<PhoneApp />);
    expect(screen.queryByRole('dialog')).toBeNull();
    cleanup();
    window.history.pushState({}, '', '/phone?nurse=N-02');
    mocked.mockReturnValue(makeSession(makeState({ handoffs: [packet({ status: 'accepted' })] })));
    render(<PhoneApp />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('Not now leaves a banner that reopens the sheet', () => {
    window.history.pushState({}, '', '/phone?nurse=N-02');
    mocked.mockReturnValue(makeSession(makeState({ handoffs: [packet()] })));
    render(<PhoneApp />);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Handoff waiting for you/ }));
    expect(screen.getByRole('dialog', { name: /Handoff/ })).toBeTruthy();
  });
  it('the default nurse is Priya S. and has no sheet', () => {
    mocked.mockReturnValue(makeSession(makeState()));
    render(<PhoneApp />);
    expect(screen.getByTestId('nurse-label').textContent).toBe('Priya S.');
  });
});

describe('P2 Hand off', () => {
  it('offers to the next roster nurse with the chosen severity', () => {
    const session = makeSession(makeState());
    mocked.mockReturnValue(session);
    render(<PhoneApp />);
    fireEvent.click(screen.getByRole('radio', { name: 'Watch' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hand off Rm 12' }));
    const call = vi.mocked(session.send).mock.calls[0][0] as Record<string, unknown>;
    expect(call).toMatchObject({ type: 'HANDOFF_OFFER', device: 'phone', patientId: 'P-1012', toNurseId: 'N-02', severity: 'Watch' });
    expect(String(call.handoffId)).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });
  it('omits severity when none was picked (Not stated)', () => {
    const session = makeSession(makeState());
    mocked.mockReturnValue(session);
    render(<PhoneApp />);
    fireEvent.click(screen.getByRole('button', { name: 'Hand off Rm 12' }));
    expect(vi.mocked(session.send).mock.calls[0][0]).not.toHaveProperty('severity');
  });
  it('shows an offered chip, then Handed off to Marcus T. with the accepted time', () => {
    mocked.mockReturnValue(makeSession(makeState({ handoffs: [packet()] })));
    const { unmount } = render(<PhoneApp />);
    expect(screen.getByTestId('handoff-offered').textContent).toContain('Offered');
    expect(screen.queryByRole('button', { name: 'Hand off Rm 12' })).toBeNull();
    unmount();
    mocked.mockReturnValue(makeSession(makeState({ handoffs: [packet({ status: 'accepted', acceptedLabel: '2:09 PM' })] })));
    render(<PhoneApp />);
    expect(screen.getByTestId('handoff-accepted').textContent).toContain('Handed off to Marcus T. 2:09 PM');
  });
  it('the receiving nurse phone does not offer a handoff (the server has one on-duty nurse)', () => {
    window.history.pushState({}, '', '/phone?nurse=N-02');
    mocked.mockReturnValue(makeSession(makeState()));
    render(<PhoneApp />);
    expect(screen.queryByRole('button', { name: /Hand off Rm/ })).toBeNull();
  });
});

describe('Already given banner', () => {
  it('is shown prominently for a refused Give and stays for 6 s', () => {
    vi.useFakeTimers();
    const state = makeState();
    const first = makeSession(state);
    mocked.mockReturnValue(first);
    const { rerender } = render(<PhoneApp />);
    expect(screen.queryByTestId('given-banner')).toBeNull();
    // The server refuses a Give: lastResult carries the conflict text.
    mocked.mockReturnValue(makeSession(state, { lastResult: { seq: 1, ok: false, conflict: true, message: 'Already given 1:42 PM via glasses' } }));
    rerender(<PhoneApp />);
    const banner = screen.getByTestId('given-banner');
    expect(banner.getAttribute('role')).toBe('alert');
    expect(banner.textContent).toContain('Already given 1:42 PM via glasses');
    // Not duplicated as a short toast.
    expect(screen.getAllByText('Already given 1:42 PM via glasses')).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(GIVEN_BANNER_MS - 100); });
    expect(screen.getByTestId('given-banner')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.queryByTestId('given-banner')).toBeNull();
  });
  it('also fires for the phone-side check when the med is already given', () => {
    const medStatus = { 'P-1012:M-1': { status: 'given', givenAtLabel: '1:42 PM', via: 'glasses', givenAtMs: 1 } } as unknown as SessionState['medStatus'];
    const session = makeSession(makeState({ medStatus }));
    mocked.mockReturnValue(session);
    render(<PhoneApp />);
    fireEvent.click(screen.getByRole('button', { name: /Metformin/ }));
    expect(session.send).not.toHaveBeenCalled();
    expect(screen.getByTestId('given-banner').textContent).toContain('Already given 1:42 PM via glasses');
    expect(screen.getByTestId('given-banner').textContent).toContain('Already given 1:42 PM via glasses');
  });
  it('other refusals stay as ordinary toasts', () => {
    mocked.mockReturnValue(makeSession(makeState(), { lastResult: { seq: 1, ok: false, message: 'Too late to undo' } }));
    render(<PhoneApp />);
    expect(screen.queryByTestId('given-banner')).toBeNull();
    expect(screen.getByText('Too late to undo')).toBeTruthy();
  });
});

describe('P4 feed kinds', () => {
  const ev = (seq: number, type: string): SessionEvent => ({ seq, atMs: 1_000 * seq, type, device: 'phone' });
  const entry = (seq: number, kind: string, chain: string[], label?: string): FeedEntry =>
    ({ seq, atMs: 1_000 * seq, kind, device: 'phone', timeLabel: '2:05 PM', chain, ...(label ? { label } : {}) });

  it('renders handoff, allergy and dressing entries with labels and verification steps', () => {
    const events = [ev(1, 'HANDOFF_OFFER'), ev(2, 'HANDOFF_ACCEPT'), ev(3, 'ALLERGY_ACK'), ev(4, 'WOUND_SET_DRESSING')];
    const feed = [
      entry(1, 'handoff_offered', ['Built from shift log', 'Offered from glasses', 'Server accepted'], 'Priya S. to Marcus T.'),
      entry(2, 'handoff_accepted', ['Built from shift log', 'Offered from glasses', '2 critical items read back', 'Accepted on another device', 'Server accepted'], 'Priya S. to Marcus T.'),
      entry(3, 'allergy_ack', ['Order on chart', 'Chart lists Penicillin allergy', 'Shown on glasses', 'Acknowledged via voice', 'Server accepted']),
      entry(4, 'wound_dressing', ['Nurse documented dressing', 'Server accepted']),
    ];
    render(<P4ActivityFeed events={events} labelFor={() => '2:05 PM'} feed={feed} />);
    expect(screen.getByText('Handoff offered')).toBeTruthy();
    expect(screen.getByText('Handoff accepted')).toBeTruthy();
    expect(screen.getByText('Allergy alert acknowledged')).toBeTruthy();
    expect(screen.getByText('Dressing documented')).toBeTruthy();
    expect(screen.getAllByTestId('feed-label').map(n => n.textContent)).toEqual(['Priya S. to Marcus T.', 'Priya S. to Marcus T.']);
    expect(screen.getByText('2 critical items read back')).toBeTruthy();
    expect(screen.getByText('Acknowledged via voice')).toBeTruthy();
    expect(screen.getByText('Nurse documented dressing')).toBeTruthy();
    // Real actions from a director-stamped phone are not hidden as rehearsal noise.
    expect(screen.queryByText(/Show demo events/)).toBeNull();
  });
  it('does not hide handoff events stamped director', () => {
    const events: SessionEvent[] = [{ seq: 1, atMs: 1, type: 'HANDOFF_OFFER', device: 'director' }];
    render(<P4ActivityFeed events={events} labelFor={() => '2:05 PM'} feed={[entry(1, 'handoff_offered', ['Server accepted'], 'Priya S. to Marcus T.')]} />);
    expect(screen.getByText('Handoff offered')).toBeTruthy();
  });
});
