// @vitest-environment node
// End to end with a real server and the real session client: offline -> "done" queued -> online -> flush -> med given exactly once.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import WebSocket from 'ws'
import { startServer } from './index'
import { sessions } from './sessionStore'
import { createSessionClient } from '../src/hud-kit/sync/useSession'
import type { Action, SessionState } from '../shared/types'

const patients = { nurse: { assignedPatientIds: ['p1'] }, patients: [{ id: 'p1', name: 'Maria Lopez', room: '12', meds: [{ id: 'm1', name: 'Metformin' }] }] }
const G = '11111111-1111-4111-8111-111111111111'
let srv: Awaited<ReturnType<typeof startServer>>
beforeAll(async () => { srv = await startServer({ patients, statsIntervalMs: 30 }) })
afterAll(async () => { await srv.close() })

const until = async (pred: () => boolean, ms = 4000) => {
  const t0 = Date.now()
  while (!pred()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 10)) }
}
const mkClient = (sid: string, flushed: { queuedMs: number }[]) => {
  const mem = new Map<string, string>()
  return createSessionClient<SessionState, Action>({
    url: `ws://127.0.0.1:${srv.port}/ws?session=${sid}&device=glasses&instance=${G}`,
    storageKey: 'k', storage: { getItem: k => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) },
    WebSocketImpl: WebSocket as never, backoffMs: () => 20, pingMs: 100, pongTimeoutMs: 2000,
    onFlushed: e => flushed.push({ queuedMs: e.queuedMs }),
  })
}

describe('chaos drop: the offline "done" is applied exactly once', () => {
  it('queues while dark, flushes in order on reconnect, the server logs one med_given, and a second reconnect adds nothing', async () => {
    const flushed: { queuedMs: number }[] = []
    const c = mkClient('chaos1', flushed)
    // A director watches the stats frames.
    const dir = new WebSocket(`ws://127.0.0.1:${srv.port}/ws?session=chaos1&device=director&director=1`)
    const seen: any[] = []
    dir.on('message', d => { const m = JSON.parse(String(d)); if (m.t === 'stats') seen.push(m) })
    await new Promise(r => dir.on('open', r))

    c.start()
    await until(() => c.getSnapshot().synced)
    c.dispatch({ type: 'START_SHIFT', device: 'glasses' } as never)
    await until(() => !!sessions.get('chaos1')?.shift)

    c.setForceOffline(true)
    await until(() => (sessions.get('chaos1') ? true : false))
    c.dispatch({ type: 'LOG_MED', device: 'glasses', patientId: 'p1', medKey: 'm1', via: 'voice' } as never)
    await new Promise(r => setTimeout(r, 250))
    expect(sessions.get('chaos1')!.medStatus['p1:m1']).toBeUndefined() // dark: the server has not seen it
    expect(c.getSnapshot().outbox).toHaveLength(1)

    c.setForceOffline(false)
    await until(() => sessions.get('chaos1')!.medStatus['p1:m1']?.status === 'given')
    await until(() => c.getSnapshot().outbox.length === 0)
    const feed = () => sessions.get('chaos1')!.feed!.filter(f => f.kind === 'med_given')
    expect(feed()).toHaveLength(1)
    expect(flushed).toHaveLength(1)
    expect(flushed[0].queuedMs).toBeGreaterThanOrEqual(240)

    // The director saw the queue depth and the outage length on reconnect (the ping goes out before the flush).
    await until(() => seen.some(m => m.peers.some((p: any) => p.instance === G && p.lastOfflineMs !== null)))
    const frame = seen.find(m => m.peers.some((p: any) => p.instance === G && p.lastOfflineMs !== null))
    expect(frame.peers.find((p: any) => p.instance === G)).toMatchObject({ q: 1 })
    expect(frame.peers.find((p: any) => p.instance === G).lastOfflineMs).toBeGreaterThanOrEqual(240)

    // Another reconnect must not replay it.
    c.reconnectNow()
    await until(() => c.getSnapshot().synced)
    await new Promise(r => setTimeout(r, 150))
    expect(feed()).toHaveLength(1)
    expect(sessions.get('chaos1')!.events.filter(e => e.type === 'LOG_MED')).toHaveLength(1)
    c.stop(); dir.close()
  })
})
