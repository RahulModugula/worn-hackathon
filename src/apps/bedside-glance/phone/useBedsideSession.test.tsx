import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionSocketUrl, useBedsideSession } from './useBedsideSession';

class FakeWS {
  static all: FakeWS[] = [];
  readyState = 0;
  sent: Array<Record<string, unknown>> = [];
  onopen: (() => void) | null = null; onclose: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null; onerror: (() => void) | null = null;
  constructor(public url: string) { FakeWS.all.push(this); }
  send(d: string) { this.sent.push(JSON.parse(d)); }
  close() { this.readyState = 3; }
}

describe('sessionSocketUrl', () => {
  it('uses wss on https pages and encodes the session id', () => {
    expect(sessionSocketUrl('a/b c', { protocol: 'https:', host: 'x.example' })).toBe('wss://x.example/ws?session=a%2Fb%20c&device=phone');
  });
});

describe('useBedsideSession', () => {
  beforeEach(() => { FakeWS.all = []; vi.stubGlobal('WebSocket', FakeWS); localStorage.clear(); window.history.replaceState({}, '', '/'); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });

  it('connects as the phone for the given session and sends typed actions with a device-less body and a fresh id', () => {
    const { result } = renderHook(() => useBedsideSession('ward-7'));
    const ws = FakeWS.all[0];
    expect(ws.url).toMatch(/\/ws\?session=ward-7&device=phone&instance=[0-9a-f-]{36}$/);
    act(() => { ws.readyState = 1; ws.onopen?.(); });
    act(() => result.current.send({ type: 'SET_ACTIVE_PATIENT', patientId: 'P-1012' } as never));
    expect(ws.sent.at(-1)).toMatchObject({ type: 'SET_ACTIVE_PATIENT', patientId: 'P-1012' });
    expect(typeof ws.sent.at(-1)!.clientEventId).toBe('string');
    expect(result.current.offline).toBe(false);
  });

  it('asks for director capability and forwards the key from the page URL when the drawer is on', () => {
    window.history.replaceState({}, '', '/?key=s3cret');
    renderHook(() => useBedsideSession('demo', { director: true }));
    expect(FakeWS.all[0].url).toContain('&director=1&key=s3cret');
  });

  it('an explicit key wins over the page URL, and no director flag means no key is sent', () => {
    window.history.replaceState({}, '', '/?key=page');
    renderHook(() => useBedsideSession('demo', { director: true, key: 'explicit' }));
    expect(FakeWS.all[0].url).toContain('key=explicit');
    renderHook(() => useBedsideSession('demo2'));
    expect(FakeWS.all[1].url).not.toContain('key=');
    expect(FakeWS.all[1].url).not.toContain('director');
  });

  it('queues actions while the socket is down and force-offline works through the wrapper', () => {
    const { result } = renderHook(() => useBedsideSession('q'));
    act(() => result.current.send({ type: 'SET_ACTIVE_PATIENT', patientId: 'P-1014' } as never));
    expect(FakeWS.all[0].sent).toEqual([]);
    act(() => result.current.setForceOffline(true));
    expect(result.current.forceOffline).toBe(true);
    expect(result.current.offline).toBe(true);
  });
});
