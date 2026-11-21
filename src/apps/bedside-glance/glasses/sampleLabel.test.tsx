import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { WoundCapture } from '../../../../shared/types';
import { P3WoundReview } from '../phone/P3WoundReview';
import { captureAssessment, PATIENTS } from '../phone/model';
import { screenCopy } from './copy';
import { assessPhoto, ASSESS_TIMEOUT_MS, type FetchFn } from './photoApi';
import { FALLBACK_ASSESSMENT, initialState } from './stateMachine';

afterEach(cleanup);
const json = (body: unknown, ok = true) => ({ ok, json: async () => body }) as unknown as Response;
const GOOD = { finding: 'Edges closed.', comparison: 'Smaller.', draftNote: 'Note.' };

describe('assessment source labelling', () => {
  it('client wait for the assessment is at most 4s', () => {
    expect(ASSESS_TIMEOUT_MS).toBeLessThanOrEqual(4000);
  });
  it('assessPhoto carries the server source; a network failure is a sample result', async () => {
    const f1: FetchFn = async () => json({ ...GOOD, source: 'gemini' });
    expect((await assessPhoto(f1, 'c1')).source).toBe('gemini');
    const f2: FetchFn = async () => json({ ...GOOD, source: 'fallback' });
    expect((await assessPhoto(f2, 'c1')).source).toBe('fallback');
    const f3: FetchFn = async () => { throw new Error('offline'); };
    expect(await assessPhoto(f3, 'c1')).toEqual(FALLBACK_ASSESSMENT);
    expect(FALLBACK_ASSESSMENT.source).toBe('fallback');
  });
  it('G8 labels sample vs real model results', () => {
    const base = { ...initialState(PATIENTS_G, null), screen: 'G8' as const, patientId: PATIENTS_G[0].id };
    const sample = screenCopy({ ...base, assessment: { ...GOOD, source: 'fallback' } }, 0).rows.map((r) => r.text).join('|');
    const real = screenCopy({ ...base, assessment: { ...GOOD, source: 'gemini' } }, 0).rows.map((r) => r.text).join('|');
    expect(sample).toContain('Photo saved');
    expect(sample).toContain('No AI review - see phone');
    expect(sample).not.toContain('AI result');
    expect(real).not.toContain('No AI review');
    expect(real.toLowerCase()).toContain('ai result');
  });
  it('phone P3 labels it too, from the stored capture', () => {
    const cap = (src: 'gemini' | 'fallback'): WoundCapture => ({
      captureId: 'c1', patientId: PATIENTS[0].id, status: 'pending_review', photoUploadFailed: false, ...GOOD, draftNote: 'n',
      source: 'glasses', capturedAtMs: 1, assessmentSource: src,
    });
    const render3 = (c: WoundCapture) => render(
      <P3WoundReview patient={PATIENTS[0]} capture={c} assessment={captureAssessment(c)!} status={c.status} capturedLabel="1:42 PM"
        draft="n" onDraftChange={() => undefined} onSave={() => undefined} onSend={() => undefined} onBack={() => undefined} reply={null} />);
    render3(cap('fallback'));
    expect(screen.getByTestId('assessment-source').textContent).toBe('No AI review');
    cleanup();
    render3(cap('gemini'));
    expect(screen.getByTestId('assessment-source').textContent).toBe('AI result');
  });
});
import type { Patient } from './stateMachine';
import patientsData from '../../../../data/patients.json';
const PATIENTS_G = (patientsData as unknown as { patients: Patient[] }).patients;
void render;
