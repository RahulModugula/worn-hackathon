// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import WebSocket from 'ws'
import { startServer } from './index'
import { createSessionClient } from '../src/hud-kit/sync/useSession'
import type { Action, SessionState } from '../shared/types'

const patients = { nurse: { assignedPatientIds: ['p1'] }, patients: [{ id: 'p1', attending: 'Dr. Okafor', meds: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }] }, { id: 'p9', meds: [] }] }
let srv: Awaited<ReturnType<typeof startServer>>
beforeAll(async () => { srv = await startServer({ patients, drReplyDelayMs: 150 }) })
afterAll(async () => { await srv.close() })

const url = (sid: string, dev: string) => `ws://127.0.0.1:${srv.port}/ws?session=${sid}&device=${dev}`
const open = (sid: string, dev: string) => new Promise<WebSocket>((res, rej) => {
  const w = new WebSocket(url(sid, dev)); w.on('open', () => res(w)); w.on('error', rej)
})
const waitMsg = (w: WebSocket, pred: (m: any) => boolean, ms = 2000) => new Promise<any>((res, rej) => {
  const t = setTimeout(() => rej(new Error('timeout')), ms)
  const h = (d: WebSocket.RawData) => { const m = JSON.parse(String(d)); if (pred(m)) { clearTimeout(t); w.off('message', h); res(m) } }
  w.on('message', h)
})
let n = 0
const act = (o: object) => JSON.stringify({ device: 'phone', clientEventId: `w${++n}`, ...o })
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

describe('ws sync', () => {
  it('action on one client is visible on the other in <1s; reset <500ms', async () => {
    const g = await open('s1', 'glasses'), p = await open('s1', 'phone&director=1')
    let t = Date.now()
    const seen = waitMsg(g, m => m.t === 'state' && m.state.medStatus['p1:m1']?.status === 'given')
    p.send(act({ type: 'LOG_MED', patientId: 'p1', medKey: 'm1' }))
    await seen
    expect(Date.now() - t).toBeLessThan(1000)
    t = Date.now()
    const cleared = waitMsg(g, m => m.t === 'state' && Object.keys(m.state.medStatus).length === 0)
    p.send(act({ type: 'RESET_SESSION', device: 'director' }))
    await cleared
    expect(Date.now() - t).toBeLessThan(500)
    g.close(); p.close()
  })

  it('GET /api/telemetry returns the stored samples; unknown session is empty', async () => {
    const g = await open('tele1', 'glasses')
    const ack = waitMsg(g, m => m.t === 'result')
    g.send(act({ type: 'TELEMETRY_SAMPLE', metric: 'scanToCardMs', ms: 321, device: 'glasses' }))
    expect((await ack).result.ok).toBe(true)
    const j = await fetch(`http://127.0.0.1:${srv.port}/api/telemetry?session=tele1`).then(r => r.json())
    expect(j).toEqual({ session: 'tele1', telemetry: { scanToCardMs: [321] } })
    const none = await fetch(`http://127.0.0.1:${srv.port}/api/telemetry?session=nope-x`).then(r => r.json())
    expect(none).toEqual({ session: 'nope-x', telemetry: {} })
    g.close()
  })

  it('malformed JSON / oversized frame / unknown type do not crash the server', async () => {
    const w = await open('s2', 'phone')
    const err = waitMsg(w, m => m.t === 'error')
    w.send('{not json')
    expect((await err).message).toBe('bad json')
    const err2 = waitMsg(w, m => m.t === 'error')
    w.send(act({ type: 'DROP_TABLES' }))
    await err2
    const closed = new Promise(r => w.on('close', r))
    w.send('x'.repeat(70 * 1024))
    await closed
    const health = await fetch(`http://127.0.0.1:${srv.port}/api/health`).then(r => r.json())
    expect(health.ok).toBe(true)
    expect(Object.keys(health)).toEqual(expect.arrayContaining(['ok', 'deepgram', 'gemini', 'version', 'lan']))
    const w2 = await open('s2', 'glasses') // still accepting connections
    w2.close()
  })

  it('outbox: 3 queued offline actions flush in order and FWW conflict is surfaced', async () => {
    const mem = new Map<string, string>()
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) }
    // another device already gave m1
    const other = await open('s3', 'glasses')
    const ack = waitMsg(other, m => m.t === 'result')
    other.send(act({ type: 'LOG_MED', device: 'glasses', patientId: 'p1', medKey: 'm1' }))
    await ack

    const c = createSessionClient<SessionState, Action>({
      url: url('s3', 'phone'), storageKey: 'k', storage, WebSocketImpl: WebSocket as never, backoffMs: () => 50,
    })
    c.setForceOffline(true)
    c.dispatch({ type: 'LOG_MED', device: 'phone', patientId: 'p1', medKey: 'm1' } as never)
    c.dispatch({ type: 'LOG_MED', device: 'phone', patientId: 'p1', medKey: 'm2' } as never)
    c.dispatch({ type: 'LOG_MED', device: 'phone', patientId: 'p1', medKey: 'm3' } as never)
    expect(c.getSnapshot().outbox).toHaveLength(3)
    expect(JSON.parse(mem.get('k')!).outbox).toHaveLength(3)

    c.setForceOffline(false)
    for (let i = 0; i < 40 && c.getSnapshot().outbox.length; i++) await sleep(50)
    const snap = c.getSnapshot()
    expect(snap.outbox).toHaveLength(0)
    expect(snap.conflicts).toHaveLength(1)
    expect(snap.conflicts[0].message).toMatch(/^Already given .* via glasses$/)
    const log = snap.state!.events.filter(e => e.type === 'LOG_MED' && e.device === 'phone').length
    expect(log).toBe(2) // m2, m3 accepted in order
    expect(Object.keys(snap.state!.medStatus).sort()).toEqual(['p1:m1', 'p1:m2', 'p1:m3'])
    const order = snap.state!.events.map(e => e.type)
    expect(order.length).toBe(3)
    expect(snap.state!.lastMedLog!.key).toBe('p1:m3')
    c.stop(); other.close()
  })
})

