import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const generateContent = vi.hoisted(() => vi.fn());

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(function (this: unknown) {
    return { models: { generateContent } };
  }),
  ThinkingLevel: { MINIMAL: 'MINIMAL', LOW: 'LOW' },
  Type: { OBJECT: 'OBJECT', STRING: 'STRING' },
}));

import { assessWound, fallbackAssessment, unavailableAssessment, isJpegBase64 } from './assessWound.js';

// Smallest plausible JPEG header: SOI + APP0 marker bytes. Content is irrelevant to the mock.
const JPEG_B64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]).toString('base64');
const GOOD = { finding: 'Dressing intact.', comparison: 'No prior photo.', draftNote: 'Dressing intact.' };

describe('assessWound', () => {
  beforeEach(() => {
    generateContent.mockReset();
    process.env.GEMINI_API_KEY = 'test-key-not-real';
    delete process.env.GEMINI_MODEL;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.GEMINI_API_KEY;
  });

  it('returns the Gemini answer with the default model and MINIMAL thinking', async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify(GOOD) });

    const result = await assessWound(JPEG_B64);

    expect(result).toEqual({ ...GOOD, source: 'gemini' });
    const call = generateContent.mock.calls[0][0];
    expect(call.model).toBe('gemini-3.5-flash-lite');
    expect(call.config.thinkingConfig).toEqual({ thinkingLevel: 'MINIMAL' });
    expect(call.contents[0].parts[0].inlineData).toEqual({ mimeType: 'image/jpeg', data: JPEG_B64 });
  });

  it('honours GEMINI_MODEL', async () => {
    process.env.GEMINI_MODEL = 'gemini-test-model';
    generateContent.mockResolvedValue({ text: JSON.stringify(GOOD) });
    await assessWound(JPEG_B64);
    expect(generateContent.mock.calls[0][0].model).toBe('gemini-test-model');
  });

  it('falls back without calling Gemini when the key is missing', async () => {
    delete process.env.GEMINI_API_KEY;
    const result = await assessWound(JPEG_B64);
    expect(result.source).toBe('fallback');
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('falls back when the call throws', async () => {
    generateContent.mockRejectedValue(new Error('boom'));
    expect((await assessWound(JPEG_B64)).source).toBe('fallback');
  });

  it('falls back on garbage JSON', async () => {
    generateContent.mockResolvedValue({ text: 'not json at all' });
    expect((await assessWound(JPEG_B64)).source).toBe('fallback');
  });

  it('falls back when required fields are missing or empty', async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify({ finding: 'x', comparison: '' }) });
    expect((await assessWound(JPEG_B64)).source).toBe('fallback');
  });

  it('truncates draftNote to 160 characters', async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify({ ...GOOD, draftNote: 'a'.repeat(300) }) });
    const result = await assessWound(JPEG_B64);
    expect(result.source).toBe('gemini');
    expect(result.draftNote).toHaveLength(160);
  });

  it('returns the fallback within 3.6s when Gemini never resolves', async () => {
    vi.useFakeTimers();
    generateContent.mockReturnValue(new Promise(() => {}));

    let settled = false;
    const pending = assessWound(JPEG_B64);
    void pending.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(3499);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(101); // total 3600 ms
    const result = await pending;
    expect(settled).toBe(true);
    expect(result.source).toBe('fallback');
  });

  it('aborts the in-flight request when it times out', async () => {
    vi.useFakeTimers();
    generateContent.mockReturnValue(new Promise(() => {}));
    const pending = assessWound(JPEG_B64);
    await vi.advanceTimersByTimeAsync(3600);
    await pending;
    expect(generateContent.mock.calls[0][0].config.abortSignal.aborted).toBe(true);
  });
});

