import { useEffect, useMemo, useState } from 'react';
import type { SessionState } from '../../../../shared/types';
import { readBridgeBattery } from '../../../hud-kit/platform/microlumin';
import { latencySummaries } from './model';
import { Icon } from './Icon';
import { Button, Chip } from './ui';

/** GET /api/health. Only booleans come back: key values never leave the server. */
export interface Health { ok: boolean; gemini: boolean; deepgram: boolean }
export type HealthState = Health | 'loading' | 'unreachable';

export interface PreflightEnv {
  secureContext: boolean;
  hasMediaDevices: boolean;
  hasSpeech: boolean;
  userAgent: string;
  /** Wrapper battery percent via the bridge's getInfo; absent or null means unknown. */
  batteryPct?: number | null;
}

export interface PreflightInput {
  env: PreflightEnv;
  health: HealthState;
  /** This phone's session socket is open (not Force Offline, not reconnecting). */
  connected: boolean;
  presence: Record<string, number>;
  /** This phone's own socket is a director socket (the drawer is open), so it counts once in presence.director. */
  directorSelf: boolean;
  telemetry: SessionState['telemetry'];
}

/** `fallback`: an optional service is missing but the demo still works (amber, not a fault). `fail` is real breakage. */
export type RowStatus = 'ok' | 'fail' | 'info' | 'fallback';
export interface PreflightRow { id: string; label: string; status: RowStatus; detail: string }

/** Plain-English browser name from the user agent, e.g. "Chrome 131 on Android" or "Safari 18 on iOS 18". */
export function browserLabel(ua: string): string {
  const os = /iPhone|iPad/.test(ua)
    ? `iOS ${ua.match(/OS (\d+)[_.]/)?.[1] ?? ''}`.trim()
    : /Android/.test(ua) ? 'Android'
      : /Windows/.test(ua) ? 'Windows'
        : /Mac OS X/.test(ua) ? 'macOS' : 'unknown OS';
  const webview = /Android/.test(ua) && /\bwv\b/.test(ua) ? ' (Android WebView)' : '';
  const chrome = ua.match(/(?:Chrome|CriOS)\/(\d+)/);
  const firefox = ua.match(/Firefox\/(\d+)/);
  const safari = ua.match(/Version\/(\d+)/);
  let name = 'unknown browser';
  if (chrome) name = `Chrome ${chrome[1]}`;
  else if (firefox) name = `Firefox ${firefox[1]}`;
  else if (safari && /Safari/.test(ua)) name = `Safari ${safari[1]}`;
  return `${name}${webview} on ${os}`;
}

const CAMERA_HINT = 'Needs https: plain http blocks the camera on phones';

/** Pure: the preflight rows for this device and session. No DOM, no network. */
export function computePreflight(input: PreflightInput): PreflightRow[] {
  const { env, health, connected, presence, directorSelf, telemetry } = input;
  const rows: PreflightRow[] = [];

  const serverOk = typeof health === 'object' && health.ok === true;
  rows.push({
    id: 'server',
    label: 'Server connected',
    status: health === 'loading' ? 'info' : serverOk && connected ? 'ok' : 'fail',
    detail: health === 'loading' ? 'Checking' : health === 'unreachable' ? 'Server not reachable' : !connected ? 'Session socket is offline (reconnecting)' : 'Reachable, session socket open',
  });

  const glasses = presence.glasses ?? 0;
  rows.push({
    id: 'glasses',
    label: 'Glasses present',
    status: glasses > 0 ? 'ok' : 'fail',
    detail: glasses > 0 ? `${glasses} connected` : 'No glasses socket in this session',
  });

  const mirror = (presence.director ?? 0) - (directorSelf ? 1 : 0);
  rows.push({
    id: 'mirror',
    label: 'Stage mirror present',
    status: mirror > 0 ? 'ok' : 'fail',
    detail: mirror > 0 ? `${mirror} open (/glasses?mirror=1)` : 'Open /glasses?mirror=1 on the projector',
  });

  const media = env.secureContext && env.hasMediaDevices;
  rows.push({
    id: 'camera',
    label: 'Camera available (phone)',
    status: media ? 'ok' : 'fail',
    detail: media ? 'Browser can open the camera' : env.secureContext ? 'Not supported in this browser' : CAMERA_HINT,
  });
  rows.push({
    id: 'mic',
    label: 'Mic available (phone)',
    status: media ? 'ok' : 'fail',
    detail: `${media ? 'Browser can open the mic' : 'Blocked: needs https or a supported browser'}; browser speech ${env.hasSpeech ? 'yes' : 'no'}`,
  });

  const keyRow = (id: string, label: string, set: (h: Health) => boolean, fallback: string): PreflightRow => {
    if (typeof health !== 'object') return { id, label, status: 'info', detail: health === 'loading' ? 'Checking' : 'Unknown (server not reachable)' };
    const ok = set(health);
    return { id, label, status: ok ? 'ok' : 'fallback', detail: ok ? 'Set on the server' : fallback };
  };
  rows.push(keyRow('gemini', 'Gemini key', h => h.gemini, 'Not set: wound results use the sample'));
  rows.push(keyRow('deepgram', 'Deepgram key', h => h.deepgram, 'Not set: voice uses browser speech or buttons'));

  const browser = browserLabel(env.userAgent);
  rows.push({
    id: 'browser',
    label: 'Browser',
    status: browser.startsWith('unknown') ? 'fail' : 'ok',
    detail: browser,
  });

  rows.push({
    id: 'battery',
    label: 'Glasses battery',
    status: 'info',
    detail: typeof env.batteryPct === 'number' ? `${Math.round(env.batteryPct)}%` : 'unknown',
  });

  const lat = latencySummaries(telemetry);
  rows.push({
    id: 'latency',
    label: 'Latency samples',
    status: 'info',
    detail: lat.length === 0
      ? 'No samples yet'
      : lat.map(l => `${l.label}: p50 ${l.p50} ms, max ${l.max} ms (n=${l.n})`).join('; '),
  });
  return rows;
}

