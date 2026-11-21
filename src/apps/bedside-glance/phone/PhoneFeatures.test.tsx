import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { SessionState, WoundCapture } from '../../../../shared/types';
import { PhoneApp } from './PhoneApp';
import { useBedsideSession } from './useBedsideSession';

vi.mock('./useBedsideSession', () => ({ useBedsideSession: vi.fn() }));

type Session = ReturnType<typeof useBedsideSession>;
const mocked = vi.mocked(useBedsideSession);

function makeState(over: Partial<SessionState> = {}): SessionState {
  return {
    id: 'demo', version: 1,
    shift: { startedAtMs: Date.now() },
    clock: { baseMin: 822, startedAtMs: Date.now() },
    clockOffsetMin: 0, activePatientId: null, medStatus: {}, woundCaptures: [],
    glassesNotice: null, events: [], eventSeq: 0, lastMedLog: null, glassesViewState: null,
    photoUploadShouldFail: false, ...over,
  };
}

function makeSession(state: SessionState | null, over: Partial<Session> = {}): Session {
  return {
    state, offline: false, forceOffline: false, conflicts: [],
    presence: {}, lastResult: null,
    setForceOffline: vi.fn(), clearConflicts: vi.fn(), send: vi.fn(),
    ...over,
  } as unknown as Session;
}

