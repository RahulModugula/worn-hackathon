import { describe, it, expect, vi, afterEach } from 'vitest'
import { createSessionClient, makeUuid } from './useSession'

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
}
const mk = () => {
  FakeWS.all = []
  const mem = new Map<string, string>()
  const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) }
  let i = 0
  const c = createSessionClient<{ n: number }, any>({ url: 'ws://x', storageKey: 'k', storage, WebSocketImpl: FakeWS as never, backoffMs: () => 5, uuid: () => `id${++i}` })
  return { c, mem, storage }
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

describe('session client', () => {
  it('queues while disconnected, persists, flushes in order on connect, clears on result', () => {
    const { c, mem } = mk()
    c.start()
    c.dispatch({ type: 'A', device: 'phone' })
    c.dispatch({ type: 'B', device: 'phone' })
    expect(c.getSnapshot().offline).toBe(true)
    expect(JSON.parse(mem.get('k')!).outbox.map((a: any) => a.type)).toEqual(['A', 'B'])
    const ws = FakeWS.all[0]; ws.open()
    expect(ws.sent.filter(a => a.t !== 'ping').map(a => a.type)).toEqual(['A', 'B']) // health pings are not actions
    ws.recv({ t: 'result', clientEventId: 'id1', result: { ok: true, state: { n: 1 } } })
    ws.recv({ t: 'result', clientEventId: 'id2', result: { ok: false, conflict: true, message: 'm', state: { n: 2 } } })
    const s = c.getSnapshot()
    expect(s.outbox).toEqual([]); expect(s.conflicts).toHaveLength(1); expect(s.state).toEqual({ n: 2 })
    expect(s.offline).toBe(false)
    c.stop() // listeners are global; do not leak into later tests
  })
  it('reconnects with backoff after drop; restores persisted state', async () => {
    const { c, storage } = mk()
    c.start(); FakeWS.all[0].open(); FakeWS.all[0].recv({ t: 'state', state: { n: 7 } })
    FakeWS.all[0].drop()
    expect(c.getSnapshot().offline).toBe(true)
    await sleep(30)
    expect(FakeWS.all.length).toBe(2)
    const c2 = createSessionClient<{ n: number }, any>({ url: 'ws://x', storageKey: 'k', storage, WebSocketImpl: FakeWS as never })
    expect(c2.getSnapshot().state).toEqual({ n: 7 })
    c.stop()
  })
  it('forceOffline closes and queues; clearOutbox result empties outbox', () => {
    const { c } = mk()
    c.start(); FakeWS.all[0].open()
    c.setForceOffline(true)
    c.dispatch({ type: 'A', device: 'phone' })
    expect(c.getSnapshot().outbox).toHaveLength(1)
    c.setForceOffline(false)
    const ws = FakeWS.all[1]; ws.open()
    ws.recv({ t: 'result', clientEventId: 'zzz', result: { ok: true, clearOutbox: true, state: { n: 0 } } })
    expect(c.getSnapshot().outbox).toEqual([])
    c.stop()
  })
})

describe('uuid on insecure origins (iPhone Safari over http://192.168.x.x)', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('dispatch still works and ids are unique 36-char uuids when crypto.randomUUID is missing', () => {
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); return a } })
    expect((globalThis.crypto as { randomUUID?: unknown }).randomUUID).toBeUndefined()
    FakeWS.all = []
    const c = createSessionClient<{ n: number }, any>({ url: 'ws://x', storageKey: 'u', storage: { getItem: () => null, setItem: () => undefined }, WebSocketImpl: FakeWS as never })
    c.start(); FakeWS.all[0].open()
    const ids = Array.from({ length: 50 }, () => c.dispatch({ type: 'A', device: 'phone' } as never).clientEventId)
    expect(new Set(ids).size).toBe(50)
    for (const i of ids) expect(i).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(FakeWS.all[0].sent.filter(a => a.t !== 'ping')).toHaveLength(50)
    c.stop()
  })
  it('falls back to Math.random when there is no crypto at all', () => {
    vi.stubGlobal('crypto', undefined)
    expect(makeUuid()).toHaveLength(36)
    expect(makeUuid()).not.toBe(makeUuid())
  })
})

