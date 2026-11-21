import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { browserLabel, computePreflight, Preflight, statusText, type PreflightEnv, type PreflightInput } from './Preflight';
import { latencySummaries } from './model';

const CHROME_ANDROID_WEBVIEW = 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.6778.135 Mobile Safari/537.36';
const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';

const GOOD_ENV: PreflightEnv = { secureContext: true, hasMediaDevices: true, hasSpeech: true, userAgent: CHROME_ANDROID_WEBVIEW };

function input(over: Partial<PreflightInput> = {}): PreflightInput {
  return {
    env: GOOD_ENV,
    health: { ok: true, gemini: true, deepgram: false },
    connected: true,
    presence: { glasses: 1, phone: 1, director: 2 },
    directorSelf: true,
    telemetry: undefined,
    ...over,
  };
}

function statusOf(rows: ReturnType<typeof computePreflight>, id: string) {
  return rows.find(r => r.id === id)?.status;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('computePreflight rows', () => {
  it('everything green when the server, glasses, mirror, camera and keys are present', () => {
    const rows = computePreflight(input());
    expect(statusOf(rows, 'server')).toBe('ok');
    expect(statusOf(rows, 'glasses')).toBe('ok');
    expect(statusOf(rows, 'mirror')).toBe('ok');
    expect(statusOf(rows, 'camera')).toBe('ok');
    expect(statusOf(rows, 'mic')).toBe('ok');
    expect(statusOf(rows, 'gemini')).toBe('ok');
    expect(statusOf(rows, 'deepgram')).toBe('fallback'); // missing key is amber (the demo still works), never red
  });

  it('red when glasses are not connected and the stage mirror is missing', () => {
    // presence.director 1 is this phone's own director socket, so the mirror is absent.
    const rows = computePreflight(input({ presence: { glasses: 0, director: 1 } }));
    expect(statusOf(rows, 'glasses')).toBe('fail');
    expect(statusOf(rows, 'mirror')).toBe('fail');
  });

  it('counts the stage mirror when another director socket exists besides this phone', () => {
    const rows = computePreflight(input({ presence: { glasses: 1, director: 2 }, directorSelf: true }));
    expect(statusOf(rows, 'mirror')).toBe('ok');
  });

  it('red camera and mic over plain http, with the https hint', () => {
    const rows = computePreflight(input({ env: { ...GOOD_ENV, secureContext: false } }));
    expect(statusOf(rows, 'camera')).toBe('fail');
    expect(rows.find(r => r.id === 'camera')?.detail).toContain('Needs https');
    expect(statusOf(rows, 'mic')).toBe('fail');
  });

  it('red server row when the session socket is offline or the health check failed', () => {
    expect(statusOf(computePreflight(input({ connected: false })), 'server')).toBe('fail');
    const rows = computePreflight(input({ health: 'unreachable' }));
    expect(statusOf(rows, 'server')).toBe('fail');
    expect(rows.find(r => r.id === 'gemini')?.status).toBe('info');
  });

  it('shows the WebView or Chrome version of this device from the user agent', () => {
    expect(browserLabel(CHROME_ANDROID_WEBVIEW)).toBe('Chrome 131 (Android WebView) on Android');
    expect(browserLabel(SAFARI_IPHONE)).toBe('Safari 18 on iOS 18');
    const rows = computePreflight(input({ env: { ...GOOD_ENV, userAgent: 'curl/8' } }));
    expect(rows.find(r => r.id === 'browser')?.status).toBe('fail');
  });

  it('latency rows show p50 and max from the telemetry samples, or say there are none yet', () => {
    expect(computePreflight(input()).find(r => r.id === 'latency')?.detail).toBe('No samples yet');
    const telemetry = { scanToCardMs: [100, 300, 200] };
    expect(latencySummaries(telemetry)).toEqual([{ metric: 'scanToCardMs', label: 'Scan to card', n: 3, p50: 200, max: 300 }]);
    const detail = computePreflight(input({ telemetry })).find(r => r.id === 'latency')?.detail;
    expect(detail).toBe('Scan to card: p50 200 ms, max 300 ms (n=3)');
  });
});

describe('statusText for teammates', () => {
  it('is plain text with one line per row and never includes a key value or secret', () => {
    const rows = computePreflight(input({ health: { ok: true, gemini: true, deepgram: true } }));
    const text = statusText(rows, 'demo', new Date('2026-11-21T18:00:00Z'));
    const lines = text.split('\n');
    expect(lines[0]).toBe('Worn preflight, session demo, 2026-11-21T18:00:00.000Z');
    expect(lines.slice(1)).toHaveLength(rows.length);
    expect(lines[1]).toMatch(/^\[(OK|FAIL|INFO)\] Server connected: /);
    expect(text).not.toMatch(/sk-|AIza|key=|token/i);
  });
});

describe('Preflight panel', () => {
  it('copies the summary with the clipboard API and says so', async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(
      <Preflight
        sessionId="demo" connected presence={{ glasses: 1, director: 2 }} directorSelf telemetry={undefined}
        env={GOOD_ENV} fetchHealth={async () => ({ ok: true, gemini: true, deepgram: true })}
      />,
    );
    await act(async () => {});
    expect(screen.getByText('Gemini key')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy status' }));
    await act(async () => {});
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(String(writeText.mock.calls[0][0])).toContain('[OK] Glasses present: 1 connected');
    expect(screen.getByRole('status').textContent).toBe('Copied. Paste it into chat.');
  });

  it('falls back to a selectable text box when the clipboard is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    Object.defineProperty(document, 'execCommand', { value: () => false, configurable: true });
    render(
      <Preflight
        sessionId="demo" connected presence={{}} directorSelf={false} telemetry={undefined}
        env={GOOD_ENV} fetchHealth={async () => { throw new Error('offline'); }}
      />,
    );
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Copy status' }));
    await act(async () => {});
    expect(screen.getByRole('status').textContent).toContain('Copy failed');
    const box = screen.getByLabelText('Status text') as HTMLTextAreaElement;
    expect(box.value).toContain('[FAIL] Server connected');
    expect(box.readOnly).toBe(true);
  });

  it('a key shows only as set or not set, never its value', async () => {
    render(
      <Preflight
        sessionId="demo" connected presence={{}} directorSelf={false} telemetry={undefined}
        env={GOOD_ENV} fetchHealth={async () => ({ ok: true, gemini: false, deepgram: true })}
      />,
    );
    await act(async () => {});
    expect(screen.getByText('Not set: wound results use the sample')).toBeTruthy();
    expect(screen.getByText('Set on the server')).toBeTruthy();
  });
});

