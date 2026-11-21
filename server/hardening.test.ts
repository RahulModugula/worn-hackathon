// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest'
import net from 'node:net'
import WebSocket, { WebSocketServer } from 'ws'
import { startServer, installCrashGuards } from './index'
import { sessions, newState, getOrCreateSession, MAX_SESSIONS } from './sessionStore'
import type { SessionState } from '../shared/types'

const patients = { nurse: { assignedPatientIds: ['p1'] }, patients: [{ id: 'p1', attending: 'Dr. Okafor', meds: [{ id: 'm1' }] }] }
let srv: Awaited<ReturnType<typeof startServer>> | undefined
afterEach(async () => { await srv?.close(); srv = undefined; delete process.env.DIRECTOR_KEY })

const q = (sid: string, extra: string) => `ws://127.0.0.1:${srv!.port}/ws?session=${sid}&${extra}`
const open = (sid: string, extra: string) => new Promise<WebSocket>((res, rej) => {
  const w = new WebSocket(q(sid, extra)); w.on('open', () => res(w)); w.on('error', rej)
})
const waitMsg = (w: WebSocket, pred: (m: any) => boolean, ms = 2000) => new Promise<any>((res, rej) => {
  const t = setTimeout(() => rej(new Error('timeout')), ms)
  const h = (d: WebSocket.RawData) => { const m = JSON.parse(String(d)); if (pred(m)) { clearTimeout(t); w.off('message', h); res(m) } }
  w.on('message', h)
})
let n = 0
const act = (o: object) => JSON.stringify({ device: 'phone', clientEventId: `h${++n}`, ...o })
const call = async (w: WebSocket, o: object) => { const id = `h${n + 1}`; w.send(act(o)); return (await waitMsg(w, m => m.t === 'result' && m.clientEventId === id)).result }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const rawUpgrade = (port: number, target: string) => new Promise<{ closed: boolean; data: string }>(resolve => {
  const s = net.connect(port, '127.0.0.1', () => {
    s.write(`GET ${target} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`)
  })
  let data = ''
  s.on('data', d => { data += String(d) })
  s.on('error', () => undefined)
  s.on('close', () => resolve({ closed: true, data }))
  setTimeout(() => { s.destroy() }, 1500)
})

describe('upgrade handling', () => {
  it('a malformed upgrade URL does not kill the server, and unknown upgrade paths are closed', async () => {
    srv = await startServer({ patients })
    const bad = await rawUpgrade(srv.port, '//[bad')
    expect(bad.closed).toBe(true)
    const t0 = Date.now()
    const unknown = await rawUpgrade(srv.port, '/nope')
    expect(unknown.closed).toBe(true)
    expect(Date.now() - t0).toBeLessThan(1000) // closed by the server, not by the 1.5s test timer
    const health = await fetch(`http://127.0.0.1:${srv.port}/api/health`).then(r => r.json())
    expect(health.ok).toBe(true)
  })

  it('installCrashGuards logs and keeps serving instead of exiting', () => {
    const before = process.listenerCount('uncaughtException')
    const off = installCrashGuards()
    expect(process.listenerCount('uncaughtException')).toBe(before + 1)
    expect(process.listenerCount('unhandledRejection')).toBeGreaterThan(0)
    off()
    expect(process.listenerCount('uncaughtException')).toBe(before)
  })
})

