#!/usr/bin/env node
// Soak + chaos test of the REAL server. Pure Node + `ws`.
//   node scripts/stress/soak.mjs [--sessions 50] [--iterations 20] [--duration SECONDS] [--chaos 0.5] [--pause 300] [--dr-delay 100] [--json out.json]
// --duration N runs the full demo flow repeatedly for N seconds (sustained-rate variant) instead of a fixed iteration count.
import { spawn } from 'node:child_process'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { isDeepStrictEqual } from 'node:util'
import { writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import WebSocket from 'ws'

const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > -1 ? process.argv[i + 1] : def }
const N = Number(arg('sessions', 50))
const ITER = Number(arg('iterations', 20))
const DURATION = arg('duration') ? Number(arg('duration')) : 0
const CHAOS = Number(arg('chaos', 0.5))
const PAUSE = Number(arg('pause', 500)) // mean "human" pause between beats, ms
const DR_DELAY = Number(arg('dr-delay', 100)) // the real default is 5000 (FRD AC#9); shortened so 20 loops fit the budget
const JSON_OUT = arg('json')
const here = path.dirname(fileURLToPath(import.meta.url))
const sleep = ms => new Promise(r => setTimeout(r, ms))
const rnd = () => Math.random()

// ---------- server process ----------
const host = spawn(process.execPath, ['--expose-gc', '--import', 'tsx', path.join(here, 'server-host.mjs')], {
  cwd: path.resolve(here, '../..'), env: { ...process.env, DR_DELAY_MS: String(DR_DELAY), GEMINI_API_KEY: '', DIRECTOR_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'],
})
let serverExited = null
host.on('exit', (code, sig) => { serverExited = { code, sig } })
let serverLog = ''
host.stderr.on('data', d => { serverLog += d })
const port = await new Promise((resolve, reject) => {
  let buf = ''
  host.stdout.on('data', d => { buf += d; const m = /READY (\d+)/.exec(buf); if (m) resolve(Number(m[1])) })
  host.on('exit', () => reject(new Error('server exited before ready: ' + serverLog)))
  setTimeout(() => reject(new Error('server start timeout')), 30_000)
})
const base = `http://127.0.0.1:${port}`
const stats = async (q = '') => (await fetch(`${base}/__stress${q}`)).json()

// ---------- clients ----------
const failures = []
const fail = (msg) => { if (failures.length < 50) failures.push(msg); }
let unhandled = 0
process.on('unhandledRejection', e => { unhandled++; fail('client unhandledRejection: ' + (e && e.message)) })
process.on('uncaughtException', e => { unhandled++; fail('client uncaughtException: ' + (e && e.message)) })

const ackLat = [], peerLat = []
const counts = { actions: 0, acked: 0, ackTimeouts: 0, conflicts: 0, replaysSent: 0, garbageFrames: 0, socketKills: 0, offlineToggles: 0, reconnects: 0, iterations: 0, undoLate: 0, serverErrors: 0 }

class Client {
  constructor(sid, device, sess) {
    this.sid = sid; this.device = device; this.sess = sess
    this.outbox = []; this.pending = new Map(); this.state = null
    this.offline = false; this.stopped = false; this.ws = null
    this.versionTimes = new Map(); this.waiters = []
    this.lastRaw = null
  }
  url() { return `ws://127.0.0.1:${port}/ws?session=${this.sid}&device=${this.device}` }
  connect() {
    if (this.stopped || this.offline) return
    const ws = new WebSocket(this.url()); this.ws = ws
    ws.on('open', () => { for (const a of this.outbox) this.raw(JSON.stringify(a)) })
    ws.on('message', d => this.onMsg(d))
    ws.on('error', () => {})
    ws.on('close', () => { if (this.ws === ws) { this.ws = null; counts.reconnects++; if (!this.stopped && !this.offline) setTimeout(() => this.connect(), 10 + rnd() * 60) } })
  }
  raw(s) { if (this.ws && this.ws.readyState === 1) { try { this.ws.send(s) } catch { /* closing */ } } }
  onMsg(d) {
    const t = performance.now()
    let m; try { m = JSON.parse(String(d)) } catch { fail('non-JSON from server'); return }
    if (m.t === 'state') {
      this.state = m.state
      this.versionTimes.set(m.state.version, t)
      if (this.versionTimes.size > 64) this.versionTimes.delete(this.versionTimes.keys().next().value)
      for (const w of this.waiters.filter(w => w.v <= m.state.version)) w.fn(t)
      this.waiters = this.waiters.filter(w => w.v > m.state.version)
    } else if (m.t === 'result') {
      const p = this.pending.get(m.clientEventId)
      this.outbox = this.outbox.filter(a => a.clientEventId !== m.clientEventId)
      if (p) { this.pending.delete(m.clientEventId); p.resolve({ result: m.result, t }) }
    } else if (m.t === 'error') counts.serverErrors++
  }
  setOffline(on) {
    this.offline = on; counts.offlineToggles++
    if (on) { const w = this.ws; this.ws = null; try { w && w.terminate() } catch { /* */ } } else this.connect()
  }
  kill() { const w = this.ws; if (w) { counts.socketKills++; try { w.terminate() } catch { /* */ } } }
  /** Send an action; resolves with the server's result once acked (the outbox resends across reconnects). */
  act(partial) {
    const a = { device: this.device, clientEventId: randomUUID(), ...partial }
    counts.actions++
    const sent = performance.now(), gen = this.sess.chaosGen, v0 = this.sess.version
    this.outbox.push(a)
    this.lastRaw = JSON.stringify(a)
    const p = new Promise(resolve => this.pending.set(a.clientEventId, { resolve }))
    this.raw(this.lastRaw)
    const timeout = new Promise(r => setTimeout(() => r(null), 20_000))
    return Promise.race([p, timeout]).then(res => {
      if (!res) { counts.ackTimeouts++; fail(`ack timeout ${this.sid} ${this.device} ${a.type}`); this.pending.delete(a.clientEventId); return { ok: false, timeout: true, state: this.state } }
      counts.acked++
      const clean = gen === this.sess.chaosGen && !this.sess.anyOffline()
      if (clean) ackLat.push(res.t - sent)
      const r = res.result
      if (r.ok && clean && r.state) this.sess.measurePeers(this, r.state.version, sent, gen)
      if (r.conflict) counts.conflicts++
      return r
    })
  }
  waitVersion(v, cb) { const t = this.versionTimes.get(v); if (t !== undefined) cb(t); else this.waiters.push({ v, fn: cb }) }
  stop() { this.stopped = true; const w = this.ws; this.ws = null; try { w && w.close() } catch { /* */ } }
}

class Session {
  constructor(i) {
    this.sid = `soak-${i}`; this.chaosGen = 0; this.version = 0
    this.glasses = new Client(this.sid, 'glasses', this); this.phone = new Client(this.sid, 'phone', this); this.director = new Client(this.sid, 'director', this)
    this.clients = [this.glasses, this.phone, this.director]
    this.monkey = null
  }
  anyOffline() { return this.clients.some(c => c.offline || !c.ws || c.ws.readyState !== 1) }
  measurePeers(from, version, sent, gen) {
    for (const peer of this.clients) {
      if (peer === from) continue
      peer.waitVersion(version, t => { if (gen === this.chaosGen && peer.versionTimes.has(version)) peerLat.push(Math.max(0, t - sent)) })
    }
  }
  startMonkey() {
    const tick = () => {
      if (this.stopMonkey) return
      if (rnd() < CHAOS) {
        const c = this.clients[Math.floor(rnd() * 3)]
        const r = rnd()
        this.chaosGen++
        if (r < 0.3) c.kill()
        else if (r < 0.55) { c.setOffline(true); setTimeout(() => c.setOffline(false), 50 + rnd() * 350) }
        else if (r < 0.8) { // garbage frames
          counts.garbageFrames++
          const g = Math.floor(rnd() * 6)
          if (g === 0) c.raw('{not json')
          else if (g === 1 && c.ws) { try { c.ws.send(Buffer.from(Array.from({ length: 64 }, () => Math.floor(rnd() * 256)))) } catch { /* */ } }
          else if (g === 2) c.raw(JSON.stringify({ type: 'DROP', clientEventId: 'x', device: 'phone' }))
          else if (g === 3) c.raw('[' .repeat(2000))
          else if (g === 4) c.raw(JSON.stringify({ device: 'phone', clientEventId: randomUUID(), type: 'LOG_MED', patientId: { a: 1 }, medKey: null }))
          else c.raw('x'.repeat(70 * 1024)) // over the frame cap: server drops this socket
        } else if (c.lastRaw) { counts.replaysSent++; c.raw(c.lastRaw) } // duplicate event, same clientEventId
      }
      this.monkeyTimer = setTimeout(tick, 100 + rnd() * 200)
    }
    this.stopMonkey = false; tick()
  }
  endMonkey() { this.stopMonkey = true; clearTimeout(this.monkeyTimer) }
}

const beat = () => sleep(rnd() * 2 * PAUSE)

/** One pass of the 90 second demo: start shift, scan Rm 12, done, conflict from phone, undo, pain, wound capture+send, dr reply, reset. */
async function demoFlow(s, iter) {
  const { glasses: g, phone: p, director: d } = s
  const cid = `cap-${iter}`
  await p.act({ type: 'START_SHIFT' }); await beat()
  await g.act({ type: 'SET_ACTIVE_PATIENT', patientId: 'P-1012' })
  await g.act({ type: 'SET_GLASSES_VIEW', view: { screen: 'G4', patientId: 'P-1012' } }); await beat()
  const done = await g.act({ type: 'LOG_MED', patientId: 'P-1012', medKey: 'M-1', via: 'voice', scanLocked: true })
  if (!done.ok && !done.timeout) fail(`${s.sid} iter ${iter}: first LOG_MED refused: ${done.message}`)
  await g.act({ type: 'TELEMETRY_SAMPLE', metric: 'doneToAckMs', ms: 120 })
  const conflict = await p.act({ type: 'LOG_MED', patientId: 'P-1012', medKey: 'M-1', via: 'tap' })
  if (!conflict.timeout && (conflict.ok || !conflict.conflict)) fail(`${s.sid} iter ${iter}: phone LOG_MED after glasses did not conflict: ${JSON.stringify({ ok: conflict.ok, message: conflict.message })}`)
  await beat()
  const undo = await p.act({ type: 'UNDO_LAST_MED' })
  if (!undo.ok && !undo.timeout) { if (undo.message === 'Too late to undo') counts.undoLate++; else fail(`${s.sid} iter ${iter}: undo refused: ${undo.message}`) }
  await beat()
  await g.act({ type: 'WOUND_CAPTURED', captureId: cid, patientId: 'P-1012', finding: 'Incision edges closed.', comparison: 'Sample result', draftNote: 'Dressing intact.', assessmentSource: 'fallback' })
  const sent = await g.act({ type: 'WOUND_SEND', captureId: cid, draftNote: 'Dressing intact.' })
  if (!sent.ok && !sent.timeout) fail(`${s.sid} iter ${iter}: WOUND_SEND refused: ${sent.message}`)
  // the doctor reply is a server timer; it must arrive on the glasses
  const t0 = Date.now()
  while (Date.now() - t0 < 5000) {
    const c = g.state?.woundCaptures?.find(x => x.captureId === cid)
    if (c?.reply) break
    await sleep(25)
  }
  if (!g.state?.woundCaptures?.find(x => x.captureId === cid)?.reply) fail(`${s.sid} iter ${iter}: no dr reply within 5s`)
  await beat()
  await d.act({ type: 'RESET_SESSION' })
  counts.iterations++
}

async function settle(s) {
  s.endMonkey()
  for (const c of s.clients) if (c.offline) c.setOffline(false)
  for (const c of s.clients) if (!c.ws) c.connect()
  const t0 = Date.now()
  while (Date.now() - t0 < 10_000) {
    if (s.clients.every(c => c.ws && c.ws.readyState === 1 && c.outbox.length === 0 && c.state)) break
    await sleep(30)
  }
  // authoritative state: a fresh observer socket receives the server's snapshot on connect
  const obs = await new Promise((resolve, reject) => {
    const w = new WebSocket(`ws://127.0.0.1:${port}/ws?session=${s.sid}&device=phone`)
    w.on('message', d => { const m = JSON.parse(String(d)); if (m.t === 'state') { w.close(); resolve(m.state) } })
    w.on('error', reject)
  })
  const deadline = Date.now() + 5000
  for (const c of s.clients) {
    while (!isDeepStrictEqual(c.state, obs) && Date.now() < deadline) await sleep(30)
    if (!isDeepStrictEqual(c.state, obs)) fail(`CONVERGENCE ${s.sid} ${c.device}: client version ${c.state?.version} != server ${obs.version}`)
  }
  for (const c of s.clients) c.stop()
}

async function runSession(s, deadline) {
  s.clients.forEach(c => c.connect())
  await sleep(100)
  s.startMonkey()
  // keep s.version fresh for peer measurements (latest server version we saw)
  for (let i = 0; deadline ? Date.now() < deadline : i < ITER; i++) {
    try { await demoFlow(s, i) } catch (e) { fail(`${s.sid} iter ${i} threw: ${e && e.message}`) }
  }
  await settle(s)
}

const pct = (a, q) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))] * 100) / 100 }
const summ = a => ({ n: a.length, p50: pct(a, 0.5), p95: pct(a, 0.95), p99: pct(a, 0.99), max: a.length ? Math.round(Math.max(...a) * 100) / 100 : null })

