// Per-peer sync health for the Director. Timers live here (never in applyAction). Frames are throttled to at most
// 2 per second per session and are sent only when something other than "last seen" changed.
import type { Device, PeerStats, ServerMsg } from '../shared/types'
import type { PingInfo } from '../shared/stats'

export const GHOST_MS = 60_000

interface Rec extends PeerStats { key: number }
interface Sess { peers: Map<number, Rec>; ghosts: Map<string, Rec>; lastJson: string; lastAt: number; timer: ReturnType<typeof setTimeout> | null }

export interface StatsHubOptions {
  now: () => number
  getVersion: (sid: string) => number
  deliver: (sid: string, msg: Extract<ServerMsg, { t: 'stats' }>) => void
  /** Minimum gap between frames for one session. Default 500 (2 per second). */
  minIntervalMs?: number
}

export function createStatsHub(opts: StatsHubOptions) {
  const min = opts.minIntervalMs ?? 500
  const sessions = new Map<string, Sess>()
  const get = (sid: string): Sess => {
    let s = sessions.get(sid)
    if (!s) { s = { peers: new Map(), ghosts: new Map(), lastJson: '', lastAt: Number.NEGATIVE_INFINITY, timer: null }; sessions.set(sid, s) }
    return s
  }
  const snapshot = (sid: string, s: Sess): Extract<ServerMsg, { t: 'stats' }> => {
    const t = opts.now()
    for (const [k, g] of s.ghosts) if (g.offlineSince !== null && t - g.offlineSince > GHOST_MS) s.ghosts.delete(k)
    const strip = ({ key: _k, ...p }: Rec): PeerStats => { void _k; return p }
    return { t: 'stats', peers: [...s.peers.values(), ...s.ghosts.values()].map(strip), serverVersion: opts.getVersion(sid) }
  }
  /** Change detection ignores `lastSeenMs`, which moves on every ping. */
  const sig = (m: Extract<ServerMsg, { t: 'stats' }>): string =>
    JSON.stringify({ v: m.serverVersion, p: m.peers.map(({ lastSeenMs: _l, ...p }) => { void _l; return p }) })

  const flush = (sid: string, s: Sess) => {
    s.timer = null
    const m = snapshot(sid, s)
    const j = sig(m)
    if (j === s.lastJson) return
    s.lastJson = j
    s.lastAt = opts.now()
    opts.deliver(sid, m)
  }
  const mark = (sid: string) => {
    const s = get(sid)
    if (s.timer) return // a trailing frame is already scheduled and will carry the latest
    const wait = min - (opts.now() - s.lastAt)
    if (wait <= 0) flush(sid, s)
    else s.timer = setTimeout(() => flush(sid, s), wait)
  }

  return {
    connected(sid: string, key: number, device: Device, instance?: string) {
      const s = get(sid)
      if (instance) s.ghosts.delete(instance)
      s.peers.set(key, { key, device, ...(instance ? { instance } : {}), v: null, q: 0, rttMs: null, lastSeenMs: opts.now(), offlineSince: null, lastOfflineMs: null })
      mark(sid)
    },
    ping(sid: string, key: number, p: PingInfo) {
      const r = sessions.get(sid)?.peers.get(key)
      if (!r) return
      r.lastSeenMs = opts.now()
      if (p.v !== undefined) r.v = p.v
      if (p.q !== undefined) r.q = p.q
      if (p.rttMs !== undefined) r.rttMs = p.rttMs
      if (p.offlineMs !== undefined) r.lastOfflineMs = p.offlineMs
      mark(sid)
    },
    closed(sid: string, key: number) {
      const s = sessions.get(sid)
      const r = s?.peers.get(key)
      if (!s || !r) return
      s.peers.delete(key)
      if (r.instance) s.ghosts.set(r.instance, { ...r, offlineSince: opts.now() })
      mark(sid)
    },
    /** The session's state version moved (an accepted action) or the director just connected: re-send if it differs. */
    versionChanged(sid: string) { mark(sid) },
    /** Forces the current frame out (a director just connected), ignoring change detection but not the rate limit. */
    resend(sid: string) { const s = get(sid); s.lastJson = ''; mark(sid) },
    dropSession(sid: string) {
      const s = sessions.get(sid)
      if (s?.timer) clearTimeout(s.timer)
      sessions.delete(sid)
    },
    dispose() { for (const s of sessions.values()) if (s.timer) clearTimeout(s.timer); sessions.clear() },
  }
}
