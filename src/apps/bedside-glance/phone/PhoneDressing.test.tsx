import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { SessionState, WoundCapture, WoundDressing } from '../../../../shared/types';
import { PhoneApp } from './PhoneApp';
import { useBedsideSession } from './useBedsideSession';
import { dressingNoteLine, dressingSummary, withDressingLine } from './model';

vi.mock('./useBedsideSession', () => ({ useBedsideSession: vi.fn() }));
type Session = ReturnType<typeof useBedsideSession>;
const mocked = vi.mocked(useBedsideSession);

function makeState(over: Partial<SessionState> = {}): SessionState {
  return {
    id: 'demo', version: 1, shift: { startedAtMs: Date.now() }, clock: { baseMin: 822, startedAtMs: Date.now() },
    clockOffsetMin: 0, activePatientId: null, medStatus: {}, woundCaptures: [], glassesNotice: null, events: [], eventSeq: 0,
    lastMedLog: null, glassesViewState: null, photoUploadShouldFail: false, ...over,
  };
}
const makeSession = (state: SessionState): Session => ({
  state, offline: false, forceOffline: false, conflicts: [], presence: {}, lastResult: null,
  setForceOffline: vi.fn(), clearConflicts: vi.fn(), send: vi.fn(),
}) as unknown as Session;

const capture: WoundCapture = {
  captureId: 'cap-1', patientId: 'P-1012', status: 'pending_review', photoUploadFailed: false,
  finding: 'Edges closed.', comparison: 'No change.', draftNote: 'Dressing intact.', source: 'glasses', capturedAtMs: Date.now(),
};
const dressing: WoundDressing = { type: 'hydrogel', changedAtMin: 845, intervalHours: 24, nextDueMin: 845, enteredBy: 'phone', atMs: 1 };

beforeEach(() => mocked.mockReset());
afterEach(cleanup);

describe('model dressing helpers', () => {
  it('summarises and builds the note line without inventing anything', () => {
    expect(dressingSummary(dressing)).toBe('Hydrogel · Changed 2:05 PM · due 2:05 PM');
    expect(dressingSummary({ ...dressing, intervalHours: null, nextDueMin: null })).toBe('Hydrogel · Changed 2:05 PM · due per protocol');
    expect(dressingSummary({ type: 'none', nextDueMin: null, enteredBy: 'phone', atMs: 1 })).toBe('None');
    expect(dressingNoteLine(dressing)).toBe('Dressing (documented by nurse): Hydrogel. Changed 2:05 PM; next due 2:05 PM.');
    expect(dressingNoteLine({ ...dressing, type: 'film', intervalHours: null, nextDueMin: null })).toBe('Dressing (documented by nurse): Transparent film. Changed 2:05 PM; next change per protocol.');
  });
  it('withDressingLine appends once and replaces an older line; no dressing leaves the draft untouched', () => {
    expect(withDressingLine('Note', undefined)).toBe('Note');
    const a = withDressingLine('Note', dressing);
    expect(a).toBe('Note\nDressing (documented by nurse): Hydrogel. Changed 2:05 PM; next due 2:05 PM.');
    expect(withDressingLine(a, { ...dressing, type: 'foam' })).toBe('Note\nDressing (documented by nurse): Foam. Changed 2:05 PM; next due 2:05 PM.');
    expect(withDressingLine('', dressing)).toBe('Dressing (documented by nurse): Hydrogel. Changed 2:05 PM; next due 2:05 PM.');
  });
});

