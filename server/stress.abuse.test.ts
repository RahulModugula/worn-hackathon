// @vitest-environment node
// Input abuse against the REAL server (ws + REST). The server must stay up, keep answering /api/health and keep memory bounded.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import net from 'node:net'
import WebSocket from 'ws'
import { startServer } from './index'

const patients = { nurse: { assignedPatientIds: ['p1'] }, patients: [{ id: 'p1', attending: 'Dr. Okafor', meds: [{ id: 'm1' }, { id: 'm2' }] }] }
let srv: Awaited<ReturnType<typeof startServer>>
const rejections: unknown[] = []
const onRej = (e: unknown) => { rejections.push(e) }
const base = () => `http://127.0.0.1:${srv.port}`
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const rss0 = { heap: 0 }

beforeAll(async () => {
  delete process.env.GEMINI_API_KEY
  process.on('unhandledRejection', onRej)
  srv = await startServer({ patients, drReplyDelayMs: 300, host: '127.0.0.1' })
  rss0.heap = process.memoryUsage().heapUsed
})
afterAll(async () => { process.off('unhandledRejection', onRej); await srv.close() })

const wsUrl = (sid: string, dev: string) => `ws://127.0.0.1:${srv.port}/ws?session=${sid}&device=${dev}`
const open = (sid: string, dev = 'phone') => new Promise<WebSocket>((res, rej) => {
  const w = new WebSocket(wsUrl(sid, dev)); w.on('open', () => res(w)); w.on('error', rej)
})
const msgs = (w: WebSocket) => { const a: any[] = []; w.on('message', d => a.push(JSON.parse(String(d)))); return a }
const waitFor = async (pred: () => boolean, ms = 3000) => { const t = Date.now(); while (!pred()) { if (Date.now() - t > ms) throw new Error('timeout'); await sleep(10) } }
const health = async () => (await fetch(`${base()}/api/health`)).json() as Promise<{ ok: boolean }>
let n = 0
const act = (o: object) => JSON.stringify({ device: 'phone', clientEventId: `a${++n}`, ...o })

describe('WS frame abuse', () => {
  it('oversized frame closes only that socket; server keeps serving', async () => {
    const w = await open('abuse1'); const closed = new Promise<number>(r => w.on('close', c => r(c)))
    w.send('x'.repeat(200 * 1024))
    expect(await closed).toBe(1009)
    expect((await health()).ok).toBe(true)
  })

  it('garbage, nested, wide, binary and numeric-edge frames each get an error or a refusal, never a crash', async () => {
    const w = await open('abuse2'); const m = msgs(w)
    const frames: (string | Buffer)[] = [
      '[' .repeat(30_000) + ']'.repeat(30_000),                       // deeply nested JSON
      '{"a":'.repeat(10_000) + '1' + '}'.repeat(10_000),
      act({ type: 'SIM_VOICE_DONE', payload: JSON.parse('['.repeat(200) + ']'.repeat(200)) }),
      '{' + Array.from({ length: 4_500 }, (_, i) => `"k${i}":${i}`).join(',') + '}', // 4.5k keys, just under the 64KB frame cap
      act({ type: 'SET_GLASSES_VIEW', view: Object.fromEntries(Array.from({ length: 5_000 }, (_, i) => [`k${i}`, 1])) }),
      Buffer.from([0, 1, 2, 3, 255, 254, 253]),
      Buffer.from(act({ type: 'UNDO_LAST_MED' })),                      // binary frame carrying valid JSON
      '{"device":"phone","clientEventId":"n1","type":"SET_CLOCK_OFFSET","offsetMin":1e999}',
      '{"device":"phone","clientEventId":"n2","type":"SET_CLOCK_OFFSET","offsetMin":NaN}',
      act({ type: 'SET_CLOCK_OFFSET', offsetMin: 1e308 }),
      act({ type: 'TELEMETRY_SAMPLE', metric: 'scanToCardMs', ms: -0 }),
      '{"device":"phone","clientEventId":"n3","type":"TELEMETRY_SAMPLE","metric":"scanToCardMs","ms":1e999}',
      act({ type: 'LOG_MED', patientId: 'p1\u0000', medKey: 'm1\u0000' }),
      act({ type: 'LOG_MED', patientId: '\u0000'.repeat(150), medKey: 'm1' }),
      act({ type: 'SET_ACTIVE_PATIENT', patientId: '__proto__' }),
      act({ type: '__proto__' }), act({ type: 'constructor' }), 'null', 'true', '42', '"str"', '[]', '',
      '{"__proto__":{"polluted":1},"device":"phone","clientEventId":"pp","type":"SIM_VOICE_DONE"}',
      JSON.stringify({ device: 'phone', clientEventId: 'x'.repeat(101), type: 'UNDO_LAST_MED' }),
      JSON.stringify({ device: 'phone', clientEventId: 'ok1', type: 'UNDO_LAST_MED', via: { toString: 1 } }),
    ]
    for (const f of frames) w.send(f)
    w.send(act({ type: 'START_SHIFT' }))
    await waitFor(() => m.some(x => x.t === 'result' && x.result.ok && x.result.state.shift))
    expect(w.readyState).toBe(1) // still connected: only oversize frames close
    expect(({} as any).polluted).toBeUndefined()
    expect((await health()).ok).toBe(true)
    const results = m.filter(x => x.t === 'result')
    expect(results.every(r => typeof r.result.ok === 'boolean')).toBe(true)
    w.close()
  })

  it('a nurse cannot become a director by claiming it in the frame', async () => {
    const w = await open('abuse3'); const m = msgs(w)
    w.send(act({ type: 'RESET_SESSION', device: 'director' }))
    w.send(act({ type: 'SET_CLOCK_OFFSET', offsetMin: 30, device: 'director' }))
    w.send(act({ type: 'START_SHIFT', baseMin: 100 }))
    await waitFor(() => m.filter(x => x.t === 'result').length === 3)
    expect(m.filter(x => x.t === 'result').every(r => r.result.ok === false && r.result.message === 'Director only')).toBe(true)
    w.close()
  })

  it('slow-loris: a half-sent WS frame and a half-sent HTTP request do not block other clients', async () => {
    const raw = net.connect(srv.port, '127.0.0.1')
    await new Promise<void>(r => raw.on('connect', () => r()))
    raw.write(`GET /ws?session=loris&device=phone HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`)
    await sleep(100)
    raw.write(Buffer.from([0x81, 0xfe, 0x10])) // text frame header announcing 16 KB, then silence
    const http = net.connect(srv.port, '127.0.0.1')
    await new Promise<void>(r => http.on('connect', () => r()))
    http.write('POST /api/assess-wound HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 100000\r\n\r\n{"captureId":')
    for (let i = 0; i < 5; i++) { http.write('"a'); await sleep(20) }
    const t0 = Date.now()
    expect((await health()).ok).toBe(true)
    const g = await open('loris2'); const m = msgs(g)
    g.send(act({ type: 'START_SHIFT' }))
    await waitFor(() => m.some(x => x.t === 'result'))
    expect(Date.now() - t0).toBeLessThan(1000)
    raw.destroy(); http.destroy(); g.close()
    expect((await health()).ok).toBe(true)
  })
})