beforeEach(() => { mocked.mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Undo on P2 (either device, 10 s window)', () => {
  it('shows a live countdown after a glasses med log, then disables the button at 10 s', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-21T18:00:00Z'));
    const lastMedLog = { key: 'P-1012:M-1', acceptedAtMs: Date.now(), device: 'glasses' as const };
    mocked.mockReturnValue(makeSession(makeState({ activePatientId: 'P-1012', lastMedLog })));
    render(<PhoneApp />);

    const undo = screen.getByRole('button', { name: /^Undo Metformin/ });
    expect(undo.textContent).toContain('10 s');
    expect((undo as HTMLButtonElement).disabled).toBe(false);

    act(() => { vi.advanceTimersByTime(4000); });
    expect(screen.getByRole('button', { name: /^Undo Metformin/ }).textContent).toContain('6 s');

    act(() => { vi.advanceTimersByTime(6000); });
    const closed = screen.getByRole('button', { name: 'Undo window closed (10 s)' }) as HTMLButtonElement;
    expect(closed.disabled).toBe(true);
  });

  it.each([-30_000, 30_000])('countdown ignores phone-vs-server clock skew of %i ms', skew => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-21T18:00:00Z'));
    const lastMedLog = { key: 'P-1012:M-1', acceptedAtMs: Date.now() + skew, device: 'glasses' as const };
    mocked.mockReturnValue(makeSession(makeState({ activePatientId: 'P-1012', lastMedLog })));
    render(<PhoneApp />);
    expect(screen.getByRole('button', { name: /^Undo Metformin/ }).textContent).toContain('10 s');
    act(() => { vi.advanceTimersByTime(4000); });
    expect(screen.getByRole('button', { name: /^Undo Metformin/ }).textContent).toContain('6 s');
    act(() => { vi.advanceTimersByTime(6000); });
    expect((screen.getByRole('button', { name: 'Undo window closed (10 s)' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('dispatches UNDO_LAST_MED from the phone', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-21T18:00:00Z'));
    const lastMedLog = { key: 'P-1012:M-1', acceptedAtMs: Date.now(), device: 'phone' as const };
    mocked.mockReturnValue(makeSession(makeState({ activePatientId: 'P-1012', lastMedLog })));
    render(<PhoneApp />);
    const session = mocked.mock.results[0].value as Session;
    fireEvent.click(screen.getByRole('button', { name: /^Undo Metformin/ }));
    expect(session.send).toHaveBeenCalledWith({ type: 'UNDO_LAST_MED', device: 'phone' });
  });

  it('shows no Undo before any med is logged', () => {
    mocked.mockReturnValue(makeSession(makeState({ activePatientId: 'P-1012' })));
    render(<PhoneApp />);
    expect(screen.queryByRole('button', { name: /Undo/ })).toBeNull();
  });

  it('toasts "Too late to undo" from the server result', () => {
    mocked.mockReturnValue(makeSession(makeState(), {
      lastResult: { seq: 7, clientEventId: 'u', ok: false, message: 'Too late to undo', state: null },
    } as never));
    render(<PhoneApp />);
    expect(screen.getByRole('alert').textContent).toBe('Too late to undo');
  });
});

describe('Confirm before giving a med that is not yet due', () => {
  // Demo clock starts at 1:42 PM. Lisinopril is due 6:00 PM (258 min away): not actionable.
  it('shows the confirm sheet and sends nothing until "Give anyway"', () => {
    mocked.mockReturnValue(makeSession(makeState({ activePatientId: 'P-1012' })));
    render(<PhoneApp />);
    const session = mocked.mock.results[0].value as Session;
    fireEvent.click(screen.getByRole('button', { name: /Lisinopril/ }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Not due until 6:00 PM. Give anyway?')).toBeTruthy();
    expect(session.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'LOG_MED' }));

    // Every override has a reason: Give anyway stays disabled until one is picked.
    const give = within(dialog).getByRole('button', { name: 'Give anyway' }) as HTMLButtonElement;
    expect(give.disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Prescriber approved giving it early' }));
    expect(give.disabled).toBe(false);
    fireEvent.click(give);
    expect(session.send).toHaveBeenCalledWith({
      type: 'LOG_MED', device: 'phone', patientId: 'P-1012', medKey: 'M-2', via: 'phone', earlyConfirmed: true,
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Cancel closes the sheet and logs nothing', () => {
    mocked.mockReturnValue(makeSession(makeState({ activePatientId: 'P-1012' })));
    render(<PhoneApp />);
    const session = mocked.mock.results[0].value as Session;
    fireEvent.click(screen.getByRole('button', { name: /Lisinopril/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(session.send).not.toHaveBeenCalled();
  });

  it('a med inside the 30 minute window logs at once, with no earlyConfirmed flag', () => {
    mocked.mockReturnValue(makeSession(makeState({ activePatientId: 'P-1012' })));
    render(<PhoneApp />);
    const session = mocked.mock.results[0].value as Session;
    fireEvent.click(screen.getByRole('button', { name: /Metformin/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
    const call = vi.mocked(session.send).mock.calls[0][0] as Record<string, unknown>;
    expect(call).toEqual({ type: 'LOG_MED', device: 'phone', patientId: 'P-1012', medKey: 'M-1', via: 'phone' });
    expect('earlyConfirmed' in call).toBe(false);
  });
});

describe('Wound source labels (never "AI finding" for a fallback)', () => {
  const base: WoundCapture = {
    captureId: 'cap-9', patientId: 'P-1012', status: 'pending_review', photoUploadFailed: false,
    finding: 'Edges look closed.', comparison: 'Stable.', draftNote: 'Dressing intact.', source: 'glasses',
    capturedAtMs: Date.now(),
  };

  function openP3(capture: WoundCapture) {
    mocked.mockReturnValue(makeSession(makeState({ woundCaptures: [capture] })));
    render(<PhoneApp />);
  }

  it('gemini: "AI result" and the "AI finding" heading', () => {
    openP3({ ...base, assessmentSource: 'gemini' });
    expect(screen.getByTestId('assessment-source').textContent).toBe('AI result');
    expect(screen.getByRole('heading', { name: 'AI finding' })).toBeTruthy();
  });

  it('fallback: "No AI review", a notice instead of a clinical finding, and a templated draft', () => {
    openP3({ ...base, assessmentSource: 'fallback', draftNote: 'Wound photo taken. Nurse assessment:' });
    expect(screen.getByTestId('assessment-source').textContent).toBe('No AI review');
    expect(screen.queryByText(/AI finding/)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Finding' })).toBeNull();
    expect(screen.queryByText(base.finding)).toBeNull();
    expect(screen.getByRole('note').textContent).toContain('No AI review');
    expect((screen.getByLabelText(/Draft note/) as HTMLTextAreaElement).value).toBe('Wound photo taken. Nurse assessment:');
  });

  it('unavailable: "Assessment unavailable" with a notice, not a finding', () => {
    openP3({ ...base, assessmentSource: 'unavailable', finding: '', comparison: '' });
    expect(screen.getByTestId('assessment-source').textContent).toBe('Assessment unavailable');
    expect(screen.getByRole('note').textContent).toContain('No assessment was made');
    expect(screen.queryByText(/AI finding/)).toBeNull();
  });

  it('P2 shows the label of the newest photo for that patient', () => {
    mocked.mockReturnValue(makeSession(makeState({
      activePatientId: 'P-1012',
      woundCaptures: [{ ...base, status: 'saved', assessmentSource: 'unavailable', finding: '', comparison: '' }],
    })));
    render(<PhoneApp />);
    expect(screen.getByTestId('p2-wound-source').textContent).toBe('Last photo: Assessment unavailable');
  });
});

describe('P4 verification chain chips', () => {
  it('renders the server chain next to the matching event', () => {
    mocked.mockReturnValue(makeSession(makeState({
      events: [{ seq: 3, atMs: Date.now(), type: 'LOG_MED', device: 'glasses' }],
      feed: [{
        seq: 3, atMs: Date.now(), kind: 'med_given', device: 'glasses', timeLabel: '1:43 PM',
        chain: ['Wristband matched', 'Nurse confirmed via voice', 'Server accepted'],
      }],
    })));
    render(<PhoneApp />);
    fireEvent.click(screen.getByRole('button', { name: /Activity/ }));
    const chain = screen.getByLabelText('Verification steps');
    expect(within(chain).getByText('Wristband matched')).toBeTruthy();
    expect(within(chain).getByText('Server accepted')).toBeTruthy();
  });
});

describe('Scan & Talk entry', () => {
  it('the P1 button opens Scan & Talk with the six big buttons', () => {
    mocked.mockReturnValue(makeSession(makeState()));
    render(<PhoneApp />);
    fireEvent.click(screen.getByRole('button', { name: /Scan & Talk/ }));
    for (const name of ['Done', 'Next', 'Vitals', 'Close patient', 'Wound']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: /^Undo/ })).toBeTruthy();
  });

  it('?scan=1 opens Scan & Talk on load', () => {
    mocked.mockReturnValue(makeSession(makeState()));
    render(<PhoneApp scanOpen />);
    expect(screen.getByRole('heading', { name: 'Scan & Talk' })).toBeTruthy();
  });
});

describe('P4 demo events are hidden by default', () => {
  it('director events stay out of the feed until "Show demo events" is pressed', () => {
    mocked.mockReturnValue(makeSession(makeState({
      events: [
        { seq: 1, atMs: Date.now(), type: 'LOG_MED', device: 'glasses' },
        { seq: 2, atMs: Date.now(), type: 'SIM_TRIGGER_PAIN', device: 'director' },
        { seq: 3, atMs: Date.now(), type: 'LOG_MED', device: 'director' }, // a med tap from a director-capable phone is real
      ],
    })));
    render(<PhoneApp />);
    fireEvent.click(screen.getByRole('button', { name: /Activity/ }));
    expect(screen.getByText('2 events this shift')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Show demo events/ }));
    expect(screen.getByText('3 events this shift')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Hide demo events/ })).toBeTruthy();
  });
});
