import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

/** 'unavailable' = nothing was assessed (no photo): the text is a notice, never a clinical finding. */
export type WoundSource = 'gemini' | 'fallback' | 'unavailable';

export interface WoundAssessment {
  finding: string;
  comparison: string;
  draftNote: string;
  source: WoundSource;
}

export interface AssessOptions {
  /** Hard budget for the whole call, including the fallback read. Default 3500 ms. */
  timeoutMs?: number;
  /** Previous wound photo (base64 JPEG) to compare against. Default: public/data/wound-previous.jpg when present; null = none. */
  previousBase64?: string | null;
}

export const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
export const ASSESS_TIMEOUT_MS = 3500;
export const DRAFT_NOTE_MAX = 160;

// Relative to the repo root, where `npm start` runs.
const DEMO_RESPONSES_PATH = resolve(process.cwd(), 'data/demo-responses.json');
const PREVIOUS_PHOTO_PATH = resolve(process.cwd(), 'public/data/wound-previous.jpg');
export const UNAVAILABLE_TEXT = 'Assessment unavailable: no photo captured';

/** Used only when data/demo-responses.json is missing or invalid (BG-03 owns that file). */
const BUILT_IN_FALLBACK: Omit<WoundAssessment, 'source'> = {
  finding: 'Photo saved. No AI review.',
  comparison: 'No AI review: no photo comparison was made.',
  draftNote: 'Wound photo taken. Nurse assessment:',
};

const COMMON = [
  'You are a documentation aid for a nurse.',
  'Describe only the visible dressing and wound appearance. Do not diagnose. Do not give treatment advice.',
  'Return JSON with keys "finding", "comparison" and "draftNote".',
  '"finding": one short sentence describing what is visible in the new photo.',
];
const DRAFT = `"draftNote": one short sentence, at most ${DRAFT_NOTE_MAX} characters, for the nurse to review.`;

/** Prompt for a new photo alone: no comparison is possible and the model must say so. */
export const PROMPT_SINGLE = [
  ...COMMON, 'There is no previous photo.',
  '"comparison": one short sentence saying that no comparison was made because there is no previous photo.', DRAFT,
].join(' ');

/** Prompt when the previous photo is attached: the first image is new, the second is the previous one. */
export const PROMPT_COMPARE = [
  ...COMMON, 'The first image is the new photo and the second image is the previous photo of the same site.',
  '"comparison": one short sentence listing only visible differences between the two photos (colour, dressing, drainage, size) for documentation. Say "no visible difference" only if you see none. Do not say the wound is improving, worsening or infected.', DRAFT,
].join(' ');

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    finding: { type: Type.STRING },
    comparison: { type: Type.STRING },
    draftNote: { type: Type.STRING },
  },
  required: ['finding', 'comparison', 'draftNote'],
};

/** True only for base64 text whose decoded bytes start with the JPEG SOI marker FF D8 FF. */
export function isJpegBase64(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 4 || value.length > 300_000) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  const head = Buffer.from(value.slice(0, 4), 'base64');
  return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
}

/** Validates model output. Returns null for anything that is not three non-empty strings. */
function sanitize(raw: unknown): Omit<WoundAssessment, 'source'> | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const { finding, comparison, draftNote } = o;
  if (typeof finding !== 'string' || typeof comparison !== 'string' || typeof draftNote !== 'string') {
    return null;
  }
  const f = finding.trim();
  const c = comparison.trim();
  const d = draftNote.trim().slice(0, DRAFT_NOTE_MAX);
  if (!f || !c || !d) return null;
  return { finding: f, comparison: c, draftNote: d };
}

let fallbackCache: Promise<Omit<WoundAssessment, 'source'>> | undefined;

function loadFallback(): Promise<Omit<WoundAssessment, 'source'>> {
  fallbackCache ??= readFile(DEMO_RESPONSES_PATH, 'utf8')
    .then((text) => {
      const parsed: unknown = JSON.parse(text);
      const obj = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
      const candidate = obj.woundAssessment ?? obj.assessWound ?? parsed; // woundAssessment is the file's key; assessWound was the old name
      return sanitize(candidate) ?? BUILT_IN_FALLBACK;
    })
    .catch(() => BUILT_IN_FALLBACK);
  return fallbackCache;
}

/** Canned answer for demos without a key, a timeout or an error. Never throws. */
export async function fallbackAssessment(): Promise<WoundAssessment> {
  return { ...(await loadFallback()), source: 'fallback' };
}

/** Nothing was assessed. Carries a notice, never a clinical finding, comparison or draft note. */
export function unavailableAssessment(): WoundAssessment {
  return { finding: UNAVAILABLE_TEXT, comparison: '', draftNote: '', source: 'unavailable' };
}

let previousCache: Promise<string | null> | undefined;
/** The server-side previous wound photo, or null when missing or not a JPEG. */
export function loadPreviousPhoto(): Promise<string | null> {
  previousCache ??= readFile(PREVIOUS_PHOTO_PATH)
    .then((buf) => {
      const b64 = buf.toString('base64');
      return isJpegBase64(b64) ? b64 : null;
    })
    .catch(() => null);
  return previousCache;
}

async function callGemini(jpegBase64: string, previous: string | null, apiKey: string, signal: AbortSignal): Promise<unknown> {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || DEFAULT_MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: jpegBase64 } },
          ...(previous ? [{ inlineData: { mimeType: 'image/jpeg', data: previous } }] : []),
          { text: previous ? PROMPT_COMPARE : PROMPT_SINGLE },
        ],
      },
    ],
    config: {
      temperature: 0.2,
      maxOutputTokens: 240,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
      abortSignal: signal,
    },
  });
  return JSON.parse(response.text ?? '');
}

/**
 * Describes a wound photo for the nurse. Always resolves: returns the Gemini answer
 * when it arrives in time and is valid, otherwise the demo fallback (source 'fallback').
 */
export async function assessWound(jpegBase64: string, opts: AssessOptions = {}): Promise<WoundAssessment> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return fallbackAssessment();

  const timeoutMs = opts.timeoutMs ?? ASSESS_TIMEOUT_MS;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, timeoutMs);
  });

  try {
    const previous = opts.previousBase64 === undefined ? await loadPreviousPhoto() : opts.previousBase64;
    const live = callGemini(jpegBase64, previous, apiKey, controller.signal)
      .then(sanitize)
      .catch(() => null);
    const result = await Promise.race([live, timedOut]);
    if (result) return { ...result, source: 'gemini' };
    return fallbackAssessment();
  } catch {
    return fallbackAssessment();
  } finally {
    clearTimeout(timer);
  }
}