const cap = (captureId: string, over: object = {}) => act({
  type: 'WOUND_CAPTURED', device: 'glasses', captureId, patientId: 'p1', finding: 'f', comparison: 'c', draftNote: 'd', ...over,
})
const nextPresence = (w: WebSocket, pred: (p: Record<string, number>) => boolean) => waitMsg(w, m => m.t === 'presence' && pred(m.presence))
/** Opens a socket and records every message from the very first frame, so nothing is missed. */
const openRec = (sid: string, dev: string) => new Promise<{ w: WebSocket; msgs: any[] }>((res, rej) => {
  const w = new WebSocket(url(sid, dev)); const msgs: any[] = []
  w.on('message', d => msgs.push(JSON.parse(String(d)))); w.on('open', () => res({ w, msgs })); w.on('error', rej)
})
/** Round-trips a harmless action so the next state frame is the current authoritative state. */
const freshState = (w: WebSocket) => new Promise<any>(res => {
  const id = `probe${++n}`
  const h = (d: WebSocket.RawData) => { const m = JSON.parse(String(d)); if (m.t === 'state') { w.off('message', h); res(m.state) } }
  w.on('message', h)
  w.send(JSON.stringify({ device: 'glasses', clientEventId: id, type: 'SET_GLASSES_VIEW', view: id }))
})

describe('presence', () => {
  it('counts sockets per role, on connect and on disconnect, scoped to the session', async () => {
    const { w: p, msgs } = await openRec('pr1', 'phone')
    await sleep(50)
    expect(msgs.find(m => m.t === 'presence').presence).toEqual({ glasses: 0, phone: 1, director: 0 })
    const gotG = nextPresence(p, x => x.glasses === 1)
    const g = await open('pr1', 'glasses')
    expect((await gotG).presence).toEqual({ glasses: 1, phone: 1, director: 0 })
    const other = await open('pr1-other', 'glasses') // another session must not leak in
    const gone = nextPresence(p, x => x.glasses === 0)
    g.close()
    expect((await gone).presence).toEqual({ glasses: 0, phone: 1, director: 0 })
    p.close(); other.close()
  })
})

