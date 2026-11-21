import express from 'express'
import { createServer, type Server } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, type WebSocket } from 'ws'
import type { Action, Device, ServerMsg, SessionState } from '../shared/types'
import { applyAction, getOrCreateSession, sessions, validateAction, SessionCapError, MAX_SESSIONS, isReplay, type PatientsData } from './sessionStore'

import { isMainModule } from './mainModule'
import { resolveAssessmentSource } from './captureSources'
import { registerApiRoutes, attachSttProxy, STT_PATH, type SttProxyOptions } from './api'

const MAX_FRAME = 64 * 1024
const __dirname = path.dirname(fileURLToPath(import.meta.url))

export function lanAddresses(): string[] {
  const out: string[] = []
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) out.push(i.address)
  }
  return out
}

export function urlsFor(host: string, port: number): string[] {
  const b = `http://${host}:${port}`
  return [`Phone (iPhone Safari): ${b}/phone`, `Glasses preview: ${b}/glasses`,
    `Director: ${b}/phone?director=1`, `Stage mirror: ${b}/glasses?mirror=1`]
}

/** Actions only a director may send. A plain START_SHIFT (the nurse's own button) is allowed; one with baseMin is not. */
function isDirectorOnly(a: Action): boolean {
  return a.type === 'RESET_SESSION' || a.type === 'SET_CLOCK_OFFSET' || a.type === 'DR_REPLY' || a.type.startsWith('SIM_') ||
    (a.type === 'START_SHIFT' && a.baseMin !== undefined)
}

/** Director capability for a connection: device=director or director=1, plus a matching `key` when DIRECTOR_KEY is set. */
function hasDirectorCapability(u: URL): boolean {
  const wants = u.searchParams.get('device') === 'director' || u.searchParams.get('director') === '1'
  if (!wants) return false
  const required = process.env.DIRECTOR_KEY
  return !required || u.searchParams.get('key') === required
}

/** A connection instance id: uuid-shaped (hex and dashes), 8 to 64 chars. Anything else is treated as "no instance". */
const INSTANCE_RE = /^[0-9a-fA-F-]{8,64}$/
export function parseInstance(v: string | null): string | undefined {
  return v !== null && INSTANCE_RE.test(v) ? v : undefined
}

/** Log and keep serving: a bad packet or stray rejection must not take the demo down. */
export function installCrashGuards(): () => void {
  const onErr = (err: unknown) => console.error('uncaught error (server keeps running):', err instanceof Error ? err.message : String(err))
  const onRej = (err: unknown) => console.error('unhandled rejection (server keeps running):', err instanceof Error ? err.message : String(err))
  process.on('uncaughtException', onErr)
  process.on('unhandledRejection', onRej)
  return () => { process.off('uncaughtException', onErr); process.off('unhandledRejection', onRej) }
}

export interface ServerOptions {
  /** Max live sessions (default 50). The oldest idle one is evicted. */
  maxSessions?: number
  /** Server ping interval; a socket that misses two pongs is terminated. Default 15000. */
  pingIntervalMs?: number
  stt?: SttProxyOptions
  host?: string
  port?: number
  patients?: PatientsData
  now?: () => number
  /** Delay between WOUND_SEND and the simulated doctor reply. Default 5000 (FRD AC#9). */
  drReplyDelayMs?: number
  hooks?: (app: express.Express, http: Server) => void
}

function loadPatients(): PatientsData | undefined {
  try {
    const f = path.resolve(__dirname, '../data/patients.json')
    return JSON.parse(readFileSync(f, 'utf8')) as PatientsData
  } catch { return undefined }
}

const FALLBACK_REPLY = { from: 'Dr. Okafor', text: 'Looks good. Continue the current dressing plan.' }
function loadDrReply(): { from: string; text: string } {
  try {
    const f = path.resolve(__dirname, '../data/demo-responses.json')
    const j = JSON.parse(readFileSync(f, 'utf8')) as { drReply?: { from?: unknown; text?: unknown } }
    if (typeof j.drReply?.from === 'string' && typeof j.drReply.text === 'string') return { from: j.drReply.from, text: j.drReply.text }
  } catch { /* use fallback */ }
  return FALLBACK_REPLY
}

