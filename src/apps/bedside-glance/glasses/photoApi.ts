// Photo upload and wound assessment calls. Never throw: failures come back as values.
import { FALLBACK_ASSESSMENT, type Assessment } from './stateMachine';

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
export const API_TIMEOUT_MS = 6000;
/** The nurse waits at most this long for a wound assessment, then sees the sample result. */
export const ASSESS_TIMEOUT_MS = 4000;

async function post(fetchFn: FetchFn, url: string, body: unknown, timeoutMs = API_TIMEOUT_MS): Promise<Response> {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    return await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl?.signal,
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Uploads the cached photo for `captureId`. With no photo (camera unavailable) there is nothing to
 * upload, which counts as success unless the failure is simulated. `simulateFailure` sends the
 * server's photoUploadFailed flag so the real failure path (502) is exercised.
 */
export async function uploadPhoto(
  fetchFn: FetchFn, captureId: string, imageBase64: string | null, simulateFailure: boolean,
): Promise<boolean> {
  if (!imageBase64 && !simulateFailure) return true;
  try {
    const res = await post(fetchFn, '/api/upload-wound-photo', {
      captureId,
      ...(imageBase64 ? { imageBase64 } : {}),
      ...(simulateFailure ? { photoUploadFailed: true } : {}),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Asks the server for an assessment; any failure returns the offline fallback copy. */
export async function assessPhoto(fetchFn: FetchFn, captureId: string): Promise<Assessment> {
  try {
    const res = await post(fetchFn, '/api/assess-wound', { captureId }, ASSESS_TIMEOUT_MS);
    if (!res.ok) return FALLBACK_ASSESSMENT;
    const j = (await res.json()) as Partial<Assessment> | null;
    if (j && isStr(j.finding) && isStr(j.comparison) && isStr(j.draftNote)) {
      const source = (j as { source?: unknown }).source === 'gemini' ? 'gemini' : 'fallback';
      return { finding: j.finding, comparison: j.comparison, draftNote: j.draftNote, source };
    }
  } catch {
    // fall through to the fallback
  }
  return FALLBACK_ASSESSMENT;
}

export const FALLBACK_PHOTO_URL = '/data/wound-fallback.jpg';

/** Director SIM_CAPTURE_WOUND: the bundled JPEG as base64, or null if it cannot be fetched. Never throws. */
export async function fetchFallbackPhoto(fetchFn: FetchFn): Promise<string | null> {
  try {
    const res = await fetchFn(FALLBACK_PHOTO_URL);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  } catch {
    return null;
  }
}