describe('acknowledgements', () => {
  it('replies to the dispatching client with a result for every action, conflicts and failures included; other clients get no result', async () => {
    const a = await open('ack1', 'glasses')
    const { w: b, msgs: bMsgs } = await openRec('ack1', 'phone')
    const ok = act({ type: 'LOG_MED', device: 'glasses', patientId: 'p1', medKey: 'm1' })
    const okId = JSON.parse(ok).clientEventId
    const r1 = waitMsg(a, m => m.t === 'result' && m.clientEventId === okId)
    a.send(ok)
    expect((await r1).result.ok).toBe(true)
    const dup = act({ type: 'LOG_MED', device: 'phone', patientId: 'p1', medKey: 'm1' })
    const dupId = JSON.parse(dup).clientEventId
    const r2 = waitMsg(b, m => m.t === 'result' && m.clientEventId === dupId)
    b.send(dup)
    const res = (await r2).result
    expect(res).toMatchObject({ ok: false, conflict: true })
    expect(res.message).toMatch(/^Already given .* via glasses$/)
    const undo = act({ type: 'UNDO_LAST_MED', device: 'phone' })
    const undoId = JSON.parse(undo).clientEventId
    const r3 = waitMsg(b, m => m.t === 'result' && m.clientEventId === undoId)
    b.send(undo)
    expect((await r3).result.ok).toBe(true)
    const none = act({ type: 'UNDO_LAST_MED', device: 'phone' })
    const noneId = JSON.parse(none).clientEventId
    const r4 = waitMsg(b, m => m.t === 'result' && m.clientEventId === noneId)
    b.send(none)
    expect((await r4).result).toMatchObject({ ok: false, message: 'Nothing to undo' })
    expect(bMsgs.filter(m => m.t === 'result').map(m => m.clientEventId)).not.toContain(okId)
    a.close(); b.close()
  })
  it('a validation failure that carries a clientEventId is reported back on that id', async () => {
    const w = await open('ack2', 'phone')
    const e = waitMsg(w, m => m.t === 'error' && m.clientEventId === 'bad-1')
    w.send(JSON.stringify({ device: 'phone', clientEventId: 'bad-1', type: 'LOG_MED' }))
    expect((await e).message).toBe('bad LOG_MED')
    w.close()
  })
})

describe('wound lifecycle over ws (two clients)', () => {
  it('glasses WOUND_CAPTURED reaches the phone; phone SEND notifies glasses; the doctor reply is a server timer, once', async () => {
    const g = await open('wd1', 'glasses'), p = await open('wd1', 'phone')
    const seen = waitMsg(p, m => m.t === 'state' && m.state.woundCaptures[0]?.status === 'pending_review')
    g.send(cap('cap-a'))
    await seen
    const sent = waitMsg(g, m => m.t === 'state' && m.state.glassesNotice?.text === 'Sent to Dr. Okafor')
    const t0 = Date.now()
    p.send(act({ type: 'WOUND_SEND', captureId: 'cap-a' }))
    await sent
    const replied = await waitMsg(g, m => m.t === 'state' && m.state.glassesNotice?.kind === 'dr_reply', 1500)
    expect(Date.now() - t0).toBeGreaterThanOrEqual(140) // timer driven, not synchronous
    expect(replied.state.woundCaptures[0].reply.from).toBe('Dr. Okafor')
    expect(replied.state.glassesNotice.text).toMatch(/^Dr\. Okafor: /)
    const again = waitMsg(p, m => m.t === 'result' && m.result.conflict === true)
    p.send(act({ type: 'WOUND_SEND', captureId: 'cap-a' }))
    expect((await again).result.message).toBe('Already sent to Dr. Okafor')
    g.close(); p.close()
  })

  it('SIM_DR_REPLY replies immediately and the pending timer does not double-reply', async () => {
    const g = await open('wd2', 'glasses'), d = await open('wd2', 'director')
    g.send(cap('cap-b'))
    const sent = waitMsg(d, m => m.t === 'state' && m.state.woundCaptures[0]?.status === 'sent')
    g.send(act({ type: 'WOUND_SEND', captureId: 'cap-b', device: 'phone' }))
    await sent
    const t0 = Date.now()
    const replied = waitMsg(d, m => m.t === 'state' && m.state.woundCaptures[0]?.reply)
    d.send(act({ type: 'SIM_DR_REPLY', device: 'director' }))
    await replied
    expect(Date.now() - t0).toBeLessThan(120) // well before the 150ms timer
    await sleep(300)
    const st = await freshState(d)
    expect(st.events.filter((e: any) => e.type === 'DR_REPLY')).toHaveLength(1)
    g.close(); d.close()
  })

  it('RESET_SESSION cancels a pending doctor reply', async () => {
    const g = await open('wd3', 'glasses&director=1')
    g.send(cap('cap-c'))
    g.send(act({ type: 'WOUND_SEND', captureId: 'cap-c', device: 'phone' }))
    g.send(act({ type: 'RESET_SESSION', device: 'director' }))
    await sleep(350)
    const st = await freshState(g)
    expect(st.events.some((e: any) => e.type === 'DR_REPLY')).toBe(false)
    expect(st.woundCaptures).toEqual([])
    g.close()
  })
})