// ---------- run ----------
const lag = monitorEventLoopDelay({ resolution: 10 }); lag.enable()
await sleep(300)
const before = await stats('?gc=1&reset=1')
const t0 = Date.now()
const mode = DURATION ? `sustained ${DURATION}s` : `${ITER} iterations`
console.log(`soak: ${N} sessions x (glasses+phone+director), ${mode}, chaos=${CHAOS}, pause~${PAUSE}ms, dr-delay=${DR_DELAY}ms, server port ${port}`)
const sessions = Array.from({ length: N }, (_, i) => new Session(i))
const deadline = DURATION ? Date.now() + DURATION * 1000 : 0
// each session tracks the highest version it has seen, so peer latency can be keyed on it
await Promise.all(sessions.map(s => runSession(s, deadline)))
const elapsed = (Date.now() - t0) / 1000
await sleep(500)
const during = await stats('?reset=1')
const after = await stats('?gc=1')
const health = await fetch(`${base}/api/health`).then(r => r.json()).catch(() => null)
if (!health?.ok) fail('health check failed after soak')
if (serverExited) fail('server process exited: ' + JSON.stringify(serverExited))
if (after.uncaught || after.unhandled) fail(`server reported uncaught=${after.uncaught} unhandled=${after.unhandled}`)
if (unhandled) fail('client side unhandled errors: ' + unhandled)
if (counts.iterations !== (DURATION ? counts.iterations : N * ITER)) fail(`only ${counts.iterations}/${N * ITER} iterations completed`)