describe('connection abuse', () => {
  it('1000 rapid reconnects leave no ghost sockets; presence returns to 0', async () => {
    const watcher = await open('churn', 'director'); const m = msgs(watcher)
    for (let b = 0; b < 10; b++) {
      const batch = await Promise.all(Array.from({ length: 100 }, () => open('churn', 'glasses')))
      for (const w of batch) w.close()
      await Promise.all(batch.map(w => new Promise<void>(r => (w.readyState === 3 ? r() : w.on('close', () => r())))))
    }
    await waitFor(() => { const p = [...m].reverse().find(x => x.t === 'presence'); return p && p.presence.glasses === 0 && p.presence.director === 1 }, 5000)
    watcher.close()
    expect((await health()).ok).toBe(true)
  }, 30_000)

  it('200 simultaneous sockets in one session all converge on one action', async () => {
    const socks = await Promise.all(Array.from({ length: 200 }, (_, i) => open('crowd', i % 3 === 0 ? 'glasses' : 'phone')))
    const logs = socks.map(msgs)
    socks[0].send(act({ type: 'LOG_MED', patientId: 'p1', medKey: 'm1', earlyConfirmed: true }))
    await waitFor(() => logs.every(l => l.some(x => x.t === 'state' && x.state.medStatus['p1:m1']?.status === 'given')), 5000)
    // all 200 race on the same med: exactly one winner
    const racers = socks.map((s, i) => { s.send(act({ type: 'LOG_MED', patientId: 'p1', medKey: 'm2', earlyConfirmed: true, clientEventId: `race-${i}` })) })
    void racers
    await waitFor(() => logs.every(l => l.filter(x => x.t === 'result').length >= (l === logs[0] ? 2 : 1)), 8000)
    const results = logs.flatMap(l => l.filter(x => x.t === 'result' && String(x.clientEventId).startsWith('race-')))
    expect(results).toHaveLength(200)
    expect(results.filter(r => r.result.ok)).toHaveLength(1)
    expect(results.filter(r => r.result.conflict)).toHaveLength(199)
    for (const s of socks) s.close()
  }, 30_000)

  it('session cap: a flood of distinct sessions never crashes the server (excess closed 1013)', async () => {
    const codes: number[] = []
    const held: WebSocket[] = []
    for (let i = 0; i < 70; i++) {
      const w = new WebSocket(wsUrl(`flood-${i}`, 'phone'))
      w.on('close', c => codes.push(c)); w.on('error', () => {}); held.push(w)
    }
    await sleep(800)
    for (const w of held) w.close()
    expect(codes.filter(c => c === 1013).length).toBeGreaterThan(0)
    expect((await health()).ok).toBe(true)
  })
})