describe('presence, synced, acknowledgements', () => {
  it('exposes presence from the server, clears it and synced on drop; persisted state alone is not synced', () => {
    const { c, storage } = mk()
    c.start(); const ws = FakeWS.all[0]; ws.open()
    expect(c.getSnapshot().synced).toBe(false)
    ws.recv({ t: 'state', state: { n: 1 } })
    ws.recv({ t: 'presence', presence: { glasses: 1, phone: 1, director: 0 } })
    expect(c.getSnapshot().synced).toBe(true)
    expect(c.getSnapshot().presence).toEqual({ glasses: 1, phone: 1, director: 0 })
    ws.drop()
    expect(c.getSnapshot().presence).toEqual({}); expect(c.getSnapshot().synced).toBe(false)
    const c2 = createSessionClient<{ n: number }, any>({ url: 'ws://x', storageKey: 'k', storage, WebSocketImpl: FakeWS as never })
    expect(c2.getSnapshot().state).toEqual({ n: 1 }); expect(c2.getSnapshot().synced).toBe(false)
    c.stop()
  })
  it('onResult fires for every ack of a LIVE (non-outbox) action, with the action attached; failures included', () => {
    const got: any[] = []
    FakeWS.all = []
    let i = 0
    const c = createSessionClient<{ n: number }, any>({
      url: 'ws://x', storageKey: 'r', storage: { getItem: () => null, setItem: () => undefined }, WebSocketImpl: FakeWS as never,
      uuid: () => `r${++i}`, onResult: e => got.push(e),
    })
    c.start(); const ws = FakeWS.all[0]; ws.open()
    c.dispatch({ type: 'UNDO_LAST_MED', device: 'glasses' })
    c.dispatch({ type: 'LOG_MED', device: 'phone' })
    ws.recv({ t: 'result', clientEventId: 'r1', result: { ok: false, message: 'Too late to undo', state: { n: 1 } } })
    ws.recv({ t: 'result', clientEventId: 'r2', result: { ok: false, conflict: true, message: 'Already given', state: { n: 2 } } })
    expect(got.map(g => [g.action.type, g.ok, g.message])).toEqual([['UNDO_LAST_MED', false, 'Too late to undo'], ['LOG_MED', false, 'Already given']])
    expect(got[1].seq).toBeGreaterThan(got[0].seq)
    expect(c.getSnapshot().lastResult?.clientEventId).toBe('r2')
    ws.recv({ t: 'error', clientEventId: 'zz', message: 'bad LOG_MED' })
    expect(got.at(-1)).toMatchObject({ clientEventId: 'zz', ok: false, message: 'bad LOG_MED' })
    c.stop()
  })
})

describe('recovery after sleep and heartbeat', () => {
  afterEach(() => { vi.useRealTimers() })
  it('visibilitychange/pageshow/online tear down the old socket and reconnect immediately', () => {
    const { c } = mk()
    c.start(); FakeWS.all[0].open()
    expect(c.getSnapshot().offline).toBe(false)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(FakeWS.all).toHaveLength(2)
    expect(FakeWS.all[0].readyState).toBe(3)
    FakeWS.all[1].open()
    window.dispatchEvent(new Event('pageshow'))
    expect(FakeWS.all).toHaveLength(3)
    FakeWS.all[2].open()
    window.dispatchEvent(new Event('online'))
    expect(FakeWS.all).toHaveLength(4)
    c.stop()
    window.dispatchEvent(new Event('online'))
    expect(FakeWS.all).toHaveLength(4)
  })
  it('no pong within the timeout: socket is declared dead, actions go to the outbox, a new socket opens', () => {
    vi.useFakeTimers()
    const { c } = mk()
    c.start(); FakeWS.all[0].open()
    vi.advanceTimersByTime(10_000)
    expect(FakeWS.all[0].sent.at(-1)).toMatchObject({ t: 'ping', q: 0 })
    vi.advanceTimersByTime(5_000)
    expect(FakeWS.all).toHaveLength(2)
    expect(c.getSnapshot().offline).toBe(true)
    c.dispatch({ type: 'A', device: 'phone' })
    expect(c.getSnapshot().outbox).toHaveLength(1)
    expect(FakeWS.all[0].sent.some(m => m.type === 'A')).toBe(false)
    FakeWS.all[1].open()
    expect(FakeWS.all[1].sent.filter(m => m.t !== 'ping').map(m => m.type)).toEqual(['A'])
    c.stop()
  })
  it('a pong (or any traffic) keeps the socket alive', () => {
    vi.useFakeTimers()
    const { c } = mk()
    c.start(); const ws = FakeWS.all[0]; ws.open()
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(10_000)
      ws.recv({ t: 'pong' })
    }
    expect(FakeWS.all).toHaveLength(1)
    expect(c.getSnapshot().offline).toBe(false)
    c.stop()
  })
})