export function createApp(opts: ServerOptions = {}) {
  const now = opts.now ?? Date.now
  const patients = opts.patients ?? loadPatients()
  const drReply = loadDrReply()
  const replyDelay = opts.drReplyDelayMs ?? 5000
  const app = express()
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, deepgram: !!process.env.DEEPGRAM_API_KEY, gemini: !!process.env.GEMINI_API_KEY, version: '0.1.0', lan: lanAddresses() })
  })
  app.get('/api/telemetry', (req, res) => {
    const sid = String(req.query.session ?? 'demo').slice(0, 64)
    res.set('Cache-Control', 'no-store').json({ session: sid, telemetry: sessions.get(sid)?.telemetry ?? {} })
  })
  const http = createServer(app)
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME })
  interface Peer { device: Device; director: boolean; misses: number; instance?: string }
  const rooms = new Map<string, Map<WebSocket, Peer>>()
  const maxSessions = opts.maxSessions ?? MAX_SESSIONS
  const isBusy = (sid: string) => (rooms.get(sid)?.size ?? 0) > 0
  /** Pending simulated doctor replies, keyed `${sessionId}:${captureId}`. Timers live here, never in applyAction. */
  const replyTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const broadcast = (sid: string, session: SessionState) => {
    for (const c of rooms.get(sid)?.keys() ?? []) send(c, { t: 'state', state: structuredClone(session) })
  }
  const presenceOf = (sid: string): Record<Device, number> => {
    const p: Record<Device, number> = { glasses: 0, phone: 0, director: 0 }
    for (const peer of rooms.get(sid)?.values() ?? []) p[peer.device]++
    return p
  }
  const broadcastPresence = (sid: string) => {
    const presence = presenceOf(sid)
    for (const c of rooms.get(sid)?.keys() ?? []) send(c, { t: 'presence', presence })
  }
  const clearReplyTimers = (sid: string, only?: string) => {
    for (const [k, tm] of replyTimers) {
      if (only ? k === `${sid}:${only}` : k.startsWith(`${sid}:`)) { clearTimeout(tm); replyTimers.delete(k) }
    }
  }
  const fireReply = (sid: string, captureId: string | undefined, from: string) => {
    if (!sessions.has(sid)) return // evicted while the timer ran
    const session = getOrCreateSession(sid, isBusy, maxSessions)
    const action: Action = {
      type: 'DR_REPLY', captureId, from, text: drReply.text, device: 'director',
      clientEventId: captureId ? `dr:${captureId}` : `dr:none:${session.eventSeq + 1}`,
    }
    const r = applyAction(session, action, now(), patients)
    if (r.ok) broadcast(sid, session)
  }
  const send = (ws: WebSocket, m: ServerMsg) => { try { if (ws.readyState === 1) ws.send(JSON.stringify(m)) } catch { /* ignore */ } }

  /** Server-side effects of accepted actions. Timers are scheduled here so applyAction stays pure and synchronous. */
  const afterAction = (sid: string, session: SessionState, a: Action) => {
    if (a.type === 'RESET_SESSION') { clearReplyTimers(sid); return }
    if (a.type === 'WOUND_SEND') {
      const key = `${sid}:${a.captureId}`
      if (replyTimers.has(key)) return // replayed send: one reply only
      const from = session.woundCaptures.find(c => c.captureId === a.captureId)?.sentTo ?? drReply.from
      const tm = setTimeout(() => { replyTimers.delete(key); fireReply(sid, a.captureId, from) }, replyDelay)
      replyTimers.set(key, tm)
    } else if (a.type === 'SIM_DR_REPLY') {
      const target = [...session.woundCaptures].reverse().find(c => c.status === 'sent' && !c.reply)
      if (target) clearReplyTimers(sid, target.captureId)
      fireReply(sid, target?.captureId, target?.sentTo ?? drReply.from)
    }
  }

  http.on('upgrade', (req, socket, head) => {
    let pathname: string
    try { pathname = new URL(req.url ?? '', 'http://x').pathname } catch { socket.destroy(); return }
    if (pathname !== '/ws') return // other upgrade handlers (STT proxy) may claim it; the last listener closes the rest
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req))
  })

  wss.on('connection', (ws, req) => {
    ws.on('error', () => { /* oversize frames etc: ws closes itself */ })
    let u: URL
    try { u = new URL(req.url ?? '', 'http://x') } catch { ws.close(1008, 'bad url'); return }
    const sid = (u.searchParams.get('session') ?? 'demo').slice(0, 64)
    const dev = u.searchParams.get('device')
    const director = hasDirectorCapability(u)
    // The role comes from the connection, never from a frame body. Without capability a "director" socket is just a phone.
    const device: Device = director ? 'director' : dev === 'glasses' ? 'glasses' : 'phone'
    let session: SessionState
    try { session = getOrCreateSession(sid, isBusy, maxSessions) } catch (e) {
      if (e instanceof SessionCapError) { ws.close(1013, 'too many sessions'); return }
      throw e
    }
    let room = rooms.get(sid)
    if (!room) { room = new Map(); rooms.set(sid, room) }
    // Stamped here and nowhere else: a frame body cannot claim another instance (validateAction drops it).
    const instance = parseInstance(u.searchParams.get('instance'))
    const peer: Peer = { device, director, misses: 0, instance }
    room.set(ws, peer)
    ws.on('pong', () => { peer.misses = 0 })
    ws.on('close', () => { room!.delete(ws); if (room!.size === 0 && rooms.get(sid) === room) rooms.delete(sid); broadcastPresence(sid) })
    send(ws, { t: 'state', state: structuredClone(session) })
    broadcastPresence(sid)
    ws.on('message', data => {
      try {
        const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as Buffer)
        if (buf.length > MAX_FRAME) return send(ws, { t: 'error', message: 'frame too large' })
        let raw: unknown
        try { raw = JSON.parse(buf.toString('utf8')) } catch { return send(ws, { t: 'error', message: 'bad json' }) }
        if (raw && typeof raw === 'object' && (raw as { t?: unknown }).t === 'ping') return send(ws, { t: 'pong' })
        const v = validateAction(raw)
        if ('error' in v) {
          const cid = (raw as { clientEventId?: unknown } | null)?.clientEventId
          return send(ws, { t: 'error', message: v.error, ...(typeof cid === 'string' && cid.length <= 100 ? { clientEventId: cid } : {}) })
        }
        const action = { ...v.action, device, ...(peer.instance ? { instance: peer.instance } : {}) } as Action // the body's device and instance are ignored
        if (isDirectorOnly(action) && !director) {
          const denied = { ok: false, message: 'Director only', state: structuredClone(session) }
          return send(ws, { t: 'result', clientEventId: action.clientEventId, result: denied })
        }
        if (action.type === 'WOUND_CAPTURED') action.assessmentSource = resolveAssessmentSource(action.captureId, action.assessmentSource)
        const result = applyAction(session, action, now(), patients)
        send(ws, { t: 'result', clientEventId: action.clientEventId, result })
        // A replayed id (outbox retry) changed nothing: no fan-out, and above all no timer side effects
        // (a duplicate RESET_SESSION would otherwise cancel a doctor reply scheduled after the original).
        if (result.ok && !isReplay(result)) {
          for (const c of room!.keys()) send(c, { t: 'state', state: result.state })
          afterAction(sid, session, action)
        }
      } catch { send(ws, { t: 'error', message: 'internal error' }) }
    })
  })

  registerApiRoutes(app)
  attachSttProxy(http, opts.stt)
  opts.hooks?.(app, http)
  // Last upgrade listener: any path nobody claimed is closed instead of hanging.
  http.on('upgrade', (req, socket) => {
    let pathname = ''
    try { pathname = new URL(req.url ?? '', 'http://x').pathname } catch { /* destroy below */ }
    if (pathname !== '/ws' && pathname !== STT_PATH && !socket.destroyed) socket.destroy()
  })
  const pingMs = opts.pingIntervalMs ?? 15_000
  const pinger = setInterval(() => {
    for (const room of rooms.values()) {
      for (const [ws, peer] of room) {
        if (peer.misses >= 2) { ws.terminate(); continue }
        peer.misses++
        try { ws.ping() } catch { /* terminated next tick */ }
      }
    }
  }, pingMs)
  pinger.unref()
  const dist = path.resolve(__dirname, '../dist')
  // Serve the built SPA whenever dist/ exists. No NODE_ENV needed: `npm start` must work on Windows too.
  if (existsSync(dist)) {
    app.use(express.static(dist))
    app.get('/{*splat}', (_req, res) => res.sendFile('index.html', { root: dist }))
  }
  const dispose = () => { clearInterval(pinger); for (const tm of replyTimers.values()) clearTimeout(tm); replyTimers.clear() }
  return { app, http, wss, dispose }
}

export function startServer(opts: ServerOptions = {}): Promise<{ http: Server; port: number; close: () => Promise<void> }> {
  const { http, wss, dispose } = createApp(opts)
  return new Promise(resolve => {
    http.listen(opts.port ?? 0, opts.host ?? '0.0.0.0', () => {
      const port = (http.address() as { port: number }).port
      resolve({
        http, port,
        close: () => new Promise<void>(r => { dispose(); for (const c of wss.clients) c.terminate(); wss.close(); http.close(() => r()) }),
      })
    })
  })
}

if (isMainModule(process.argv[1], import.meta.url)) {
  const port = Number(process.env.PORT) || 3001
  const host = process.env.HOST || '0.0.0.0'
  installCrashGuards()
  startServer({ port, host }).then(() => {
    console.log(`server on ${host}:${port}`)
    for (const l of urlsFor('localhost', port)) console.log(l)
    for (const ip of lanAddresses()) for (const l of urlsFor(ip, port)) console.log(l)
  })
}