describe('device identity and director capability', () => {
  it('phone socket cannot RESET, SIM, SET_CLOCK_OFFSET or START_SHIFT with baseMin; director can', async () => {
    srv = await startServer({ patients })
    const p = await open('d1', 'device=phone'), d = await open('d1', 'device=director')
    for (const o of [{ type: 'RESET_SESSION' }, { type: 'SIM_CLOCK_PLUS_30' }, { type: 'SIM_VOICE_DONE' },
      { type: 'SET_CLOCK_OFFSET', offsetMin: 5 }, { type: 'START_SHIFT', baseMin: 100 }]) {
      const r = await call(p, o)
      expect(r.ok, JSON.stringify(o)).toBe(false)
      expect(r.message).toBe('Director only')
    }
    expect((await call(p, { type: 'START_SHIFT' })).ok).toBe(true) // the nurse's own Start Shift button
    expect((await call(d, { type: 'SIM_CLOCK_PLUS_30' })).ok).toBe(true)
    expect((await call(d, { type: 'RESET_SESSION' })).ok).toBe(true)
    p.close(); d.close()
  })

  it('a body device of "director" on a phone socket is ignored (and recorded as phone)', async () => {
    srv = await startServer({ patients })
    const p = await open('d2', 'device=phone')
    const r = await call(p, { type: 'RESET_SESSION', device: 'director' })
    expect(r.ok).toBe(false)
    const l = await call(p, { type: 'LOG_MED', patientId: 'p1', medKey: 'm1', device: 'director' })
    expect(l.ok).toBe(true)
    expect(l.state.medStatus['p1:m1'].by).toBe('phone')
    p.close()
  })

  it('director=1 in the query grants capability to a phone socket', async () => {
    srv = await startServer({ patients })
    const p = await open('d3', 'device=phone&director=1')
    expect((await call(p, { type: 'RESET_SESSION' })).ok).toBe(true)
    p.close()
  })

  it('with DIRECTOR_KEY set, capability needs the matching key', async () => {
    process.env.DIRECTOR_KEY = 'sesame'
    srv = await startServer({ patients })
    const noKey = await open('d4', 'device=director'), bad = await open('d4', 'device=phone&director=1&key=nope')
    const good = await open('d4', 'device=phone&director=1&key=sesame')
    expect((await call(noKey, { type: 'RESET_SESSION' })).message).toBe('Director only')
    expect((await call(bad, { type: 'RESET_SESSION' })).message).toBe('Director only')
    expect((await call(good, { type: 'RESET_SESSION' })).ok).toBe(true)
    noKey.close(); bad.close(); good.close()
  })

  it('idempotency is scoped by device: the same clientEventId from another device is a new action', async () => {
    srv = await startServer({ patients })
    const g = await open('d5', 'device=glasses'), p = await open('d5', 'device=phone')
    g.send(JSON.stringify({ device: 'glasses', clientEventId: 'same', type: 'LOG_MED', patientId: 'p1', medKey: 'm1' }))
    await waitMsg(g, m => m.t === 'result' && m.clientEventId === 'same')
    const r = waitMsg(p, m => m.t === 'result' && m.clientEventId === 'same')
    p.send(JSON.stringify({ device: 'phone', clientEventId: 'same', type: 'LOG_MED', patientId: 'p1', medKey: 'm1' }))
    const res = (await r).result
    expect(res.conflict).toBe(true) // evaluated for real (already given), not replayed as the glasses' ok
    g.close(); p.close()
  })
})

describe('caps and liveness', () => {
  it('caps sessions: evicts the oldest idle one, never one with a connected socket', async () => {
    srv = await startServer({ patients, maxSessions: 3 })
    sessions.clear()
    const keep = await open('c0', 'device=phone')
    for (const id of ['c1', 'c2', 'c3', 'c4']) { const w = await open(id, 'device=phone'); w.close(); await sleep(20) }
    expect(sessions.size).toBeLessThanOrEqual(3)
    expect(sessions.has('c0')).toBe(true)
    expect(sessions.has('c4')).toBe(true)
    expect(sessions.has('c1')).toBe(false)
    keep.close()
    expect(MAX_SESSIONS).toBe(50)
  })

  it('terminates sockets that miss two server pings, and keeps ones that answer', async () => {
    srv = await startServer({ patients, pingIntervalMs: 40 })
    const dead = new WebSocket(q('p1', 'device=phone'), { autoPong: false })
    await new Promise(r => dead.on('open', r))
    const live = await open('p1', 'device=glasses')
    const closed = new Promise<number>(r => dead.on('close', c => r(c)))
    await Promise.race([closed, sleep(1000).then(() => { throw new Error('dead socket not terminated') })])
    expect(live.readyState).toBe(WebSocket.OPEN)
    live.close()
  })

  it('caps concurrent /ws/stt sockets', async () => {
    process.env.DEEPGRAM_API_KEY = 'test'
    const up = new WebSocketServer({ port: 0 })
    const upPort = (up.address() as { port: number }).port
    srv = await startServer({ patients, stt: { upstreamUrl: `ws://127.0.0.1:${upPort}/`, maxClients: 2 } })
    const mk = () => new Promise<WebSocket | number>(res => {
      const w = new WebSocket(`ws://127.0.0.1:${srv!.port}/ws/stt`)
      w.on('open', () => res(w)); w.on('unexpected-response', (_rq, rs) => res(rs.statusCode ?? 0)); w.on('error', () => undefined)
    })
    const a = await mk(), b = await mk(), c = await mk()
    expect(typeof a).toBe('object'); expect(typeof b).toBe('object')
    expect(c).toBe(503)
    ;(a as WebSocket).close(); (b as WebSocket).close(); up.close()
    delete process.env.DEEPGRAM_API_KEY
  })
})
void newState; void getOrCreateSession; void (null as unknown as SessionState)
