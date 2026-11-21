import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'

/** Generic synced-session client. No app-specific knowledge lives here. */
export interface BaseAction { clientEventId: string; device: string; type: string }
export interface SyncResult<S> { ok: boolean; conflict?: boolean; message?: string; state: S; clearOutbox?: boolean }
export interface Conflict<S> { clientEventId: string; message?: string; state: S }
/** The server's acknowledgement of one dispatched action (ok, conflict or failure). `seq` increases per result. */
export interface ResultEvent<S, A> {
  seq: number
  clientEventId: string
  ok: boolean
  conflict?: boolean
  message?: string
  action?: A
  state: S | null
}

/**
 * RFC 4122 v4 id that also works on non-secure origins (http://192.168.x.x in iPhone Safari), where
 * crypto.randomUUID is undefined. Falls back to getRandomValues, then to Math.random.
 */
export function makeUuid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  try { if (c && typeof c.randomUUID === 'function') return c.randomUUID() } catch { /* insecure context */ }
  const b = new Uint8Array(16)
  let filled = false
  try { if (c && typeof c.getRandomValues === 'function') { c.getRandomValues(b); filled = true } } catch { /* fall through */ }
  if (!filled) for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, x => x.toString(16).padStart(2, '0'))
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10).join('')}`
}

let memoryInstance: string | undefined
/**
 * An id for THIS browser tab or app instance, stable across reconnects and reloads of the tab (sessionStorage), different
 * for every other tab or device. Clients send it as `instance=` on the connect URL; the server stamps it on actions.
 */
export function getInstanceId(): string {
  try {
    const s = globalThis.sessionStorage
    let v = s.getItem('hud-instance')
    if (!v || !/^[0-9a-fA-F-]{8,64}$/.test(v)) { v = makeUuid(); s.setItem('hud-instance', v) }
    return v
  } catch {
    return (memoryInstance ??= makeUuid())
  }
}

interface WsLike {
  readyState: number
  send(data: string): void
  close(): void
  onopen: ((ev?: unknown) => void) | null
  onclose: ((ev?: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onerror: ((ev?: unknown) => void) | null
}
type WsCtor = new (url: string) => WsLike

export interface ClientOptions<S = unknown, A = unknown> {
  url: string
  storageKey: string
  WebSocketImpl?: WsCtor
  storage?: Pick<Storage, 'getItem' | 'setItem'>
  backoffMs?: (attempt: number) => number
  uuid?: () => string
  /** Called for every server acknowledgement of an action this client sent. */
  onResult?: (e: ResultEvent<S, A>) => void
  /** Heartbeat: ping every pingMs; no traffic within pongTimeoutMs after a ping means the socket is dead. 0 disables. */
  pingMs?: number
  pongTimeoutMs?: number
  /** Reads the state's version for ping reports. Default: the numeric `version` field. */
  versionOf?: (s: S) => number | undefined
  /** Called for each action that sat in the outbox and was just flushed, with how long it waited (ms). */
  onFlushed?: (e: { clientEventId: string; queuedMs: number; action: A }) => void
}

export interface Snapshot<S, A> {
  state: S | null
  offline: boolean
  forceOffline: boolean
  outbox: A[]
  conflicts: Conflict<S>[]
  /** Sockets connected per device role, as last broadcast by the server. Empty while disconnected. */
  presence: Record<string, number>
  /** True once the server has sent its state on the CURRENT connection (persisted state is not synced). */
  synced: boolean
  lastResult: ResultEvent<S, A> | null
  /** Round trip of the last ping/pong on this connection (ms), or null before the first pong. */
  rttMs: number | null
}

export function createSessionClient<S, A extends BaseAction>(opts: ClientOptions<S, A>) {
  const Ctor = opts.WebSocketImpl ?? (globalThis as unknown as { WebSocket: WsCtor }).WebSocket
  const backoff = opts.backoffMs ?? (n => Math.min(250 * 2 ** n, 5000))
  const uuid = opts.uuid ?? makeUuid
  const pingMs = opts.pingMs ?? 10_000
  const pongTimeoutMs = opts.pongTimeoutMs ?? 5_000
  let storage = opts.storage
  if (!storage) { try { storage = globalThis.localStorage } catch { /* none */ } }

  let state: S | null = null
  let outbox: A[] = []
  let conflicts: Conflict<S>[] = []
  let connected = false
  let forced = false
  let ws: WsLike | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let attempt = 0
  let stopped = false
  let presence: Record<string, number> = {}
  let synced = false
  let lastResult: ResultEvent<S, A> | null = null
  let resultSeq = 0
  const versionOf = opts.versionOf ?? ((s: S) => { const v = (s as { version?: unknown } | null)?.version; return typeof v === 'number' ? v : undefined })
  /** Send time per ping sequence number `n` still waiting for its pong (the server echoes `n`). */
  let pingSent = new Map<number, number>()
  let pingSeq = 0
  let rttMs: number | null = null
  /** When the current outage began (socket drop, or Force Offline); reported once as offlineMs on the next ping. */
  let offlineAt: number | null = null
  let verTimer: ReturnType<typeof setTimeout> | null = null
  let reportedV: number | undefined
  /** When each queued action entered the outbox (this page session only). */
  const queuedAt = new Map<string, number>()
  const sentActions = new Map<string, A>()
  let pingTimer: ReturnType<typeof setInterval> | null = null
  let pongTimer: ReturnType<typeof setTimeout> | null = null
  const listeners = new Set<() => void>()
  let snap: Snapshot<S, A>

  try {
    const raw = storage?.getItem(opts.storageKey)
    if (raw) { const p = JSON.parse(raw); state = p.state ?? null; outbox = Array.isArray(p.outbox) ? p.outbox : [] }
  } catch { /* ignore corrupt storage */ }

  const persist = () => { try { storage?.setItem(opts.storageKey, JSON.stringify({ state, outbox })) } catch { /* ignore */ } }
  const publish = () => {
    snap = { state, offline: forced || !connected, forceOffline: forced, outbox: [...outbox], conflicts: [...conflicts], presence, synced, lastResult, rttMs }
    persist()
    listeners.forEach(l => l())
  }
  publish()

  const rawSend = (o: unknown) => { try { ws?.send(JSON.stringify(o)) } catch { /* ignore */ } }
  const remember = (a: A) => {
    sentActions.set(a.clientEventId, a)
    if (sentActions.size > 200) sentActions.delete(sentActions.keys().next().value as string)
  }
  const emitResult = (clientEventId: string, r: { ok: boolean; conflict?: boolean; message?: string; state?: S }) => {
    const action = sentActions.get(clientEventId)
    sentActions.delete(clientEventId)
    const e: ResultEvent<S, A> = { seq: ++resultSeq, clientEventId, ok: r.ok, conflict: r.conflict, message: r.message, action, state: r.state ?? state }
    lastResult = e
    try { opts.onResult?.(e) } catch { /* a consumer bug must not break sync */ }
  }

  /** Health report for the server: state version, outbox depth, last measured round trip, and (once) how long we were away. */
  function sendPing(sock: WsLike) {
    const v = state === null ? undefined : versionOf(state)
    reportedV = v
    const n = ++pingSeq
    const ping: Record<string, unknown> = { t: 'ping', n, q: outbox.length }
    if (v !== undefined) ping.v = v
    if (rttMs !== null) ping.rtt = rttMs
    if (offlineAt !== null) { ping.offlineMs = Math.max(0, Date.now() - offlineAt); offlineAt = null }
    try { sock.send(JSON.stringify(ping)) } catch { return }
    pingSent.set(n, Date.now())
    if (pingSent.size > 8) pingSent.delete(pingSent.keys().next().value as number)
  }
  /** A newer state version is reported soon after it lands (debounced), so the Director sees convergence in real time. */
  function scheduleVersionPing() {
    if (verTimer || pingMs <= 0 || !ws) return
    const sock = ws
    verTimer = setTimeout(() => { verTimer = null; if (ws === sock && connected) sendPing(sock) }, 150)
  }

  function stopHeartbeat() {
    if (verTimer) { clearTimeout(verTimer); verTimer = null }
    pingSent = new Map()
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null }
    if (pongTimer) { clearTimeout(pongTimer); pongTimer = null }
  }
  function startHeartbeat(sock: WsLike) {
    stopHeartbeat()
    if (pingMs <= 0) return
    pingTimer = setInterval(() => {
      if (ws !== sock) return
      sendPing(sock);
      if (!pongTimer) pongTimer = setTimeout(() => { pongTimer = null; if (ws === sock) reconnectNow() }, pongTimeoutMs)
    }, pingMs)
  }

  function onMessage(ev: { data: unknown }) {
    let m: { t?: string; state?: S; clientEventId?: string; result?: SyncResult<S>; presence?: Record<string, number>; message?: string }
    try { m = JSON.parse(String(ev.data)) } catch { return }
    if (pongTimer) { clearTimeout(pongTimer); pongTimer = null } // any traffic proves the socket is alive
    if (m.t === 'pong') {
      const t0 = typeof (m as { n?: unknown }).n === 'number' ? pingSent.get((m as { n: number }).n) : undefined
      if (t0 !== undefined) { pingSent.delete((m as { n: number }).n); rttMs = Math.max(0, Date.now() - t0); publish() }
      return
    }
    if (m.t === 'state' && m.state) { state = m.state; synced = true }
    else if (m.t === 'presence' && m.presence && typeof m.presence === 'object') { presence = m.presence }
    else if (m.t === 'error' && m.clientEventId) {
      outbox = outbox.filter(a => a.clientEventId !== m.clientEventId)
      emitResult(m.clientEventId, { ok: false, message: m.message })
    }
    else if (m.t === 'result' && m.result && m.clientEventId) {
      state = m.result.state ?? state
      emitResult(m.clientEventId, m.result)
      if (m.result.clearOutbox) { outbox = []; conflicts = []; queuedAt.clear() }
      else {
        const before = outbox.length
        outbox = outbox.filter(a => a.clientEventId !== m.clientEventId)
        if (before !== outbox.length && !m.result.ok && m.result.conflict) {
          conflicts.push({ clientEventId: m.clientEventId, message: m.result.message, state: m.result.state })
        }
      }
    }
    publish()
    if (state !== null && versionOf(state) !== reportedV) scheduleVersionPing()
  }

  function connect() {
    if (stopped || forced || ws) return
    const sock = new Ctor(opts.url)
    ws = sock
    sock.onopen = () => {
      if (ws !== sock) return
      connected = true; attempt = 0
      startHeartbeat(sock)
      if (pingMs > 0) sendPing(sock) // report version, queue depth and the outage length BEFORE the flush drains the queue
      const flushAt = Date.now()
      for (const a of outbox) {
        remember(a); rawSend(a) // flush in order; results arrive in order
        const t0 = queuedAt.get(a.clientEventId)
        queuedAt.delete(a.clientEventId)
        if (t0 !== undefined) { try { opts.onFlushed?.({ clientEventId: a.clientEventId, queuedMs: Math.max(0, flushAt - t0), action: a }) } catch { /* telemetry must not break sync */ } }
      }
      publish()
    }
    sock.onmessage = onMessage
    sock.onerror = () => { /* close follows */ }
    sock.onclose = () => {
      if (ws !== sock) return
      ws = null; connected = false; synced = false; presence = {}; offlineAt ??= Date.now(); stopHeartbeat(); publish()
      if (!stopped && !forced) timer = setTimeout(() => { timer = null; connect() }, backoff(attempt++))
    }
  }

  function teardown() {
    if (timer) { clearTimeout(timer); timer = null }
    stopHeartbeat()
    synced = false; presence = {}
    if (ws !== null || connected) offlineAt ??= Date.now()
    const s = ws; ws = null; connected = false
    if (s) { s.onclose = null; try { s.close() } catch { /* ignore */ } }
  }

  /** Drops any (possibly half-open) socket and reconnects now with a fresh backoff. */
  function reconnectNow() {
    if (stopped || forced) return
    teardown(); attempt = 0; publish(); connect()
  }
  // iOS Safari freezes sockets when the page is backgrounded or the phone sleeps: recover on wake.
  const onVisible = () => { if ((globalThis as { document?: Document }).document?.visibilityState !== 'hidden') reconnectNow() }
  const onWake = () => reconnectNow()
  const listen = (on: boolean) => {
    const g = globalThis as { addEventListener?: Window['addEventListener']; removeEventListener?: Window['removeEventListener']; document?: Document }
    const op = on ? g.addEventListener : g.removeEventListener
    const dop = on ? g.document?.addEventListener : g.document?.removeEventListener
    try {
      op?.call(g, 'pageshow', onWake); op?.call(g, 'online', onWake)
      dop?.call(g.document, 'visibilitychange', onVisible)
    } catch { /* no DOM */ }
  }

  return {
    start() { stopped = false; listen(false); listen(true); connect() },
    stop() { stopped = true; listen(false); teardown() },
    reconnectNow,
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l) } },
    getSnapshot: () => snap,
    dispatch(partial: Omit<A, 'clientEventId'> & { clientEventId?: string }): A {
      const action = { ...partial, clientEventId: partial.clientEventId ?? uuid() } as A
      if (forced || !connected) { outbox.push(action); queuedAt.set(action.clientEventId, Date.now()); if (queuedAt.size > 500) queuedAt.delete(queuedAt.keys().next().value as string); publish() }
      else { remember(action); rawSend(action) }
      return action
    },
    setForceOffline(v: boolean) {
      forced = v
      if (v) teardown(); else { attempt = 0; connect() }
      publish()
    },
    clearConflicts() { conflicts = []; publish() },
  }
}

export interface UseSessionOptions<S = unknown, A = unknown> extends ClientOptions<S, A> {}

export function useSession<S, A extends BaseAction>(opts: UseSessionOptions<S, A>) {
  const optsRef = useRef(opts); optsRef.current = opts
  const client = useMemo(
    () => createSessionClient<S, A>({ ...opts, onResult: e => optsRef.current.onResult?.(e) }),
    [opts.url, opts.storageKey], // eslint-disable-line react-hooks/exhaustive-deps
  )
  useEffect(() => { client.start(); return () => client.stop() }, [client])
  const snap = useSyncExternalStore(client.subscribe, client.getSnapshot)
  const dispatch = useCallback((a: Omit<A, 'clientEventId'> & { clientEventId?: string }) => client.dispatch(a), [client])
  return {
    state: snap.state, offline: snap.offline, forceOffline: snap.forceOffline, outbox: snap.outbox,
    conflicts: snap.conflicts, presence: snap.presence, synced: snap.synced, lastResult: snap.lastResult, rttMs: snap.rttMs, dispatch, setForceOffline: client.setForceOffline, clearConflicts: client.clearConflicts,
  }
}
