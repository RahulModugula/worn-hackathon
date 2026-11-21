import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { SessionState, WoundCapture } from '../../../../shared/types';
import { PhoneApp } from './PhoneApp';
import { useBedsideSession } from './useBedsideSession';
import { DIRECTOR_BUTTONS } from './DirectorDrawer';

vi.mock('./useBedsideSession', () => ({ useBedsideSession: vi.fn() }));

type Session = ReturnType<typeof useBedsideSession>;

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

const mocked = vi.mocked(useBedsideSession);

beforeEach(() => {
  mocked.mockReset();
});
afterEach(() => {
  cleanup();
});

describe('PhoneApp: P2 auto-open', () => {
  it('stays on My Shift when no patient is active', () => {
    mocked.mockReturnValue(makeSession(makeState()));
    render(<PhoneApp />);
    expect(screen.getByRole('heading', { name: 'Priya S.' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Maria Lopez' })).toBeNull();
  });

  it('opens P2 for the patient the glasses set as activePatientId', () => {
    mocked.mockReturnValue(makeSession(makeState({ activePatientId: 'P-1012' })));
    render(<PhoneApp />);
    expect(screen.getByRole('heading', { name: 'Maria Lopez' })).toBeTruthy();
  });

  it('opens P2 when activePatientId changes while the phone is open', () => {
    mocked.mockReturnValue(makeSession(makeState()));
    const { rerender } = render(<PhoneApp />);
    mocked.mockReturnValue(makeSession(makeState({ activePatientId: 'P-1014' })));
    rerender(<PhoneApp />);
    expect(screen.getByRole('heading', { name: 'James Carter' })).toBeTruthy();
  });
});

describe('PhoneApp: med logging on P2', () => {
  it('shows the exact conflict toast when the med is already given', () => {
    mocked.mockReturnValue(makeSession(makeState({
      activePatientId: 'P-1012',
      medStatus: { 'P-1012:M-1': { status: 'given', givenAtLabel: '1:45 PM', via: 'glasses', by: 'glasses' } },
    })));
    render(<PhoneApp />);
    const session = mocked.mock.results[0].value as Session;
    fireEvent.click(screen.getByRole('button', { name: /Metformin/ }));
    expect(screen.getByRole('alert').textContent).toBe('Already given 1:45 PM via glasses');
    expect(session.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'LOG_MED' }));
  });

  it('logs a due med from the phone with via=phone', () => {
    mocked.mockReturnValue(makeSession(makeState({ activePatientId: 'P-1012' })));
    render(<PhoneApp />);
    const session = mocked.mock.results[0].value as Session;
    fireEvent.click(screen.getByRole('button', { name: /Metformin/ }));
    expect(session.send).toHaveBeenCalledWith({ type: 'LOG_MED', device: 'phone', patientId: 'P-1012', medKey: 'M-1', via: 'phone' });
  });
});

describe('PhoneApp: P3 wound review (server-owned lifecycle)', () => {
  const capture: WoundCapture = {
    captureId: 'cap-1', patientId: 'P-1012', status: 'pending_review', photoUploadFailed: false,
    finding: 'Edges closed.', comparison: 'No change.', draftNote: 'Dressing intact.', source: 'glasses',
    capturedAtMs: Date.now(),
  };

  it('shows the pending_review banner and auto-opens P3', () => {
    mocked.mockReturnValue(makeSession(makeState({ woundCaptures: [capture] })));
    render(<PhoneApp />);
    expect(screen.getByRole('heading', { name: 'Wound review' })).toBeTruthy();
    // One banner only: "Draft for clinician review" with the source badge (no separate green "ready" line).
    expect(screen.getByText('Draft for clinician review')).toBeTruthy();
    expect(screen.queryByText('Wound photo ready for review')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save to chart' })).toBeTruthy();
  });

  it('shows no banner for a capture still waiting for an assessment, and says the photo did not upload', () => {
    mocked.mockReturnValue(makeSession(makeState({
      woundCaptures: [{ ...capture, status: 'captured', finding: '', comparison: '', draftNote: '', photoUploadFailed: true }],
    })));
    render(<PhoneApp />);
    expect(screen.queryByText('Wound photo ready for review')).toBeNull();
    expect(screen.getByRole('alert').textContent).toBe("Photo didn't upload");
  });

  it('Save and Send dispatch the server actions with the captureId and the edited draft; nothing is kept phone-locally', () => {
    mocked.mockReturnValue(makeSession(makeState({ woundCaptures: [capture] })));
    render(<PhoneApp />);
    const session = mocked.mock.results[0].value as Session;
    fireEvent.change(screen.getByLabelText(/Draft note/), { target: { value: 'Edited note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save to chart' }));
    expect(session.send).toHaveBeenLastCalledWith({ type: 'WOUND_SAVE', device: 'phone', captureId: 'cap-1', draftNote: 'Edited note' });
    fireEvent.click(screen.getByRole('button', { name: 'Send to Dr. Okafor' }));
    expect(session.send).toHaveBeenLastCalledWith({ type: 'WOUND_SEND', device: 'phone', captureId: 'cap-1', draftNote: 'Edited note' });
    expect(session.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_GLASSES_NOTICE' }));
    expect(session.send).toHaveBeenCalledTimes(2);
  });

  it('status and reply come from the server state: a freshly loaded phone sees sent + the doctor reply', () => {
    mocked.mockReturnValue(makeSession(makeState({
      activePatientId: 'P-1012',
      woundCaptures: [{ ...capture, status: 'sent', sentTo: 'Dr. Okafor', reply: { from: 'Dr. Okafor', text: 'Looks good.', atMs: 1 } }],
    })));
    render(<PhoneApp />);
    fireEvent.click(screen.getByRole('button', { name: 'Open wound review' }));
    expect(screen.getByText('✓ Sent to Dr. Okafor')).toBeTruthy();
    expect(screen.getByText('Looks good.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Send to/ })).toBeNull(); // cannot send twice
  });
});

describe('PhoneApp: presence, acknowledgements', () => {
  it('Glasses connected comes from server presence, not from glassesViewState', () => {
    mocked.mockReturnValue(makeSession(makeState({ glassesViewState: { v: 1 } })));
    const { rerender } = render(<PhoneApp />);
    expect(screen.getByText('Not connected')).toBeTruthy();
    mocked.mockReturnValue(makeSession(makeState(), { presence: { glasses: 1, phone: 1, director: 0 } } as never));
    rerender(<PhoneApp />);
    expect(screen.getByText('Glasses connected')).toBeTruthy();
    mocked.mockReturnValue(makeSession(makeState(), { presence: { glasses: 0, phone: 1, director: 0 } } as never));
    rerender(<PhoneApp />);
    expect(screen.getByText('Not connected')).toBeTruthy();
  });

  it('toasts a refused action live (lost race, undo too late) from lastResult', () => {
    const lastResult = { seq: 1, clientEventId: 'x', ok: false, conflict: true, message: 'Already given 1:45 PM via glasses', state: null };
    mocked.mockReturnValue(makeSession(makeState(), { lastResult } as never));
    render(<PhoneApp />);
    expect(screen.getByRole('alert').textContent).toBe('Already given 1:45 PM via glasses');
  });

  it('does not toast successful results', () => {
    const lastResult = { seq: 1, clientEventId: 'x', ok: true, state: null };
    mocked.mockReturnValue(makeSession(makeState(), { lastResult } as never));
    render(<PhoneApp />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('PhoneApp: Director Drawer', () => {
  it('lists exactly the FRD buttons in order, including Clock +30m', () => {
    mocked.mockReturnValue(makeSession(makeState()));
    render(<PhoneApp directorOpen />);
    const dialog = screen.getByRole('dialog', { name: 'Director' });
    const labels = within(dialog).getAllByRole('button').map(b => b.textContent);
    // Copy status (preflight, at the top) is the only addition; the FRD list below it is unchanged.
    expect(labels).toEqual([
      'Close', 'Copy status',
      'Start Shift', 'Sim Scan Rm 12', 'Sim Scan Rm 14', 'Voice: Done', 'Voice: Next', 'Voice: Undo',
      'Trigger: Pain', 'Trigger: Wound', 'Capture Wound Photo', 'Demo: Set Dressing', 'Voice: Send to Phone', 'Dr. Reply', 'Trigger Allergy Alert', 'Add Conflicting Order',
      'Toggle Photo Fail: OFF', 'Force Offline', 'Clock +30m', 'RESET DEMO',
    ]);
    expect(DIRECTOR_BUTTONS.map(b => b.label)).toEqual([
      'Start Shift', 'Sim Scan Rm 12', 'Sim Scan Rm 14', 'Voice: Done', 'Voice: Next', 'Voice: Undo',
      'Trigger: Pain', 'Trigger: Wound', 'Capture Wound Photo', 'Demo: Set Dressing', 'Voice: Send to Phone', 'Dr. Reply', 'Trigger Allergy Alert', 'Add Conflicting Order',
      'Toggle Photo Fail', 'Force Offline', 'Clock +30m', 'RESET DEMO',
    ]);
  });

  it('RESET DEMO needs a second tap before it sends', () => {
    mocked.mockReturnValue(makeSession(makeState()));
    render(<PhoneApp directorOpen />);
    const session = mocked.mock.results[0].value as Session;
    fireEvent.click(screen.getByRole('button', { name: 'RESET DEMO' }));
    expect(session.send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, RESET DEMO' }));
    expect(session.send).toHaveBeenCalledWith({ type: 'RESET_SESSION', device: 'director' });
  });

  it('Sim Scan Rm 12 sends the sim event and loads Maria', () => {
    mocked.mockReturnValue(makeSession(makeState()));
    render(<PhoneApp directorOpen />);
    const session = mocked.mock.results[0].value as Session;
    fireEvent.click(screen.getByRole('button', { name: 'Sim Scan Rm 12' }));
    expect(session.send).toHaveBeenNthCalledWith(1, { type: 'SIM_SCAN_RM_12', device: 'director' });
    expect(session.send).toHaveBeenNthCalledWith(2, { type: 'SET_ACTIVE_PATIENT', patientId: 'P-1012', device: 'director' });
  });
});

describe('PhoneApp: director sim commands', () => {
  it('the photo-fail button reflects the session flag', () => {
    mocked.mockReturnValue(makeSession(makeState({ photoUploadShouldFail: true })));
    render(<PhoneApp directorOpen />);
    const b = screen.getByRole('button', { name: 'Toggle Photo Fail: ON' });
    expect(b.getAttribute('aria-pressed')).toBe('true');
    const session = mocked.mock.results[0].value as Session;
    fireEvent.click(b);
    expect(session.send).toHaveBeenCalledWith({ type: 'SIM_FAIL_PHOTO_UPLOAD', device: 'director' });
  });
  it('Capture Wound Photo sends SIM_CAPTURE_WOUND; Dr. Reply sends only SIM_DR_REPLY (the server does the rest)', () => {
    mocked.mockReturnValue(makeSession(makeState()));
    render(<PhoneApp directorOpen />);
    const session = mocked.mock.results[0].value as Session;
    fireEvent.click(screen.getByRole('button', { name: 'Capture Wound Photo' }));
    expect(session.send).toHaveBeenLastCalledWith({ type: 'SIM_CAPTURE_WOUND', device: 'director' });
    fireEvent.click(screen.getByRole('button', { name: 'Dr. Reply' }));
    expect(session.send).toHaveBeenLastCalledWith({ type: 'SIM_DR_REPLY', device: 'director' });
    expect(session.send).toHaveBeenCalledTimes(2);
  });
});

describe('PhoneApp: status line', () => {
  it('says Reconnecting when offline and Connected when online', () => {
    mocked.mockReturnValue(makeSession(makeState(), { offline: true }));
    const { rerender } = render(<PhoneApp />);
    expect(screen.getByRole('status').textContent).toBe('Reconnecting…');
    mocked.mockReturnValue(makeSession(makeState(), { offline: false }));
    rerender(<PhoneApp />);
    expect(screen.getByRole('status').textContent).toBe('Connected to demo session');
  });
});

describe('PhoneApp: director capability on the socket', () => {
  it('connects without director=1 until the drawer is enabled; three taps on the brand enable it', () => {
    mocked.mockReturnValue(makeSession(makeState()));
    render(<PhoneApp />);
    expect(mocked.mock.calls.at(-1)?.[1]).toMatchObject({ director: false });
    expect(screen.queryByLabelText('Open Director Drawer')).toBeNull(); // the bolt only shows with ?director=1
    const brand = screen.getByRole('button', { name: 'Bedside Glance' });
    fireEvent.click(brand); fireEvent.click(brand);
    expect(mocked.mock.calls.at(-1)?.[1]).toMatchObject({ director: false });
    fireEvent.click(brand);
    expect(mocked.mock.calls.at(-1)?.[1]).toMatchObject({ director: true });
    expect(screen.getByRole('dialog', { name: 'Director' })).toBeTruthy();
  });

  it('the bolt button appears with ?director=1 and opens the drawer', () => {
    mocked.mockReturnValue(makeSession(makeState()));
    render(<PhoneApp directorOpen />);
    expect(screen.getByLabelText('Open Director Drawer')).toBeTruthy();
  });

  it('?director=1 (directorOpen) connects as director from the start', () => {
    mocked.mockReturnValue(makeSession(makeState()));
    render(<PhoneApp directorOpen />);
    expect(mocked.mock.calls[0]?.[1]).toMatchObject({ director: true });
  });
});