/** Plain-text summary for teammates to paste into chat. Booleans and timings only: never a key or a token. */
export function statusText(rows: PreflightRow[], sessionId: string, now: Date = new Date()): string {
  const tag = { ok: 'OK', fail: 'FAIL', info: 'INFO', fallback: 'FALLBACK' } as const;
  const lines = [`Worn preflight, session ${sessionId}, ${now.toISOString()}`];
  for (const r of rows) lines.push(`[${tag[r.status]}] ${r.label}: ${r.detail}`);
  return lines.join('\n');
}

/** Clipboard with a fallback for insecure origins and older WebViews. Resolves false when nothing copied. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to the textarea copy */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Reads the device facts the preflight needs. Every access is guarded: a missing API is a finding, not a crash. */
export function readEnv(): PreflightEnv {
  const w = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : {};
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  return {
    secureContext: w.isSecureContext === true,
    hasMediaDevices: typeof nav?.mediaDevices?.getUserMedia === 'function',
    hasSpeech: !!(w.SpeechRecognition || w.webkitSpeechRecognition),
    userAgent: nav?.userAgent ?? '',
    batteryPct: readBridgeBattery(),
  };
}

async function defaultHealth(): Promise<Health> {
  const r = await fetch('/api/health');
  if (!r.ok) throw new Error('health status');
  const j = (await r.json()) as Partial<Health>;
  return { ok: j.ok === true, gemini: j.gemini === true, deepgram: j.deepgram === true };
}

interface PreflightProps {
  sessionId: string;
  connected: boolean;
  presence: Record<string, number>;
  directorSelf: boolean;
  telemetry: SessionState['telemetry'];
  /** Test seams. */
  fetchHealth?: () => Promise<Health>;
  env?: PreflightEnv;
}

/** Director preflight: green and red rows for what the demo needs, plus a copy button for teammates. */
export function Preflight({ sessionId, connected, presence, directorSelf, telemetry, fetchHealth = defaultHealth, env }: PreflightProps) {
  const [health, setHealth] = useState<HealthState>('loading');
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const [manual, setManual] = useState<string | null>(null);
  const deviceEnv = useMemo(() => env ?? readEnv(), [env]);

  useEffect(() => {
    let alive = true;
    fetchHealth().then(h => { if (alive) setHealth(h); }, () => { if (alive) setHealth('unreachable'); });
    return () => { alive = false; };
  }, [fetchHealth]);

  const rows = computePreflight({ env: deviceEnv, health, connected, presence, directorSelf, telemetry });
  const problems = rows.filter(r => r.status === 'fail').length;
  const fallbacks = rows.filter(r => r.status === 'fallback').length;

  const onCopy = async () => {
    const text = statusText(rows, sessionId);
    const ok = await copyText(text);
    setCopyMsg(ok ? 'Copied. Paste it into chat.' : 'Copy failed. Select the text below and copy it.');
    setManual(ok ? null : text);
  };

  return (
    <section className="ph-preflight" aria-labelledby="preflight-title">
      <div className="ph-pf-head">
        <h3 id="preflight-title" className="ph-h3">Preflight</h3>
        {problems === 0 && fallbacks === 0 ? (
          <Chip tone="accent" icon="check-circle">All set</Chip>
        ) : problems === 0 ? (
          <Chip tone="warn" icon="info">{fallbacks} on fallback</Chip>
        ) : (
          <Chip tone="danger" icon="alert">{problems} to fix{fallbacks > 0 ? ` · ${fallbacks} on fallback` : ''}</Chip>
        )}
      </div>
      <ul className="ph-pf-list">
        {rows.map(r => (
          <li key={r.id} className={`ph-pf ph-pf-${r.status}`} data-status={r.status}>
            <span className="ph-pf-mark" aria-hidden="true">
              <Icon name={r.status === 'ok' ? 'check-circle' : r.status === 'fail' ? 'alert' : 'info'} size={20} />
            </span>
            <span className="ph-pf-text">
              <span className="ph-strong">{r.label}</span>
              {r.status === 'fallback' && <span className="ph-pf-tag"> Using fallback</span>}
              <span className="ph-muted ph-pf-detail"> {r.detail}</span>
            </span>
            <span className="ph-sr-only">{r.status === 'ok' ? 'OK' : r.status === 'fail' ? 'Problem' : r.status === 'fallback' ? 'Notice' : 'Info'}</span>
          </li>
        ))}
      </ul>
      <Button block icon="copy" onClick={onCopy}>Copy status</Button>
      {copyMsg && <p role="status" className="ph-muted">{copyMsg}</p>}
      {manual && (
        <textarea readOnly className="ph-input ph-pf-manual" aria-label="Status text" rows={8} value={manual} />
      )}
    </section>
  );
}