describe('REST abuse', () => {
  const post = (path: string, body: BodyInit | undefined, type?: string) =>
    fetch(`${base()}${path}`, { method: 'POST', body, headers: type ? { 'content-type': type } : {} })
  it('huge base64 is a JSON 413, never an HTML page or a crash', async () => {
    const r = await post('/api/assess-wound', JSON.stringify({ captureId: 'c1', imageBase64: 'A'.repeat(5_000_000) }), 'application/json')
    expect(r.status).toBe(413)
    expect((await r.json()).error).toBe('payload_too_large')
  })
  it('invalid base64 / non-JPEG / bad ids / wrong types are 400s', async () => {
    const bad = ['not base64!!', 'AAAA', '=='.repeat(50), '\u0000\u0000', '/9j/' + '%%%']
    for (const img of bad) {
      const r = await post('/api/assess-wound', JSON.stringify({ captureId: 'c1', imageBase64: img }), 'application/json')
      expect(r.status, img).toBe(400)
    }
    for (const body of [JSON.stringify({ captureId: '../x' }), JSON.stringify({ captureId: 5 }), '[]', 'null', '"s"', '{']) {
      const r = await post('/api/assess-wound', body, 'application/json')
      expect([400], body).toContain(r.status)
      expect((await r.json()).ok).toBe(false)
    }
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/octet-stream', undefined]) {
      const r = await post('/api/assess-wound', JSON.stringify({ captureId: 'c1' }), type)
      expect(r.status, String(type)).toBeLessThan(500)
    }
    const up = await post('/api/upload-wound-photo', JSON.stringify({ captureId: 'c1', imageBase64: '/9j/' + 'A'.repeat(1000) + '$$$' }), 'application/json')
    expect(up.status).toBe(400)
  })
  it('a missing photo is "unavailable", never an invented finding (no key set)', async () => {
    const r = await post('/api/assess-wound', JSON.stringify({ captureId: 'c-none' }), 'application/json')
    expect(r.status).toBe(200)
    expect((await r.json()).source).toBe('unavailable')
  })
  it('unknown routes and wild paths do not 500', async () => {
    for (const p of ['/api/nope', '/api/wound-photo/%00', '/api/wound-photo/' + 'a'.repeat(5000), '/api/telemetry?session=' + 'x'.repeat(5000), '/%E0%A4%A']) {
      const r = await fetch(base() + p).catch(() => null)
      if (r) expect(r.status, p).toBeLessThan(500)
    }
    expect((await health()).ok).toBe(true)
  })
})

describe('doctor reply timer vs duplicate RESET (regression)', () => {
  it('a retried RESET_SESSION (same clientEventId) must not cancel a reply scheduled after the original', async () => {
    const d = await open('dupreset', 'director'); const m = msgs(d)
    const send = (o: object) => d.send(JSON.stringify({ device: 'director', ...o }))
    const final = (id: string) => waitFor(() => m.some(x => x.t === 'result' && x.clientEventId === id))
    send({ clientEventId: 'R', type: 'RESET_SESSION' }); await final('R')
    send({ clientEventId: 'W1', type: 'WOUND_CAPTURED', captureId: 'cap1', patientId: 'p1', finding: 'f', comparison: 'c', draftNote: 'n', assessmentSource: 'fallback' }); await final('W1')
    send({ clientEventId: 'S1', type: 'WOUND_SEND', captureId: 'cap1' }); await final('S1')
    send({ clientEventId: 'R', type: 'RESET_SESSION' }) // the outbox retries the same reset
    await sleep(60)
    send({ clientEventId: 'W2', type: 'WOUND_CAPTURED', captureId: 'cap2', patientId: 'p1', finding: 'f', comparison: 'c', draftNote: 'n', assessmentSource: 'fallback' }); await final('W2')
    send({ clientEventId: 'S2', type: 'WOUND_SEND', captureId: 'cap2' }); await final('S2')
    send({ clientEventId: 'R', type: 'RESET_SESSION' }) // duplicate again, after the second send was scheduled
    await waitFor(() => m.some(x => x.t === 'state' && x.state.woundCaptures.find((c: any) => c.captureId === 'cap2')?.reply), 2000)
    d.close()
  })
})

describe('after the abuse', () => {
  it('no unhandled rejections, memory bounded', async () => {
    await sleep(100)
    expect(rejections).toEqual([])
    const growthMb = (process.memoryUsage().heapUsed - rss0.heap) / 1048576
    expect(growthMb).toBeLessThan(250)
    expect((await health()).ok).toBe(true)
  })
})