describe('honest wound fallback', () => {
  beforeEach(() => { generateContent.mockReset(); delete process.env.GEMINI_API_KEY; });

  it('reads the woundAssessment key of data/demo-responses.json (not the built-in text)', async () => {
    const fb = await fallbackAssessment();
    expect(fb.source).toBe('fallback');
    expect(fb.finding).toBe('Photo saved. No AI review.');
    expect(fb.finding + fb.draftNote).not.toMatch(/incision|redness|drainage|intact|closed/i);
  });

  it('the sample result never claims a comparison was done', async () => {
    const fb = await fallbackAssessment();
    expect(fb.comparison).not.toMatch(/similar|no change|improv|compared to/i);
    expect(fb.comparison).toMatch(/no .*comparison/i);
  });

  it('unavailable carries the notice and no clinical finding or note', () => {
    expect(unavailableAssessment()).toEqual({
      finding: 'Assessment unavailable: no photo captured', comparison: '', draftNote: '', source: 'unavailable',
    });
  });

  it('with a previous photo the model gets both images and documentation-aid wording', async () => {
    process.env.GEMINI_API_KEY = 'test-key-not-real';
    generateContent.mockResolvedValue({ text: JSON.stringify(GOOD) });
    await assessWound(JPEG_B64, { previousBase64: JPEG_B64 });
    const parts = generateContent.mock.calls[0][0].contents[0].parts;
    expect(parts.filter((p: { inlineData?: unknown }) => p.inlineData)).toHaveLength(2);
    const text = parts[parts.length - 1].text as string;
    expect(text).toMatch(/documentation aid/i);
    expect(text).toMatch(/do not diagnose/i);
    expect(text).not.toMatch(/no comparison is made/i);
    delete process.env.GEMINI_API_KEY;
  });

  it('without a previous photo the prompt says no comparison is possible', async () => {
    process.env.GEMINI_API_KEY = 'test-key-not-real';
    generateContent.mockResolvedValue({ text: JSON.stringify(GOOD) });
    await assessWound(JPEG_B64, { previousBase64: null });
    const parts = generateContent.mock.calls[0][0].contents[0].parts;
    expect(parts.filter((p: { inlineData?: unknown }) => p.inlineData)).toHaveLength(1);
    expect(parts[parts.length - 1].text).toMatch(/no previous photo/i);
    delete process.env.GEMINI_API_KEY;
  });
});

describe('assessWound model output validation', () => {
  beforeEach(() => {
    generateContent.mockReset();
    process.env.GEMINI_API_KEY = 'test-key-not-real';
  });
  afterEach(() => { delete process.env.GEMINI_API_KEY; });

  it.each([
    ['JSON null', 'null'],
    ['a bare number', '42'],
    ['an array of strings', '["a","b","c"]'],
    ['whitespace-only fields', JSON.stringify({ finding: '   ', comparison: 'x', draftNote: 'y' })],
    ['a non-string field', JSON.stringify({ finding: 'x', comparison: 7, draftNote: 'y' })],
    ['an empty reply', ''],
  ])('never surfaces %s as a Gemini finding', async (_name, text) => {
    generateContent.mockResolvedValue({ text });
    expect((await assessWound(JPEG_B64, { previousBase64: null })).source).toBe('fallback');
  });

  it('trims model text before returning it', async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify({ finding: '  F  ', comparison: ' C ', draftNote: ' D ' }) });
    expect(await assessWound(JPEG_B64, { previousBase64: null })).toEqual({ finding: 'F', comparison: 'C', draftNote: 'D', source: 'gemini' });
  });

  it('a response with no text field is treated as invalid, not as an empty finding', async () => {
    generateContent.mockResolvedValue({});
    expect((await assessWound(JPEG_B64, { previousBase64: null })).source).toBe('fallback');
  });

  it('uses the server-side previous photo when the caller does not pass one', async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify(GOOD) });
    await assessWound(JPEG_B64);
    const parts = generateContent.mock.calls[0][0].contents[0].parts;
    expect(parts.filter((p: { inlineData?: unknown }) => p.inlineData).length).toBeGreaterThanOrEqual(1);
  });
});

describe('isJpegBase64', () => {
  it('rejects text that is too short or far too long to be a wound photo', () => {
    expect(isJpegBase64('/9j')).toBe(false);
    expect(isJpegBase64('/9j/' + 'A'.repeat(300_000))).toBe(false);
    expect(isJpegBase64('/9j/4AAQ')).toBe(true);
  });

  it('accepts JPEG bytes and rejects other content', () => {
    expect(isJpegBase64(JPEG_B64)).toBe(true);
    expect(isJpegBase64(Buffer.from('%PDF-1.4').toString('base64'))).toBe(false);
    expect(isJpegBase64('not base64!!')).toBe(false);
    expect(isJpegBase64(123)).toBe(false);
    expect(isJpegBase64('')).toBe(false);
  });
});