describe('server enforces the assignment list', () => {
  it('SET_ACTIVE_PATIENT for a patient not on the list is refused over ws', async () => {
    const w = await open('as1', 'glasses')
    const r = waitMsg(w, m => m.t === 'result')
    w.send(act({ type: 'SET_ACTIVE_PATIENT', device: 'glasses', patientId: 'p9' }))
    expect((await r).result).toMatchObject({ ok: false, message: 'Not on your list' })
    w.close()
  })
})

describe('event seq cursor over ws', () => {
  it('a fresh client sees eventSeq at the newest event; SIM events carry increasing seq', async () => {
    const a = await open('sq1', 'director')
    a.send(act({ type: 'SIM_VOICE_DONE', device: 'director' }))
    a.send(act({ type: 'SIM_VOICE_NEXT', device: 'director' }))
    await sleep(80)
    const { w: b, msgs } = await openRec('sq1', 'glasses')
    await sleep(50)
    const m = msgs.find(x => x.t === 'state')
    expect(m.state.eventSeq).toBe(2)
    expect(m.state.events.map((e: any) => e.seq)).toEqual([1, 2])
    a.close(); b.close()
  })
})

describe('director-only DR_REPLY and server-recorded assessment source', () => {
  it('a phone cannot forge DR_REPLY; the director-internal simulated reply still lands', async () => {
    const g = await open('dr-forge', 'glasses'), p = await open('dr-forge', 'phone'), d = await open('dr-forge', 'director')
    g.send(cap('cap-forge'))
    const forged = waitMsg(p, m => m.t === 'result' && m.clientEventId === 'forge-1')
    p.send(act({ type: 'DR_REPLY', captureId: 'cap-forge', from: 'Dr. Fake', text: 'Approved', clientEventId: 'forge-1' }))
    expect((await forged).result).toMatchObject({ ok: false, message: 'Director only' })
    const st = await freshState(p)
    expect(st.woundCaptures[0].reply).toBeUndefined()
    const sent = waitMsg(d, m => m.t === 'state' && m.state.woundCaptures[0]?.status === 'sent')
    p.send(act({ type: 'WOUND_SEND', captureId: 'cap-forge' }))
    await sent
    const replied = await waitMsg(d, m => m.t === 'state' && m.state.woundCaptures[0]?.reply, 1500)
    expect(replied.state.woundCaptures[0].reply.from).toBe('Dr. Okafor')
    g.close(); p.close(); d.close()
  })

  it('a client claiming gemini for a capture the server never assessed is stored as fallback', async () => {
    const g = await open('src-claim', 'glasses')
    g.send(cap('cap-claim-1', { assessmentSource: 'gemini' }))
    const st = await freshState(g)
    expect(st.woundCaptures[0].assessmentSource).toBe('fallback')
    g.close()
  })

  it('uses the source the server recorded at /api/assess-wound, not the client claim', async () => {
    const prev = process.env.GEMINI_API_KEY; delete process.env.GEMINI_API_KEY
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('x')]).toString('base64')
    const r = await fetch(`http://127.0.0.1:${srv.port}/api/assess-wound`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ captureId: 'cap-rec-1', imageBase64: jpeg }),
    })
    expect((await r.json()).source).toBe('fallback')
    if (prev) process.env.GEMINI_API_KEY = prev
    const g = await open('src-rec', 'glasses')
    // wait for the state frame that actually contains the capture (the connect-time snapshot can arrive first)
    const withCapture = waitMsg(g, m => m.t === 'state' && m.state.woundCaptures?.length > 0, 4000)
    g.send(cap('cap-rec-1', { assessmentSource: 'gemini' }))
    expect((await withCapture).state.woundCaptures[0].assessmentSource).toBe('fallback')
    g.close()
  })
})