describe('Preflight badge: fallback is amber, only real breakage is red', () => {
  it('missing keys read "N on fallback" with no problem count', async () => {
    render(
      <Preflight
        sessionId="demo" connected presence={{ glasses: 1, director: 2 }} directorSelf telemetry={undefined}
        env={GOOD_ENV} fetchHealth={async () => ({ ok: true, gemini: false, deepgram: false })}
      />,
    );
    await act(async () => {});
    expect(screen.getByText('2 on fallback')).toBeTruthy();
    expect(screen.queryByText(/to fix/)).toBeNull();
    expect(screen.getAllByText('Using fallback')).toHaveLength(2);
  });

  it('real breakage plus fallbacks reads "N to fix · M on fallback"', async () => {
    render(
      <Preflight
        sessionId="demo" connected presence={{}} directorSelf={false} telemetry={undefined}
        env={GOOD_ENV} fetchHealth={async () => ({ ok: true, gemini: false, deepgram: false })}
      />,
    );
    await act(async () => {});
    expect(screen.getByText(/2 to fix · 2 on fallback/)).toBeTruthy();
  });
});

describe('battery row (wrapper bridge getInfo)', () => {
  it('shows the level when available', () => {
    const row = computePreflight(input({ env: { ...GOOD_ENV, batteryPct: 83 } })).find(r => r.id === 'battery');
    expect(row?.status).toBe('info');
    expect(row?.detail).toContain('83%');
  });
  it.each([undefined, null])('says unknown and never fails when battery is %s', b => {
    const rows = computePreflight(input({ env: { ...GOOD_ENV, batteryPct: b } }));
    const row = rows.find(r => r.id === 'battery');
    expect(row?.status).toBe('info');
    expect(row?.detail).toBe('unknown');
  });
});