const report = {
  date: new Date().toISOString(), node: process.version, mode, sessions: N, chaos: CHAOS, pauseMs: PAUSE, drDelayMs: DR_DELAY, elapsedSec: Math.round(elapsed * 10) / 10,
  counts, actionsPerSec: Math.round(counts.acked / elapsed),
  actionToAckMs: summ(ackLat), actionToPeerBroadcastMs: summ(peerLat),
  server: { before, during, after }, serverRssGrowthMb: Math.round((after.rssMb - before.rssMb) * 10) / 10, serverHeapGrowthAfterGcMb: Math.round((after.heapUsedMb - before.heapUsedMb) * 10) / 10,
  serverEventLoopLagMs: during.eventLoopMs,
  loadGeneratorEventLoopLagMs: { p50: Math.max(0, Math.round(lag.percentile(50) / 1e4) / 100 - 10), p99: Math.max(0, Math.round(lag.percentile(99) / 1e4) / 100 - 10), max: Math.max(0, Math.round(lag.max / 1e4) / 100 - 10) },
  failures,
}
console.log(JSON.stringify(report, null, 2))
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(report, null, 2))
host.kill('SIGTERM')
if (failures.length) { console.error(`SOAK FAILED: ${failures.length} problem(s)`); for (const f of failures.slice(0, 15)) console.error(' - ' + f); process.exit(1) }
console.log('SOAK PASSED')
process.exit(0)
