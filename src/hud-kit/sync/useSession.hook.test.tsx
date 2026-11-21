import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionClient, useSession } from './useSession';

class FakeWS {
  static all: FakeWS[] = [];
  readyState = 0;
  sent: Array<Record<string, unknown>> = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) { FakeWS.all.push(this); }
  send(d: string) { this.sent.push(JSON.parse(d)); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  recv(m: unknown) { this.onmessage?.({ data: typeof m === 'string' ? m : JSON.stringify(m) }); }
}
const memStorage = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

type A = { clientEventId: string; device: string; type: string };

describe('createSessionClient robustness', () => {
  beforeEach(() => { FakeWS.all = []; });

  it('ignores corrupt persisted state and a throwing storage instead of crashing', () => {
    const bad = memStorage({ k: '{not json' });
    const c = createSessionClient<{ n: number }, A>({ url: 'ws://x', storageKey: 'k', storage: bad, WebSocketImpl: FakeWS as never });
    expect(c.getSnapshot().state).toBeNull();
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); } };
    const c2 = createSessionClient<{ n: number }, A>({ url: 'ws://x', storageKey: 'k', storage: throwing, WebSocketImpl: FakeWS as never });
    expect(() => c2.dispatch({ type: 'A', device: 'phone' })).not.toThrow();
    expect(c2.getSnapshot().outbox).toHaveLength(1);
  });

  it('a non-array persisted outbox is dropped but the persisted state is kept', () => {
    const s = memStorage({ k: JSON.stringify({ state: { n: 3 }, outbox: 'oops' }) });
    const c = createSessionClient<{ n: number }, A>({ url: 'ws://x', storageKey: 'k', storage: s, WebSocketImpl: FakeWS as never });
    expect(c.getSnapshot().state).toEqual({ n: 3 });
    expect(c.getSnapshot().outbox).toEqual([]);
  });

  it('a server error frame drops that action from the outbox and reports a failed result', () => {
    const got: Array<{ ok: boolean; clientEventId: string }> = [];
    const c = createSessionClient<{ n: number }, A>({
      url: 'ws://x', storageKey: 'e', storage: memStorage(), WebSocketImpl: FakeWS as never, uuid: () => 'e1', onResult: (e) => got.push(e),
    });
    c.start();
    c.dispatch({ type: 'A', device: 'phone' }); // queued: socket not open yet
    const ws = FakeWS.all[0];
    ws.open();
    ws.recv({ t: 'error', clientEventId: 'e1', message: 'nope' });
    expect(c.getSnapshot().outbox).toEqual([]);
    expect(got).toEqual([expect.objectContaining({ ok: false, clientEventId: 'e1' })]);
    c.stop();
  });

  it('malformed frames and frames without the expected fields change nothing', () => {
    const c = createSessionClient<{ n: number }, A>({ url: 'ws://x', storageKey: 'm', storage: memStorage(), WebSocketImpl: FakeWS as never });
    c.start();
    const ws = FakeWS.all[0];
    ws.open();
    ws.recv({ t: 'state', state: { n: 1 } });
    ws.recv('garbage{');
    ws.recv({ t: 'state' });
    ws.recv({ t: 'presence', presence: 'x' });
    ws.recv({ t: 'result', clientEventId: 'q' });
    expect(c.getSnapshot().state).toEqual({ n: 1 });
    expect(c.getSnapshot().presence).toEqual({});
    c.stop();
  });

  it('a throwing onResult consumer cannot break sync', () => {
    const c = createSessionClient<{ n: number }, A>({
      url: 'ws://x', storageKey: 't', storage: memStorage(), WebSocketImpl: FakeWS as never, uuid: () => 't1',
      onResult: () => { throw new Error('consumer bug'); },
    });
    c.start();
    const ws = FakeWS.all[0];
    ws.open();
    c.dispatch({ type: 'A', device: 'phone' });
    ws.recv({ t: 'result', clientEventId: 't1', result: { ok: true, state: { n: 9 } } });
    expect(c.getSnapshot().state).toEqual({ n: 9 });
    c.stop();
  });

  it('clearOutbox result wipes queued actions and conflicts; clearConflicts empties conflicts', () => {
    let i = 0;
    const c = createSessionClient<{ n: number }, A>({ url: 'ws://x', storageKey: 'c', storage: memStorage(), WebSocketImpl: FakeWS as never, uuid: () => `c${++i}` });
    c.start();
    c.dispatch({ type: 'A', device: 'phone' });
    c.dispatch({ type: 'B', device: 'phone' });
    const ws = FakeWS.all[0];
    ws.open();
    ws.recv({ t: 'result', clientEventId: 'c1', result: { ok: false, conflict: true, message: 'm', state: { n: 1 } } });
    expect(c.getSnapshot().conflicts).toHaveLength(1);
    c.clearConflicts();
    expect(c.getSnapshot().conflicts).toEqual([]);
    ws.recv({ t: 'result', clientEventId: 'c2', result: { ok: true, clearOutbox: true, state: { n: 2 } } });
    expect(c.getSnapshot().outbox).toEqual([]);
    c.stop();
  });

  it('stop() prevents any further reconnect', async () => {
    const c = createSessionClient<{ n: number }, A>({ url: 'ws://x', storageKey: 's', storage: memStorage(), WebSocketImpl: FakeWS as never, backoffMs: () => 5 });
    c.start();
    c.stop();
    await new Promise((r) => setTimeout(r, 30));
    expect(FakeWS.all.length).toBe(1);
    expect(FakeWS.all[0].readyState).not.toBe(1);
  });
});

describe('useSession hook', () => {
  beforeEach(() => { FakeWS.all = []; vi.stubGlobal('WebSocket', FakeWS); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('connects on mount, exposes state, dispatches with a generated id, and closes on unmount', () => {
    const seen: string[] = [];
    const { result, unmount } = renderHook(() => useSession<{ n: number }, A>({ url: 'ws://hook', storageKey: 'hook-1', onResult: (e) => seen.push(e.clientEventId) }));
    expect(result.current.offline).toBe(true);
    const ws = FakeWS.all[0];
    expect(ws.url).toBe('ws://hook');
    act(() => ws.open());
    act(() => ws.recv({ t: 'state', state: { n: 5 } }));
    expect(result.current.state).toEqual({ n: 5 });
    expect(result.current.synced).toBe(true);
    expect(result.current.offline).toBe(false);

    let id = '';
    act(() => { id = result.current.dispatch({ type: 'LOG', device: 'phone' }).clientEventId; });
    expect(ws.sent.at(-1)).toMatchObject({ type: 'LOG', device: 'phone', clientEventId: id });
    act(() => ws.recv({ t: 'result', clientEventId: id, result: { ok: true, state: { n: 6 } } }));
    expect(seen).toEqual([id]); // the latest onResult closure is used
    expect(result.current.lastResult?.ok).toBe(true);

    act(() => result.current.setForceOffline(true));
    expect(result.current.forceOffline).toBe(true);
    expect(result.current.offline).toBe(true);
    unmount();
    expect(FakeWS.all.at(-1)!.readyState).not.toBe(1);
  });

  it('a new url creates a fresh client (new socket to the new address)', () => {
    const { rerender } = renderHook(({ url }) => useSession<{ n: number }, A>({ url, storageKey: 'hook-2' }), { initialProps: { url: 'ws://one' } });
    rerender({ url: 'ws://two' });
    expect(FakeWS.all.map((w) => w.url)).toEqual(['ws://one', 'ws://two']);
  });
});
