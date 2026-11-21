import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStatsHub, GHOST_MS } from './stats'
import type { ServerMsg } from '../shared/types'

type Stats = Extract<ServerMsg, { t: 'stats' }>
let version = 3
let out: Stats[] = []
const hub = () => createStatsHub({ now: () => Date.now(), getVersion: () => version, deliver: (_sid, m) => out.push(m), minIntervalMs: 500 })

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10_000); version = 3; out = [] })
afterEach(() => vi.useRealTimers())
const step = (ms: number) => { vi.advanceTimersByTime(ms) }

describe('stats hub', () => {
  it('reports each peer with version, queue depth, rtt and last seen, plus the server version', () => {
    const h = hub()
    h.connected('s', 1, 'glasses', 'inst-g')
    h.ping('s', 1, { v: 3, q: 0, rttMs: 12 })
    step(600) // the connect frame went out at once; the ping rides the trailing frame
    const last = out.at(-1)!
    expect(last.serverVersion).toBe(3)
    expect(last.peers).toEqual([{ device: 'glasses', instance: 'inst-g', v: 3, q: 0, rttMs: 12, lastSeenMs: 10_000, offlineSince: null, lastOfflineMs: null }])
  })

  it('emits on change only: an identical ping adds nothing', () => {
    const h = hub()
    h.connected('s', 1, 'phone')
    h.ping('s', 1, { v: 3, q: 0, rttMs: 10 })
    step(1000)
    const n = out.length
    h.ping('s', 1, { v: 3, q: 0, rttMs: 10 })
    step(1000)
    expect(out.length).toBe(n)
    h.ping('s', 1, { v: 3, q: 2, rttMs: 10 })
    expect(out.length).toBe(n + 1)
  })

  it('never more than 2 per second: a burst gets a leading and one trailing frame carrying the latest', () => {
    const h = hub()
    h.connected('s', 1, 'phone')
    step(1000)
    out = []
    for (let i = 0; i < 20; i++) { h.ping('s', 1, { v: 3, q: i, rttMs: 10 }); step(20) } // 400 ms burst
    step(600)
    expect(out.length).toBeLessThanOrEqual(2)
    expect(out.at(-1)!.peers[0].q).toBe(19)
    // And over a whole second of constant change the cap holds.
    out = []
    for (let i = 0; i < 100; i++) { h.ping('s', 1, { v: 3, q: 100 + i, rttMs: 10 }); step(10) }
    step(600)
    expect(out.length).toBeLessThanOrEqual(4) // 1.6 s elapsed => at most 2 per second plus the trailing frame
  })

  it('a server version change is a change, and a stale peer is visible next to it', () => {
    const h = hub()
    h.connected('s', 1, 'glasses'); h.connected('s', 2, 'phone')
    h.ping('s', 1, { v: 3 }); h.ping('s', 2, { v: 3 })
    step(1000)
    version = 4
    h.versionChanged('s')
    expect(out.at(-1)!.serverVersion).toBe(4)
    expect(out.at(-1)!.peers.map((p) => p.v)).toEqual([3, 3])
    step(1000)
    h.ping('s', 1, { v: 4 })
    expect(out.at(-1)!.peers.map((p) => p.v)).toEqual([4, 3])
  })

  it('a closed peer with an instance stays visible as offline; reconnecting with the same instance clears it and records the outage', () => {
    const h = hub()
    h.connected('s', 1, 'glasses', 'inst-g')
    h.ping('s', 1, { v: 3 })
    step(2000)
    h.closed('s', 1)
    step(1000)
    expect(out.at(-1)!.peers).toMatchObject([{ device: 'glasses', instance: 'inst-g', offlineSince: 12_000 }])
    step(2000)
    h.connected('s', 2, 'glasses', 'inst-g')
    h.ping('s', 2, { v: 3, q: 1, offlineMs: 4200 })
    step(600)
    const peers = out.at(-1)!.peers
    expect(peers).toHaveLength(1)
    expect(peers[0]).toMatchObject({ offlineSince: null, lastOfflineMs: 4200, q: 1 })
  })

  it('a closed peer without an instance just disappears; a ghost expires after a minute', () => {
    const h = hub()
    h.connected('s', 1, 'phone'); h.closed('s', 1)
    step(1000)
    expect(out.at(-1)!.peers).toEqual([])
    h.connected('s', 2, 'glasses', 'inst-x'); h.closed('s', 2)
    step(1000)
    expect(out.at(-1)!.peers).toHaveLength(1)
    step(61_000)
    h.versionChanged('s')
    expect(out.at(-1)!.peers).toEqual([])
  })

  it('frees the session entry GHOST_MS after the room empties, so entries do not grow without bound', () => {
    const h = hub()
    for (let i = 0; i < 200; i++) { h.connected(`s${i}`, i, 'phone', `inst-${i}-aaaa`); h.closed(`s${i}`, i) }
    expect(h.size()).toBe(200)
    step(GHOST_MS + 1000)
    expect(h.size()).toBe(0)
  })

  it('a reconnect inside the grace period cancels the drop', () => {
    const h = hub()
    h.connected('s', 1, 'phone', 'inst-r-aaaa'); h.closed('s', 1)
    step(GHOST_MS - 1000)
    h.connected('s', 2, 'phone', 'inst-r-aaaa')
    step(GHOST_MS * 2)
    expect(h.size()).toBe(1)
    h.closed('s', 2)
    step(GHOST_MS + 1000)
    expect(h.size()).toBe(0)
  })

  it('closed() makes no ghost while a live peer has the same instance (reconnect before the old socket closes)', () => {
    const h = hub()
    h.connected('s', 1, 'phone', 'inst-dup-aaaa')
    h.connected('s', 2, 'phone', 'inst-dup-aaaa')
    h.closed('s', 1)
    step(1000)
    const peers = out.at(-1)!.peers
    expect(peers).toHaveLength(1)
    expect(peers[0].offlineSince).toBeNull()
  })

  it('dropSession clears pending timers and state', () => {
    const h = hub()
    h.connected('s', 1, 'phone'); h.ping('s', 1, { q: 1 }); h.ping('s', 1, { q: 2 })
    h.dropSession('s')
    out = []
    step(5000)
    expect(out).toEqual([])
  })
})
