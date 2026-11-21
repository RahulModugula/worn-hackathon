import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSessionClient } from './useSession'

class FakeWS {
  static all: FakeWS[] = []
  readyState = 0
  sent: any[] = []
  onopen: any = null; onclose: any = null; onmessage: any = null; onerror: any = null
  constructor(public url: string) { FakeWS.all.push(this) }
  send(d: string) { this.sent.push(JSON.parse(d)) }
  close() { this.readyState = 3 }
  open() { this.readyState = 1; this.onopen?.() }
  recv(m: unknown) { this.onmessage?.({ data: JSON.stringify(m) }) }
  drop() { this.readyState = 3; this.onclose?.() }
  pings() { return this.sent.filter(m => m.t === 'ping') }
  actions() { return this.sent.filter(m => m.t === undefined) }
}
type S = { version: number }
const mk = (extra: Record<string, unknown> = {}) => {
  FakeWS.all = []
  const mem = new Map<string, string>()
  const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) }
  let i = 0
  const flushed: { clientEventId: string; queuedMs: number }[] = []
  const c = createSessionClient<S, any>({
    url: 'ws://x', storageKey: 'k', storage, WebSocketImpl: FakeWS as never, backoffMs: () => 100, uuid: () => `id${++i}`,
    pingMs: 10_000, pongTimeoutMs: 5_000, onFlushed: e => flushed.push({ clientEventId: e.clientEventId, queuedMs: e.queuedMs }), ...extra,
  })
  return { c, flushed }
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000) })
afterEach(() => vi.useRealTimers())

describe('ping carries state version and outbox depth; the client times the pong', () => {
  it('sends {t:ping, v, q} on the interval and reports the measured round trip on the next ping', () => {
    const { c } = mk()
    c.start(); const ws = FakeWS.all[0]; ws.open()
    ws.recv({ t: 'state', state: { version: 7 } })
    vi.advanceTimersByTime(10_000)
    const p1 = ws.pings().at(-1)!
    expect(p1).toMatchObject({ t: 'ping', v: 7, q: 0 })
    expect('rtt' in p1).toBe(false) // nothing measured yet
    vi.advanceTimersByTime(42)
    ws.recv({ t: 'pong', n: p1.n })
    expect(c.getSnapshot().rttMs).toBe(42)
    vi.advanceTimersByTime(10_000)
    expect(ws.pings().at(-1)).toMatchObject({ v: 7, q: 0, rtt: 42 })
    c.stop()
  })

  it('a pong for an older or unknown ping never produces a bogus round trip', () => {
    const { c } = mk()
    c.start(); const ws = FakeWS.all[0]; ws.open()
    vi.advanceTimersByTime(10_000)
    ws.recv({ t: 'pong' })          // no n
    ws.recv({ t: 'pong', n: 9999 }) // unknown n
    expect(c.getSnapshot().rttMs).toBeNull()
    c.stop()
  })

  it('q is the live outbox length', () => {
    const { c } = mk()
    c.start(); const ws = FakeWS.all[0]; ws.open()
    c.setForceOffline(true)
    c.dispatch({ type: 'A', device: 'glasses' }); c.dispatch({ type: 'B', device: 'glasses' })
    c.setForceOffline(false)
    const ws2 = FakeWS.all[1]; ws2.open()
    expect(ws2.pings()[0]).toMatchObject({ q: 2 }) // reported before the flush drains it
    c.stop()
  })

  it('a new state version is reported soon after, not only on the 10 s tick', () => {
    const { c } = mk()
    c.start(); const ws = FakeWS.all[0]; ws.open()
    ws.recv({ t: 'state', state: { version: 1 } })
    vi.advanceTimersByTime(300)
    const before = ws.pings().length
    ws.recv({ t: 'state', state: { version: 2 } })
    ws.recv({ t: 'state', state: { version: 3 } })
    vi.advanceTimersByTime(300)
    const after = ws.pings().slice(before)
    expect(after).toHaveLength(1) // debounced: one ping for the burst
    expect(after[0]).toMatchObject({ v: 3 })
    c.stop()
  })
})

describe('reconnect', () => {
  it('pings at once with offlineMs, before flushing the outbox', () => {
    const { c } = mk()
    c.start(); const ws = FakeWS.all[0]; ws.open()
    ws.recv({ t: 'state', state: { version: 4 } })
    ws.drop()
    vi.advanceTimersByTime(3000)
    const ws2 = FakeWS.all.at(-1)!
    c.dispatch({ type: 'A', device: 'glasses' })
    ws2.open()
    const first = ws2.sent[0]
    expect(first).toMatchObject({ t: 'ping', v: 4, q: 1 })
    expect(first.offlineMs).toBeGreaterThanOrEqual(3000)
    expect(first.offlineMs).toBeLessThan(3500)
    // offlineMs is reported once per outage
    vi.advanceTimersByTime(10_000)
    expect(ws2.pings().slice(1).every(p => !('offlineMs' in p))).toBe(true)
    c.stop()
  })

  it('a first connect reports no outage', () => {
    const { c } = mk()
    c.start(); FakeWS.all[0].open()
    expect('offlineMs' in FakeWS.all[0].pings()[0]).toBe(false)
    c.stop()
  })
})

describe('offline, done queued, online: flushed once, with the time each action waited', () => {
  it('Force Offline -> dispatch -> back online -> the action goes out exactly once; onFlushed reports queuedMs', () => {
    const { c, flushed } = mk()
    c.start(); FakeWS.all[0].open()
    c.setForceOffline(true)
    vi.advanceTimersByTime(1000)
    const a = c.dispatch({ type: 'LOG_MED', device: 'glasses', medKey: 'M-1' })
    expect(c.getSnapshot().outbox).toHaveLength(1)
    vi.advanceTimersByTime(3000)
    c.setForceOffline(false)
    const ws = FakeWS.all.at(-1)!
    ws.open()
    expect(ws.actions().filter(m => m.type === 'LOG_MED')).toHaveLength(1)
    expect(flushed).toEqual([{ clientEventId: a.clientEventId, queuedMs: 3000 }])
    // The server acks: outbox empties and nothing is sent again, even across a later reconnect.
    ws.recv({ t: 'result', clientEventId: a.clientEventId, result: { ok: true, state: { version: 2 } } })
    expect(c.getSnapshot().outbox).toHaveLength(0)
    ws.drop(); vi.advanceTimersByTime(200)
    const ws3 = FakeWS.all.at(-1)!; ws3.open()
    expect(ws3.actions()).toEqual([])
    c.stop()
  })

  it('an action sent while online is never reported as queued', () => {
    const { c, flushed } = mk()
    c.start(); FakeWS.all[0].open()
    c.dispatch({ type: 'A', device: 'glasses' })
    expect(flushed).toEqual([])
    c.stop()
  })
})
