// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import WebSocket from 'ws'
import { startServer } from './index'
import { convergence } from '../shared/stats'

const patients = { nurse: { assignedPatientIds: ['p1'] }, patients: [{ id: 'p1', meds: [{ id: 'm1' }] }] }
const G = '11111111-1111-4111-8111-111111111111'
let srv: Awaited<ReturnType<typeof startServer>>
beforeAll(async () => { srv = await startServer({ patients, statsIntervalMs: 40 }) })
afterAll(async () => { await srv.close() })

const open = (sid: string, q: string) => new Promise<WebSocket>((res, rej) => {
  const w = new WebSocket(`ws://127.0.0.1:${srv.port}/ws?session=${sid}&${q}`); w.on('open', () => res(w)); w.on('error', rej)
})
const waitMsg = (w: WebSocket, pred: (m: any) => boolean, ms = 3000) => new Promise<any>((res, rej) => {
  const t = setTimeout(() => rej(new Error('timeout')), ms)
  const h = (d: WebSocket.RawData) => { const m = JSON.parse(String(d)); if (pred(m)) { clearTimeout(t); w.off('message', h); res(m) } }
  w.on('message', h)
})
let n = 0
const act = (o: object) => JSON.stringify({ device: 'phone', clientEventId: `st${++n}`, ...o })

describe('stats frames to the director', () => {
  it('carry the glasses ping (v, q, rtt), reach only director sockets, and drive convergence', async () => {
    const dir = await open('st1', 'device=director&director=1')
    const g = await open('st1', `device=glasses&instance=${G}`)
    const phone = await open('st1', 'device=phone')
    const phoneStats: unknown[] = []
    phone.on('message', d => { const m = JSON.parse(String(d)); if (m.t === 'stats') phoneStats.push(m) })

    g.send(JSON.stringify({ t: 'ping', v: 0, q: 2, rtt: 18.6 }))
    const s1 = await waitMsg(dir, m => m.t === 'stats' && m.peers.some((p: any) => p.instance === G && p.q === 2 && p.rttMs === 19))
    const gp = s1.peers.find((p: any) => p.instance === G)
    expect(gp).toMatchObject({ device: 'glasses', v: 0, q: 2, rttMs: 19, offlineSince: null })
    expect(s1.serverVersion).toBe(0)

    // A server-side change: the glasses are now one version behind until they report the new one.
    const behind = waitMsg(dir, m => m.t === 'stats' && m.serverVersion === 1)
    phone.send(act({ type: 'LOG_MED', patientId: 'p1', medKey: 'm1' }))
    const s2 = await behind
    expect(convergence(s2.peers, s2.serverVersion).status).toBe('behind')
    const ok = waitMsg(dir, m => m.t === 'stats' && m.peers.some((p: any) => p.instance === G && p.v === 1))
    g.send(JSON.stringify({ t: 'ping', v: 1, q: 0 }))
    const s3 = await ok
    expect(convergence(s3.peers.filter((p: any) => p.device === 'glasses'), s3.serverVersion).status).toBe('converged')

    expect(phoneStats).toEqual([]) // non-director sockets never get stats
    dir.close(); g.close(); phone.close()
  })

  it('a dropped glasses socket shows as offline with a time; garbage ping fields are ignored', async () => {
    const dir = await open('st2', 'device=director&director=1')
    const g = await open('st2', `device=glasses&instance=${G}`)
    g.send(JSON.stringify({ t: 'ping', v: 'x', q: -5, rtt: 1e12, offlineMs: 'no' }))
    await waitMsg(dir, m => m.t === 'stats' && m.peers.some((p: any) => p.instance === G))
    const off = waitMsg(dir, m => m.t === 'stats' && m.peers.some((p: any) => p.instance === G && p.offlineSince !== null))
    g.close()
    const s = await off
    const gp = s.peers.find((p: any) => p.instance === G)
    expect(gp.v).toBeNull(); expect(gp.rttMs).toBeNull(); expect(gp.q).toBe(0)
    dir.close()
  })
})
