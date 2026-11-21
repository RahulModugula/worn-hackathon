// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import WebSocket from 'ws'
import { parseInstance, startServer } from './index'

const patients = {
  nurse: { id: 'N-01', assignedPatientIds: ['p1'] },
  handoffNurses: [{ id: 'N-01', name: 'Priya S.' }, { id: 'N-02', name: 'Marcus T.' }],
  patients: [{ id: 'p1', name: 'Maria Lopez', room: '12', attending: 'Dr. Okafor', allergies: [], meds: [] }],
}
const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
let srv: Awaited<ReturnType<typeof startServer>>
beforeAll(async () => { srv = await startServer({ patients }) })
afterAll(async () => { await srv.close() })

const open = (sid: string, dev: string, instance?: string) => new Promise<WebSocket>((res, rej) => {
  const w = new WebSocket(`ws://127.0.0.1:${srv.port}/ws?session=${sid}&device=${dev}${instance !== undefined ? `&instance=${instance}` : ''}`)
  w.on('open', () => res(w)); w.on('error', rej)
})
const waitMsg = (w: WebSocket, pred: (m: any) => boolean, ms = 2000) => new Promise<any>((res, rej) => {
  const t = setTimeout(() => rej(new Error('timeout')), ms)
  const h = (d: WebSocket.RawData) => { const m = JSON.parse(String(d)); if (pred(m)) { clearTimeout(t); w.off('message', h); res(m) } }
  w.on('message', h)
})
let n = 0
const send = async (w: WebSocket, o: object) => {
  const clientEventId = `hw${++n}`
  const r = waitMsg(w, m => m.t === 'result' && m.clientEventId === clientEventId)
  w.send(JSON.stringify({ device: 'phone', clientEventId, ...o }))
  return (await r).result
}

describe('connection instance (server-stamped)', () => {
  it('parseInstance accepts uuid-shaped ids of at most 64 chars and nothing else', () => {
    expect(parseInstance(A)).toBe(A)
    expect(parseInstance(null)).toBeUndefined()
    expect(parseInstance('')).toBeUndefined()
    expect(parseInstance('x'.repeat(20))).toBeUndefined()
    expect(parseInstance('a'.repeat(65))).toBeUndefined()
    expect(parseInstance('abcd<script>')).toBeUndefined()
  })

  it('glasses offer, a different instance reads back and accepts; a forged body instance changes nothing', async () => {
    const g = await open('hw1', 'glasses', A), p = await open('hw1', 'phone', B)
    // The offer carries a forged instance (B) in the body; the server must stamp A from the connection.
    const offer = await send(g, { type: 'HANDOFF_OFFER', device: 'glasses', handoffId: 'h1', patientId: 'p1', toNurseId: 'N-02', instance: B })
    expect(offer.ok).toBe(true)
    expect(offer.state.handoffs[0].offeredByInstance).toBe(A)
    expect(offer.state.handoffs[0].offeredVia).toBe('glasses')
    // The offering instance cannot accept even by sending the receiver's instance in the body.
    const self = await send(g, { type: 'HANDOFF_ACCEPT', handoffId: 'h1', instance: B })
    expect(self).toMatchObject({ ok: false, message: "Accept on the receiving nurse's device" })
    const acc = await send(p, { type: 'HANDOFF_ACCEPT', handoffId: 'h1' })
    expect(acc.ok).toBe(true)
    expect(acc.state.handoffs[0].acceptedByInstance).toBe(B)
    expect(acc.state.glassesNotice.text).toBe('Handoff accepted · Marcus T.')
    const again = await send(p, { type: 'HANDOFF_ACCEPT', handoffId: 'h1' })
    expect(again).toMatchObject({ ok: false, conflict: true })
    expect(again.message).toMatch(/^Already accepted by Marcus T\./)
    g.close(); p.close()
  })

  it('a connection without a valid instance can never accept (fails closed)', async () => {
    const g = await open('hw2', 'glasses', A), bad = await open('hw2', 'phone', 'not a valid instance!')
    await send(g, { type: 'HANDOFF_OFFER', device: 'glasses', handoffId: 'h2', patientId: 'p1', toNurseId: 'N-02' })
    const r = await send(bad, { type: 'HANDOFF_ACCEPT', handoffId: 'h2' })
    expect(r).toMatchObject({ ok: false, message: "Accept on the receiving nurse's device" })
    g.close(); bad.close()
  })

  it('SIM_HANDOFF_OFFER is director only', async () => {
    const p = await open('hw3', 'phone', B)
    const r = await send(p, { type: 'SIM_HANDOFF_OFFER', payload: {} })
    expect(r).toMatchObject({ ok: false, message: 'Director only' })
    const d = await open('hw3', 'director', A)
    const ok = await send(d, { type: 'SIM_HANDOFF_OFFER', device: 'director', payload: { toNurseId: 'N-02' } })
    expect(ok.ok).toBe(true)
    p.close(); d.close()
  })
})