describe('P3 Dressing card', () => {
  const open = (c: WoundCapture = capture) => {
    mocked.mockReturnValue(makeSession(makeState({ woundCaptures: [c] })));
    render(<PhoneApp />);
    return mocked.mock.results[0].value as Session;
  };

  it('is a nurse-documentation card with the aid wording, not AI', () => {
    open();
    const card = screen.getByRole('region', { name: 'Dressing' });
    expect(within(card).getByText('Documented by nurse')).toBeTruthy();
    expect(within(card).getByText(/Documentation aid/)).toBeTruthy();
    expect(screen.getByText(/Documentation aid, not a diagnosis. Draft for clinician review/)).toBeTruthy();
    expect(card.textContent).not.toMatch(/\bAI\b|recommend/);
  });
  it('offers every dressing type and the interval presets, none preselected', () => {
    open();
    const sel = screen.getByLabelText('Dressing type') as HTMLSelectElement;
    expect([...sel.options].map((o) => o.text)).toEqual(['Choose type', 'Hydrogel', 'Hydrocolloid', 'Foam', 'Alginate', 'Transparent film', 'Gauze', 'Other', 'None']);
    expect(sel.value).toBe('');
    for (const n of ['24 h', '48 h', '72 h', 'Per protocol']) expect(screen.getByRole('button', { name: n }).getAttribute('aria-pressed')).toBe('false');
    expect((screen.getByRole('button', { name: 'Save dressing' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('defaults Last changed to the demo clock and dispatches WOUND_SET_DRESSING with the nurse choices', () => {
    const session = open();
    const time = screen.getByLabelText('Last changed') as HTMLInputElement;
    expect(time.value).toMatch(/^13:4\d$/); // shift started at 1:42 PM
    fireEvent.change(screen.getByLabelText('Dressing type'), { target: { value: 'foam' } });
    fireEvent.change(time, { target: { value: '14:05' } });
    fireEvent.click(screen.getByRole('button', { name: '48 h' }));
    expect(screen.getByText('Next due 2:05 PM')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save dressing' }));
    expect(session.send).toHaveBeenLastCalledWith({ type: 'WOUND_SET_DRESSING', device: 'phone', captureId: 'cap-1', dressingType: 'foam', changedAtMin: 845, intervalHours: 48 });
  });
  it('per protocol sends a null interval and shows no next-due time', () => {
    const session = open();
    fireEvent.change(screen.getByLabelText('Dressing type'), { target: { value: 'gauze' } });
    fireEvent.click(screen.getByRole('button', { name: 'Per protocol' }));
    expect(screen.queryByText(/^Next due/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save dressing' }));
    expect(session.send).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'WOUND_SET_DRESSING', dressingType: 'gauze', intervalHours: null }));
  });
  it('None needs no time or interval', () => {
    const session = open();
    fireEvent.change(screen.getByLabelText('Dressing type'), { target: { value: 'none' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save dressing' }));
    expect(session.send).toHaveBeenLastCalledWith({ type: 'WOUND_SET_DRESSING', device: 'phone', captureId: 'cap-1', dressingType: 'none' });
  });
  it('controls are at least 48px targets (class contract) and the card is sentence case', () => {
    open();
    const card = screen.getByRole('region', { name: 'Dressing' });
    for (const el of card.querySelectorAll('select, input, button')) expect(el.className).toMatch(/ph-dr-ctl|ph-btn/);
    expect(card.textContent).not.toMatch(/\b[A-Z]{4,}\b/);
  });
  it('included in Save to chart and Send drafts', () => {
    mocked.mockReturnValue(makeSession(makeState({ woundCaptures: [{ ...capture, dressing }] })));
    render(<PhoneApp />);
    const session = mocked.mock.results[0].value as Session;
    fireEvent.click(screen.getByRole('button', { name: 'Save to chart' }));
    expect(session.send).toHaveBeenLastCalledWith({
      type: 'WOUND_SAVE', device: 'phone', captureId: 'cap-1',
      draftNote: 'Dressing intact.\nDressing (documented by nurse): Hydrogel. Changed 2:05 PM; next due 2:05 PM.',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send to Dr. Okafor' }));
    expect(session.send).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'WOUND_SEND', draftNote: expect.stringContaining('Dressing (documented by nurse): Hydrogel') }));
  });
  it('the form follows the server: a dressing documented elsewhere (the Director preset) fills the controls', () => {
    mocked.mockReturnValue(makeSession(makeState({ woundCaptures: [capture] })));
    const { rerender } = render(<PhoneApp />);
    expect((screen.getByLabelText('Dressing type') as HTMLSelectElement).value).toBe('');
    mocked.mockReturnValue(makeSession(makeState({ woundCaptures: [{ ...capture, dressing }] })));
    rerender(<PhoneApp />);
    expect((screen.getByLabelText('Dressing type') as HTMLSelectElement).value).toBe('hydrogel');
    expect((screen.getByLabelText('Last changed') as HTMLInputElement).value).toBe('14:05');
    expect(screen.getByRole('button', { name: '24 h' }).getAttribute('aria-pressed')).toBe('true');
  });
  it('once saved or sent it is a read-only summary (server first-write-wins)', () => {
    mocked.mockReturnValue(makeSession(makeState({ activePatientId: 'P-1012', woundCaptures: [{ ...capture, status: 'saved', dressing }] })));
    render(<PhoneApp />);
    fireEvent.click(screen.getByRole('button', { name: 'Open wound review' }));
    const card = screen.getByRole('region', { name: 'Dressing' });
    expect(within(card).getByText('Hydrogel · Changed 2:05 PM · due 2:05 PM')).toBeTruthy();
    expect(within(card).queryByRole('button', { name: 'Save dressing' })).toBeNull();
    expect(card.querySelector('select')).toBeNull();
  });
});

describe('Director dressing preset', () => {
  it('sends SIM_DRESSING_PRESET', () => {
    mocked.mockReturnValue(makeSession(makeState()));
    render(<PhoneApp directorOpen />);
    const session = mocked.mock.results[0].value as Session;
    fireEvent.click(screen.getByRole('button', { name: 'Demo: Set Dressing' }));
    expect(session.send).toHaveBeenLastCalledWith({ type: 'SIM_DRESSING_PRESET', device: 'director' });
  });
});
