import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { SessionState } from '../../../../shared/types';
import { PhoneApp } from './PhoneApp';
import { useBedsideSession } from './useBedsideSession';

vi.mock('./useBedsideSession', () => ({ useBedsideSession: vi.fn() }));

type Session = ReturnType<typeof useBedsideSession>;
const mocked = vi.mocked(useBedsideSession);

function makeState(over: Partial<SessionState> = {}): SessionState {
  return {
    id: 'demo', version: 1, shift: { startedAtMs: Date.now() }, clock: { baseMin: 822, startedAtMs: Date.now() },
    clockOffsetMin: 0, activePatientId: 'P-1012', medStatus: {}, woundCaptures: [], glassesNotice: null, events: [], eventSeq: 0,
    lastMedLog: null, glassesViewState: null, photoUploadShouldFail: false,
    extraOrders: { 'P-1012': [{ id: 'X-1', name: 'Amoxicillin', dose: '250 mg', route: 'PO', dueAt: '13:42', allergyClasses: ['penicillin'] }] },
    allergyAcks: [{ key: 'P-1012:X-1', atMs: 1, label: '1:42 PM', device: 'glasses', via: 'voice' }],
    ...over,
  };
}
const makeSession = (state: SessionState): Session =>
  ({ state, offline: false, forceOffline: false, conflicts: [], presence: {}, lastResult: null, setForceOffline: vi.fn(), clearConflicts: vi.fn(), send: vi.fn() }) as unknown as Session;

beforeEach(() => { mocked.mockReset(); });
afterEach(() => { cleanup(); });

describe('allergy acknowledged on glasses (P2)', () => {
  it('shows the banner with the glasses time', () => {
    mocked.mockReturnValue(makeSession(makeState()));
    render(<PhoneApp />);
    expect(screen.getByText('Allergy alert acknowledged on glasses 1:42 PM')).toBeTruthy();
  });
  it('giving the allergen opens a confirm dialog and only then sends allergyConfirmed', () => {
    mocked.mockReturnValue(makeSession(makeState()));
    render(<PhoneApp />);
    const session = mocked.mock.results[0].value as Session;
    fireEvent.click(screen.getByRole('button', { name: /Amoxicillin/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Chart lists Penicillin allergy\. Give anyway\?/)).toBeTruthy();
    expect(session.send).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getAllByRole('radio')[0]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Give anyway' }));
    expect(session.send).toHaveBeenCalledWith({
      type: 'LOG_MED', device: 'phone', patientId: 'P-1012', medKey: 'X-1', via: 'phone', allergyConfirmed: true,
    });
  });
});
